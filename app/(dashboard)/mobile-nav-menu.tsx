"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { isNavItemActive, navItemsFor } from "./nav-items";

export function MobileNavMenu({ isAdmin = false }: { isAdmin?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const navItems = navItemsFor(isAdmin);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Layout persists across dashboard route changes, so this needs to close
  // itself on navigation rather than relying on unmounting. Adjusting state
  // during render (React's sanctioned pattern for this) instead of an
  // effect avoids an extra post-navigation render with the menu still open.
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div ref={containerRef} className="relative md:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Menu"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-paper-raised text-ink transition-colors hover:bg-paper"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-10 mt-2 w-56 rounded-[14px] border border-line bg-paper-raised p-2 shadow-lg"
        >
          <nav className="flex flex-col gap-1">
            {navItems.map((item) => {
              const isActive = isNavItemActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  role="menuitem"
                  className={`rounded-[10px] px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-ink text-paper"
                      : "text-text-dim hover:bg-paper hover:text-text"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="my-1 h-px bg-line" />

          <button
            type="button"
            role="menuitem"
            onClick={handleSignOut}
            className="w-full rounded-[10px] px-3 py-2 text-left text-sm font-medium text-text-dim transition-colors hover:bg-paper hover:text-danger"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
