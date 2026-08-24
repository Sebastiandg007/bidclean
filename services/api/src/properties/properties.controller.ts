import {
  Body,
  Controller,
  Get,
  Headers,
  HttpStatus,
  NotFoundException,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Request, Response } from 'express';
import { PropertiesService } from './properties.service';
import { PropertyPhotoService } from './photo/property-photo.service';
import { GeocodingService } from './geocoding/geocoding.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OnboardingGateGuard, RequireOnboarding } from '../roles/guards';
import { UserRole } from '../roles/roles.types';
import { JwtUserPayload } from '../auth/guards/jwt.types';
import { CreatePropertyDto } from './dto/create-property.dto';
import { PropertyQueryDto } from './dto/property-query.dto';
import { PropertyListResponse } from './dto/property-response.dto';
import { User } from '../auth/entities/user.entity';

/**
 * Properties controller.
 * Exposes endpoints for property CRUD, photo management,
 * geocoding proxies, and public property views.
 *
 * All endpoints require JWT authentication.
 * Mutation endpoints additionally require Host role + OnboardingGateGuard.
 */
@Controller('properties')
@UseGuards(JwtAuthGuard)
export class PropertiesController {
  constructor(
    private readonly propertiesService: PropertiesService,
    private readonly propertyPhotoService: PropertyPhotoService,
    private readonly geocodingService: GeocodingService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {
    // Reference to suppress noUnusedLocals until all endpoints are implemented.
    void this.propertyPhotoService;
    void this.geocodingService;
  }

  /**
   * GET /properties — List the current user's properties (paginated).
   * Supports search, type filter, and configurable sorting.
   */
  @Get()
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async listProperties(
    @Query() query: PropertyQueryDto,
    @Req() req: Request & { user: JwtUserPayload },
  ): Promise<PropertyListResponse> {
    const userId = await this.resolveUserId(req.user.keycloakId);
    return this.propertiesService.listProperties(userId, query);
  }

  /**
   * POST /properties — Create a new property.
   * Requires Host role with completed onboarding.
   * Supports Idempotency-Key header for duplicate prevention.
   * Returns 201 for new creation, 200 for idempotent duplicate.
   */
  @Post()
  @UseGuards(OnboardingGateGuard)
  @RequireOnboarding(UserRole.HOST)
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  async createProperty(
    @Body() dto: CreatePropertyDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: Request & { user: JwtUserPayload },
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ id: string; property: Record<string, unknown> }> {
    const userId = await this.resolveUserId(req.user.keycloakId);

    const result = await this.propertiesService.createProperty(
      userId,
      dto,
      idempotencyKey,
    );

    if (result.isNew) {
      res.status(HttpStatus.CREATED);
    } else {
      res.status(HttpStatus.OK);
    }

    return { id: result.property.id, property: result.property as unknown as Record<string, unknown> };
  }

  /** Resolves the internal user UUID from the Keycloak subject ID. */
  private async resolveUserId(keycloakId: string): Promise<string> {
    const user = await this.userRepository.findOne({ where: { keycloakId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user.id;
  }
}
