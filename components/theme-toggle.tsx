"use client";

import { useSyncExternalStore } from "react";
import { THEME_STORAGE_KEY, toggleTheme, type Theme } from "@/lib/theme/theme";

// Module-level, not component state: two ThemeToggle instances are
// simultaneously mounted at once in the dashboard layout (one per
// breakpoint, only one visible via CSS at a time — see app/(dashboard)/
// layout.tsx) and both must reflect the same click. useSyncExternalStore
// (not useState+useEffect) also sidesteps a hydration mismatch cleanly:
// getServerSnapshot below gives the SSR pass the same "light" default the
// bootstrap script itself falls back to, and React reconciles the real
// client value afterward without a mismatch warning — its whole purpose.
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function getSnapshot(): Theme {
  const current = document.documentElement.dataset.theme;
  return current === "dark" ? "dark" : "light";
}

function getServerSnapshot(): Theme {
  return "light";
}

function applyTheme(next: Theme) {
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // Private browsing / storage disabled — theme still applies for this
    // page view, it just won't be remembered next visit.
  }
  listeners.forEach((onChange) => onChange());
}

// Icon only, no label, matching SignOutButton's iconOnly variant and
// MobileNavMenu's hamburger button — neutral/monochrome per DESIGN.md
// (brand-colored icon tiles are reserved for service logos, never chrome).
function SunIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2" x2="12" y2="4.5" />
      <line x1="12" y1="19.5" x2="12" y2="22" />
      <line x1="4.22" y1="4.22" x2="5.94" y2="5.94" />
      <line x1="18.06" y1="18.06" x2="19.78" y2="19.78" />
      <line x1="2" y1="12" x2="4.5" y2="12" />
      <line x1="19.5" y1="12" x2="22" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.94" y2="18.06" />
      <line x1="18.06" y1="5.94" x2="19.78" y2="4.22" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

// Reads the theme the no-flash bootstrap script (app/layout.tsx) already
// applied to <html data-theme> before this component ever mounts — this
// never independently decides the initial theme, only mirrors whatever's
// already on screen, then takes over on click.
export function ThemeToggle({ className = "" }: { className?: string }) {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  function handleClick() {
    applyTheme(toggleTheme(theme));
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-text-dim transition-colors hover:bg-paper hover:text-ink ${className}`}
    >
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
