"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const inputClass =
  "w-full rounded-[10px] border border-line bg-paper px-3.5 py-2.5 text-sm text-text placeholder:text-slate-dim focus:border-signal focus:outline-none focus:ring-1 focus:ring-signal";

export function SignupForm() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    if (!agreed) {
      setError("You need to accept the Terms of Service and Privacy Policy.");
      return;
    }

    setLoading(true);
    const response = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fullName, email, username, password }),
    });
    const result = await response.json();
    setLoading(false);

    if (!response.ok) {
      setError(result.error ?? "Something went wrong");
      return;
    }

    if (!result.hasSession) {
      // Signup succeeded but no session came back — most likely email
      // confirmation is still enabled on the Supabase project. The product
      // spec calls for no email-verification gate, so that setting needs
      // to be turned off in Authentication > Providers > Email.
      setError(
        "Account created, but you weren't signed in automatically. This project's email confirmation setting may still be on.",
      );
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="fullName" className="text-sm font-medium text-text">
          Full name
        </label>
        <input
          id="fullName"
          type="text"
          required
          autoComplete="name"
          className={inputClass}
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-sm font-medium text-text">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          className={inputClass}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="username" className="text-sm font-medium text-text">
          Username
        </label>
        <input
          id="username"
          type="text"
          required
          autoComplete="username"
          pattern="[a-zA-Z0-9_]+"
          title="Letters, numbers, and underscores only."
          className={inputClass}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-sm font-medium text-text">
          Password
        </label>
        <input
          id="password"
          type="password"
          required
          minLength={6}
          autoComplete="new-password"
          className={inputClass}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="confirmPassword" className="text-sm font-medium text-text">
          Confirm password
        </label>
        <input
          id="confirmPassword"
          type="password"
          required
          minLength={6}
          autoComplete="new-password"
          className={inputClass}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
        />
      </div>

      <label className="flex items-start gap-2.5 text-sm text-text-dim">
        <input
          type="checkbox"
          required
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-line text-signal focus:ring-signal"
        />
        <span>
          I agree to the{" "}
          <Link href="/terms" className="font-medium text-signal hover:text-signal-bright">
            Terms of Service
          </Link>
          ,{" "}
          <Link href="/acceptable-use" className="font-medium text-signal hover:text-signal-bright">
            Acceptable Use Policy
          </Link>
          , and{" "}
          <Link href="/privacy" className="font-medium text-signal hover:text-signal-bright">
            Privacy Policy
          </Link>
          .
        </span>
      </label>

      {error && <p className="text-sm text-danger">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="mt-2 rounded-[10px] bg-signal px-4 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-signal-bright disabled:opacity-60"
      >
        {loading ? "Creating account…" : "Create account"}
      </button>
    </form>
  );
}
