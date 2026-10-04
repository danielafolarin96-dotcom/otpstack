export type Theme = "light" | "dark";

// Single source of truth for the key name — shared by the no-flash bootstrap
// script in app/layout.tsx (interpolated into that inline script at render
// time, since the script itself runs standalone before any bundle loads and
// can't import this module) and ThemeToggle's own reads/writes.
export const THEME_STORAGE_KEY = "otpstack-theme";

export function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark";
}

// Resolution order: an explicit stored choice always wins; otherwise fall
// back to the system preference. This is the behavior the bootstrap
// script's inline copy (app/layout.tsx) must match — kept here, not only
// there, specifically so it has one unit-tested definition instead of only
// ever running untested inside a raw <script> string.
export function resolveInitialTheme(storedValue: string | null, prefersDark: boolean): Theme {
  if (isTheme(storedValue)) return storedValue;
  return prefersDark ? "dark" : "light";
}

export function toggleTheme(current: Theme): Theme {
  return current === "dark" ? "light" : "dark";
}
