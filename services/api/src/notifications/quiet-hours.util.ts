/**
 * Compute the current minutes-since-midnight in an IANA timezone, or null when the timezone is
 * unknown/unsupported (the decision then treats quiet-hours as disabled — fail-open, never quiet).
 *
 * Uses `Intl.DateTimeFormat` (no external dep). `now` is injectable for deterministic tests.
 */
export function localNowMinutesInZone(timezone: string | null, now: Date = new Date()): number | null {
  if (!timezone) {
    return null;
  }
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const hourPart = parts.find((p) => p.type === 'hour')?.value;
    const minutePart = parts.find((p) => p.type === 'minute')?.value;
    if (hourPart === undefined || minutePart === undefined) {
      return null;
    }
    // Intl may render midnight as "24" in some environments; normalize to 0.
    const hour = Number(hourPart) % 24;
    const minute = Number(minutePart);
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
      return null;
    }
    return hour * 60 + minute;
  } catch {
    return null;
  }
}
