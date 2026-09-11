import Link from "next/link";
import { SUPPORT_EMAIL } from "@/lib/content/contact";

const LINKS = [
  { label: "FAQ", href: "/faq" },
  { label: "Terms of Service", href: "/terms" },
  { label: "Acceptable Use Policy", href: "/acceptable-use" },
  { label: "Privacy Policy", href: "/privacy" },
];

export function SiteFooter() {
  return (
    <footer className="mt-auto w-full border-t border-line">
      <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-4 px-5 py-8 text-sm text-text-dim sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="hover:text-text">
              {link.label}
            </Link>
          ))}
        </div>
        <div className="flex flex-col gap-1 sm:items-end">
          <a href={`mailto:${SUPPORT_EMAIL}`} className="hover:text-text">
            {SUPPORT_EMAIL}
          </a>
          <span className="text-xs text-slate-dim">© {new Date().getFullYear()} OtpStack</span>
        </div>
      </div>
    </footer>
  );
}
