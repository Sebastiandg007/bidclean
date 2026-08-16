---
inclusion: always
---

# Clean Code Standards

Based on "Clean Code" by Robert C. Martin. These principles apply to ALL code in the BidClean project — TypeScript, Python, configuration, and documentation.

## Naming

- Use intention-revealing names. A reader should understand purpose without comments.
- Classes/interfaces: PascalCase nouns (`OfferService`, `PaymentGateway`)
- Functions/methods: camelCase verbs (`calculateCommission`, `expandSearchRadius`)
- Variables: camelCase nouns (`activeOffers`, `cleanerDistance`)
- Constants: SCREAMING_SNAKE_CASE (`MAX_RADIUS_KM`, `ESCROW_RELEASE_HOURS`)
- Booleans: prefix with is/has/can/should (`isVerified`, `hasActiveSubscription`)
- No abbreviations unless universally understood (OK: `id`, `url`. NOT OK: `ofr`, `clnr`)
- No generic names (`data`, `info`, `temp`, `result`) unless scope is tiny (2-3 lines)

## Functions

- Maximum 20-30 lines. If longer, extract sub-functions.
- One function = one responsibility (Single Responsibility Principle).
- Maximum 3 parameters. If more, use an options object.
- No side effects hidden in the name. `getUser()` should not modify state.
- Return early to avoid deep nesting (guard clauses).
- No flag arguments (booleans that change behavior). Create two functions instead.

## Files

- One responsibility per file.
- Sweet spot: 50-200 lines. Over 200 = consider splitting.
- Over 400 = must split.
- File names match their primary export: `offers.service.ts` exports `OffersService`.

## Comments

- Code should be self-explanatory. Comments explain WHY, not WHAT.
- Delete commented-out code — git has history.
- Use JSDoc/docstrings for public APIs only.
- TODO comments include ticket/task reference: `// TODO(BID-42): implement retry logic`

## Error Handling

- Never swallow errors silently.
- Use typed exceptions/errors with meaningful messages.
- Handle errors at the appropriate level (not too early, not too late).
- Log errors with context (what was being done, what inputs caused it).
- Never use error handling for control flow.

## DRY (Don't Repeat Yourself)

- Shared logic goes in `packages/shared/`.
- If you copy-paste, extract to a utility or shared module.
- But: don't over-abstract. Two similar things that evolve differently should stay separate.

## No Magic Numbers/Strings

- Every literal value that has business meaning becomes a named constant.
- Configuration values come from environment or config files, never inline.

## Code Organization

- Related code stays together (feature-based, not type-based).
- Dependencies flow inward: controllers → services → repositories.
- No circular dependencies between modules.
- Explicit imports — no barrel re-exports that hide where things come from.

## Testing

- Every public function has a corresponding test.
- Test names describe the behavior: `should return error when offer price is negative`.
- Tests are independent — no shared mutable state between tests.
- Arrange → Act → Assert pattern.
