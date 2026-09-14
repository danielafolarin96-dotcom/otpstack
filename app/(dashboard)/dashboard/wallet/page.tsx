import { createClient } from "@/lib/supabase/server";
import { TopupForm } from "./topup-form";
import { TransactionsTable } from "./transactions-table";
import { PaymentStatusPoller } from "./payment-status-poller";

export default async function WalletPage({
  searchParams,
}: {
  searchParams: Promise<{ reference?: string | string[] }>;
}) {
  const { reference: rawReference } = await searchParams;
  // Paystack's redirect appends its own `trxref`/`reference` params on top
  // of the `reference` we already put in callback_url, so this key can show
  // up twice in the URL — Next.js then hands us a string[] here instead of
  // a string. Collapse to a single value so the confirmation banner doesn't
  // render the reference doubled up.
  const reference = Array.isArray(rawReference) ? rawReference[0] : rawReference;
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

  // Bug fix (Sept 2026): this used to render purely on whether a
  // `reference` query param was present in the URL, with no check against
  // whether that payment had actually landed — so the banner either
  // vanished via PaymentStatusPoller's own 10-second client-side timeout
  // regardless of real webhook status, or reappeared claiming "still
  // confirming" for an already-completed topup whenever the user reloaded
  // or revisited a URL that still carried an old `?reference=`.
  // wallet_transactions.reference is the exact same string the callback
  // URL is built with (`topup_${randomUUID()}`, see
  // app/api/wallet/topup/route.ts) — so if a row with that reference is
  // already in what we just fetched, the webhook already succeeded and
  // there's nothing left to poll for.
  const paymentAlreadyConfirmed = reference
    ? (transactions ?? []).some((t) => t.reference === reference)
    : false;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-2xl font-bold text-ink">Wallet & top-up</h1>

      {reference && !paymentAlreadyConfirmed && <PaymentStatusPoller reference={reference} />}

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
