import { HttpStatus } from '@nestjs/common';
import { Repository } from 'typeorm';
import { Response } from 'express';

import { User } from '../../auth/entities/user.entity';
import { UserRole } from '../../roles/roles.types';
import { FavoritesService } from '../favorites.service';
import { AddResult } from '../favorites.types';

/**
 * Unit tests for FavoritesController (Spec 22).
 *
 * Identity is resolved server-side from the JWT `keycloakId` (never client-asserted). Covers Host-only
 * guards (403 for a non-Host), the add status mapping (201 CREATED / 204 ALREADY_EXISTS), and the
 * aggregate-count flag gating (Cleaner-only, 404 when disabled). The service + User repo are faked;
 * `FAVORITES_EXPOSE_AGGREGATE_COUNT` is toggled by isolating the module with the env set.
 */

function fakeUserRepo(user: User | null): Repository<User> {
  return { findOne: jest.fn().mockResolvedValue(user) } as unknown as Repository<User>;
}

function userWith(roles: UserRole[], id = 'user-1'): User {
  return { id, keycloakId: 'kc-1', roles } as unknown as User;
}

function fakeService(overrides: Partial<Record<keyof FavoritesService, jest.Mock>> = {}): FavoritesService {
  return {
    add: jest.fn().mockResolvedValue(AddResult.CREATED),
    remove: jest.fn().mockResolvedValue(undefined),
    listFavorites: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
    isFavorite: jest.fn().mockResolvedValue(true),
    aggregateCountForCleaner: jest.fn().mockResolvedValue(4),
    ...overrides,
  } as unknown as FavoritesService;
}

function fakeRes(): Response & { statusCode: number } {
  const res = {
    statusCode: 0,
    status(code: number): Response {
      (res as unknown as { statusCode: number }).statusCode = code;
      return res as unknown as Response;
    },
  };
  return res as unknown as Response & { statusCode: number };
}

const req = { user: { keycloakId: 'kc-1', email: 'h@x.io', emailVerified: true } } as never;
const CLEANER = '22222222-2222-4222-8222-222222222222';

/** Load a fresh controller with FAVORITES_EXPOSE_AGGREGATE_COUNT set to the given flag. */
function loadController(exposeAggregate: boolean): { FavoritesController: new (...args: never[]) => unknown } {
  const saved = process.env.FAVORITES_EXPOSE_AGGREGATE_COUNT;
  process.env.FAVORITES_EXPOSE_AGGREGATE_COUNT = String(exposeAggregate);
  let mod: { FavoritesController: new (...args: never[]) => unknown } = {
    FavoritesController: class {},
  };
  jest.isolateModules(() => {
    mod = require('../favorites.controller');
  });
  if (saved === undefined) {
    delete process.env.FAVORITES_EXPOSE_AGGREGATE_COUNT;
  } else {
    process.env.FAVORITES_EXPOSE_AGGREGATE_COUNT = saved;
  }
  return mod;
}

interface ControllerLike {
  add(req: unknown, dto: { cleanerId: string }, res: Response): Promise<void>;
  remove(req: unknown, cleanerId: string): Promise<void>;
  isFavorite(req: unknown, cleanerId: string): Promise<{ isFavorite: boolean }>;
  aggregateCount(req: unknown): Promise<{ count: number }>;
}

/**
 * Assert an awaited call rejects with an HttpException carrying `status`. Uses `getStatus()` rather
 * than `toBeInstanceOf`, because the controller is loaded via `jest.isolateModules` and its Nest
 * exception classes have a distinct identity from the top-level import.
 */
async function expectHttpStatus(promise: Promise<unknown>, status: number): Promise<void> {
  await expect(promise).rejects.toMatchObject({});
  try {
    await promise;
    throw new Error('expected the call to reject');
  } catch (error) {
    const getStatus = (error as { getStatus?: () => number }).getStatus;
    expect(typeof getStatus).toBe('function');
    expect(getStatus?.call(error)).toBe(status);
  }
}

describe('FavoritesController', () => {
  it('POST sets 201 on CREATED and 204 on ALREADY_EXISTS', async () => {
    const { FavoritesController } = loadController(false);
    const created = new FavoritesController(
      fakeService({ add: jest.fn().mockResolvedValue(AddResult.CREATED) }) as never,
      fakeUserRepo(userWith([UserRole.HOST])) as never,
    ) as unknown as ControllerLike;
    const res1 = fakeRes();
    await created.add(req, { cleanerId: CLEANER }, res1);
    expect(res1.statusCode).toBe(HttpStatus.CREATED);

    const exists = new FavoritesController(
      fakeService({ add: jest.fn().mockResolvedValue(AddResult.ALREADY_EXISTS) }) as never,
      fakeUserRepo(userWith([UserRole.HOST])) as never,
    ) as unknown as ControllerLike;
    const res2 = fakeRes();
    await exists.add(req, { cleanerId: CLEANER }, res2);
    expect(res2.statusCode).toBe(HttpStatus.NO_CONTENT);
  });

  it('rejects a non-Host caller on a Host endpoint (403)', async () => {
    const { FavoritesController } = loadController(false);
    const controller = new FavoritesController(
      fakeService() as never,
      fakeUserRepo(userWith([UserRole.CLEANER])) as never,
    ) as unknown as ControllerLike;
    await expectHttpStatus(controller.isFavorite(req, CLEANER), HttpStatus.FORBIDDEN);
  });

  it('rejects an unknown subject (403)', async () => {
    const { FavoritesController } = loadController(false);
    const controller = new FavoritesController(
      fakeService() as never,
      fakeUserRepo(null) as never,
    ) as unknown as ControllerLike;
    await expectHttpStatus(controller.isFavorite(req, CLEANER), HttpStatus.FORBIDDEN);
  });

  it('aggregate-count → 404 when the flag is disabled', async () => {
    const { FavoritesController } = loadController(false);
    const controller = new FavoritesController(
      fakeService() as never,
      fakeUserRepo(userWith([UserRole.CLEANER])) as never,
    ) as unknown as ControllerLike;
    await expectHttpStatus(controller.aggregateCount(req), HttpStatus.NOT_FOUND);
  });

  it('aggregate-count → { count } for a Cleaner when enabled; 403 for a non-Cleaner', async () => {
    const { FavoritesController } = loadController(true);
    const cleaner = new FavoritesController(
      fakeService({ aggregateCountForCleaner: jest.fn().mockResolvedValue(7) }) as never,
      fakeUserRepo(userWith([UserRole.CLEANER])) as never,
    ) as unknown as ControllerLike;
    await expect(cleaner.aggregateCount(req)).resolves.toEqual({ count: 7 });

    const nonCleaner = new FavoritesController(
      fakeService() as never,
      fakeUserRepo(userWith([UserRole.HOST])) as never,
    ) as unknown as ControllerLike;
    await expectHttpStatus(nonCleaner.aggregateCount(req), HttpStatus.FORBIDDEN);
  });
});
