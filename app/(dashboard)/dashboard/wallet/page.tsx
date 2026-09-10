import { createClient } from "@/lib/supabase/server";
import { TopupForm } from "./topup-form";
import { TransactionsTable } from "./transactions-table";
import { PaymentStatusPoller } from "./payment-status-poller";

export default async function WalletPage({
  searchParams,
}: {
  searchParams: Promise<{ reference?: string }>;
}) {
  const { reference } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null; // layout above already redirects unauthenticated requests

  const [{ data: wallet }, { data: transactions }] = await Promise.all([
    supabase.from("wallets").select("balance_kobo").eq("user_id", user.id).maybeSingle(),
    supabase
      .from("wallet_transactions")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const balanceKobo = wallet?.balance_kobo ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-2xl font-bold text-ink">Wallet & top-up</h1>

      {reference && <PaymentStatusPoller reference={reference} />}

      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-[14px] border border-line bg-ink p-6 text-paper">
          <p className="text-sm text-paper/70">Wallet balance</p>
          <p className="mt-2 font-technical text-3xl font-bold">
            ₦{(balanceKobo / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })}
          </p>
        </div>

        <TopupForm />
      </div>

      <TransactionsTable transactions={transactions ?? []} />
    </div>
  );
}
