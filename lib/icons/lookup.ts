import "server-only";
import * as simpleIcons from "simple-icons";

export interface BrandIcon {
  path: string;
  hex: string;
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
    .map((icon) => [icon.slug, { path: icon.path, hex: icon.hex }]),
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
