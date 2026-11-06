# Requirements Document

## Introduction

The `samsung-optimization` module makes BidClean a first-class citizen on Samsung Galaxy devices — especially **foldables (Z Fold / Z Flip)** and large screens — so the app adapts gracefully when a device is unfolded (split/two-pane layouts), survives fold/unfold and rotation without losing state, and is publishable on the **Galaxy Store**. It is Spec 23, the last of Sprint 6 (Polish & Extras), and it depends on **all the mobile specs** because it optimizes screens that already exist rather than inventing new features. It directly targets the hackathon's "Best App for Galaxy" (Samsung) category.

**It is adaptive presentation, not new domain logic.** samsung-optimization adds **responsive/adaptive layouts** keyed to window size classes (compact / medium / expanded) and fold posture, so the same screens the app already ships render as single-pane on a phone and as two-pane (list + detail) when there is room. It touches no backend, no money, no data model — it is a mobile-only layer over the existing navigation and screens, built on the theming and design tokens just established in `dark-light-theme` (Spec 24).

**Adaptivity is driven by window size + posture, not device brand.** The correct engineering approach is to respond to the **available window** (React Native `useWindowDimensions` / size classes) and **fold posture** (flat vs half-folded / tabletop), NOT to detect "is this a Samsung device". A Galaxy Z Fold unfolded is just an expanded window; a tablet or a large phone in landscape benefits from the same two-pane layout. Samsung is the primary *target* and validation surface (and the Galaxy Store is a publish target), but the implementation is a general adaptive-layout capability that also improves tablets and other large screens — never brand-sniffing.

**Authority split (client-only, presentation layer):**
- **Window size class + fold posture are the single input** that drives layout selection; there is no server involvement and no persisted state beyond ephemeral UI state.
- **Existing screens and navigation are the source of truth for content**; samsung-optimization only chooses how to arrange them (single vs two-pane, expanded spacing) and ensures state survives configuration changes.
- **The design tokens (Spec 24) are the source of truth for styling**; adaptive layouts reuse tokens and add only responsive spacing/breakpoints, no new colors.

**Deliberate scope boundaries (to keep it focused and shippable):**
- **Adaptive layout + state continuity + Galaxy Store publish readiness only.** No new features, no new screens, no domain/backend changes. It restyles arrangement and adds foldable/large-screen support to existing surfaces.
- **Respond to window/posture, never brand-detect.** No "if Samsung" branching; the same adaptive rules apply to any device that presents the corresponding window size — this keeps it correct, testable, and beneficial beyond Samsung.
- **Prioritized surfaces, not a full two-pane rewrite of every screen.** The two-pane treatment targets the highest-value list+detail flows (e.g. the radar map + offer detail, the properties list + property detail, the activity/history list + item) — where the plan explicitly calls for split view. Other screens simply reflow (expanded spacing, max content width) rather than forcing a two-pane split.
- **State continuity across fold/unfold/rotation is mandatory.** A configuration change (fold, unfold, rotate) SHALL NOT lose the user's place, form input, in-progress action, active call/tracking, or scroll position — a common Android/foldable failure this spec forbids.
- **No Samsung-proprietary SDKs required for the MVP.** The MVP uses standard Expo/React Native adaptive capabilities (window dimensions, safe areas, foldable posture via the platform's exposed APIs where available). Deep One UI / DeX / S-Pen / Flex-mode-specific SDK integrations are documented enhancements, not hard v1 requirements.
- **Galaxy Store is a publish target, not a code change.** Publishing to the Galaxy Store is a build/submission concern (assets, listing, AAB) captured as readiness requirements + documentation; it does not alter app logic. The app remains a single Expo codebase (iOS + Play + Galaxy).
- **Correctness = no state loss + no broken layout.** There is no persistence/transaction concern here; the invariants are "state survives configuration changes" and "no layout is clipped/overlapping/unusable at any supported window size or posture".

## Domain Model Overview

```
window metrics (the single adaptive input — NOT device brand; one resolver, explicit unavailability):
  sizeClass   ∈ { COMPACT, MEDIUM, EXPANDED }   (derived from useWindowDimensions / width breakpoints)
  orientation ∈ { PORTRAIT, LANDSCAPE }
  posture     ∈ { FLAT, HALF_OPEN, UNKNOWN }    (UNKNOWN = device/platform does not expose posture —
                                                 NEVER conflated with FLAT; layout falls back to sizeClass)
  safeAreaInsets  (top/bottom/left/right — respected in every posture/orientation)
  displayCutout   (notch/punch-hole bounds where present)
  foldFeature/hinge bounds (when the platform exposes them; absent otherwise)
  → the window-metrics resolver is the single source; each field has a defined "unavailable" value so a
    screen never assumes a metric it doesn't have
        │  drives
        ▼
adaptive layout selection (presentation only — reuses existing screens + Spec 24 tokens):
  COMPACT               → single-pane (phone, current behavior — unchanged baseline)
  EXPANDED (unfolded /  → two-pane list+detail on PRIORITIZED flows:
   tablet / landscape)      radar map + offer detail | properties list + property detail |
                            activity/history list + item
  other screens         → reflow: expanded spacing, max readable content width, no forced split
  HALF_OPEN posture     → optional posture-aware arrangement (e.g. content top / controls bottom) where supported

state continuity (mandatory — a config change must NOT lose state):
  fold / unfold / rotate = an Android configuration change
  SHALL preserve: navigation stack + selected item, form input, in-progress actions,
                  active call/tracking/upload, scroll position, modal/sheet state

useResponsiveLayout() (hook — the adaptive contract):
  → { sizeClass, orientation, posture (FLAT|HALF_OPEN|UNKNOWN), isTwoPane, safeAreaInsets, cutout?, hinge? }
    consumed by prioritized screens to pick a layout; posture=UNKNOWN → decide by sizeClass only

supported configuration universe (what "no broken layout" is promised over + validated):
  sizeClass: COMPACT | MEDIUM | EXPANDED   ×   orientation: PORTRAIT | LANDSCAPE
  posture: HALF_OPEN only where a supported foldable test device exposes it
  validation matrix: a representative phone, a large phone (landscape), a tablet, and a Z-Fold-class
  foldable (folded + unfolded) — the minimum device/resolution set for visual validation

Galaxy Store publish readiness (build/submission concern, NOT app logic):
  single Expo codebase → Android AAB → Galaxy Store listing (assets, screenshots incl. unfolded,
  content rating, privacy) — documented; no branching in app code
```

- **Adaptivity keys off window size class + posture + orientation**, never brand detection; a Galaxy Z Fold unfolded is simply an `EXPANDED` window and gets the two-pane treatment, as do tablets and large-phone landscape.
- **Existing screens + Spec 24 tokens are reused**; samsung-optimization only selects arrangement (single vs two-pane, expanded spacing) via `useResponsiveLayout()`.
- **State continuity across fold/unfold/rotate is the core correctness invariant** — a configuration change never loses the user's place or in-progress work.
- **Galaxy Store is a publish/readiness target**, handled via build + listing (assets incl. unfolded screenshots), not app-logic changes.

## Glossary

- **Size class** — a coarse bucket of available window width (`COMPACT` phone / `MEDIUM` / `EXPANDED` unfolded-tablet-landscape) derived from window dimensions; the primary adaptive input.
- **Posture** — foldable state (`FLAT` fully open/closed-as-phone vs `HALF_OPEN` tabletop/book) where the platform exposes it; optional posture-aware layout input.
- **Two-pane (list+detail)** — an expanded-window layout showing a list and its detail side by side, used on prioritized flows instead of push-navigation.
- **Reflow** — non-two-pane screens adapting to a large window via expanded spacing + a max readable content width (not stretched edge-to-edge).
- **Configuration change** — an Android event (fold, unfold, rotate) that recreates/relays the UI; the app must preserve state across it.
- **State continuity** — the guarantee that navigation, input, in-progress actions, active call/tracking, and scroll survive a configuration change.
- **`useResponsiveLayout()`** — the hook exposing `{ sizeClass, posture, orientation, isTwoPane }` that prioritized screens consume to choose a layout.
- **Galaxy Store readiness** — the build/listing artifacts (AAB, unfolded screenshots, listing metadata) needed to publish the existing app to the Galaxy Store; no app-logic change.

## Requirements

### Requirement 1 — Window/posture-driven adaptivity (never brand detection)

**User Story:** As a Galaxy (or tablet/large-screen) user, I want the app to use the extra space when I unfold or rotate, so that it feels designed for my device.

#### Acceptance Criteria

1. WHEN the app decides a layout THEN it SHALL derive `sizeClass` (COMPACT / MEDIUM / EXPANDED) from the available window (e.g. `useWindowDimensions` / width breakpoints), `orientation`, and foldable `posture` where the platform exposes it — and SHALL NOT branch on device brand or model ("is Samsung").
2. WHEN a screen consumes adaptivity THEN it SHALL do so via a single `useResponsiveLayout()` hook returning `{ sizeClass, orientation, posture, isTwoPane, safeAreaInsets, cutout?, hinge? }`, where `posture ∈ { FLAT, HALF_OPEN, UNKNOWN }` — `UNKNOWN` explicitly meaning the platform does not expose posture (never conflated with `FLAT`), in which case layout decides by `sizeClass` alone. Layout logic is centralized and testable.
3. WHEN the window is COMPACT THEN screens SHALL render their existing single-pane layout unchanged (the phone baseline is not regressed).
4. WHEN the same rules apply to any device presenting a given window THEN a tablet or a large phone in landscape SHALL benefit from the same adaptive layouts as an unfolded foldable (the capability is general, Samsung is the primary target/validation).
5. WHEN breakpoints/size-class thresholds are defined THEN they SHALL be named constants/config, not scattered magic numbers.

### Requirement 2 — Two-pane on prioritized flows; reflow elsewhere

**User Story:** As a user on a large screen, I want the main list+detail flows to show side by side, so that I'm not bouncing back and forth.

#### Acceptance Criteria

1. WHEN the window is EXPANDED THEN the prioritized flows SHALL present a two-pane list+detail layout: the radar map + offer detail, the properties list + property detail, and the activity/history list + item.
2. WHEN a two-pane flow is shown THEN selecting an item in the list SHALL update the detail pane in place (not a full push navigation), and a sensible default/empty state SHALL show when nothing is selected.
3. WHEN a screen is not a prioritized two-pane flow THEN it SHALL reflow for the larger window (expanded spacing, a max readable content width, no edge-to-edge stretching or clipping) rather than forcing a split.
4. WHEN the window shrinks back to COMPACT (fold, rotate to portrait) THEN a two-pane flow SHALL collapse back to single-pane push navigation, resolving to the currently selected item as the visible screen. The **active selection SHALL be represented by the flow's existing navigation/shared-flow state contract — NOT by state local to the adaptive two-pane container** — so that when the container unmounts on collapse, the same detail screen can be resolved from navigation/flow state (e.g. `selectedOfferId` lives in the flow's navigation params / shared store, not only in the two-pane component). The reverse (COMPACT→EXPANDED) SHALL likewise hydrate the detail pane from that same selection state.
5. WHEN two-pane rendering occurs THEN it SHALL reuse the existing screens/components and Spec 24 design tokens, adding only responsive spacing/breakpoints — no new colors, no forked screen logic that could diverge from the phone version.

### Requirement 3 — State continuity across fold / unfold / rotate (adaptive layer must not cause loss; owners keep the state)

**User Story:** As a user, I want to keep my place and my work when I fold, unfold, or rotate, so that the app never throws away what I was doing.

**Scope note.** This requirement governs a **configuration change** (fold / unfold / rotate) **within the same running app session** only. It is explicitly NOT a guarantee of recovery after **process death** or an **app restart** (those are separate concerns, not owned here). And the adaptive layer does not become the owner of any of these states — **each state remains owned by its existing owner** (navigation layer, screen/store state, the call/tracking/upload workflows, the theme/auth systems); the adaptive layer's obligation is simply to **not cause their loss** when it re-lays-out.

#### Acceptance Criteria

1. WHEN a configuration change occurs within the running session THEN the adaptive layer SHALL NOT cause loss of state: the **navigation layer** remains the source of truth for the navigation stack + current route, and re-layout SHALL preserve it (the user stays where they were).
2. WHEN a configuration change occurs during data entry THEN in-progress form input SHALL be preserved by its existing screen/store owner (not reset by the re-layout); the adaptive layer SHALL NOT remount the form in a way that discards it.
3. WHEN a configuration change occurs during an in-progress action (an active call/tracking session, a photo/voice upload, a running timer, an open bottom sheet/modal) THEN that action's state SHALL continue to be owned and preserved by its existing owner (voip/service-tracking/upload/UI); the adaptive re-layout SHALL NOT restart or tear it down.
4. WHEN a configuration change occurs THEN list scroll position SHALL be preserved as closely as the platform allows (by the existing list/UI state, not re-derived by the adaptive layer).
5. WHEN a configuration change occurs THEN the app SHALL NOT crash, SHALL NOT destructively remount the whole tree, and SHALL NOT lose the authenticated session or theme — it re-lays-out via the adaptive layer, it does not reset; each owner's state survives because the adaptive layer only rearranges presentation.

### Requirement 4 — Foldable posture & large-screen polish

**User Story:** As a foldable user, I want the app to feel intentional in tabletop/unfolded modes, so that it looks premium on my Galaxy.

#### Acceptance Criteria

1. WHEN the device is HALF_OPEN (tabletop/book posture) and the platform exposes posture THEN the app MAY adopt a posture-aware arrangement (e.g. content in the upper half, controls in the lower half) on flows where it adds value; where posture is unavailable it SHALL fall back to the size-class layout without error.
2. WHEN content is shown on a large/unfolded screen THEN text columns SHALL respect a maximum readable width (no ultra-wide lines), and touch targets/spacing SHALL scale appropriately (not tiny phone spacing stretched across a tablet).
3. WHEN safe areas, hinge, and display cutouts are handled THEN they SHALL be sourced from the single window-metrics resolver (`safeAreaInsets`, `displayCutout`, `foldFeature/hinge`), each with a defined "unavailable" value; the layout SHALL respect them where present (no content under the hinge/cutout, correct safe-area insets in every posture/orientation) and SHALL degrade gracefully when a metric is unavailable (never assume a metric it doesn't have).
4. WHEN the map/radar is shown two-pane THEN it SHALL remain fully interactive in its pane and SHALL NOT be clipped by the fold or the detail pane.
5. WHEN any adaptive layout renders across the **supported configuration universe** — `{COMPACT, MEDIUM, EXPANDED} × {PORTRAIT, LANDSCAPE}`, plus `HALF_OPEN` where a supported foldable exposes it — THEN no such configuration SHALL produce clipped, overlapping, or unusable UI (the visual correctness invariant). "Supported" is that explicit set + the validation device matrix, not "every conceivable Android window size".

### Requirement 5 — Galaxy Store publish readiness

**User Story:** As the team, I want BidClean publishable on the Galaxy Store from the same codebase, so that we qualify for the Samsung category.

#### Acceptance Criteria

1. WHEN the app targets Galaxy Store THEN it SHALL remain a **single Expo/React Native codebase** producing an Android build (AAB), with NO Samsung-brand branching in app logic to be publishable.
2. WHEN Galaxy Store submission is prepared THEN the readiness artifacts SHALL be captured (documented): store listing metadata, app icon, screenshots INCLUDING unfolded/large-screen captures, content rating, privacy policy link, and the AAB build config — mirroring the Play Store submission.
3. WHEN store-specific config is needed (package identifiers, listing) THEN it SHALL come from configuration, not hardcoded per-store branches in app logic.
4. WHEN the build pipeline is described THEN the Galaxy Store build SHALL fit the existing mobile CI/CD approach (the same codebase + build config), documented so it is reproducible.
5. WHEN large-screen readiness is evaluated THEN the app SHALL meet the large-screen/foldable quality bar the store expects (adaptive layout + state continuity from Reqs 1–4), so the listing showcases the unfolded experience.
6. WHEN the Galaxy Store build is prepared THEN it SHALL satisfy Samsung's **current** submission requirements — including target API level, 64-bit binary, correct signing, and any applicable Android binary-compatibility requirement (e.g. page-size compatibility) — validated at build time. The specific version numbers SHALL NOT be hardcoded in this spec (external store requirements change over time); the requirement is that the build passes whatever Samsung currently mandates, tracked in the deployment docs.

### Requirement 6 — Quality, configuration, and standards

**User Story:** As a maintainer, I want the adaptive layer to follow project standards, so that it stays consistent and testable.

#### Acceptance Criteria

1. WHEN breakpoints, size-class thresholds, max content widths, or posture behavior are set THEN they SHALL be named constants/config with no scattered magic numbers, and TypeScript-typed (size-class/posture enums, no `any`).
2. WHEN adaptive layouts reuse styling THEN they SHALL consume Spec 24 design tokens (no new hardcoded colors) and existing components (no forked divergent copies).
3. WHEN any UI text is added for adaptive states THEN it SHALL come from i18n keys with `en`/`es` parity.
4. WHEN the adaptive layer is built THEN `useResponsiveLayout()` and the two-pane containers SHALL be unit-testable by simulating window sizes/postures, so adaptivity is verified without physical devices.
5. WHEN the adaptive layer or Galaxy Store readiness is introduced THEN it SHALL be documented (a mobile responsive/foldable README, ARCHITECTURE note if structural, CHANGELOG, and an ADR for the window-driven-adaptivity + Galaxy-Store-single-codebase decisions) per the project documentation rules.

## Correctness Properties (business invariants)

The design defines concrete, testable properties (its own numbering) mapping back to these.

- **REQ-SM1 — Window/posture-driven, never brand-detected.** Layout derives from `sizeClass`/`posture`/`orientation` via `useResponsiveLayout()`, never from device brand/model; the same rules benefit foldables, tablets, and large-phone landscape alike. *(Req 1.1, 1.4, 4.1)*
- **REQ-SM2 — Phone baseline not regressed.** COMPACT renders the existing single-pane layouts unchanged; adaptivity is additive. *(Req 1.3, 2.4)*
- **REQ-SM3 — Two-pane on prioritized flows, reflow elsewhere.** EXPANDED shows list+detail side by side on the prioritized flows (radar+detail, properties+detail, activity+item) with in-place detail updates; other screens reflow (max width, expanded spacing), not a forced split. *(Req 2.1, 2.2, 2.3)*
- **REQ-SM4 — Reuse, no fork.** Two-pane/reflow reuse existing screens/components and Spec 24 tokens; no forked screen logic and no new hardcoded colors. *(Req 2.5, 6.2)*
- **REQ-SM5 — Adaptive layer causes no state loss; owners keep the state.** A fold/unfold/rotate configuration change (within the same running session — NOT process death/restart) causes no loss: navigation, form input, in-progress actions (call/tracking/upload/timer/sheet), scroll, session, and theme each remain owned by their existing owner and survive the re-layout; the adaptive layer only rearranges presentation and never resets or destructively remounts. *(Req 3.1–3.5)*
- **REQ-SM5b — Selection lives in navigation/flow state, not the adaptive container.** The active two-pane selection is represented by the flow's existing navigation/shared state, so collapsing two-pane→single-pane resolves the same detail from that state (and the reverse hydrates the detail pane), never relying on state local to the adaptive container. *(Req 2.4)*
- **REQ-SM6 — Posture-aware with explicit UNKNOWN + safe fallback.** `posture ∈ {FLAT, HALF_OPEN, UNKNOWN}`; `UNKNOWN` (platform doesn't expose posture) is never conflated with `FLAT` and falls back to size-class layout; `HALF_OPEN` MAY drive an arrangement where exposed and valuable. *(Req 1.2, 4.1)*
- **REQ-SM7 — Visual correctness over the supported universe; metrics from one resolver.** Over `{COMPACT,MEDIUM,EXPANDED}×{PORTRAIT,LANDSCAPE}` (+ HALF_OPEN where exposed) no configuration yields clipped/overlapping/unusable UI; safe-area/cutout/hinge come from the single window-metrics resolver (each with a defined unavailable value) and are respected/degraded gracefully; max readable width honored. *(Req 4.2, 4.3, 4.4, 4.5)*
- **REQ-SM8 — Single codebase, Galaxy Store publishable + build-valid.** One Expo codebase → AAB, no brand branching in app logic; store config from configuration; readiness artifacts (incl. unfolded screenshots) documented; and the build satisfies Samsung's current submission requirements (target API, 64-bit, signing, applicable binary-compatibility) without hardcoding version numbers in the spec. *(Req 5.1–5.6)*
- **REQ-SM9 — Testable without devices.** `useResponsiveLayout()` and two-pane containers are unit-testable by simulating window sizes/postures. *(Req 6.4)*
- **REQ-SM10 — Standards + i18n.** Breakpoints/thresholds are named typed config (no magic numbers, no `any`), adaptive UI text is `en`/`es` i18n, and the decisions are documented (ADR). *(Req 6.1, 6.3, 6.5)*

## Non-Goals

- New features, screens, domain logic, backend, or data-model changes — this is an adaptive presentation + publish-readiness layer over existing mobile surfaces.
- Device-brand detection or "if Samsung" branching — adaptivity is window/posture-driven and benefits all large screens.
- A full two-pane rewrite of every screen — only prioritized list+detail flows get two-pane; the rest reflow.
- Samsung-proprietary SDK integrations (deep One UI, DeX desktop mode, S-Pen, Flex-mode APIs) as hard v1 requirements — they are documented enhancements; the MVP uses standard Expo/RN adaptive capabilities.
- Server-side or persisted layout state, or cross-device layout sync — layout is ephemeral UI state from the current window/posture.
- New colors or a restyle — adaptive layouts reuse the Spec 24 tokens and existing components.
- Changing the CI/CD architecture — Galaxy Store publishing fits the existing single-codebase mobile build; only listing/readiness artifacts are added.
- iOS-specific or Play-specific behavior changes — the adaptive layer is cross-platform; Galaxy is the primary validation target for foldables.
