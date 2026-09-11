export const NAV_ITEMS = [
  { label: "Overview", href: "/dashboard" },
  { label: "Get a number", href: "/dashboard/get-a-number" },
  { label: "Order history", href: "/dashboard/orders" },
  { label: "Wallet & top-up", href: "/dashboard/wallet" },
  { label: "Settings", href: "/dashboard/settings" },
] as const;

export interface NavItem {
  label: string;
  href: string;
}

export function navItemsFor(isAdmin: boolean): NavItem[] {
  return isAdmin ? [...NAV_ITEMS, { label: "Admin", href: "/admin" }] : [...NAV_ITEMS];
}

export function isNavItemActive(pathname: string, href: string): boolean {
  return href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(href);
}
