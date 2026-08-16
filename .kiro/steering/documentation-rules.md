---
inclusion: always
---

# Documentation Rules

## Core Principle

Documentation is a living artifact. It MUST reflect the current state of the project at all times. Outdated documentation is worse than no documentation.

## When to Update Documentation

Every time one of these events occurs, the corresponding documentation MUST be updated:

| Event | What to update |
|-------|---------------|
| New file/module created | README in the parent folder, ARCHITECTURE.md if structural |
| File/module deleted | Remove references from README, ARCHITECTURE.md |
| New integration added | ARCHITECTURE.md diagrams, new ADR if it's architectural |
| API endpoint changed | Module README, API docs |
| New pattern introduced | Evaluate if a new steering file is needed |
| New automation needed | Evaluate if a new hook is needed |
| Dependency added/removed | Module README, root package.json documented |
| Configuration changed | .env.example, deployment docs |
| Architecture decision made | New ADR in `docs/ADR/` |

## README Standards

Every significant folder (module, service, feature) has a README.md with:

```markdown
# Module Name

## Purpose
One paragraph: what this module does and why it exists.

## Files
| File | Responsibility |
|------|---------------|
| `name.service.ts` | Brief description |
| `name.controller.ts` | Brief description |

## Dependencies
- Which other modules this depends on
- Which external services it uses

## API (if applicable)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/endpoint` | What it does |

## Environment Variables (if applicable)
| Variable | Description | Required |
|----------|-------------|----------|
| `STRIPE_SECRET_KEY` | Stripe API key | Yes |

## How to Run (if applicable)
Brief instructions for running this module in isolation.
```

## Architecture Diagrams (Mermaid)

- Live in `docs/ARCHITECTURE.md`.
- Updated on EVERY structural change.
- Diagrams included:
  1. System Architecture (all services and connections)
  2. Frontend Architecture (screens, stores, navigation)
  3. Backend Architecture (modules, DB, external services)
  4. Offer Lifecycle (data flow from publish to payment)
  5. Payment Flow (money movement through Stripe)
  6. Auth & Security Flow (registration, KYC, verification)

## ADR (Architecture Decision Records)

- One file per decision in `docs/ADR/`.
- Format: `NNN-short-title.md` (e.g., `001-react-native-expo.md`).
- Content:

```markdown
# ADR-NNN: Decision Title

## Status
Accepted | Superseded | Deprecated

## Context
What situation prompted this decision?

## Decision
What did we decide?

## Consequences
What are the trade-offs? What becomes easier/harder?
```

## CHANGELOG

- Updated with every release/tag.
- Auto-generated from conventional commits using standard-version or similar.
- Format: Keep a Changelog (https://keepachangelog.com/).

## Evaluating New Steering/Hooks

When a new module, integration, pattern, or significant behavior is introduced, evaluate whether it requires:

1. A new steering file (if it introduces coding standards or rules)
2. A new hook (if it introduces a repetitive automated process)
3. An update to existing steering/hooks
4. An update to ARCHITECTURE.md diagrams
5. A new ADR (if it's an architectural decision)

This evaluation happens on every structural change — enforced by the `update-docs-on-change` hook.
