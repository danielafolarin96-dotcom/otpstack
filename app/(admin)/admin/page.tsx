import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile, type FiveSimProfile } from "@/lib/5sim/client";
import { getBalance as getGrizzlyBalance } from "@/lib/grizzly/client";
import { fetchLatestFxRate } from "@/lib/pricing/engine";
import { FiveSimBalanceCard } from "./fivesim-balance-card";
import { GrizzlyBalanceCard } from "./grizzly-balance-card";

export default async function AdminOverviewPage() {
  const admin = createAdminClient();

  let profile: FiveSimProfile | null = null;
  let profileError: string | null = null;
  let grizzlyBalance: number | null = null;
  let grizzlyError: string | null = null;
  // Independent: one provider being unreachable never hides the other card.
  await Promise.all([
    getProfile()
      .then((p) => {
        profile = p;
      })
      .catch((err: unknown) => {
        profileError = err instanceof Error ? err.message : "Unknown error";
      }),
    getGrizzlyBalance()
      .then((b) => {
        grizzlyBalance = b;
      })
      .catch((err: unknown) => {
        // GrizzlyError messages never include the URL/key (lib/grizzly/client.ts).
        grizzlyError = err instanceof Error ? err.message : "Unknown error";
      }),
  ]);

  // Best-effort — a missing fx_rates row just means the card skips the NGN
  // estimate, it shouldn't take down the whole overview page.
  let ngnRate: number | null = null;
  try {
    ngnRate = await fetchLatestFxRate(admin, "USD_NGN");
  } catch {
    ngnRate = null;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">Overview</h1>
        <p className="text-sm text-text-dim">Upstream account health.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <FiveSimBalanceCard profile={profile} ngnRate={ngnRate} error={profileError} />
        <GrizzlyBalanceCard balanceUsd={grizzlyBalance} ngnRate={ngnRate} error={grizzlyError} />
      </div>
    </div>
  );
}
