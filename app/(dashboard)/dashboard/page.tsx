import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "./_components/empty-state";
import { TransactionsTable } from "./wallet/transactions-table";

export default async function OverviewPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null; // layout above already redirects unauthenticated requests

  const [{ data: profile }, { data: wallet }, { data: recentTransactions }] = await Promise.all([
    supabase.from("users").select("full_name").eq("id", user.id).maybeSingle(),
    supabase.from("wallets").select("balance_kobo").eq("user_id", user.id).maybeSingle(),
    supabase
      .from("wallet_transactions")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const displayName =
    profile?.full_name || user.user_metadata?.full_name || user.email || "there";
  const balanceKobo = wallet?.balance_kobo ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">
          Welcome back, {displayName}
        </h1>
        <p className="text-sm text-text-dim">Here&apos;s what&apos;s happening with your account.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Link
          href="/dashboard/wallet"
          className="rounded-[14px] border border-line bg-ink p-6 text-paper transition-opacity hover:opacity-90"
        >
          <p className="text-sm text-paper/70">Wallet balance</p>
          <p className="mt-2 font-technical text-3xl font-bold">
            ₦{(balanceKobo / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })}
          </p>
        </Link>

        <div className="rounded-[14px] border border-line bg-paper-raised p-6">
          <p className="text-sm text-text-dim">Active number</p>
          <p className="mt-2 font-technical text-xl text-text-dim">No active number</p>
        </div>
      </div>

      <EmptyState
        title="No quick-buy services yet"
        description="The service catalog and live pricing arrive in Phase 3."
      />

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <p className="font-display text-lg font-semibold text-ink">Recent activity</p>
          <Link href="/dashboard/wallet" className="text-sm font-medium text-signal hover:text-signal-bright">
            View all
          </Link>
        </div>
        <TransactionsTable transactions={recentTransactions ?? []} />
      </div>
    </div>
  );
}
