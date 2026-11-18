# Centrifugo

## Purpose

Configuration for the Centrifugo WebSocket server used for real-time delivery (offer radar, chat, tracking). `docker-compose.yml` mounts `config.json` into the `bidclean-centrifugo` container (image `centrifugo/centrifugo:v5`, command `centrifugo -c config.json`). The values in this file are local-development defaults only. Production must override every secret through environment or Vault, never by committing real values.

## Files

| File | Responsibility |
|------|---------------|
| `config.json` | Local settings: `token_hmac_secret_key`, `admin_secret` and `api_key` (placeholders `CHANGE_ME_IN_PRODUCTION`), `admin_password` (local only), `allowed_origins` limited to `http://localhost:*`, `health: true` (enables `/health`). |

## Dependencies

- Started by [`../docker-compose.yml`](../README.md); host port 8001 maps to container port 8000.
- The API signs connection tokens with the same HMAC secret (`services/api/src/auth/centrifugo`) and publishes through the Centrifugo API key (`services/api/src/offers/delivery/centrifugo.client.ts`).

## Environment Variables

None are read from this file. Secrets that must match the API's configuration are listed in the root `.env.example` (Centrifugo section).

## How to Run

```powershell
# PowerShell, from the repo root
docker compose -f infra/docker-compose.yml up -d centrifugo
curl http://localhost:8001/health
```
