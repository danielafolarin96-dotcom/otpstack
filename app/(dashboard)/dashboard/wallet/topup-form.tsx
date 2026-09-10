"use client";

import { useState } from "react";

export function TopupForm() {
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const naira = Number(amount);
    if (!Number.isFinite(naira) || naira < 500) {
      setError("Minimum top-up is ₦500.");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/wallet/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountKobo: Math.round(naira * 100) }),
      });
      const json = await response.json();

      if (!response.ok) {
        setError(json.error ?? "Something went wrong.");
        setLoading(false);
        return;
      }

      window.location.href = json.authorizationUrl;
    } catch {
      setError("Couldn't reach the server. Try again.");
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-[14px] border border-line bg-paper-raised p-6"
    >
      <label htmlFor="amount" className="text-sm font-medium text-text">
        Top up wallet (₦)
      </label>
      <input
        id="amount"
        type="number"
        min={500}
        step={1}
        required
        placeholder="500"
        className="w-full rounded-[10px] border border-line bg-paper px-3.5 py-2.5 text-sm text-text focus:border-signal focus:outline-none focus:ring-1 focus:ring-signal"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      {error && <p className="text-sm text-danger">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="rounded-[10px] bg-signal px-4 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-signal-bright disabled:opacity-60"
      >
        {loading ? "Redirecting…" : "Top up"}
      </button>
    </form>
  );
}
