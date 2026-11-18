# Health

## Purpose

Liveness endpoint for uptime monitoring, Docker `HEALTHCHECK` and the full-audit probes. It does not check downstream dependencies.

## Files

| File | Responsibility |
|------|---------------|
| `health.controller.ts` | `GET /health` returns `{ status: "ok", timestamp, service: "bidclean-api" }`. |
| `health.module.ts` | Registers `HealthController`. |

## Dependencies

- `@nestjs/common` only.

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Service liveness check |
