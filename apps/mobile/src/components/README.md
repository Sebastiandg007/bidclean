# Components

## Purpose

Reusable UI components shared across multiple screens. Each component lives in its own folder with its implementation, tests, and styles.

## Structure

```
components/
├── Button/
│   ├── Button.tsx
│   ├── Button.test.tsx
│   └── Button.styles.ts
├── Card/
├── Badge/
├── Timer/
├── MapPin/
└── ...
```

## Rules

- Only components used in 2+ screens belong here.
- Screen-specific components stay in their screen folder.
- Each component is self-contained (no external dependencies beyond theme).
- All components have accessibility labels.
