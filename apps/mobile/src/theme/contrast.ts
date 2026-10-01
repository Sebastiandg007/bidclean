/**
 * contrast.ts — a pure WCAG 2.1 relative-luminance / contrast-ratio utility.
 *
 * Used by tests to assert that text/essential-UI token pairs meet WCAG 2.1 AA in both themes. Pure,
 * single-responsibility, no `any`. Accepts `#RGB`, `#RRGGBB`, and `rgba(r,g,b,a)` colors; an `rgba`
 * with alpha < 1 is composited over an opaque backdrop (default: the token it renders on) so the
 * effective color is measured, not the translucent literal.
 */

interface Rgb {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** WCAG AA minimum contrast for normal-size text. */
export const WCAG_AA_NORMAL = 4.5;

/** WCAG AA minimum contrast for large text and essential UI / graphical elements. */
export const WCAG_AA_LARGE = 3.0;

/** Parses a `#RGB`, `#RRGGBB`, or `rgba()`/`rgb()` color into normalized RGBA channels. */
function parseColor(color: string): Rgb {
  const trimmed = color.trim();

  if (trimmed.startsWith('#')) {
    return parseHex(trimmed);
  }
  if (trimmed.startsWith('rgb')) {
    return parseRgb(trimmed);
  }
  throw new Error(`[contrast] Unsupported color format: ${color}`);
}

/** Parses `#RGB` or `#RRGGBB`. */
function parseHex(hex: string): Rgb {
  const body = hex.slice(1);
  const full = body.length === 3 ? body.replace(/(.)/g, '$1$1') : body;

  if (full.length !== 6 || /[^0-9a-fA-F]/.test(full)) {
    throw new Error(`[contrast] Invalid hex color: ${hex}`);
  }

  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
    a: 1,
  };
}

/** Parses `rgb(r,g,b)` / `rgba(r,g,b,a)`. */
function parseRgb(rgb: string): Rgb {
  const parts = rgb
    .slice(rgb.indexOf('(') + 1, rgb.indexOf(')'))
    .split(',')
    .map((p) => Number(p.trim()));

  const r = parts[0] ?? NaN;
  const g = parts[1] ?? NaN;
  const b = parts[2] ?? NaN;
  const a = parts[3];
  if ([r, g, b].some((c) => Number.isNaN(c))) {
    throw new Error(`[contrast] Invalid rgb color: ${rgb}`);
  }

  return { r, g, b, a: a === undefined || Number.isNaN(a) ? 1 : a };
}

/** Composites a possibly-translucent foreground over an opaque backdrop into an opaque color. */
function flatten(color: Rgb, backdrop: Rgb): Rgb {
  if (color.a >= 1) {
    return color;
  }
  return {
    r: color.r * color.a + backdrop.r * (1 - color.a),
    g: color.g * color.a + backdrop.g * (1 - color.a),
    b: color.b * color.a + backdrop.b * (1 - color.a),
    a: 1,
  };
}

/** Converts an 8-bit channel to its linearized value per the WCAG relative-luminance formula. */
function linearize(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance (0–1) of an opaque color per WCAG 2.1. */
function relativeLuminance(color: Rgb): number {
  return 0.2126 * linearize(color.r) + 0.7152 * linearize(color.g) + 0.0722 * linearize(color.b);
}

/**
 * WCAG 2.1 contrast ratio between a foreground and a background color (1–21). A translucent
 * foreground is composited over the (opaque) background before measuring.
 */
export function contrastRatio(foreground: string, background: string): number {
  const bg = parseColor(background);
  const fg = flatten(parseColor(foreground), bg);

  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);

  return (lighter + 0.05) / (darker + 0.05);
}
