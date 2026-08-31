import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Request } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { JwtUserPayload } from '../../auth/guards/jwt.types';
import { User } from '../../auth/entities/user.entity';
import { CommissionAdminGuard } from '../guards/commission-admin.guard';
import { CommissionAdminRateLimitGuard } from '../guards/commission-admin-rate-limit.guard';
import { CommissionAdminService } from './commission-admin.service';
import { CreateRuleDto } from '../dto/create-rule.dto';
import { UpdateRuleDto } from '../dto/update-rule.dto';
import {
  RuleAuditResponse,
  RuleResponse,
  toRuleAuditResponse,
  toRuleResponse,
} from '../dto/rule-response.dto';
import { RateSide, SubscriberTier } from '../commission.types';

interface AuthenticatedRequest extends Request {
  user: JwtUserPayload;
}

/** Optional filters for the rule list endpoint. */
interface ListQuery {
  appliesTo?: RateSide;
  isActive?: string;
}

/**
 * Commission-rule administration endpoints (operator only).
 *
 * Guarded by JWT + operator allowlist + a per-operator rate limit. Not on the offer hot
 * path. Every mutation is transactional (rule + audit) and triggers cache invalidation
 * inside the service. Overlap conflicts -> 409; invalid/over-cap rates -> 400.
 */
@Controller('admin/commission/rules')
@UseGuards(JwtAuthGuard, CommissionAdminGuard, CommissionAdminRateLimitGuard)
export class CommissionAdminController {
  constructor(
    private readonly adminService: CommissionAdminService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Req() req: AuthenticatedRequest,
    @Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })) dto: CreateRuleDto,
  ): Promise<RuleResponse> {
    const actorId = await this.resolveUserId(req.user.keycloakId);
    const rule = await this.adminService.createRule({
      country: dto.country ?? null,
      subscriberTier: (dto.subscriberTier as SubscriberTier | undefined) ?? null,
      serviceType: dto.serviceType ?? null,
      appliesTo: dto.appliesTo,
      rateBps: dto.rateBps,
      priority: dto.priority ?? 0,
      effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date(),
      effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
      actorId,
      reason: dto.reason ?? null,
    });
    return toRuleResponse(rule);
  }

  @Patch(':id')
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })) dto: UpdateRuleDto,
  ): Promise<RuleResponse> {
    const actorId = await this.resolveUserId(req.user.keycloakId);
    const rule = await this.adminService.updateRule(id, {
      country: dto.country,
      subscriberTier: dto.subscriberTier as SubscriberTier | undefined,
      serviceType: dto.serviceType,
      appliesTo: dto.appliesTo,
      rateBps: dto.rateBps,
      priority: dto.priority,
      effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : undefined,
      effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : undefined,
      actorId,
      reason: dto.reason ?? null,
    });
    return toRuleResponse(rule);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  async activate(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(new ValidationPipe({ whitelist: true })) body: { reason?: string },
  ): Promise<RuleResponse> {
    const actorId = await this.resolveUserId(req.user.keycloakId);
    const rule = await this.adminService.activateRule(id, actorId, body.reason ?? null);
    return toRuleResponse(rule);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  async deactivate(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(new ValidationPipe({ whitelist: true })) body: { reason?: string },
  ): Promise<RuleResponse> {
    const actorId = await this.resolveUserId(req.user.keycloakId);
    const rule = await this.adminService.deactivateRule(id, actorId, body.reason ?? null);
    return toRuleResponse(rule);
  }

  @Get()
  async list(@Query() query: ListQuery): Promise<RuleResponse[]> {
    const isActive =
      query.isActive === undefined ? undefined : query.isActive === 'true';
    const rules = await this.adminService.listRules({
      appliesTo: query.appliesTo,
      isActive,
    });
    return rules.map(toRuleResponse);
  }

  @Get(':id/audit')
  async audit(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<RuleAuditResponse[]> {
    const rows = await this.adminService.listAudit(id);
    return rows.map(toRuleAuditResponse);
  }

  /** Resolve the internal user id from the JWT keycloak id (for created_by/updated_by). */
  private async resolveUserId(keycloakId: string): Promise<string | null> {
    const user = await this.userRepository.findOne({ where: { keycloakId } });
    return user ? user.id : null;
  }
}
