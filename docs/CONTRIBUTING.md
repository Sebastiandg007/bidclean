# Contributing to BidClean

## Getting Started

1. Clone the repository.
2. Read the steering files in `.kiro/steering/` to understand project standards.
3. Read `docs/ARCHITECTURE.md` for the system overview.
4. Set up your local environment (see root README.md).

## Development Workflow

1. Create a feature branch from `develop`: `git checkout -b feature/your-feature`
2. Write code following the standards in `.kiro/steering/`.
3. Write tests for new functionality.
4. Commit using Conventional Commits: `feat(scope): description`
5. Push and open a Pull Request to `develop`.
6. Ensure all CI checks pass (lint, tests, type-check).
7. Request review from at least one team member.
8. Squash merge after approval.

## Code Standards

All code must follow the standards defined in `.kiro/steering/`:

- **Clean Code principles** — meaningful names, small functions, SRP, DRY
- **TypeScript** — strict mode, no `any`, explicit types on public APIs
- **Python** — type hints, docstrings, PEP 8
- **React Native** — functional components, custom hooks, accessibility

## Documentation Requirements

When you make changes:

- **New module/file?** → Update the parent folder's README.md
- **Architecture change?** → Update `docs/ARCHITECTURE.md` diagrams
- **New decision?** → Create a new ADR in `docs/ADR/`
- **API change?** → Update the module README with new endpoints
- **Dependency added?** → Document in module README

## Commit Messages

Format: `type(scope): short description`

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `style`, `perf`, `ci`

Scopes: `mobile`, `api`, `ai`, `infra`, `shared`, `docs`

## Pull Request Template

```
## What
Brief summary of changes.

## Why
Context or link to requirement/task.

## How to Test
Steps to verify the change works.

## Checklist
- [ ] Code follows project standards
- [ ] Tests added/updated
- [ ] Documentation updated
- [ ] No hardcoded values
- [ ] Accessibility considered (mobile)
```

## Branch Naming

Format: `type/short-description`

Examples:
- `feature/offers-counteroffer`
- `fix/notification-delivery`
- `docs/architecture-update`
- `refactor/auth-module`
