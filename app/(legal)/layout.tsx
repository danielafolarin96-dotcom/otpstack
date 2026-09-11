import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-[1080px] items-center justify-between px-5 py-6">
        <Link href="/" className="font-display text-xl font-bold text-ink">
          OtpStack
        </Link>
        <Link href="/dashboard" className="text-sm font-medium text-text-dim hover:text-text">
          Go to dashboard
        </Link>
      </header>

      <main className="mx-auto w-full max-w-[720px] flex-1 px-5 pb-16">{children}</main>

      <SiteFooter />
    </div>
  );
}
