# Docker

## Purpose

Production Dockerfiles for the two application services. Both are multi-stage builds that start from the repository root as build context (they copy `services/...` and `packages/...` paths). `docker-compose.yml` does not build them; it only runs the supporting infrastructure.

## Files

| File | Responsibility |
|------|---------------|
| `api.Dockerfile` | NestJS API. Builder stage (`node:20-alpine`) runs `npm ci` for the `services/api` and `packages/shared` workspaces and `npm run build --workspace=services/api`. Runner stage copies `dist` and `node_modules`, exposes 3000, `HEALTHCHECK` via `wget` on `/health`, `CMD ["node", "dist/main"]`. |
| `ai.Dockerfile` | FastAPI AI service. Builder stage (`python:3.11-slim`) installs Poetry 1.8.3 and the dependencies from `services/ai/pyproject.toml` (`--no-dev`). Runner stage copies site-packages and `src`, exposes 8000, `HEALTHCHECK` on `/health`, `CMD uvicorn src.main:app --host 0.0.0.0 --port 8000`. |

## Dependencies

- Source: `services/api`, `packages/shared`, `services/ai`.
- Docker with BuildKit.

## How to Run

```powershell
# PowerShell, from the repo root (build context is the root)
docker build -f infra/docker/api.Dockerfile -t bidclean-api .
docker build -f infra/docker/ai.Dockerfile -t bidclean-ai .
```

Notes: the API image does not run migrations. Run `npm run migration:run --workspace=services/api` against the target database before starting it. `poetry install --no-dev` installs only the main group, so the optional `ml` group (PaddleOCR, DeepFace) is not in the image unless the Dockerfile is extended.
