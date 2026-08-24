import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UnprocessableEntityException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Request, Response } from 'express';
import { PropertiesService, CreatePropertyResult } from './properties.service';
import { PropertyPhotoService } from './photo/property-photo.service';
import { GeocodingService } from './geocoding/geocoding.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OnboardingGateGuard, RequireOnboarding } from '../roles/guards';
import { PropertyOwnerGuard } from './guards/property-owner.guard';
import { UserRole } from '../roles/roles.types';
import { JwtUserPayload } from '../auth/guards/jwt.types';
import { CreatePropertyDto } from './dto/create-property.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';
import { PropertyQueryDto } from './dto/property-query.dto';
import { ReorderPhotosDto } from './dto/reorder-photos.dto';
import { ForwardGeocodeDto } from './dto/geocode-request.dto';
import { PropertyDetailResponse, PropertyListResponse } from './dto/property-response.dto';
import { PhotoUploadResult } from './photo/property-photo.types';
import { ForwardGeocodeResponse } from './geocoding/geocoding.types';
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
  ) {}

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
   * POST /properties/geocode — Forward geocode an address to coordinates.
   * Requires Host role with completed onboarding.
   * Rate limited per user (configured via PROPERTY_GEOCODING_RATE_LIMIT).
   * Returns lat/lng, formattedAddress, and confidence score.
   * Returns 422 if geocoding produces no results.
   */
  @Post('geocode')
  @UseGuards(OnboardingGateGuard)
  @RequireOnboarding(UserRole.HOST)
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  async geocodeAddress(
    @Body() dto: ForwardGeocodeDto,
    @Req() req: Request & { user: JwtUserPayload },
  ): Promise<ForwardGeocodeResponse> {
    const userId = await this.resolveUserId(req.user.keycloakId);

    const result = await this.geocodingService.forwardGeocode(
      { address: dto.address, country: dto.country },
      userId,
    );

    if (!result) {
      throw new UnprocessableEntityException('property.error.geocoding_failed');
    }

    return result;
  }

  /**
   * GET /properties/:id — Get full property detail (owner view).
   * Returns all fields including private data, photo signed URLs
   * ordered by display_order ASC, and offer-readiness status.
   * Ownership enforced at both guard and query level.
   */
  @Get(':id')
  @UseGuards(PropertyOwnerGuard)
  async getPropertyDetail(
    @Param('id') propertyId: string,
    @Req() req: Request & { user: JwtUserPayload },
  ): Promise<PropertyDetailResponse> {
    const userId = await this.resolveUserId(req.user.keycloakId);
    const detail = await this.propertiesService.getPropertyDetail(propertyId, userId);

    if (!detail) {
      throw new NotFoundException('property.error.not_found');
    }

    return detail;
  }

  /**
   * PATCH /properties/:id — Update an existing property (partial update).
   * Requires Host role with ownership verification.
   * PropertyOwnerGuard enforces ownership as secondary defense.
   * Address changes trigger re-geocoding (location_source → GEOCODED).
   * Coordinate changes update location_source → MANUAL.
   * Consults OfferEditabilityCheck before applying changes.
   */
  @Patch(':id')
  @UseGuards(PropertyOwnerGuard)
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  async updateProperty(
    @Param('id') propertyId: string,
    @Body() dto: UpdatePropertyDto,
    @Req() req: Request & { user: JwtUserPayload },
  ): Promise<PropertyDetailResponse> {
    const userId = await this.resolveUserId(req.user.keycloakId);
    const result = await this.propertiesService.updateProperty(propertyId, userId, dto);

    if (!result) {
      throw new NotFoundException('property.error.not_found');
    }

    return result;
  }

  /**
   * DELETE /properties/:id — Soft delete a property.
   * Requires Host role with ownership verification.
   * PropertyOwnerGuard enforces ownership as secondary defense.
   * Consults OfferEditabilityCheck to ensure no active offers block deletion.
   * Returns 204 No Content on success.
   * Returns 404 if property not found or not owned.
   * Returns 409 Conflict if the property has active offers.
   */
  @Delete(':id')
  @UseGuards(PropertyOwnerGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteProperty(
    @Param('id') propertyId: string,
    @Req() req: Request & { user: JwtUserPayload },
  ): Promise<void> {
    const userId = await this.resolveUserId(req.user.keycloakId);
    const deleted = await this.propertiesService.deleteProperty(propertyId, userId);

    if (!deleted) {
      throw new NotFoundException('property.error.not_found');
    }
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
  ): Promise<{ id: string; property: CreatePropertyResult['property'] }> {
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

    return { id: result.property.id, property: result.property };
  }

  /**
   * POST /properties/:id/photos — Upload a photo for a property.
   * Requires Host role with ownership verification (PropertyOwnerGuard).
   * Accepts file via multipart form-data with field name "file".
   * Supports Idempotency-Key header for duplicate prevention.
   * Returns 201 for new upload, 200 for idempotent duplicate.
   * Returns 400 for invalid format or max photos reached, 413 for file too large.
   */
  @Post(':id/photos')
  @UseGuards(PropertyOwnerGuard)
  @UseInterceptors(FileInterceptor('file'))
  async uploadPhoto(
    @Param('id') propertyId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PhotoUploadResult> {
    if (!file) {
      throw new BadRequestException('property.error.file_required');
    }

    const result = await this.propertyPhotoService.uploadPhoto(
      propertyId,
      file.buffer,
      file.mimetype,
      idempotencyKey,
    );

    const isIdempotentDuplicate =
      idempotencyKey !== undefined &&
      result.storageKey === `${propertyId}/${idempotencyKey}`;

    if (isIdempotentDuplicate) {
      res.status(HttpStatus.OK);
    } else {
      res.status(HttpStatus.CREATED);
    }

    return result;
  }

  /**
   * DELETE /properties/:id/photos/:photoId — Delete a property photo.
   * Requires Host role with ownership verification (PropertyOwnerGuard).
   * Removes photo from MinIO and DB within a transaction with SELECT FOR UPDATE.
   * Renumbers remaining photos to maintain contiguous display_order (0, 1, 2, ...).
   * Returns 204 No Content on success.
   * Returns 404 if photo not found.
   */
  @Delete(':id/photos/:photoId')
  @UseGuards(PropertyOwnerGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async deletePhoto(
    @Param('id') propertyId: string,
    @Param('photoId') photoId: string,
  ): Promise<void> {
    await this.propertyPhotoService.deletePhoto(propertyId, photoId);
  }

  /**
   * PATCH /properties/:id/photos/order — Reorder property photos.
   * Requires Host role with ownership verification (PropertyOwnerGuard).
   * Accepts an array of photo IDs in desired display order.
   * Executes within a TRANSACTION with SELECT FOR UPDATE to prevent concurrent corruption.
   * Validates all photo IDs belong to the property.
   * Returns 200 OK with success confirmation.
   */
  @Patch(':id/photos/order')
  @UseGuards(PropertyOwnerGuard)
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  async reorderPhotos(
    @Param('id') propertyId: string,
    @Body() dto: ReorderPhotosDto,
  ): Promise<{ message: string }> {
    await this.propertyPhotoService.reorderPhotos(propertyId, dto.photoIds);
    return { message: 'property.photos.reordered' };
  }

  /** Resolves the internal user UUID from the Keycloak subject ID. */
  private async resolveUserId(keycloakId: string): Promise<string> {
    const user = await this.userRepository.findOne({ where: { keycloakId } });
    if (!user) {
      throw new NotFoundException('auth.error.user_not_found');
    }
    return user.id;
  }
}
