"use client";

import { useState } from "react";

// text-base below sm:, not text-sm alone: iOS Safari auto-zooms the page
// on focus of any input under 16px computed font-size.
const inputClass =
  "w-full rounded-[10px] border border-line bg-paper px-3.5 py-2.5 text-base text-text placeholder:text-slate-dim focus:border-signal focus:outline-none focus:ring-1 focus:ring-signal sm:text-sm";

export function ChangePasswordForm() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setLoading(true);
    const response = await fetch("/api/settings/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const result = await response.json();
    setLoading(false);

    if (!response.ok) {
      setError(result.error ?? "Something went wrong");
      return;
    }

    setPassword("");
    setConfirmPassword("");
    setSuccess(true);
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="newPassword" className="text-sm font-medium text-text">
          New password
        </label>
        <input
          id="newPassword"
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
        <label htmlFor="confirmNewPassword" className="text-sm font-medium text-text">
          Confirm new password
        </label>
        <input
          id="confirmNewPassword"
          type="password"
          required
          minLength={6}
          autoComplete="new-password"
          className={inputClass}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
        />
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}
      {success && <p className="text-sm text-good">Password updated.</p>}

      <button
        type="submit"
        disabled={loading}
        className="self-start rounded-[10px] bg-signal px-4 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-signal-bright disabled:opacity-60"
      >
        {loading ? "Updating…" : "Update password"}
      </button>
    </form>
  );
}
