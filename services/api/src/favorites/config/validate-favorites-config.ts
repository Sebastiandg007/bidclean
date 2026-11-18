import {
  FAVORITES_CACHE_TTL_MS,
  FAVORITES_FREE_MAX,
  FAVORITES_LIST_DEFAULT_LIMIT,
  FAVORITES_LIST_MAX_LIMIT,
  FAVORITES_PRO_MAX,
} from '../favorites.constants';

/**
 * Fail-fast startup validation for favorites configuration (Spec 22).
 *
 * Skipped under NODE_ENV=test (tests inject config directly), consistent with the sibling modules.
 * Throws the full batch of invalid values so a misconfigured deployment never boots. Enforces the
 * limit representation rule (no magic sentinels): `FAVORITES_FREE_MAX` must be a positive integer;
 * `FAVORITES_PRO_MAX` is `null` (unset = unlimited) or a positive integer; the boolean flags parse
 * cleanly by construction (`envBool`); the list limits are positive integers with default <= max;
 * `FAVORITES_CACHE_TTL_MS` (if set) is a positive integer.
 */
export function validateFavoritesConfig(): void {
  if (process.env.NODE_ENV === 'test') {
    return;
  }

  const errors: string[] = [];

  if (!Number.isInteger(FAVORITES_FREE_MAX) || FAVORITES_FREE_MAX <= 0) {
    errors.push(`FAVORITES_FREE_MAX must be a positive integer, got ${FAVORITES_FREE_MAX}`);
  }

  // null = unlimited (valid); any present value must be a positive integer (never a sentinel).
  if (FAVORITES_PRO_MAX !== null && (!Number.isInteger(FAVORITES_PRO_MAX) || FAVORITES_PRO_MAX <= 0)) {
    errors.push(
      `FAVORITES_PRO_MAX must be unset (unlimited) or a positive integer, got ${FAVORITES_PRO_MAX}`,
    );
  }

  if (!Number.isInteger(FAVORITES_LIST_MAX_LIMIT) || FAVORITES_LIST_MAX_LIMIT <= 0) {
    errors.push(
      `FAVORITES_LIST_MAX_LIMIT must be a positive integer, got ${FAVORITES_LIST_MAX_LIMIT}`,
    );
  }

  if (!Number.isInteger(FAVORITES_LIST_DEFAULT_LIMIT) || FAVORITES_LIST_DEFAULT_LIMIT <= 0) {
    errors.push(
      `FAVORITES_LIST_DEFAULT_LIMIT must be a positive integer, got ${FAVORITES_LIST_DEFAULT_LIMIT}`,
    );
  }

  if (
    Number.isInteger(FAVORITES_LIST_MAX_LIMIT) &&
    Number.isInteger(FAVORITES_LIST_DEFAULT_LIMIT) &&
    FAVORITES_LIST_DEFAULT_LIMIT > FAVORITES_LIST_MAX_LIMIT
  ) {
    errors.push(
      'FAVORITES_LIST_DEFAULT_LIMIT must be <= FAVORITES_LIST_MAX_LIMIT ' +
        `(${FAVORITES_LIST_DEFAULT_LIMIT} > ${FAVORITES_LIST_MAX_LIMIT})`,
    );
  }

  if (
    FAVORITES_CACHE_TTL_MS !== null &&
    (!Number.isInteger(FAVORITES_CACHE_TTL_MS) || FAVORITES_CACHE_TTL_MS <= 0)
  ) {
    errors.push(
      `FAVORITES_CACHE_TTL_MS must be unset or a positive integer, got ${FAVORITES_CACHE_TTL_MS}`,
    );
  }

  if (errors.length > 0) {
    throw new Error(`Invalid favorites configuration:\n- ${errors.join('\n- ')}`);
  }
}
