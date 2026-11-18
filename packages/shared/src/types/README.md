# Types

## Purpose

Type contracts shared by the mobile app and the backend. Enumerations are `as const` objects with a derived union type (not TypeScript enums), matching the VARCHAR + validation convention in the database. Changing them affects both sides.

## Files

| File | Responsibility |
|------|---------------|
| `index.ts` | Re-exports all type files. |
| `user.types.ts` | `UserRole`, `SubscriptionTier`, `KycStatus`, `UserProfile`. |
| `offer.types.ts` | `OfferStatus`, `ServiceType`, `PropertyType`, `GeoLocation`, `OfferSummary`. |
| `payment.types.ts` | `PaymentStatus`, `DisputeReason`, `PaymentBreakdown`. |
| `notification.types.ts` | `NotificationType`, `NotificationCategory`, `NotificationPriority`, `NotificationChannel`, `NotificationStatus`, `Platform`, `SuppressionReason`, `DeepLink`, `NotificationIntent`. |

## Dependencies

- None.
