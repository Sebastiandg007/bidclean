# Theme

## Purpose

Design tokens and theme configuration for the BidClean design system. All visual properties are defined here and consumed by components.

## Files

| File | Content |
|------|---------|
| `colors.ts` | Color palette (dark mode, light mode, accent) |
| `typography.ts` | Font families, sizes, weights |
| `spacing.ts` | Spacing scale (xs, sm, md, lg, xl, xxl) |
| `radius.ts` | Border radius tokens |
| `shadows.ts` | Shadow/elevation definitions |
| `index.ts` | Unified theme export |

## Rules

- Never hardcode colors, fonts, or spacing in components.
- Always reference tokens: `theme.colors.accent`, `theme.spacing.md`.
- Theme supports dark and light mode (dark is default).
