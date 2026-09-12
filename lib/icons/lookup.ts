import "server-only";
import * as simpleIcons from "simple-icons";

export interface BrandIcon {
  path: string;
  hex: string;
  // True for a handful of brands (Supercell, Sony, Unity, ... 37 of the
  // package's 3,459 icons as of this writing) whose hex is at or near pure
  // white — invisible on the fixed-white --icon-surface tile background
  // (see components/catalog/service-catalog-grid.tsx), the same way dark
  // logos used to go invisible on the old theme-following --paper. Callers
  // use a fixed-dark tile instead for these.
  isNearWhite: boolean;
}

interface SimpleIconLike {
  slug: string;
  path: string;
  hex: string;
}

function isSimpleIcon(value: unknown): value is SimpleIconLike {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as SimpleIconLike).slug === "string" &&
    typeof (value as SimpleIconLike).path === "string" &&
    typeof (value as SimpleIconLike).hex === "string"
  );
}

// Relative luminance (WCAG-style, sRGB without the linearization curve —
// plenty precise for a binary "is this basically white" check, not a
// contrast-ratio calculation). Confirmed against real data: Snapchat's
// #FFFC00 (0.919) still reads fine on white, so the threshold below is set
// past that rather than at a round number.
function luminance(hex: string): number {
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const NEAR_WHITE_THRESHOLD = 0.94;

// simple-icons' named exports are keyed by "si<PascalTitle>" (e.g.
// siWhatsapp), not by the slug we actually store (services.icon_key) —
// build a slug -> icon map once, at module load, so lookups are O(1).
// Server-only: importing the whole package client-side would ship every
// brand's SVG path data (thousands of icons) to the browser for the
// handful actually used — see components/catalog/service-catalog-grid.tsx,
// which only ever receives the already-resolved path/hex for the services
// on the current page.
const iconsBySlug = new Map<string, BrandIcon>(
  Object.values(simpleIcons)
    .filter(isSimpleIcon)
    .map((icon) => [
      icon.slug,
      { path: icon.path, hex: icon.hex, isNearWhite: luminance(icon.hex) > NEAR_WHITE_THRESHOLD },
    ]),
);

// Returns null if icon_key doesn't match any current Simple Icons slug —
// callers fall back to the neutral ink-initial tile (DESIGN.md's "Icon
// tiles" note) in that case. Simple Icons doesn't have every brand: verified
// during the Stage 3 catalog trial that Amazon, Microsoft, and LinkedIn
// currently have no match despite being obviously major brands — a real
// gap in Simple Icons' coverage, not a bug in this lookup.
export function getBrandIcon(iconKey: string): BrandIcon | null {
  if (!iconKey) return null;
  return iconsBySlug.get(iconKey) ?? null;
}
