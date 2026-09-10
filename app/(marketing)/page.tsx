import Link from "next/link";

export default function Home() {
  return (
    <>
      <header className="mx-auto flex w-full max-w-[1080px] items-center justify-between px-5 py-6">
        <span className="font-display text-xl font-bold text-ink">OtpStack</span>
        <nav className="flex items-center gap-3">
          <Link
            href="/login"
            className="rounded-[10px] px-4 py-2 text-sm font-medium text-text hover:text-ink"
          >
            Log in
          </Link>
          <Link
            href="/signup"
            className="rounded-[10px] bg-signal px-4 py-2 text-sm font-semibold text-paper transition-colors hover:bg-signal-bright"
          >
            Create account
          </Link>
        </nav>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-4 px-5 text-center">
        <h1 className="font-display text-4xl font-bold text-ink">
          Your code. Your number. Your stack.
        </h1>
        <p className="max-w-md font-body text-text-dim">
          Temporary phone numbers for OTP verification, priced in naira, ready in seconds.
        </p>
        <p className="font-technical text-sm text-slate">
          Foundation scaffold — Phase 1 in progress
        </p>
      </main>
    </>
  );
}
