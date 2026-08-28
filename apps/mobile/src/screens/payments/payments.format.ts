/**
 * Currency formatting helpers for the payments UI.
 *
 * Formats integer cents into a locale-aware currency string using the payment's
 * currency, falling back to a plain string if Intl lacks the currency.
 */

const CENTS_PER_UNIT = 100;

/** Format integer cents in the given ISO 4217 currency, per the device locale. */
export function formatMoney(cents: number, currency: string): string {
  const amount = cents / CENTS_PER_UNIT;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}
