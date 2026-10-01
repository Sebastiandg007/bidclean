# ADR-010: Configuration Inventory, Source Taxonomy, Orthogonal Scope/Env Axes, Public/Secret Boundary, and No-Rotation-This-Iteration

## Status
Accepted

## Context
After Specs 1–25 were written, every feature introduced its own configuration surface with a
fail-fast validator (`validateChatConfig`, `validatePaymentsConfig`, `validateSubscriptionsConfig`,
`validateCommissionConfig`, `validateNegotiationConfig`, the AI service's pydantic `KYCSettings`, and
the mobile `EXPO_PUBLIC_*` build-time values). The committed `.env.example` covered the earlier sprints
but had drifted from the full set of variables the later specs and services actually read. Standing the
project up ("copy `.env.example`, fill values, boot") had become a scavenger hunt, and there was no
machine-checkable guarantee that a documented variable is real, that a real variable is documented, that
no secret leaks to the mobile client, or that no real credential sits in a tracked artifact.

The `secrets-inventory` meta-spec (`tools/config-inventory/`) resolves this as tooling, not a product
feature. Several decisions had to be settled before implementation.

## Decision
1. **A canonical inventory model is the single derived source of truth.** An in-memory
   `ConfigVariable[]` catalog — carrying `surface`, `group`, `kind`, `requiredScope`,
   `envApplicability`, `placeholder`, `consumedBy`, and `provenance` — decides what a variable *is*. It is
   derived from the code/config sources, never invented, and never sourced from `.env.example`.
2. **Completeness is defined against a six-type configuration-source taxonomy**, with one dedicated
   scanner per type: `APPLICATION | BUILD | DEPLOY | INFRA | CI | RUNTIME`. Each catalogued variable
   records ≥1 `DiscoveryProvenance` (source type + file + location), so completeness is audited against
   every source type — not just `*.constants.ts`. A variable seen by several sources keeps the full
   provenance set.
3. **The authority chain is one-directional:**
   `CODE / CONFIG SOURCES → CANONICAL INVENTORY MODEL → .env.example → RUNTIME ENV / Vault`.
   `.env.example` is a generated PRESENTATION/SHAPE projection (names, grouping, placeholders,
   required/optional annotations) and MAY NOT declare a variable the model does not recognize. The report
   renders the model into presentation artifacts and never reads them back as an authority.
4. **`requiredScope` and `envApplicability` are two orthogonal axes, never conflated.** `requiredScope`
   (`runtime | build | deploy | infra`) says *what lifecycle scope* needs the value; `envApplicability`
   (`local | staging | production`) says *which environments* it applies to. There is deliberately no
   `environment-specific` scope, which would collapse the axes.
5. **The public/secret boundary is hard and verified by classification, not naming.** Only
   `EXPO_PUBLIC_*` values reach the client, and they must be classified `PUBLIC`; a name matching a HARD
   server-secret pattern (`_SECRET_KEY`, `_API_KEY`, `_PASSWORD`, `_PRIVATE_KEY`, `_WEBHOOK_SECRET`,
   `_SIGNING_SECRET`, `AWS_SECRET_ACCESS_KEY`) but carrying the `EXPO_PUBLIC_` prefix is caught as a
   blocking `SECRET_ON_CLIENT` finding rather than trusted by its prefix. The AI surface holds no
   object-storage credentials (Option A): a storage credential on the AI surface is a blocking finding.
6. **Orphans are removed or justified with a structured, accountable, time-bounded record.** A
   `.env.example` entry no source reads is an `ORPHANED_ENV_EXAMPLE` finding unless it carries an
   `OrphanJustification` (`{ type: LEGACY | BUILD_ONLY | EXTERNAL_TOOL | DEPRECATED, owner, expiresAt }`)
   — never a free-text note — so a justified orphan cannot silently rot.
7. **No rotation this iteration; a discovered exposure is a blocking finding.** The tooling never
   rotates, revokes, regenerates, moves, or stages any credential. The exposure scanner runs
   `git check-ignore` + a tracked-file scan (`git ls-files`) + a secret-pattern scan (generic +
   provider-specific), skipping `.env.example` placeholders. Any hit is a blocking `SECRET_EXPOSURE`
   finding referencing file/line/provider — never the captured value — and the secret is left untouched.
   Remediation is deferred to separate secrets-security work.
8. **The pipeline ends at "configured & startup-valid", not "operational/healthy."** Verifying the
   deployed VPS is reachable/healthy is `full-audit`/deployment-readiness, not this tooling.

## Reasoning
- **Derive, don't invent.** Keying existence off actual reads (constants, `ConfigService.get/getOrThrow`,
  pydantic, compose interpolation, CI `env`, dynamic reads) means the inventory cannot drift into fiction,
  and the reconciliation findings pinpoint real gaps rather than guesses.
- **Taxonomy over a single heuristic.** A real configuration input can enter through a build profile, a
  CI `env` block, compose interpolation, or a dynamic read — not only `*.constants.ts`. One scanner per
  source type is what makes "complete" a checkable claim.
- **Two axes stay independent** because a variable can be runtime-required yet apply only to
  staging+production (a live Stripe key), or build-time-only across all environments. Collapsing them
  would lose exactly the distinctions an operator needs.
- **Classification verified by flow** catches the dangerous case a naming rule misses: a secret
  mis-prefixed `EXPO_PUBLIC_*`. The prefix is treated as a claim to verify, not proof.
- **Report, never rotate** honors the operator's explicit direction (they supply values) while refusing
  to certify a repo that already leaks a credential — the exposure is blocking, the fix is out of scope.

## Alternatives Considered
- **Treat `.env.example` as the source of truth.** Rejected: it drifts, cannot express provenance or the
  two axes, and would let a documented-but-unread variable masquerade as real.
- **A single heuristic scanner over the whole tree.** Rejected: cannot attribute provenance per source
  type, so completeness against BUILD/CI/DEPLOY/RUNTIME could not be asserted.
- **A bare `required: boolean`.** Rejected: cannot represent prod-only, build-time-only, or infra-only
  requirements; hence the `requiredScope` set + separate `envApplicability`.
- **Naming-only secret classification.** Rejected: a mis-prefixed `EXPO_PUBLIC_*_SECRET_KEY` would be
  trusted; the boundary check must verify against where the value flows.
- **Rotate/relocate the discovered secret now.** Rejected as out of scope this iteration; doing so would
  violate the operator's "do not touch existing credentials" direction. It is reported and deferred.
- **Free-text orphan justifications.** Rejected: not accountable or time-bounded; the structured record
  lets CI surface a `DEPRECATED` or past-`expiresAt` orphan for removal.

## Consequences
- The reconciled `.env.example` is complete (every read variable documented, placeholders only) and its
  required/optional annotations match the validators, so bring-up is a deterministic checklist.
- The `config-inventory` CI job fails the build on any drift or blocking finding, keeping the inventory a
  maintained artifact rather than a one-off snapshot.
- The known tracked `.kiro/settings/mcp.json` RevenueCat key is reported as a blocking `SECRET_EXPOSURE`
  and the repo is therefore **not** marked compliant until separate secrets-security work rotates it —
  exactly the intended tension resolution (untouched, but never silently accepted).
- The tooling adds no database entities and no runtime feature behavior; it reads sources and writes
  documentation + findings only.
- Later configuration additions extend the same model: a new variable is added by the code that reads it,
  the scanners pick it up, and reconciliation flags it until `.env.example` documents it.
