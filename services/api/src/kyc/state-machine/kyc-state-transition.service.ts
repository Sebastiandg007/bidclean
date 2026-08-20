import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { KycVerification } from '../entities/kyc-verification.entity';
import { KycStatus } from '../kyc.types';
import { KycStateMachine } from './kyc-state-machine';
import {
  TransitionContext,
  TransitionResult,
  TransitionOptions,
} from './kyc-state-machine.types';
import {
  InvalidStateTransitionError,
  StateConflictError,
  TransitionGuardError,
} from './kyc-state-machine.errors';

/**
 * KYC State Transition Service.
 *
 * Wraps the pure state machine logic with database operations,
 * ensuring atomic transitions using SELECT ... FOR UPDATE
 * and idempotent behavior for mobile retry scenarios.
 */
@Injectable()
export class KycStateTransitionService {
  private readonly logger = new Logger(KycStateTransitionService.name);

  constructor(
    @InjectRepository(KycVerification)
    private readonly kycRepository: Repository<KycVerification>,
  ) {}

  /**
   * Perform an atomic state transition within a transaction.
   * Uses SELECT ... FOR UPDATE to prevent concurrent modifications.
   *
   * Idempotent: if the verification is already in the target state,
   * returns success without modifying the database.
   */
  async transition(options: TransitionOptions): Promise<TransitionResult> {
    const { targetStatus, context } = options;
    const { verification } = context;

    return this.kycRepository.manager.transaction(async (manager) => {
      return this.executeTransition(manager, verification.id, targetStatus, context);
    });
  }

  /**
   * Execute the transition within a provided EntityManager (transaction).
   * Useful when the caller already has a transaction open.
   */
  async transitionWithManager(
    manager: EntityManager,
    options: TransitionOptions,
  ): Promise<TransitionResult> {
    const { targetStatus, context } = options;
    const { verification } = context;

    return this.executeTransition(manager, verification.id, targetStatus, context);
  }

  private async executeTransition(
    manager: EntityManager,
    verificationId: string,
    targetStatus: KycStatus,
    context: TransitionContext,
  ): Promise<TransitionResult> {
    const locked = await this.acquireLock(manager, verificationId);
    const now = new Date();

    if (KycStateMachine.isIdempotent(locked.status, targetStatus)) {
      return this.buildIdempotentResult(locked, targetStatus, now);
    }

    this.validateTransition(locked.status, targetStatus);
    this.validateGuards(targetStatus, { ...context, verification: locked });

    const metadata = KycStateMachine.getTransitionMetadata(
      targetStatus,
      { ...context, verification: locked },
      now,
    );

    await this.applyAtomicUpdate(manager, locked, targetStatus, metadata);

    this.logger.log(
      `Transition: ${locked.status} → ${targetStatus} for verification ${verificationId}`,
    );

    return {
      verificationId,
      previousStatus: locked.status,
      newStatus: targetStatus,
      wasIdempotent: false,
      transitionedAt: now,
    };
  }

  /**
   * Acquire a row-level lock on the verification record.
   * SELECT ... FOR UPDATE prevents concurrent modifications.
   */
  private async acquireLock(
    manager: EntityManager,
    verificationId: string,
  ): Promise<KycVerification> {
    const locked = await manager
      .createQueryBuilder(KycVerification, 'v')
      .setLock('pessimistic_write')
      .where('v.id = :id', { id: verificationId })
      .getOne();

    if (!locked) {
      throw new StateConflictError(verificationId, KycStatus.NOT_STARTED);
    }

    return locked;
  }

  /**
   * Validate the state transition is allowed by the state machine.
   */
  private validateTransition(from: KycStatus, to: KycStatus): void {
    if (!KycStateMachine.isValidTransition(from, to)) {
      throw new InvalidStateTransitionError(from, to);
    }
  }

  /**
   * Validate all guard preconditions pass.
   */
  private validateGuards(targetStatus: KycStatus, context: TransitionContext): void {
    const guardResult = KycStateMachine.evaluateGuards(targetStatus, context);

    if (guardResult !== null) {
      throw new TransitionGuardError(guardResult.guardName, guardResult.reason);
    }
  }

  /**
   * Apply the state change atomically using UPDATE ... WHERE status = :expected.
   * If no rows are affected, a concurrent modification occurred.
   */
  private async applyAtomicUpdate(
    manager: EntityManager,
    verification: KycVerification,
    targetStatus: KycStatus,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const result = await manager
      .createQueryBuilder()
      .update(KycVerification)
      .set({ status: targetStatus, ...metadata })
      .where('id = :id AND status = :expectedStatus', {
        id: verification.id,
        expectedStatus: verification.status,
      })
      .execute();

    if (result.affected === 0) {
      throw new StateConflictError(verification.id, verification.status);
    }
  }

  /**
   * Build result for idempotent transition (already in target state).
   */
  private buildIdempotentResult(
    verification: KycVerification,
    targetStatus: KycStatus,
    now: Date,
  ): TransitionResult {
    this.logger.debug(
      `Idempotent transition: verification ${verification.id} already in ${targetStatus}`,
    );

    return {
      verificationId: verification.id,
      previousStatus: targetStatus,
      newStatus: targetStatus,
      wasIdempotent: true,
      transitionedAt: now,
    };
  }
}
