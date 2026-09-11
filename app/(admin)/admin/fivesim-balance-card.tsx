import type { FiveSimProfile } from "@/lib/5sim/client";

export function FiveSimBalanceCard({
  profile,
  ngnRate,
  error,
}: {
  profile: FiveSimProfile | null;
  ngnRate: number | null;
  error: string | null;
}) {
  if (error) {
    return (
      <div className="rounded-[14px] border border-line bg-paper-raised p-6">
        <p className="text-sm font-medium text-text-dim">5sim balance</p>
        <p className="mt-2 text-sm text-danger">Couldn&apos;t reach 5sim: {error}</p>
      </div>
    );
  }

  if (!profile) return null;

  return (
    <div className="rounded-[14px] border border-line bg-ink p-6 text-paper">
      <p className="text-sm text-paper/70">5sim balance</p>
      <p className="mt-2 font-technical text-3xl font-bold">
        ${profile.balance.toLocaleString("en-US", { minimumFractionDigits: 2 })}
      </p>
      {ngnRate !== null && (
        <p className="mt-1 text-sm text-paper/70">
          ≈ ₦
          {(profile.balance * ngnRate).toLocaleString("en-NG", { minimumFractionDigits: 2 })} at
          today&apos;s rate
        </p>
      )}
      <p className="mt-4 text-xs text-paper/50">{profile.email}</p>
    </div>
  );
}
