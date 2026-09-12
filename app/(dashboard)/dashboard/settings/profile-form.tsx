"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const inputClass =
  "w-full rounded-[10px] border border-line bg-paper px-3.5 py-2.5 text-sm text-text placeholder:text-slate-dim focus:border-signal focus:outline-none focus:ring-1 focus:ring-signal";

export function ProfileForm({
  initialFullName,
  initialUsername,
}: {
  initialFullName: string;
  initialUsername: string;
}) {
  const router = useRouter();
  const [fullName, setFullName] = useState(initialFullName);
  const [username, setUsername] = useState(initialUsername);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setLoading(true);

    const response = await fetch("/api/settings/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fullName, username }),
    });
    const result = await response.json();
    setLoading(false);

    if (!response.ok) {
      setError(result.error ?? "Something went wrong");
      return;
    }

    setSuccess(true);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
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

      {error && <p className="text-sm text-danger">{error}</p>}
      {success && <p className="text-sm text-good">Profile updated.</p>}

      <button
        type="submit"
        disabled={loading}
        className="self-start rounded-[10px] bg-signal px-4 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-signal-bright disabled:opacity-60"
      >
        {loading ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}
