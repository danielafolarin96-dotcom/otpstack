import type { Metadata } from "next";
import Link from "next/link";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = {
  title: "Create account",
  description: "Create a free OtpStack account. Get virtual numbers for WhatsApp, Telegram, TikTok and 700+ apps in 130 countries, paid in naira.",
  alternates: { canonical: "/signup" },
};

export default function SignupPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-bold text-ink">Create account</h1>
        <p className="text-sm text-text-dim">Your code. Your number. Your stack.</p>
      </div>
      <SignupForm />
      <p className="text-center text-sm text-text-dim">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-signal-text hover:text-signal-dark">
          Log in
        </Link>
      </p>
    </div>
  );
}
