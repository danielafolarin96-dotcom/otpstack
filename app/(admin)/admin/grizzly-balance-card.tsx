// Same layout as FiveSimBalanceCard, for the Grizzly SMS account
// (getBalance -> "ACCESS_BALANCE:<usd>"). Grizzly's balance response
// carries no account email, so there's no footer line.
export function GrizzlyBalanceCard({
  balanceUsd,
  ngnRate,
  error,
}: {
  balanceUsd: number | null;
  ngnRate: number | null;
  error: string | null;
}) {
  if (error) {
    return (
      <div className="rounded-[14px] border border-line bg-paper-raised p-6">
        <p className="text-sm font-medium text-text-dim">Grizzly balance</p>
        <p className="mt-2 text-sm text-danger">Couldn&apos;t reach Grizzly: {error}</p>
      </div>
    );
  }

  if (balanceUsd === null) return null;

  return (
    <div className="rounded-[14px] border border-line bg-ink p-6 text-paper">
      <p className="text-sm text-paper/70">Grizzly balance</p>
      <p className="mt-2 font-technical text-3xl font-bold">
        ${balanceUsd.toLocaleString("en-US", { minimumFractionDigits: 2 })}
      </p>
      {ngnRate !== null && (
        <p className="mt-1 text-sm text-paper/70">
          ≈ ₦
          {(balanceUsd * ngnRate).toLocaleString("en-NG", { minimumFractionDigits: 2 })} at
          today&apos;s rate
        </p>
      )}
    </div>
  );
}
