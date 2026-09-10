import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 px-5 py-16">
      <Link href="/" className="font-display text-2xl font-bold text-ink">
        OtpStack
      </Link>
      <div className="w-full max-w-[420px] rounded-[14px] border border-line bg-paper-raised p-8 shadow-sm">
        {children}
      </div>
    </main>
  );
}
