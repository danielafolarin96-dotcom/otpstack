"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { label: "Overview", href: "/dashboard" },
  { label: "Get a number", href: "/dashboard/get-a-number" },
  { label: "Order history", href: "/dashboard/orders" },
  { label: "Wallet & top-up", href: "/dashboard/wallet" },
  { label: "Settings", href: "/dashboard/settings" },
];

export function DashboardNav({ isAdmin = false }: { isAdmin?: boolean }) {
  const pathname = usePathname();
  const navItems = isAdmin ? [...NAV_ITEMS, { label: "Admin", href: "/admin" }] : NAV_ITEMS;

  return (
    <nav className="flex min-w-0 flex-1 gap-1 overflow-x-auto md:flex-col md:overflow-visible">
      {navItems.map((item) => {
        const isActive =
          item.href === "/dashboard"
            ? pathname === "/dashboard"
            : pathname.startsWith(item.href);

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
