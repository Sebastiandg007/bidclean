# Implementation Plan: Samsung Optimization (Adaptive Layout & Foldable Support)

## Overview

`samsung-optimization` (Spec 23, Sprint 6 — Polish & Extras) is a **mobile-only, client-only adaptive-presentation layer** under `apps/mobile/src/responsive/`. It touches **no backend, no API, no data model, no money, no domain data**. It makes existing screens respond to the available window (size class), orientation, and foldable posture — single-pane on a phone, two-pane (list + detail) when there is room — while guaranteeing a fold/unfold/rotate never loses the user's place or in-progress work, and it is publishable on the Galaxy Store from the same Expo codebase.

Implementation is bottom-up, pure-logic-core first (testable by simulating window metrics, no physical device): types + named config → the pure decision functions (`classifySizeClass`, `derivePosture`, `decideLayout`, `clampContentWidth`, `computePaneGeometry`) → the totality resolver (`resolveWindowMetrics`) → the platform hook (`useWindowMetrics`) → the adaptive contract (`useResponsiveLayout`) → adaptive containers (`AdaptiveScreen`, `TwoPaneLayout`, `ReflowContainer`) → integration of the three prioritized flows (radar+offer, properties+property, activity+item) reusing existing screens with no fork, plus reflow for all other screens → property-based tests (P1–P9, fast-check, min 100 iterations), unit/example/snapshot tests, CI guards (brand-guard, extended Spec 24 hex-guard, `tsc` no-`any`, named-config check), Galaxy Store build-readiness, and documentation.

Layout is a **pure function of window metrics** — there is no `if (isSamsung)` branch anywhere in app logic. `decideLayout` is fully deterministic from `(sizeClass, isPrioritized)`; in v1 `posture` is advisory-only and never changes the decision (FLAT, HALF_OPEN, and UNKNOWN all yield the same result; UNKNOWN is never conflated with FLAT). The active two-pane selection lives in navigation/flow state, never in the adaptive container, so a collapse→single-pane and expand→two-pane both resolve the same detail. The adaptive layer never owns owned state and causes no observable owned-state loss across a configuration change. All colors come from `dark-light-theme` (Spec 24) tokens — no new colors. Everything is verified locally and in CI via `tsc --noEmit` + `eslint src/` + `jest` (with `fast-check`); `useWindowDimensions`, `react-native-safe-area-context`, the platform display-feature/posture API, and navigation are mocked/injected — no device farm. See `requirements.md` (6 requirements + REQ-SM1…REQ-SM10) and `design.md` (Properties 1–9).

## Tasks

- [ ] 1. Responsive types and named config (the typed foundation)
  - [ ] 1.1 Create responsive enums and core value types
    - Create `apps/mobile/src/responsive/responsive.types.ts`: enums `SizeClass` (`COMPACT`/`MEDIUM`/`EXPANDED`), `Orientation` (`PORTRAIT`/`LANDSCAPE`), `Posture` (`FLAT`/`HALF_OPEN`/`UNKNOWN`), `LayoutMode` (`SINGLE_PANE`/`TWO_PANE`/`REFLOW`), `PrioritizedFlow` (`RADAR_OFFER`/`PROPERTIES`/`ACTIVITY`); interfaces `Rect`, `SafeAreaInsets`, `SpacingScale`, `WindowMetrics` (every field defined; `cutout`/`hinge` are `Rect | null`; `posture` valid enum), and `ResponsiveLayout` (`{ sizeClass, orientation, posture, isTwoPane, layoutMode, safeAreaInsets, cutout, hinge, maxContentWidth, spacing }`) — all strictly typed, no `any`
    - _Requirements: 1.2, 6.1 · REQ-SM1, REQ-SM10_
  - [ ] 1.2 Create the named responsive constants
    - Create `apps/mobile/src/responsive/responsive.constants.ts`: `RESPONSIVE_BREAKPOINTS` (`MEDIUM_MIN_DP = 600`, `EXPANDED_MIN_DP = 840`), `MAX_CONTENT_WIDTH_DP = 720`, `SPACING_SCALE: Readonly<Record<SizeClass, SpacingScale>>`, `PRIORITIZED_FLOWS` (the three flows), and `TWO_PANE_LIST_FRACTION = 0.38` — named typed constants, no scattered magic numbers
    - _Requirements: 1.5, 6.1 · REQ-SM10_

- [ ] 2. Pure decision functions (the layout logic core)
  - [ ] 2.1 Implement classifySizeClass
    - Create `apps/mobile/src/responsive/classifySizeClass.ts`: pure `classifySizeClass(widthDp: number): SizeClass` using `RESPONSIVE_BREAKPOINTS` — `COMPACT` when `w < MEDIUM_MIN_DP`, `MEDIUM` when `MEDIUM_MIN_DP <= w < EXPANDED_MIN_DP`, `EXPANDED` when `w >= EXPANDED_MIN_DP`; exactly one class per width, monotonic, no device-brand parameter
    - _Requirements: 1.1, 1.4, 1.5 · REQ-SM1_
  - [ ]* 2.2 Property test for size-class classification
    - **Property 1: Size-class classification is total and deterministic**
    - **Validates: Requirements 1.1, 1.4, 1.5 · REQ-SM1** — for all non-negative widths, exactly one `SizeClass` per the named breakpoints; monotonic in width; classification depends only on width (no brand input exists). Tag `// Feature: samsung-optimization, Property 1`; min 100 iterations
  - [ ] 2.3 Implement derivePosture
    - Create `apps/mobile/src/responsive/derivePosture.ts`: pure `derivePosture(feature)` mapping a raw display feature to `Posture` — `FLAT`/`HALF_OPEN` when exposed, `Posture.UNKNOWN` when the feature is absent/unrecognized (never `FLAT`)
    - _Requirements: 1.2, 4.1 · REQ-SM6_
  - [ ] 2.4 Implement decideLayout
    - Create `apps/mobile/src/responsive/decideLayout.ts`: pure `decideLayout({ sizeClass, posture, isPrioritized }): { layoutMode, isTwoPane }` — `EXPANDED ∧ isPrioritized → TWO_PANE` (`isTwoPane = true`); `EXPANDED ∧ ¬isPrioritized → REFLOW`; `MEDIUM → REFLOW`; `COMPACT → SINGLE_PANE`. Fully deterministic from `(sizeClass, isPrioritized)`; `posture` is advisory-only in v1 and never changes the result for any value (FLAT/HALF_OPEN/UNKNOWN); no device-brand parameter
    - _Requirements: 1.2, 1.3, 1.4, 2.1, 2.3, 4.1 · REQ-SM1, REQ-SM2, REQ-SM3, REQ-SM6_
  - [ ]* 2.5 Property test for the layout decision
    - **Property 2: Layout decision — two-pane vs single vs reflow, with posture-UNKNOWN fallback and no brand input**
    - **Validates: Requirements 1.2, 1.3, 1.4, 2.1, 2.3, 4.1 · REQ-SM1, REQ-SM2, REQ-SM3, REQ-SM6** — over `sizeClass × posture × isPrioritized`: `TWO_PANE` iff `EXPANDED ∧ prioritized`; `REFLOW` for MEDIUM / EXPANDED-non-prioritized; `SINGLE_PANE` for COMPACT; result invariant across all posture values (UNKNOWN never routed through a FLAT branch); equal `(sizeClass, isPrioritized)` → equal decision. Tag `// Feature: samsung-optimization, Property 2`; min 100 iterations
  - [ ] 2.6 Implement clampContentWidth
    - Create `apps/mobile/src/responsive/clampContentWidth.ts`: pure `clampContentWidth(windowWidthDp: number): number` returning `min(windowWidthDp, MAX_CONTENT_WIDTH_DP)`
    - _Requirements: 2.3, 4.2 · REQ-SM3, REQ-SM7_
  - [ ]* 2.7 Property test for reflow clamp + spacing monotonicity
    - **Property 3: Reflow content-width clamp and spacing-scale monotonicity**
    - **Validates: Requirements 2.3, 4.2 · REQ-SM3, REQ-SM7** — for all widths, `clampContentWidth(w) === min(w, MAX_CONTENT_WIDTH_DP)` and `<= w` and `<= MAX_CONTENT_WIDTH_DP`; each key of `SPACING_SCALE` is non-decreasing across `COMPACT < MEDIUM < EXPANDED`. Tag `// Feature: samsung-optimization, Property 3`; min 100 iterations
  - [ ] 2.8 Implement computePaneGeometry
    - Create `apps/mobile/src/responsive/paneGeometry.ts`: pure `computePaneGeometry({ window, insets, cutout, hinge }): { listRect, detailRect }` for a two-pane window — split via `TWO_PANE_LIST_FRACTION`; occluded region = union of safe-area insets ∪ cutout (when present) ∪ hinge (when present); both rects lie within the safe window bounds, are pairwise non-overlapping, each meet a minimum usable size, and neither pane's interactive content region intersects the cutout or hinge occlusion region
    - _Requirements: 4.3, 4.4, 4.5 · REQ-SM7_
  - [ ]* 2.9 Property test for two-pane geometry
    - **Property 8: Two-pane geometry is within bounds, non-overlapping, and cutout- & hinge-safe across the two-pane-applicable universe**
    - **Validates: Requirements 4.4, 4.5 · REQ-SM7** — over the two-pane-applicable universe (EXPANDED + prioritized × `{PORTRAIT, LANDSCAPE}`, with/without cutout, with/without hinge, + insets): `listRect`/`detailRect` within safe bounds, non-overlapping, each ≥ min usable size, neither intersects the cutout region nor the hinge occlusion region when present. Tag `// Feature: samsung-optimization, Property 8`; min 100 iterations

- [ ] 3. Window-metrics resolver (totality contract)
  - [ ] 3.1 Implement resolveWindowMetrics (pure, total, never throws)
    - Create `apps/mobile/src/responsive/windowMetrics.ts` (pure portion): `resolveWindowMetrics(raw): WindowMetrics` folding any raw input to a total `WindowMetrics` — missing insets → `0` per side; `cutout`/`hinge` absent → `null`; posture feature absent → `Posture.UNKNOWN`; derives `sizeClass` via `classifySizeClass`, `orientation` from width/height, `posture` via `derivePosture`. Every field defined (never `undefined`); never throws
    - _Requirements: 4.3 · REQ-SM7_
  - [ ]* 3.2 Property test for resolver totality
    - **Property 7: Window-metrics resolver totality**
    - **Validates: Requirements 4.3 · REQ-SM7** — for all raw inputs (missing/partial insets, no cutout, no hinge, no posture feature), every `WindowMetrics` field is defined (valid enum / numeric insets / `Rect`-or-`null`), `posture = UNKNOWN` when unexposed, never `undefined`, never throws. Tag `// Feature: samsung-optimization, Property 7`; min 100 iterations
  - [ ] 3.3 Implement useWindowMetrics (thin platform adapter)
    - Add `useWindowMetrics(): WindowMetrics` to `apps/mobile/src/responsive/windowMetrics.ts` — wires `useWindowDimensions` (size + orientation), `react-native-safe-area-context` insets, and the Expo/RN display-feature/posture API where exposed, feeding live values into `resolveWindowMetrics`
    - _Requirements: 1.1, 1.2, 4.3 · REQ-SM1, REQ-SM7_

- [ ] 4. useResponsiveLayout — the adaptive contract
  - [ ] 4.1 Implement useResponsiveLayout hook
    - Create `apps/mobile/src/responsive/useResponsiveLayout.ts`: `useResponsiveLayout(flow?: PrioritizedFlow): ResponsiveLayout` — reads `useWindowMetrics()`, computes `isPrioritized = flow != null && PRIORITIZED_FLOWS.includes(flow)`, `{ layoutMode, isTwoPane } = decideLayout(...)`, `maxContentWidth = clampContentWidth(width)`, `spacing = SPACING_SCALE[sizeClass]`, returns the full `ResponsiveLayout`
    - _Requirements: 1.2, 1.3, 2.1, 6.4 · REQ-SM1, REQ-SM9_
  - [ ]* 4.2 Unit tests for the useResponsiveLayout contract and COMPACT baseline
    - With mocked window metrics: hook returns the full `ResponsiveLayout` shape; `isTwoPane === (sizeClass === EXPANDED && isPrioritized)`; at a COMPACT width every prioritized flow yields `layoutMode === SINGLE_PANE` (phone baseline not regressed); breakpoint boundaries (`MEDIUM_MIN_DP - 1 → COMPACT`, `MEDIUM_MIN_DP → MEDIUM`, `EXPANDED_MIN_DP → EXPANDED`) read from `RESPONSIVE_BREAKPOINTS`; `derivePosture(null) === UNKNOWN` and a `UNKNOWN`-posture screen renders the size-class layout without error
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 4.1, 6.4 · REQ-SM1, REQ-SM2, REQ-SM6, REQ-SM9_

- [ ] 5. Adaptive containers (presentation only)
  - [ ] 5.1 Implement TwoPaneLayout (selection read from flow state)
    - Create `apps/mobile/src/responsive/components/TwoPaneLayout.tsx`: generic list+detail container sized via `computePaneGeometry`; props `{ selectedId, onSelect, renderList, renderDetail, renderEmpty }`; `selectedId` is SOURCED from the flow's navigation params / shared store (never owned locally); selecting an item calls `onSelect` (updates flow state) and the detail pane updates IN PLACE (not a push navigation); `selectedId === null` renders the empty state; colors from `useTheme()` (Spec 24) only, spacing from the responsive scale
    - _Requirements: 2.2, 2.4, 2.5 · REQ-SM3, REQ-SM4, REQ-SM5b_
  - [ ]* 5.2 Property test for in-place detail resolution
    - **Property 4: In-place detail resolution from selection**
    - **Validates: Requirements 2.2 · REQ-SM3** — for all item lists and selected ids `s`: non-null present `s` → detail pane renders `renderDetail(s)` (in-place, not a push); `s === null` → empty state; detail always corresponds to the current `selectedId`. Tag `// Feature: samsung-optimization, Property 4`; min 100 iterations
  - [ ]* 5.3 Property test for the selection round-trip
    - **Property 5: Selection lives in flow state — collapse/expand round-trip resolves the same detail**
    - **Validates: Requirements 2.4 · REQ-SM5b** — for all `s` held in a flow-state fake and all finite size-class transition sequences (EXPANDED→COMPACT→EXPANDED, incl. repeated fold/unfold/rotate), the resolved detail always equals `resolve(s)` in both TWO_PANE and SINGLE_PANE; unmounting the container on collapse does not clear/alter `s`; re-expand hydrates from the same `s`. Tag `// Feature: samsung-optimization, Property 5`; min 100 iterations
  - [ ] 5.4 Implement ReflowContainer
    - Create `apps/mobile/src/responsive/components/ReflowContainer.tsx`: wraps children, centers content, caps width at `maxContentWidth` (from `clampContentWidth`), applies size-class spacing; never edge-to-edge stretch; colors/spacing from tokens
    - _Requirements: 2.3, 4.2 · REQ-SM3, REQ-SM7_
  - [ ] 5.5 Implement AdaptiveScreen
    - Create `apps/mobile/src/responsive/components/AdaptiveScreen.tsx`: thin wrapper calling `useResponsiveLayout(flow)` and picking the arrangement — `renderSingle()` on COMPACT, `renderTwoPane()` on prioritized EXPANDED (fall back to `renderSingle` reflowed with a dev misuse warning when `renderTwoPane` is missing), `ReflowContainer` children otherwise
    - _Requirements: 1.3, 2.1, 2.3 · REQ-SM2, REQ-SM3_
  - [ ]* 5.6 Unit/example tests for the containers
    - `TwoPaneLayout`: selecting an item updates the detail pane in place without a nav push, null selection renders empty state, the component holds no local selection state (unmount does not clear it); `ReflowContainer`: on a wide window caps rendered content width at `maxContentWidth` and centers it, a non-prioritized flow never selects `TWO_PANE`; `AdaptiveScreen`: COMPACT renders the single-pane snapshot unchanged, missing `renderTwoPane` falls back rather than crashing; representative EXPANDED window with a hinge rect and a cutout rect → map/detail rects disjoint and clear of both
    - _Requirements: 2.2, 2.3, 2.4, 4.2, 4.4 · REQ-SM3, REQ-SM5b, REQ-SM7_

- [ ] 6. State continuity across a configuration change
  - [ ] 6.1 Wire the adaptive layer to preserve owned state (no destructive remount)
    - Ensure the adaptive containers rearrange presentation with stable React keys/identity so a fold/unfold/rotate does not tear down the navigation container, mounted forms, active-action owners (call/tracking/upload/timer/open sheet), or scrollable lists; the adaptive layer owns none of that state and only reads selection from nav/flow state; verify no `if (isSamsung)`/brand branch exists in the layer
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5 · REQ-SM5, REQ-SM5b_
  - [ ]* 6.2 Property test for state continuity
    - **Property 6: State continuity — a configuration change preserves all observable owned state and does not destructively remount the tree**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5 · REQ-SM5** — for all owned-state snapshots (nav stack+route, form input, in-progress action, scroll offset, session, theme) and all finite config-change sequences within one session, re-layout is an identity over observable owned state; no crash, no destructive whole-tree remount; asserted over observable state (a child may be reconstructed if it rehydrates with no observable difference). Tag `// Feature: samsung-optimization, Property 6`; min 100 iterations
  - [ ]* 6.3 Unit test for state continuity under a simulated config change
    - Render a tree with a mounted form + a stubbed active-action owner + a scrollable list under the adaptive layer; simulate a dimensions/posture change; assert form value, action-owner state, scroll offset, session, and theme are unchanged and no crash/destructive whole-tree remount occurs (stable identity checked as the preferred path; a reconstructed child passes if it rehydrates with no observable difference)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5 · REQ-SM5_

- [ ] 7. Checkpoint — pure core, hook, and containers integrated
  - Ensure `apps/mobile` `tsc --noEmit` + `eslint src/` (no `any`) are clean and the responsive Jest suites (properties P1–P8 so far, unit/example) pass against mocked window metrics; ask the user if questions arise.

- [ ] 8. Integrate prioritized flows (reuse, no fork)
  - [ ] 8.1 Make the radar+offer flow adaptive
    - Wrap the existing `screens/radar` map + offer-detail components in `TwoPaneLayout` on EXPANDED (via `AdaptiveScreen` with `PrioritizedFlow.RADAR_OFFER`) and render the same components single-pane on COMPACT; source `selectedOfferId` from the radar flow's navigation param / shared store (not the container); ensure the map pane stays fully interactive and unclipped by the fold/cutout/detail pane; reuse Spec 24 tokens, no forked logic, no new colors
    - _Requirements: 2.1, 2.2, 2.4, 2.5, 4.4 · REQ-SM3, REQ-SM4, REQ-SM5b, REQ-SM7_
  - [ ] 8.2 Make the properties+property flow adaptive
    - Wrap the existing `screens/properties` list + property-detail components in `TwoPaneLayout` on EXPANDED (`PrioritizedFlow.PROPERTIES`), single-pane on COMPACT; source `selectedPropertyId` from the properties nav param / store; reuse existing components + tokens, no fork
    - _Requirements: 2.1, 2.2, 2.4, 2.5 · REQ-SM3, REQ-SM4, REQ-SM5b_
  - [ ] 8.3 Make the activity+item flow adaptive
    - Wrap the existing activity/history list + item-detail components in `TwoPaneLayout` on EXPANDED (`PrioritizedFlow.ACTIVITY`), single-pane on COMPACT; source `selectedActivityId` from the activity nav param / store; reuse existing components + tokens, no fork
    - _Requirements: 2.1, 2.2, 2.4, 2.5 · REQ-SM3, REQ-SM4, REQ-SM5b_
  - [ ] 8.4 Reflow the non-prioritized screens
    - Wrap the remaining (non-prioritized) screens' existing content in `ReflowContainer` so they get max readable content width + expanded spacing on MEDIUM/EXPANDED windows, no forced split, no clipping; colors from `useTheme()` only
    - _Requirements: 2.3, 4.2 · REQ-SM3, REQ-SM7_
  - [ ]* 8.5 Snapshot/migration tests for the adaptive flows
    - Reuse-no-fork import assertions (two-pane and single-pane render use the same underlying list/detail components); EXPANDED render of each prioritized flow shows list + detail side by side and selecting updates detail in place; each non-prioritized screen renders under MEDIUM/EXPANDED without error, no clipped content, colors sourced only from `useTheme()`
    - _Requirements: 2.1, 2.2, 2.3, 2.5 · REQ-SM3, REQ-SM4_

- [ ] 9. i18n for adaptive UI states
  - [ ] 9.1 Add adaptive i18n keys (en + es)
    - Add any adaptive/responsive UI strings (e.g. two-pane empty-state text) to `apps/mobile/src/i18n/locales/en/…` and `es/…` with full parity — no hardcoded strings in the responsive layer
    - _Requirements: 6.3 · REQ-SM10_
  - [ ]* 9.2 Property test for i18n en/es parity
    - **Property 9: i18n en/es parity for adaptive labels**
    - **Validates: Requirements 6.3 · REQ-SM10** — every adaptive/responsive i18n key exists and resolves to a non-empty string in both `en` and `es`; the two locales expose an identical adaptive-key set. Tag `// Feature: samsung-optimization, Property 9`; min 100 iterations

- [ ] 10. CI guards (brand-guard, hex-guard, types, named config)
  - [ ] 10.1 Add the brand-guard CI check
    - Add a CI/lint step that greps app logic for device-brand branching (`isSamsung`, brand/model comparisons in layout code) and fails if any appear — layout must key only off window metrics; wire into the mobile CI workflow
    - _Requirements: 5.1, 6.1 · REQ-SM1, REQ-SM8_
  - [ ] 10.2 Extend the Spec 24 hex-guard to responsive/ and add the named-config check
    - Extend the existing hex-guard so no raw `#RRGGBB`/`rgba(...)` appears in `apps/mobile/src/responsive/` (tokens via `useTheme()` only); add a check that breakpoints, max content width, spacing scale, and the prioritized-flow list are referenced from `responsive.constants.ts` (no scattered literals); rely on `tsc --noEmit` + `eslint @typescript-eslint/no-explicit-any` to enforce typed enums/config and no `any`
    - _Requirements: 1.5, 2.5, 6.1, 6.2 · REQ-SM4, REQ-SM10_

- [ ] 11. Galaxy Store publish readiness (build + docs, not code)
  - [ ] 11.1 Configure the single-codebase Android AAB build + store config
    - Ensure the mobile build produces an Android AAB from the same Expo codebase and a reproducible Android build configuration with no per-store code branch; supply Galaxy Store package identifiers, listing metadata, and signing via build config / environment (never hardcoded per-store branches); add build-time validation of Samsung's current submission requirements (target API level, 64-bit binary, correct signing, applicable binary-compatibility such as 16 KB page size)
    - _Requirements: 5.1, 5.3, 5.4, 5.6 · REQ-SM8_

- [ ] 12. Documentation
  - [ ] 12.1 Write the responsive README and update the navigation README
    - Create `apps/mobile/src/responsive/README.md` (resolver → hook → layout model, `useResponsiveLayout` contract, two-pane vs reflow, the "selection lives in flow state" rule, no-brand-detection and no-new-color rules, how to make a screen adaptive); update `apps/mobile/src/navigation/README.md` to note selection ids live in navigation/flow state for two-pane collapse/expand
    - _Requirements: 6.5 · REQ-SM10_
  - [ ] 12.2 Write the Galaxy Store deployment doc and update ARCHITECTURE/CHANGELOG/ADR/ROADMAP
    - Create `docs/deployment/galaxy-store.md` (single-codebase AAB build config, listing artifacts incl. unfolded/large-screen screenshots, content rating, privacy link, and Samsung's current submission requirements tracked here rather than hardcoded); add the adaptive-presentation layer to `docs/ARCHITECTURE.md` (single window-metrics resolver → `useResponsiveLayout` → two-pane/reflow containers wrapping existing screens); add `docs/CHANGELOG.md` `[Unreleased]` entries (resolver + `useResponsiveLayout`, two-pane prioritized flows, reflow, state-continuity guarantee, Galaxy Store readiness); create `docs/ADR/0NN-window-driven-adaptivity.md` (window/posture-driven adaptivity never brand detection, two-pane on prioritized flows with selection in nav/flow state, adaptive layer causing no state loss, Galaxy Store from a single Expo codebase); mark Spec 23 status in `.kiro/specs/ROADMAP.md`
    - _Requirements: 5.2, 5.5, 6.5 · REQ-SM8, REQ-SM10_

- [ ] 13. Final checkpoint — all tests pass, CI green, docs updated
  - Ensure `apps/mobile` `tsc --noEmit` + `eslint src/` (no `any`) + the full Jest suite (unit/example, snapshot/migration, property P1–P9) pass against mocked window metrics, the brand-guard reports no brand branching, the hex-guard reports only `primitives.ts`, the AAB build validates Samsung's current requirements, and all documentation is updated; ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional (tests) and can be skipped for a faster MVP — but per this project's execution rules they are executed (property-based, unit/example, snapshot/migration).
- Each task references specific requirements; property-test tasks cite the design's Properties 1–9 and the requirements' REQ-SM invariants.
- **Mobile-only, client-only:** no backend, no API, no data model, no money, no domain data — the whole spec lives under `apps/mobile/src/responsive/` plus thin integration at existing screens.
- **Pure function of window metrics:** layout keys off `{ sizeClass, orientation, posture, safeAreaInsets, cutout, hinge }` from the single resolver — there is no `if (isSamsung)` branch anywhere (enforced by the brand-guard).
- **decideLayout is deterministic from `(sizeClass, isPrioritized)`:** in v1 `posture` is advisory-only and never changes the result (FLAT/HALF_OPEN/UNKNOWN identical); `UNKNOWN` is never conflated with `FLAT`; a HALF_OPEN posture-aware arrangement is a documented later extension.
- **Selection lives in navigation/flow state, not the container:** collapse→single-pane and expand→two-pane both resolve the same detail; `TwoPaneLayout` holds no local selection state.
- **No observable owned-state loss:** across a within-session fold/unfold/rotate, each owner keeps its state; the adaptive layer only rearranges presentation (stable identity preferred, reconstruction allowed only if it rehydrates with no observable loss). Process death/restart is out of scope.
- **Reuse, no fork; no new colors:** adaptive layouts compose existing screen components and consume `dark-light-theme` (Spec 24) tokens; the hex-guard is extended to the responsive layer.
- **Testable without devices:** the pure resolver + injectable metrics make `useResponsiveLayout` and the containers unit-testable by simulating window sizes/postures; `useWindowDimensions`, `react-native-safe-area-context`, the display-feature/posture API, and navigation are mocked.
- **Galaxy Store is build/docs, not code:** one Expo codebase → AAB, store config from configuration, readiness artifacts + current submission requirements documented in `docs/deployment/galaxy-store.md`.
- CI: mobile is verified locally and in CI via `tsc --noEmit` + `eslint src/` + `jest` (with `fast-check`); there is no backend surface, so no API/DB jobs are involved.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["2.1", "2.3", "2.6", "2.8"] },
    { "id": 3, "tasks": ["2.2", "2.4", "2.7", "2.9"] },
    { "id": 4, "tasks": ["2.5", "3.1"] },
    { "id": 5, "tasks": ["3.2", "3.3"] },
    { "id": 6, "tasks": ["4.1"] },
    { "id": 7, "tasks": ["4.2", "5.1", "5.4"] },
    { "id": 8, "tasks": ["5.2", "5.3", "5.5", "5.6", "6.1"] },
    { "id": 9, "tasks": ["6.2", "6.3", "8.1", "8.2", "8.3", "8.4"] },
    { "id": 10, "tasks": ["8.5", "9.1", "10.1", "10.2", "11.1"] },
    { "id": 11, "tasks": ["9.2", "12.1", "12.2"] }
  ]
}
```
