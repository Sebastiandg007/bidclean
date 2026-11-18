# Tools

## Purpose

Repository tooling that is neither a service nor a mobile feature. Each tool is an isolated TypeScript project with its own `tsconfig.json` and Jest config, run from the repo root with `ts-node`. Tools observe and report; they do not change application code or configuration.

## Files

| Folder | Responsibility |
|--------|---------------|
| [`config-inventory/`](config-inventory/README.md) | Builds the code-derived catalog of every configuration variable, reconciles `.env.example`, enforces the public/secret boundary and writes `docs/CONFIGURATION-INVENTORY.md`. Also a CI gate (`--check`). |
| [`full-audit/`](full-audit/README.md) | Deployment-readiness audit. Probes the running stack (local Docker, then VPS) against a component registry and renders `docs/deployment/READINESS-CHECKLIST.md`. |

## Dependencies

- `ts-node`, `typescript`, `jest`, `ts-jest`, `fast-check` (root dev dependencies).
- `git` for the exposure scan in `config-inventory`; a running Docker stack for live `full-audit` runs.

## How to Run

```powershell
# PowerShell, from the repo root
npx ts-node --project tools/config-inventory/tsconfig.json tools/config-inventory/inventory.cli.ts --check
npx ts-node -T --project tools/full-audit/tsconfig.json tools/full-audit/audit.cli.ts --env local
```
