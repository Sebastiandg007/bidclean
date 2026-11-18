import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtUserPayload } from '../auth/guards/jwt.types';
import { User } from '../auth/entities/user.entity';
import { DeviceRegistryService } from './device-registry.service';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { UpdateConsentDto } from './dto/update-consent.dto';

/** Request with the typed JWT user payload attached by the guard. */
interface AuthenticatedRequest extends Request {
  user: JwtUserPayload;
}

/**
 * Device registry controller (self-scoped, Model B).
 *
 * All operations act on the JWT subject's OWN devices. A body `userId` differing from the resolved
 * subject is rejected with 403 and mutates nothing (Property 7). Identity is resolved from
 * `req.user.keycloakId -> internal user id`.
 */
@Controller('notifications/devices')
@UseGuards(JwtAuthGuard)
export class NotificationDeviceController {
  constructor(
    private readonly registry: DeviceRegistryService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  /** POST /notifications/devices — register/upsert the caller's device. */
  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  async register(@Req() req: AuthenticatedRequest, @Body() dto: RegisterDeviceDto): Promise<void> {
    const user = await this.resolveUser(req.user.keycloakId);
    if (dto.userId !== undefined && dto.userId !== user.id) {
      throw new ForbiddenException('Cannot register a device for another user');
    }
    await this.registry.registerDevice(user, dto.onesignalPlayerId, dto.platform, dto.consentGranted);
  }

  /** PATCH /notifications/devices/:playerId/consent — update the caller's device consent. */
  @Patch(':playerId/consent')
  @HttpCode(HttpStatus.NO_CONTENT)
  async updateConsent(
    @Req() req: AuthenticatedRequest,
    @Param('playerId') playerId: string,
    @Body() dto: UpdateConsentDto,
  ): Promise<void> {
    const user = await this.resolveUser(req.user.keycloakId);
    await this.registry.updateConsent(user, playerId, dto.consentGranted);
  }

  /** DELETE /notifications/devices/:playerId — unregister (logout) the caller's device. */
  @Delete(':playerId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unregister(
    @Req() req: AuthenticatedRequest,
    @Param('playerId') playerId: string,
  ): Promise<void> {
    const user = await this.resolveUser(req.user.keycloakId);
    await this.registry.unregisterDevice(user.id, playerId);
  }

  /** Resolve the internal user from the JWT subject, or reject when unknown. */
  private async resolveUser(keycloakId: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { keycloakId } });
    if (!user) {
      throw new ForbiddenException('User not found');
    }
    return user;
  }
}
