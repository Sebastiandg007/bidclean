# Infrastructure

## Purpose

Docker configurations, deployment scripts, and infrastructure-as-code for BidClean.

## Files

| File/Directory | Responsibility |
|----------------|---------------|
| `docker-compose.yml` | Local development environment (all services) |
| `docker/api.Dockerfile` | Production build for NestJS API |
| `docker/ai.Dockerfile` | Production build for FastAPI AI service |
| `centrifugo/config.json` | Centrifugo WebSocket server configuration |
| `scripts/` | Deployment and maintenance scripts (planned) |

## Local Development

```bash
cd infra
docker compose up -d
```

This starts: PostgreSQL, Redis, MinIO, Keycloak, Centrifugo, LibreTranslate.

## Services and Ports (Local)

| Service | Port | Dashboard |
|---------|------|-----------|
| PostgreSQL | 5432 | — |
| Redis | 6379 | — |
| MinIO (S3) | 9000 | http://localhost:9001 |
| Keycloak (Auth) | 8080 | http://localhost:8080 |
| Centrifugo (WebSocket) | 8001 | — |
| LibreTranslate | 5000 | http://localhost:5000 |

## Production

Production uses `docker-compose.prod.yml` (to be created) with:
- Traefik reverse proxy + SSL
- Production secrets from HashiCorp Vault
- Health checks and auto-restart policies
