# @bidclean/shared

## Purpose

Shared types, constants, and utilities used across the BidClean mobile app and backend services. This package ensures type consistency between frontend and backend without duplication.

## Files

| File / Directory | Responsibility |
|------------------|---------------|
| `package.json` | Package `@bidclean/shared`; `main` and `types` point at `src/index.ts` (consumed as TypeScript source); scripts `typecheck`, `lint`, `lint:fix`. |
| `tsconfig.json` | Extends `../../tsconfig.base.json`; `rootDir: ./src`. |
| `src/` | Source with the single `index.ts` entry point. See [`src/README.md`](src/README.md). |
| `src/types/` | TypeScript interfaces and type definitions shared across services |
| `src/constants/` | Business rules and configuration constants |
| `src/outbox/` | Transactional outbox writer |

## Usage

Import from any workspace package:

```typescript
import { OfferStatus, UserRole, HOST_COMMISSION_PERCENT } from '@bidclean/shared';
```

## Important

- All types here are **contracts** — changing them affects both frontend and backend.
- Constants here are **defaults** — they can be overridden by environment variables in production.
- Never put service-specific logic here — only shared definitions.
