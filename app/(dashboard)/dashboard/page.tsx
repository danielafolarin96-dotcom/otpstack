import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeCatalogPrices, fetchActiveCountries } from "@/lib/pricing/catalog";
import { EmptyState } from "./_components/empty-state";
import { TransactionsTable } from "./wallet/transactions-table";
import { ActiveNumberPanel, type ActiveOrder } from "./active-number-panel";
import { customerCanCancel } from "@/lib/providers/policy";
import { shouldShowOnDashboard } from "@/lib/orders/active-order";
import { DashboardAppSearch } from "./app-search";

const QUICK_BUY_COUNT = 4;

export default async function OverviewPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null; // layout above already redirects unauthenticated requests

  const admin = createAdminClient();

  const [{ data: profile }, { data: wallet }, { data: recentTransactions }, countries, { data: latestOrder }] =
    await Promise.all([
      supabase.from("users").select("full_name").eq("id", user.id).maybeSingle(),
      supabase.from("wallets").select("balance_kobo").eq("user_id", user.id).maybeSingle(),
      supabase
        .from("wallet_transactions")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(5),
      fetchActiveCountries(admin),
      // The newest order of ANY status — see lib/orders/active-order.ts for
      // why (Nov 2026 fix: filtering on pending/sms_received here let an
      // older delivered order resurface once the newest one expired).
      // shouldShowOnDashboard below decides whether it's still "active".
      // (Sept 2026 history: this was once .eq("status", "pending"), which
      // made a delivered code vanish the instant it arrived; sms_received
      // still shows — the panel clears it on Dismiss/Copy, or once stale.)
      supabase
        .from("orders")
        .select("*, services(name)")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  const pendingOrder = shouldShowOnDashboard(latestOrder) ? latestOrder : null;
  const activeOrder: ActiveOrder | null = pendingOrder
    ? {
        id: pendingOrder.id,
        status: pendingOrder.status,
        phoneNumber: pendingOrder.phone_number,
        otpCode: pendingOrder.otp_code,
        expiresAt: pendingOrder.expires_at,
        serviceName: (pendingOrder as unknown as { services: { name: string } | null }).services?.name ?? "Number",
        canCancel: customerCanCancel(pendingOrder.provider),
      }
    : null;

  const displayName =
    profile?.full_name || user.user_metadata?.full_name || user.email || "there";
  const balanceKobo = wallet?.balance_kobo ?? 0;

  const defaultCountry = countries.find((c) => c.name === "Nigeria") ?? countries[0];
  // Quick buy only ever showed the first QUICK_BUY_COUNT of this — kept as
  // the full list here too so the search box below can search the entire
  // priced catalog for defaultCountry, not just that teaser slice.
  const allEntries = defaultCountry ? await computeCatalogPrices(admin, defaultCountry.id) : [];
  const quickBuy = allEntries.slice(0, QUICK_BUY_COUNT);

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

        <ActiveNumberPanel key={activeOrder?.id ?? "none"} order={activeOrder} />
      </div>

      {defaultCountry && allEntries.length > 0 && (
        <DashboardAppSearch entries={allEntries} countryId={defaultCountry.id} countryName={defaultCountry.name} />
      )}

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <p className="font-display text-lg font-semibold text-ink">Quick buy</p>
          <Link
            href="/dashboard/get-a-number"
            className="text-sm font-medium text-signal-text hover:text-signal-dark"
          >
            View all
          </Link>
        </div>
        {quickBuy.length > 0 ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {quickBuy.map(({ service, price }) => (
              <Link
                key={service.id}
                href="/dashboard/get-a-number"
                className="flex flex-col items-center gap-2 rounded-[14px] border border-line bg-paper-raised p-4 text-center transition-colors hover:border-signal"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-[10px] border border-line bg-paper font-display text-lg font-bold text-ink">
                  {service.name.charAt(0)}
                </div>
                <p className="text-sm font-medium text-text">{service.name}</p>
                <p className="font-technical text-sm text-signal-text">
                  {price
                    ? `₦${(price.priceKobo / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`
                    : "—"}
                </p>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No services configured yet"
            description="Add services and pricing rules in the admin panel."
          />
        )}
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <p className="font-display text-lg font-semibold text-ink">Recent activity</p>
          <Link href="/dashboard/wallet" className="text-sm font-medium text-signal-text hover:text-signal-dark">
            View all
          </Link>
        </div>
        <TransactionsTable transactions={recentTransactions ?? []} />
      </div>
    </div>
  );
}
