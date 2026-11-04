import type { FiveSimProfile } from "@/lib/5sim/client";
import { isLowBalance, LOW_BALANCE_THRESHOLD_USD } from "@/lib/providers/balance-thresholds";

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

  const low = isLowBalance("5sim", profile.balance);

  return (
    <div
      className={`rounded-[14px] border p-6 text-paper ${low ? "border-danger bg-ink" : "border-line bg-ink"}`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-paper/70">5sim balance</p>
        {low && (
          <span className="w-fit rounded-full bg-danger/15 px-2.5 py-1 text-xs font-medium text-danger">
            Low balance
          </span>
        )}
      </div>
      <p className={`mt-2 font-technical text-3xl font-bold ${low ? "text-danger" : ""}`}>
        ${profile.balance.toLocaleString("en-US", { minimumFractionDigits: 2 })}
      </p>
      {ngnRate !== null && (
        <p className="mt-1 text-sm text-paper/70">
          ≈ ₦
          {(profile.balance * ngnRate).toLocaleString("en-NG", { minimumFractionDigits: 2 })} at
          today&apos;s rate
        </p>
      )}
      {low && (
        <p className="mt-2 text-xs text-danger">
          Below the ${LOW_BALANCE_THRESHOLD_USD["5sim"]} threshold — top up soon to avoid declined
          purchases.
        </p>
      )}
      <p className="mt-4 text-xs text-paper/50">{profile.email}</p>
    </div>
  );
}
