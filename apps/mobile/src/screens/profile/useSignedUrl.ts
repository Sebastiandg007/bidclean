/**
 * useSignedUrl — Hook that detects expired signed URLs and requests fresh ones.
 *
 * Used for profile photos and portfolio images stored in MinIO.
 * Parses the signed URL expiry from query parameters (X-Amz-Expires / X-Amz-Date).
 * Returns current URL if still valid, null if expired.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Buffer time (ms) before actual expiry to trigger refresh early */
const EXPIRY_BUFFER_MS = 60_000;

/** Param names used by S3-compatible signed URLs */
const S3_DATE_PARAM = 'X-Amz-Date';
const S3_EXPIRES_PARAM = 'X-Amz-Expires';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Parses the expiry timestamp from a signed URL's query parameters.
 * Returns epoch ms when the URL expires, or null if unparseable.
 */
function parseUrlExpiry(url: string): number | null {
  try {
    const parsedUrl = new URL(url);
    const dateStr = parsedUrl.searchParams.get(S3_DATE_PARAM);
    const expiresStr = parsedUrl.searchParams.get(S3_EXPIRES_PARAM);

    if (!dateStr || !expiresStr) {
      return null;
    }

    // X-Amz-Date format: 20240101T120000Z
    const year = Number(dateStr.slice(0, 4));
    const month = Number(dateStr.slice(4, 6)) - 1;
    const day = Number(dateStr.slice(6, 8));
    const hour = Number(dateStr.slice(9, 11));
    const minute = Number(dateStr.slice(11, 13));
    const second = Number(dateStr.slice(13, 15));

    const signedAt = new Date(Date.UTC(year, month, day, hour, minute, second));
    const expiresInSeconds = Number(expiresStr);

    return signedAt.getTime() + expiresInSeconds * 1000;
  } catch {
    return null;
  }
}

/**
 * Determines if a signed URL is still valid (not expired).
 */
function isUrlValid(url: string): boolean {
  const expiry = parseUrlExpiry(url);

  if (expiry === null) {
    // Cannot parse — assume valid for fallback behavior
    return true;
  }

  return Date.now() < expiry - EXPIRY_BUFFER_MS;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Returns a valid signed URL if the input URL is still fresh.
 * Returns null when the URL has expired (caller should trigger a refresh).
 *
 * @param url - The current signed URL (may be expired or null)
 * @returns A valid signed URL or null if expired/unavailable
 */
export function useSignedUrl(url: string | null): string | null {
  const [validUrl, setValidUrl] = useState<string | null>(url);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const expiresAt = useMemo(() => {
    if (!url) return null;
    return parseUrlExpiry(url);
  }, [url]);

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (!url) {
      setValidUrl(null);
      return;
    }

    if (!isUrlValid(url)) {
      setValidUrl(null);
      return;
    }

    setValidUrl(url);

    // Schedule invalidation when URL expires
    if (expiresAt) {
      const timeUntilExpiry = expiresAt - Date.now() - EXPIRY_BUFFER_MS;

      if (timeUntilExpiry > 0) {
        timerRef.current = setTimeout(() => {
          setValidUrl(null);
        }, timeUntilExpiry);
      }
    }

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [url, expiresAt]);

  return validUrl;
}

export default useSignedUrl;
