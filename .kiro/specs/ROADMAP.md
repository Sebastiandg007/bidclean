# BidClean — Specs Roadmap

> This file tracks the state of all feature specs. Read this first in any new session to know where the project stands and what to work on next.

## Current Sprint: Sprint 2 — Core Marketplace

## Specs Status

### Sprint 1 — Auth & Users
| # | Spec | Status | Dependencies |
|---|------|--------|-------------|
| 1 | `user-authentication` | ✅ Completed | None |
| 2 | `user-roles` | ✅ Completed | Spec 1 |
| 3 | `kyc-verification` | ✅ Completed | Spec 1 |
| 4 | `user-profile` | ✅ Completed | Spec 1, 2 |

### Sprint 2 — Core Marketplace
| # | Spec | Status | Dependencies |
|---|------|--------|-------------|
| 5 | `property-management` | ✅ Completed | Spec 1, 2 |
| 6 | `offer-publishing` | ✅ Completed | Spec 5 |
| 7 | `offer-radar` | ⬜ Pending | Spec 5, 6 |
| 8 | `offer-negotiation` | ⬜ Pending | Spec 6, 7 |

### Sprint 3 — Payments
| # | Spec | Status | Dependencies |
|---|------|--------|-------------|
| 9 | `stripe-escrow` | ⬜ Pending | Spec 8 |
| 10 | `commission-system` | ⬜ Pending | Spec 9 |
| 11 | `revenuecat-subscriptions` | ⬜ Pending | Spec 1 |
| 12 | `revenuecat-ads` | ⬜ Pending | Spec 11 |

### Sprint 4 — Communication
| # | Spec | Status | Dependencies |
|---|------|--------|-------------|
| 13 | `realtime-chat` | ⬜ Pending | Spec 1, 8 |
| 14 | `voice-notes` | ⬜ Pending | Spec 13 |
| 15 | `voip-calls` | ⬜ Pending | Spec 13 |
| 16 | `push-notifications` | ⬜ Pending | Spec 1 |

### Sprint 5 — Service Execution
| # | Spec | Status | Dependencies |
|---|------|--------|-------------|
| 17 | `service-tracking` | ⬜ Pending | Spec 8 |
| 18 | `video-verification` | ⬜ Pending | Spec 3, 17 |
| 19 | `checklist-photos` | ⬜ Pending | Spec 17 |
| 20 | `service-completion` | ⬜ Pending | Spec 9, 19 |

### Sprint 6 — Polish & Extras
| # | Spec | Status | Dependencies |
|---|------|--------|-------------|
| 21 | `dispute-system` | ⬜ Pending | Spec 20 |
| 22 | `favorites` | ⬜ Pending | Spec 8 |
| 23 | `samsung-optimization` | ⬜ Pending | All mobile specs |
| 24 | `dark-light-theme` | ⬜ Pending | Spec 7 |

### Sprint 7 — QA & Formal Testing
| # | Spec | Status | Dependencies |
|---|------|--------|-------------|
| 25 | `quality-assurance-pbt` | ⬜ Pending | All specs (1-24) |

> **Sprint 7 scope:** Exhaustive testing of the ENTIRE system after all features are implemented.
> - Property-Based Testing (fast-check + Hypothesis) with 100+ iterations per property and shrinking
> - Correctness Properties verification across ALL modules
> - E2E flows: registration → KYC → publish offer → negotiate → escrow payment → service → complete
> - Integration tests with real infrastructure (Docker: PostgreSQL, Redis, Keycloak, MinIO)
> - Load testing with k6 (100+ concurrent users)
> - Cross-module conflict detection (requirements from different specs don't contradict)
> - Ambiguity analysis: PBT finds cases no requirement covers → reported as gaps
> - Per-module PBT: auth, roles, KYC, profile, offers, payments, chat, notifications

## How to Use This File

1. Check **Current Sprint** to know what phase the project is in.
2. Find the first spec with status 🔄 or ⬜ whose dependencies are ✅.
3. Open that spec folder in `.kiro/specs/<spec-name>/` and work on it.
4. When a spec is fully implemented and validated, mark it ✅ and move to the next.

## Spec Structure

Each feature has its own folder in `.kiro/specs/<feature-name>/` containing exactly 3 files:

```
.kiro/specs/<feature-name>/
├── requirements.md    → WHAT the feature does (functional + non-functional requirements)
├── design.md          → HOW it's implemented (architecture, components, data models, flows)
└── tasks.md           → Implementation plan (ordered tasks with dependencies)
```

**Workflow per feature:**
1. Create the spec folder with requirements.md, design.md, and tasks.md
2. Review and validate the spec before implementation
3. Execute tasks one by one (or via "Run All Tasks")
4. After all tasks complete: update docs, commit, mark spec as ✅
5. Move to the next spec whose dependencies are satisfied

**Specs are created just before implementation** — not all at once. This ensures each spec has up-to-date context from previously completed features.

## Status Legend
- ✅ Completed — all tasks done, tests pass, docs updated
- 🔄 In Progress — tasks being executed
- ⬜ Pending — not started yet
