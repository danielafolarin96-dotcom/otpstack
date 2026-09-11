import { createAdminClient } from "@/lib/supabase/admin";
import { UsersFilters } from "./users-filters";
import { UsersTable } from "./users-table";

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const { q, status } = await searchParams;
  const admin = createAdminClient();

  let matchingIds: string[] | null = null;
  if (q) {
    // Three separate ilike lookups + merge instead of a single .or() string
    // — see the orders/transactions pages for why: that syntax treats
    // commas/parens in the search box input as filter-structure delimiters.
    const pattern = `%${q}%`;
    const [{ data: byEmail }, { data: byUsername }, { data: byName }] = await Promise.all([
      admin.from("users").select("id").ilike("email", pattern),
      admin.from("users").select("id").ilike("username", pattern),
      admin.from("users").select("id").ilike("full_name", pattern),
    ]);
    const ids = new Set<string>();
    for (const row of byEmail ?? []) ids.add(row.id);
    for (const row of byUsername ?? []) ids.add(row.id);
    for (const row of byName ?? []) ids.add(row.id);
    matchingIds = Array.from(ids);
  }

  let users: unknown[] = [];
  if (!matchingIds || matchingIds.length > 0) {
    let query = admin
      .from("users")
      .select("*, wallets(balance_kobo)")
      .order("created_at", { ascending: false })
      .limit(100);

    if (matchingIds) query = query.in("id", matchingIds);
    if (status === "frozen") query = query.eq("is_frozen", true);
    if (status === "active") query = query.eq("is_frozen", false);

    const { data } = await query;
    users = data ?? [];
  }
  // matchingIds is an empty array (search term matched nobody) — leave
  // users as [] rather than querying with .in("id", []), which isn't a
  // reliable way to express "no rows" across PostgREST versions.

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">Users</h1>
        <p className="text-sm text-text-dim">Every account, most recently joined first.</p>
      </div>

      <UsersFilters selected={{ q, status }} />

      <UsersTable users={(users as never) ?? []} />
    </div>
  );
}
