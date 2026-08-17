---
inclusion: always
---

# Task Execution Rules

These rules apply EVERY TIME a task is being executed, whether from a spec or manually.

## After Completing Any Task

When a task is completed (implementation is done and working), you MUST:

### 1. Update Documentation
- If files were created/deleted/moved: update the README.md of the affected module/folder.
- If the structure of the project changed (new service, new module, new integration): update `docs/ARCHITECTURE.md` with the relevant Mermaid diagram.
- If a new feature was implemented: add an entry to `docs/CHANGELOG.md` under `## [Unreleased]`.
- If the task belongs to a spec: update `.kiro/specs/ROADMAP.md` if the spec status changed.

### 2. Update Mermaid Diagrams
The diagrams in `docs/ARCHITECTURE.md` MUST reflect current reality. Update when:
- A new module/component is added to the system
- A new integration with an external service is established
- The data flow between components changes
- A component is removed or renamed

### 3. Commit and Push
After completing a task with all documentation updates:
- Stage all changes: `git add -A`
- Commit with conventional commit format: `feat(scope): short description of what was done`
- Push to the current branch

### 4. No Hardcoded Values
Before marking any task as complete, verify:
- No API keys, URLs, or secrets are hardcoded in the code
- No business rule values (percentages, timeouts, limits) are literal numbers in logic
- All configurable values come from environment variables or constants files
- No UI text is hardcoded (should use i18n keys)

### 5. Code Quality Audit
Before marking any task as complete, verify:
- Functions are small (max 20-30 lines) and have single responsibility
- Names are meaningful and intention-revealing
- Error handling is explicit (no swallowed errors)
- Types are strict (no `any` in TypeScript, type hints in Python)
- No commented-out code or dead code

## Task Dependency Awareness

Before implementing a task:
- Check if its dependencies (other tasks) are completed
- If a dependency requires infrastructure (Docker, external service) that isn't available, document why the task cannot be completed now and skip it

## When Infrastructure Dependencies Block a Task

If a task cannot be completed because it requires Docker, Keycloak, or another service that isn't running:
- Mark the task as blocked with a note explaining what's needed
- Move to the next task that CAN be completed
- Do NOT skip writing tests for tasks that CAN run without external infra
