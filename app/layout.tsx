import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import Script from "next/script";
import { THEME_STORAGE_KEY } from "@/lib/theme/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "OtpStack",
  description: "Your code. Your number. Your stack.",
};

// Sets data-theme on <html> before the browser paints, so the page never
// flashes the system/default theme before a stored override applies — a
// React effect would run too late (after first paint). strategy=
// "beforeInteractive" is next/script's documented mechanism for exactly
// this: injected into the initial HTML and run before any first-party JS,
// including hydration. Logic here must match lib/theme/theme.ts's
// resolveInitialTheme (unit-tested there) — duplicated, not imported,
// because this string runs standalone before any bundle, including this
// component's own, loads.
const THEME_BOOTSTRAP_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
    var theme = stored === "light" || stored === "dark"
      ? stored
      : (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.setAttribute("data-theme", theme);
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      // The bootstrap script above sets data-theme on this element before
      // React hydrates, so the server-rendered markup (which has no
      // data-theme — localStorage/matchMedia don't exist during SSR) will
      // always differ from the live DOM by the time hydration compares
      // them. That's expected, not a real mismatch, so it's suppressed
      // here rather than fixed by rendering a theme server-side (which
      // would need per-request access to a visitor's localStorage, which
      // doesn't exist).
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}
    >
      <head>
        <Script id="theme-bootstrap" strategy="beforeInteractive">
          {THEME_BOOTSTRAP_SCRIPT}
        </Script>
      </head>
      <body className="min-h-full flex flex-col bg-paper text-text">
        {children}
      </body>
    </html>
  );
}
