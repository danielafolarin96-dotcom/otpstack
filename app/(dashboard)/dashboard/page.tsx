import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "./_components/empty-state";

export default async function OverviewPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = user
    ? await supabase.from("users").select("full_name").eq("id", user.id).maybeSingle()
    : { data: null };

  const displayName =
    profile?.full_name || user?.user_metadata?.full_name || user?.email || "there";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">
          Welcome back, {displayName}
        </h1>
        <p className="text-sm text-text-dim">Here&apos;s what&apos;s happening with your account.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-[14px] border border-line bg-ink p-6 text-paper">
          <p className="text-sm text-paper/70">Wallet balance</p>
          <p className="mt-2 font-technical text-3xl font-bold">—</p>
          <p className="mt-1 text-xs text-paper/60">Wired up in Phase 2</p>
        </div>

        <div className="rounded-[14px] border border-line bg-paper-raised p-6">
          <p className="text-sm text-text-dim">Active number</p>
          <p className="mt-2 font-technical text-xl text-text-dim">No active number</p>
        </div>
      </div>

      <EmptyState
        title="No quick-buy services yet"
        description="The service catalog and live pricing arrive in Phase 3."
      />

      <EmptyState
        title="No transactions yet"
        description="Your wallet ledger will show up here once top-ups and purchases are wired up in Phase 2."
      />
    </div>
  );
}
