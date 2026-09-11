"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isNavItemActive, navItemsFor } from "./nav-items";

// Desktop only — at mobile widths the sidebar is replaced entirely by
// MobileNavMenu (a hamburger + dropdown), so this never needs to lay its
// items out in a row.
export function DashboardNav({ isAdmin = false }: { isAdmin?: boolean }) {
  const pathname = usePathname();
  const navItems = navItemsFor(isAdmin);

  return (
    <nav className="hidden min-w-0 flex-1 flex-col gap-1 md:flex">
      {navItems.map((item) => {
        const isActive = isNavItemActive(pathname, item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`shrink-0 whitespace-nowrap rounded-[10px] px-3 py-2 text-sm font-medium transition-colors ${
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
  );
}
