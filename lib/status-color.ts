/**
 * Status colors are stored as `#RRGGBB`. Pure and client-safe so the picker's
 * custom-color field and the server actions validate with the same rule.
 */

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Normalizes user input ("f80", "#FF8800", " ff8800 ") to uppercase `#RRGGBB`,
 * or returns null if it is not a valid 3- or 6-digit hex color.
 */
export function normalizeHexColor(input: string): string | null {
  const match = HEX_RE.exec(input.trim());
  if (!match) {
    return null;
  }
  let hex = match[1];
  if (hex.length === 3) {
    hex = [...hex].map((c) => c + c).join("");
  }
  return `#${hex.toUpperCase()}`;
}

export interface Hsv {
  /** 0–360 */
  h: number;
  /** 0–100 */
  s: number;
  /** 0–100 */
  v: number;
}

const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));

/** `#RRGGBB` → HSV. Invalid input yields black-ish defaults (never throws). */
export function hexToHsv(hex: string): Hsv {
  const norm = normalizeHexColor(hex) ?? "#000000";
  const r = Number.parseInt(norm.slice(1, 3), 16) / 255;
  const g = Number.parseInt(norm.slice(3, 5), 16) / 255;
  const b = Number.parseInt(norm.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) {
      h = ((g - b) / d) % 6;
    } else if (max === g) {
      h = (b - r) / d + 2;
    } else {
      h = (r - g) / d + 4;
    }
    h *= 60;
    if (h < 0) {
      h += 360;
    }
  }
  return { h, s: max === 0 ? 0 : (d / max) * 100, v: max * 100 };
}

/** HSV → uppercase `#RRGGBB`. Inputs are clamped to their ranges. */
export function hsvToHex({ h, s, v }: Hsv): string {
  const hh = ((clamp(h, 0, 360) % 360) + 360) % 360;
  const ss = clamp(s, 0, 100) / 100;
  const vv = clamp(v, 0, 100) / 100;
  const f = (n: number) => {
    const k = (n + hh / 60) % 6;
    return vv - vv * ss * Math.max(0, Math.min(k, 4 - k, 1));
  };
  const toHex = (x: number) =>
    Math.round(x * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(f(5))}${toHex(f(3))}${toHex(f(1))}`.toUpperCase();
}
