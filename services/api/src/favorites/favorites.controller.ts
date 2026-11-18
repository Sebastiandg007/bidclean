import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Request, Response } from 'express';
import { Repository } from 'typeorm';

import { User } from '../auth/entities/user.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtUserPayload } from '../auth/guards/jwt.types';
import { UserRole } from '../roles/roles.types';
import { AddFavoriteDto } from './dto/add-favorite.dto';
import { ListFavoritesQueryDto } from './dto/list-favorites-query.dto';
import {
  FAVORITES_ERROR_MESSAGES,
  FAVORITES_EXPOSE_AGGREGATE_COUNT,
  FAVORITES_LIST_DEFAULT_LIMIT,
} from './favorites.constants';
import { FavoritesService } from './favorites.service';
import { AddResult, FavoriteView, Paginated } from './favorites.types';

/** Request with the typed JWT user payload attached by the guard. */
interface AuthenticatedRequest extends Request {
  user: JwtUserPayload;
}

/**
 * FavoritesController — the Host CRUD + the opt-in Cleaner-facing aggregate-count (Spec 22).
 *
 * Identity is resolved server-side from `req.user.keycloakId → userId` (never client-asserted). Host
 * endpoints require the Host role (`403` otherwise); the aggregate-count requires the Cleaner role
 * and the `FAVORITES_EXPOSE_AGGREGATE_COUNT` flag (`404` when disabled, `403` for a non-Cleaner). The
 * add maps `CREATED → 201`, `ALREADY_EXISTS → 204`, and (via the service) `OVER_LIMIT → 422`.
 */
@Controller('favorites')
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class FavoritesController {
  constructor(
    private readonly service: FavoritesService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  /** POST /favorites — add under the host-scoped lock+limit (201 created / 204 already / 422 over). */
  @Post()
  async add(
    @Req() req: AuthenticatedRequest,
    @Body() dto: AddFavoriteDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const host = await this.resolveHost(req.user.keycloakId);
    const result = await this.service.add(host.id, dto.cleanerId);
    res.status(result === AddResult.CREATED ? HttpStatus.CREATED : HttpStatus.NO_CONTENT);
  }

  /** DELETE /favorites/:cleanerId — idempotent hard delete (always 204). */
  @Delete(':cleanerId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Req() req: AuthenticatedRequest,
    @Param('cleanerId', new ParseUUIDPipe()) cleanerId: string,
  ): Promise<void> {
    const host = await this.resolveHost(req.user.keycloakId);
    await this.service.remove(host.id, cleanerId);
  }

  /** GET /favorites — the caller's favorites, paginated (safe display fields + unavailable hint). */
  @Get()
  @HttpCode(HttpStatus.OK)
  async list(
    @Req() req: AuthenticatedRequest,
    @Query() query: ListFavoritesQueryDto,
  ): Promise<Paginated<FavoriteView>> {
    const host = await this.resolveHost(req.user.keycloakId);
    return this.service.listFavorites(host.id, {
      limit: query.limit ?? FAVORITES_LIST_DEFAULT_LIMIT,
      cursor: query.cursor ?? null,
    });
  }

  /** GET /favorites/is-favorite/:cleanerId — the boolean toggle state. */
  @Get('is-favorite/:cleanerId')
  @HttpCode(HttpStatus.OK)
  async isFavorite(
    @Req() req: AuthenticatedRequest,
    @Param('cleanerId', new ParseUUIDPipe()) cleanerId: string,
  ): Promise<{ isFavorite: boolean }> {
    const host = await this.resolveHost(req.user.keycloakId);
    const isFavorite = await this.service.isFavorite(host.id, cleanerId);
    return { isFavorite };
  }

  /** GET /favorites/aggregate-count — Cleaner-facing count only (opt-in flag; never host identities). */
  @Get('aggregate-count')
  @HttpCode(HttpStatus.OK)
  async aggregateCount(@Req() req: AuthenticatedRequest): Promise<{ count: number }> {
    if (!FAVORITES_EXPOSE_AGGREGATE_COUNT) {
      throw new NotFoundException(FAVORITES_ERROR_MESSAGES.AGGREGATE_COUNT_DISABLED);
    }
    const cleaner = await this.resolveCaller(req.user.keycloakId);
    this.assertRole(cleaner, UserRole.CLEANER, FAVORITES_ERROR_MESSAGES.NOT_A_CLEANER_CALLER);
    const count = await this.service.aggregateCountForCleaner(cleaner.id);
    return { count };
  }

  /** Resolve the Keycloak subject to a BidClean user and require the Host role. */
  private async resolveHost(keycloakId: string): Promise<User> {
    const user = await this.resolveCaller(keycloakId);
    this.assertRole(user, UserRole.HOST, FAVORITES_ERROR_MESSAGES.NOT_A_HOST);
    return user;
  }

  /** Resolve the Keycloak subject to a BidClean user (403 when unknown). */
  private async resolveCaller(keycloakId: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { keycloakId } });
    if (!user) {
      throw new ForbiddenException(FAVORITES_ERROR_MESSAGES.USER_NOT_FOUND);
    }
    return user;
  }

  /** Require a role on the resolved user (403 otherwise). */
  private assertRole(user: User, role: UserRole, message: string): void {
    if (!user.roles.includes(role)) {
      throw new ForbiddenException(message);
    }
  }
}
