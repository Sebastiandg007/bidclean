# Config

## Purpose

Infrastructure configuration shared by the whole API: the TypeORM data source used by the CLI migrations and a lazily created Redis client.

## Files

| File | Responsibility |
|------|---------------|
| `typeorm.config.ts` | Exports `dataSourceOptions` and a default `DataSource` (PostgreSQL from `DATABASE_URL`, entities `**/*.entity`, migrations `migrations/*`, `synchronize: false`, query logging when `NODE_ENV=development`). Used by the `migration:*` npm scripts. |
| `redis.config.ts` | `getRedisClient()` returns a shared ioredis client (`REDIS_URL`, default `redis://localhost:6379`, `lazyConnect`, 3 retries per request). Also exports `REDIS_CLIENT_TOKEN`. Used by rate limiting and other Redis-backed features. |

## Dependencies

- `typeorm`, `ioredis`.
- PostgreSQL and Redis.

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `REDIS_URL` | Redis connection string | Yes (defaults to localhost) |
| `NODE_ENV` | `development` enables TypeORM logging | No |
