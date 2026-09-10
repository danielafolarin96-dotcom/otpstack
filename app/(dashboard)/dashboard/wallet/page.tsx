import { EmptyState } from "../_components/empty-state";

export default function WalletPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-2xl font-bold text-ink">Wallet & top-up</h1>
      <EmptyState
        title="Wallet not wired up yet"
        description="Paystack funding and your transaction ledger arrive in Phase 2."
      />
    </div>
  );
}
