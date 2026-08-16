# Utils

## Purpose

Pure utility functions with no side effects. Helpers for formatting, calculations, and data transformations.

## Examples

- `formatCurrency(amount, currency)` → "$50.00" or "€50,00"
- `calculateDistance(pointA, pointB)` → distance in km
- `formatRelativeTime(date)` → "5 min ago"
- `truncateText(text, maxLength)` → "This is a lon..."

## Rules

- Pure functions only (input → output, no side effects).
- Each utility is independently testable.
- No dependencies on stores, services, or components.
