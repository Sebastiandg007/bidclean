---
inclusion: fileMatch
fileMatchPattern: "**/*.ts,**/*.tsx"
---

# TypeScript Standards

## Compiler Configuration

- Strict mode always enabled (`strict: true` in tsconfig).
- No `any` type — use `unknown` and narrow, or define proper types.
- No `@ts-ignore` — fix the type issue instead.
- Enable `noUncheckedIndexedAccess` for safer array/object access.

## Types and Interfaces

- Use `interface` for public contracts (API responses, service methods, props).
- Use `type` for unions, intersections, mapped types, utilities.
- Export types from the same file as their implementation.
- Prefix interfaces with descriptive names, not `I`: `OfferResponse` not `IOffer`.
- Use `Readonly<T>` for data that should not be mutated.

## Enums and Constants

- Prefer `as const` objects over enums for better tree-shaking:
  ```typescript
  export const OfferStatus = {
    PENDING: 'pending',
    ACCEPTED: 'accepted',
    COMPLETED: 'completed',
  } as const;
  export type OfferStatus = typeof OfferStatus[keyof typeof OfferStatus];
  ```

## Imports

- Use absolute path aliases (`@/modules/offers`, `@/shared/utils`).
- Order: external packages → internal modules → relative imports.
- Each module has an `index.ts` barrel export for its public API.
- Never import from deep internal paths of another module.

## Async/Await

- Always use async/await over raw Promises (`.then`).
- Always handle errors in async functions (try/catch or error boundary).
- Never have floating Promises (unhandled async calls). Use `void` prefix if intentionally fire-and-forget.

## Functions

- Arrow functions for callbacks and small utilities.
- Named function declarations for top-level module functions.
- Use `readonly` parameter types when the function should not mutate input.
- Return types should be explicit on public/exported functions.

## Null Handling

- Prefer `undefined` over `null` (TypeScript convention).
- Use optional chaining (`?.`) and nullish coalescing (`??`).
- Never use non-null assertion (`!`) unless you can prove it's safe with a comment.

## Error Handling

- Define custom error classes that extend `Error`:
  ```typescript
  export class OfferNotFoundError extends Error {
    constructor(offerId: string) {
      super(`Offer ${offerId} not found`);
      this.name = 'OfferNotFoundError';
    }
  }
  ```
- Use discriminated unions for Result types when appropriate.

## Linting and Formatting

- ESLint with `@typescript-eslint` recommended rules.
- Prettier for formatting (no style debates).
- Max line length: 100 characters.
- Semicolons: always.
- Quotes: single quotes for strings.
- Trailing commas: always (es5 style).
