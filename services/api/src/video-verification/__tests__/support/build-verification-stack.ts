import { OutboxRow } from '../../../common/outbox/outbox-writer';
import { FaceVerifyClient } from '../../ai-client/face-verify.client';
import { FaceComparisonProcessor } from '../../jobs/face-comparison.processor';
import { RetentionCleanupProcessor } from '../../jobs/retention-cleanup.processor';
import { StuckProcessingSweep } from '../../jobs/stuck-processing-sweep.processor';
import { TombstoneDrainProcessor } from '../../jobs/tombstone-drain.processor';
import { UploadWindowSweep } from '../../jobs/upload-window-sweep.processor';
import { ConsumableGrant, CreateGrantParams } from '../../repository/upload-grant.repository';
import {
  CreateVerificationParams,
  TerminalDerivedFields,
  VerificationRow,
} from '../../repository/verification.repository';
import { VerificationCreationService } from '../../service/verification-creation.service';
import { VerificationParticipationService } from '../../service/verification-participation.service';
import { ComparisonJobData, VerificationService } from '../../service/verification.service';
import {
  Decision,
  FaceVerifyResult,
  GrantStatus,
  InspectResult,
  ObjectDeletionStatus,
  VerificationState,
} from '../../video-verification.types';

/**
 * In-memory fake stack for the video-verification backend (mirrors voice-notes' `buildVoiceStack`).
 *
 * Real service/processor/sweep logic runs against faithful in-memory fakes of the repository,
 * storage, KYC reference reader, AI client, and BullMQ queue — so unit + property tests exercise the
 * actual decision/transition/validation code with zero real MinIO/Postgres/Redis/AI I/O. The fakes
 * preserve the security-critical semantics: single-winner transitions, atomic `beginProcessing`
 * (loser never bumps the attempt), the latest-attempt stale guard, grant single-use, and
 * decision-bearing-only outbox emission.
 */

/** A stored MinIO object as the storage fake sees it (server-observed properties). */
export interface StoredObject {
  readonly sizeBytes: number;
  readonly contentType: string;
  readonly durationMs: number | null;
  readonly bytes: Buffer;
}

/** A mutable variant of the row so the in-memory fakes + tests can advance the state machine. */
export type MutableVerificationRow = { -readonly [K in keyof VerificationRow]: VerificationRow[K] };

let keyCounter = 0;

/** The in-memory database shared by every fake. */
export class FakeDb {
  verifications: MutableVerificationRow[] = [];
  grants: Array<{
    objectKey: string;
    serviceSessionId: string;
    issuedToUserId: string | null;
    status: string;
    expiresAt: Date;
    consumedVerificationId: string | null;
  }> = [];
  tombstones: Array<{ objectKey: string; status: string }> = [];
  outbox: OutboxRow[] = [];
}

/** Fake VerificationRepository — same public contract as the real repository. */
export class FakeVerificationRepository {
  constructor(private readonly db: FakeDb) {}

  async createFromArrival(params: CreateVerificationParams): Promise<MutableVerificationRow> {
    const existing = this.db.verifications.find(
      (v) => v.service_session_id === params.serviceSessionId,
    );
    if (existing) {
      return existing;
    }
    const row = this.newRow(params);
    this.db.verifications.push(row);
    return row;
  }

  async findById(id: string): Promise<MutableVerificationRow | null> {
    return this.db.verifications.find((v) => v.id === id) ?? null;
  }

  async findByServiceSessionId(serviceSessionId: string): Promise<MutableVerificationRow | null> {
    return this.db.verifications.find((v) => v.service_session_id === serviceSessionId) ?? null;
  }

  async markUploaded(_manager: unknown, id: string, objectKey: string): Promise<boolean> {
    const row = this.mutable(id);
    if (!row || row.state !== VerificationState.PENDING_UPLOAD) {
      return false;
    }
    row.state = VerificationState.UPLOADED;
    row.object_key = objectKey;
    row.uploaded_at = new Date();
    row.updated_at = new Date();
    return true;
  }

  async beginProcessing(id: string): Promise<{ attempt: number } | null> {
    const row = this.mutable(id);
    if (!row || row.state !== VerificationState.UPLOADED) {
      return null;
    }
    row.state = VerificationState.PROCESSING;
    row.processing_attempt += 1;
    row.updated_at = new Date();
    return { attempt: row.processing_attempt };
  }

  async retryProcessing(id: string, stuckBefore: Date): Promise<{ attempt: number } | null> {
    const row = this.mutable(id);
    if (!row || row.state !== VerificationState.PROCESSING || row.updated_at >= stuckBefore) {
      return null;
    }
    row.processing_attempt += 1;
    row.updated_at = new Date();
    return { attempt: row.processing_attempt };
  }

  async writeResultGuarded(
    id: string,
    attempt: number,
    next: VerificationState,
    derived: TerminalDerivedFields,
    outbox: OutboxRow[],
  ): Promise<boolean> {
    const row = this.mutable(id);
    if (!row || row.state !== VerificationState.PROCESSING || row.processing_attempt !== attempt) {
      return false;
    }
    row.state = next;
    if (derived.decision !== undefined) {
      row.decision = derived.decision;
    }
    if (derived.matchScore !== undefined) {
      row.match_score = derived.matchScore.toFixed(4);
    }
    if (derived.failureReason !== undefined) {
      row.failure_reason = derived.failureReason;
    }
    row.processed_at = new Date();
    row.updated_at = new Date();
    this.db.outbox.push(...outbox);
    return true;
  }

  async expireUpload(id: string): Promise<boolean> {
    const row = this.mutable(id);
    if (!row || row.state !== VerificationState.PENDING_UPLOAD) {
      return false;
    }
    row.state = VerificationState.EXPIRED;
    row.updated_at = new Date();
    return true;
  }

  async failFromProcessing(id: string, reason: string): Promise<boolean> {
    const row = this.mutable(id);
    if (!row || row.state !== VerificationState.PROCESSING) {
      return false;
    }
    row.state = VerificationState.FAILED;
    row.failure_reason = reason;
    row.processed_at = new Date();
    row.updated_at = new Date();
    return true;
  }

  async markVideoDeleted(id: string): Promise<boolean> {
    const row = this.mutable(id);
    if (!row || row.video_deleted_at !== null) {
      return false;
    }
    row.video_deleted_at = new Date();
    return true;
  }

  async findExpirableUploads(before: Date, limit: number): Promise<string[]> {
    return this.db.verifications
      .filter((v) => v.state === VerificationState.PENDING_UPLOAD && v.created_at < before)
      .slice(0, limit)
      .map((v) => v.id);
  }

  async findStuckProcessing(before: Date, limit: number): Promise<MutableVerificationRow[]> {
    return this.db.verifications
      .filter(
        (v) =>
          (v.state === VerificationState.UPLOADED || v.state === VerificationState.PROCESSING) &&
          v.updated_at < before,
      )
      .slice(0, limit);
  }

  async findRetentionEligible(before: Date, limit: number): Promise<MutableVerificationRow[]> {
    return this.db.verifications
      .filter((v) => v.video_deleted_at === null && v.uploaded_at !== null && v.uploaded_at < before)
      .slice(0, limit);
  }

  private mutable(id: string): MutableVerificationRow | undefined {
    return this.db.verifications.find((v) => v.id === id);
  }

  private newRow(params: CreateVerificationParams): MutableVerificationRow {
    const now = new Date();
    return {
      id: `ver-${this.db.verifications.length + 1}`,
      service_session_id: params.serviceSessionId,
      offer_id: params.offerId,
      cleaner_id: params.cleanerId,
      host_id: params.hostId,
      object_key: null,
      state: params.state,
      decision: null,
      match_score: null,
      match_threshold: params.matchThreshold.toFixed(4),
      reference_source: 'KYC_SELFIE',
      processing_attempt: 0,
      failure_reason: null,
      uploaded_at: null,
      processed_at: null,
      video_deleted_at: null,
      created_at: now,
      updated_at: now,
    };
  }
}

/** Fake UploadGrantRepository — same contract; grant single-use semantics preserved. */
export class FakeUploadGrantRepository {
  constructor(private readonly db: FakeDb) {}

  createGrantCalls = 0;

  async createGrant(params: CreateGrantParams): Promise<void> {
    this.createGrantCalls += 1;
    this.db.grants.push({
      objectKey: params.objectKey,
      serviceSessionId: params.serviceSessionId,
      issuedToUserId: params.issuedToUserId,
      status: GrantStatus.ISSUED,
      expiresAt: new Date(Date.now() + 600_000),
      consumedVerificationId: null,
    });
  }

  async findConsumable(_manager: unknown, objectKey: string): Promise<ConsumableGrant | null> {
    const grant = this.db.grants.find((g) => g.objectKey === objectKey);
    if (!grant) {
      return null;
    }
    return {
      objectKey: grant.objectKey,
      serviceSessionId: grant.serviceSessionId,
      issuedToUserId: grant.issuedToUserId,
      status: grant.status,
      expiresAt: grant.expiresAt,
    };
  }

  async markConsumed(_manager: unknown, objectKey: string, verificationId: string): Promise<void> {
    const grant = this.db.grants.find((g) => g.objectKey === objectKey);
    if (grant) {
      grant.status = GrantStatus.CONSUMED;
      grant.consumedVerificationId = verificationId;
    }
  }

  /** Force-expire a grant (test helper). */
  expire(objectKey: string): void {
    const grant = this.db.grants.find((g) => g.objectKey === objectKey);
    if (grant) {
      grant.expiresAt = new Date(Date.now() - 1000);
    }
  }
}

/** Fake ObjectDeletionRepository. */
export class FakeObjectDeletionRepository {
  constructor(private readonly db: FakeDb) {}

  async findPending(limit: number): Promise<Array<{ objectKey: string }>> {
    return this.db.tombstones
      .filter((t) => t.status === ObjectDeletionStatus.PENDING)
      .slice(0, limit)
      .map((t) => ({ objectKey: t.objectKey }));
  }

  async markDone(objectKey: string): Promise<void> {
    const t = this.db.tombstones.find((x) => x.objectKey === objectKey);
    if (t) {
      t.status = ObjectDeletionStatus.DONE;
    }
  }
}

/** Fake VerificationStorageService — records presign + tracks stored objects + deletions. */
export class FakeStorageService {
  objects = new Map<string, StoredObject>();
  deleted: string[] = [];
  /** Guard: this fake intentionally has NO playback/download presign method (P3). */
  readonly hasPlaybackMethod = false;

  generateObjectKey(): string {
    keyCounter += 1;
    return `ab/key-${keyCounter}`;
  }

  async presignUploadTarget(objectKey: string): Promise<{ objectKey: string; uploadUrl: string; expiresAt: string }> {
    return {
      objectKey,
      uploadUrl: `https://minio.test/put/${objectKey}`,
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    };
  }

  putObject(objectKey: string, obj: StoredObject): void {
    this.objects.set(objectKey, obj);
  }

  async inspectObject(objectKey: string): Promise<InspectResult> {
    const obj = this.objects.get(objectKey);
    if (!obj) {
      return { exists: false, sizeBytes: 0, contentType: '', durationMs: null };
    }
    return {
      exists: true,
      sizeBytes: obj.sizeBytes,
      contentType: obj.contentType,
      durationMs: obj.durationMs,
    };
  }

  async readObject(objectKey: string): Promise<Buffer | null> {
    return this.objects.get(objectKey)?.bytes ?? null;
  }

  async deleteObjectSafe(objectKey: string): Promise<void> {
    this.deleted.push(objectKey);
    this.objects.delete(objectKey);
  }
}

/** Fake KYC reference reader — returns a configured selfie or null. */
export class FakeKycReferenceReader {
  private selfies = new Map<string, Buffer | null>();

  setSelfie(cleanerId: string, bytes: Buffer | null): void {
    this.selfies.set(cleanerId, bytes);
  }

  async getVerifiedSelfie(cleanerId: string): Promise<Buffer | null> {
    return this.selfies.get(cleanerId) ?? null;
  }
}

/** Fake FaceVerifyClient — returns a scripted result or throws a scripted error. */
export class FakeFaceVerifyClient {
  next: FaceVerifyResult | Error = { score: 0.9, decision: Decision.MATCH };

  async compare(): Promise<FaceVerifyResult> {
    if (this.next instanceof Error) {
      throw this.next;
    }
    return this.next;
  }
}

/** Fake BullMQ queue — records enqueued jobs. */
export class FakeQueue {
  jobs: ComparisonJobData[] = [];
  failNext = false;

  async add(_name: string, data: ComparisonJobData): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('enqueue failed (simulated)');
    }
    this.jobs.push(data);
  }
}

/** The assembled stack the tests drive. */
export interface VerificationStack {
  db: FakeDb;
  repository: FakeVerificationRepository;
  grantRepository: FakeUploadGrantRepository;
  objectDeletionRepository: FakeObjectDeletionRepository;
  storage: FakeStorageService;
  kycReader: FakeKycReferenceReader;
  faceVerify: FakeFaceVerifyClient;
  queue: FakeQueue;
  participation: VerificationParticipationService;
  creationService: VerificationCreationService;
  service: VerificationService;
  processor: FaceComparisonProcessor;
  uploadSweep: UploadWindowSweep;
  stuckSweep: StuckProcessingSweep;
  retention: RetentionCleanupProcessor;
  tombstoneDrain: TombstoneDrainProcessor;
}

/** Build a fresh stack wiring the REAL services/processors to the fakes. */
export function buildVerificationStack(): VerificationStack {
  const db = new FakeDb();
  const repository = new FakeVerificationRepository(db);
  const grantRepository = new FakeUploadGrantRepository(db);
  const objectDeletionRepository = new FakeObjectDeletionRepository(db);
  const storage = new FakeStorageService();
  const kycReader = new FakeKycReferenceReader();
  const faceVerify = new FakeFaceVerifyClient();
  const queue = new FakeQueue();

  // The finalize path uses `dataSource.transaction(cb)` — the fake runs the callback with a null
  // manager (the fake grant/verification repos ignore the manager argument).
  const dataSource = {
    transaction: async <T>(cb: (manager: unknown) => Promise<T>): Promise<T> => cb(null),
  };

  const participation = new VerificationParticipationService(
    repository as unknown as import('../../repository/verification.repository').VerificationRepository,
  );
  const creationService = new VerificationCreationService(
    repository as unknown as import('../../repository/verification.repository').VerificationRepository,
  );
  const service = new VerificationService(
    dataSource as never,
    repository as never,
    grantRepository as never,
    participation,
    storage as never,
    queue as never,
  );
  const processor = new FaceComparisonProcessor(
    repository as never,
    storage as never,
    kycReader as never,
    faceVerify as unknown as FaceVerifyClient,
  );
  const uploadSweep = new UploadWindowSweep(repository as never);
  const stuckSweep = new StuckProcessingSweep(repository as never, queue as never);
  const retention = new RetentionCleanupProcessor(repository as never, storage as never);
  const tombstoneDrain = new TombstoneDrainProcessor(objectDeletionRepository as never, storage as never);

  return {
    db,
    repository,
    grantRepository,
    objectDeletionRepository,
    storage,
    kycReader,
    faceVerify,
    queue,
    participation,
    creationService,
    service,
    processor,
    uploadSweep,
    stuckSweep,
    retention,
    tombstoneDrain,
  };
}

/** Seed a PENDING_UPLOAD verification directly (skips the arrival path) and return its id. */
export async function seedPendingVerification(
  stack: VerificationStack,
  overrides: Partial<CreateVerificationParams> = {},
): Promise<string> {
  const row = await stack.repository.createFromArrival({
    serviceSessionId: overrides.serviceSessionId ?? `sess-${stack.db.verifications.length + 1}`,
    offerId: overrides.offerId ?? 'offer-1',
    cleanerId: overrides.cleanerId ?? 'cleaner-1',
    hostId: overrides.hostId ?? 'host-1',
    state: overrides.state ?? VerificationState.PENDING_UPLOAD,
    matchThreshold: overrides.matchThreshold ?? 0.6,
  });
  return row.id;
}
