# Health

## Purpose

Liveness endpoint for Docker healthchecks, load balancers and monitoring. It does not authenticate and does not check models.

## Files

| File | Responsibility |
|------|---------------|
| `__init__.py` | Module docstring. |
| `router.py` | `APIRouter(prefix="/health")` with `GET /health/` returning `{ "status": "healthy", "service": "bidclean-ai" }`. |

## Dependencies

- FastAPI only.

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health/` | Service health (no auth) |
