/**
 * KYC module constants.
 *
 * All configurable values for image quality thresholds,
 * environment-dependent settings, and design tokens.
 */

// ─── Environment-Derived Configuration ───────────────────────────────────────

/** Minimum acceptable image width in pixels */
export const KYC_MIN_IMAGE_WIDTH = Number(
  process.env.EXPO_PUBLIC_KYC_MIN_IMAGE_WIDTH ?? '800',
);

/** Minimum acceptable image height in pixels */
export const KYC_MIN_IMAGE_HEIGHT = Number(
  process.env.EXPO_PUBLIC_KYC_MIN_IMAGE_HEIGHT ?? '600',
);

/** Maximum upload file size in megabytes */
export const KYC_MAX_FILE_SIZE_MB = Number(
  process.env.EXPO_PUBLIC_KYC_MAX_FILE_SIZE_MB ?? '10',
);

// ─── Image Quality Thresholds ────────────────────────────────────────────────

/** Minimum sharpness score (0-1) to consider image acceptable */
export const SHARPNESS_THRESHOLD = 0.4;

/** Minimum brightness value (0-255) for adequate lighting */
export const BRIGHTNESS_MIN_THRESHOLD = 50;

/** Maximum brightness value (0-255) for adequate lighting */
export const BRIGHTNESS_MAX_THRESHOLD = 220;

/** Minimum percentage of frame the document must fill for corners check */
export const DOCUMENT_FILL_RATIO = 0.6;

// ─── Design Tokens ───────────────────────────────────────────────────────────

export const COLORS = {
  background: '#0B0C10',
  card: '#1F2833',
  accent: '#00F5D4',
  textPrimary: '#FFFFFF',
  textSecondary: 'rgba(255, 255, 255, 0.6)',
  border: 'rgba(255, 255, 255, 0.2)',
  error: '#FF6B6B',
  overlayDark: 'rgba(0, 0, 0, 0.6)',
  warning: '#FFD93D',
} as const;

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const FONT_SIZE = {
  title: 22,
  subtitle: 14,
  body: 16,
  button: 17,
  feedback: 15,
  label: 13,
} as const;

// ─── Animation Config ────────────────────────────────────────────────────────

export const SPRING_CONFIG = {
  damping: 14,
  stiffness: 100,
  mass: 1,
} as const;

// ─── Overlay Dimensions ──────────────────────────────────────────────────────

/** Document frame aspect ratio (width:height) for standard ID cards */
export const DOCUMENT_ASPECT_RATIO = 1.586;

/** Percentage of screen width the overlay frame occupies */
export const OVERLAY_WIDTH_RATIO = 0.85;
