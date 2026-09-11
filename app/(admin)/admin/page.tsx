import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile, type FiveSimProfile } from "@/lib/5sim/client";
import { fetchLatestFxRate } from "@/lib/pricing/engine";
import { FiveSimBalanceCard } from "./fivesim-balance-card";

export default async function AdminOverviewPage() {
  const admin = createAdminClient();

  let profile: FiveSimProfile | null = null;
  let profileError: string | null = null;
  try {
    profile = await getProfile();
  } catch (err) {
    profileError = err instanceof Error ? err.message : "Unknown error";
  }

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
      </div>
    </div>
  );
}
