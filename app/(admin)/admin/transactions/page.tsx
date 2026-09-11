import { createAdminClient } from "@/lib/supabase/admin";
import { TransactionsFilters } from "./transactions-filters";
import { AdminTransactionsTable } from "./transactions-table";

const TYPES = ["topup", "purchase", "refund", "admin_adjustment"] as const;

// Two separate ilike lookups + merge instead of a single
// .or("email.ilike...,username.ilike...") string — see the orders page for
// why: that string treats commas/parens in the search box input as
// filter-structure delimiters, and .ilike() takes its pattern as a
// parameterized value.
async function findUserIdsMatching(
  admin: ReturnType<typeof createAdminClient>,
  query: string,
): Promise<string[]> {
  const pattern = `%${query}%`;
  const [{ data: byEmail }, { data: byUsername }] = await Promise.all([
    admin.from("users").select("id").ilike("email", pattern),
    admin.from("users").select("id").ilike("username", pattern),
  ]);
  const ids = new Set<string>();
  for (const row of byEmail ?? []) ids.add(row.id);
  for (const row of byUsername ?? []) ids.add(row.id);
  return Array.from(ids);
}

export default async function AdminTransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; user?: string }>;
}) {
  const { type, user: userQuery } = await searchParams;
  const admin = createAdminClient();

  let matchingUserIds: string[] | null = null;
  if (userQuery) {
    matchingUserIds = await findUserIdsMatching(admin, userQuery);
  }

  let transactions: unknown[] = [];
  if (!matchingUserIds || matchingUserIds.length > 0) {
    let query = admin
      .from("wallet_transactions")
      .select("*, users(email, username, full_name)")
      .order("created_at", { ascending: false })
      .limit(100);

    if (type) query = query.eq("type", type as (typeof TYPES)[number]);
    if (matchingUserIds) query = query.in("user_id", matchingUserIds);

    const { data } = await query;
    transactions = data ?? [];
  }
  // matchingUserIds is an empty array (search term matched nobody) — leave
  // transactions as [] rather than querying with .in("user_id", []), which
  // isn't a reliable way to express "no rows" across PostgREST versions.

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">Transactions</h1>
        <p className="text-sm text-text-dim">
          The wallet ledger across every user, most recent first.
        </p>
      </div>

      <TransactionsFilters types={TYPES} selected={{ type, userQuery }} />

      <AdminTransactionsTable transactions={transactions as never} />
    </div>
  );
}
