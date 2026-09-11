import { createAdminClient } from "@/lib/supabase/admin";
import { AuditLogFilters } from "./audit-log-filters";
import { AuditLogTable } from "./audit-log-table";

const ACTIONS = [
  "pricing_rule.create",
  "pricing_rule.delete",
  "user.freeze",
  "user.unfreeze",
  "order.manual_refund",
] as const;

// Same parameterized-ilike-merge pattern as orders/transactions/users —
// see those pages for why this isn't a single .or() string.
async function findAdminIdsMatching(
  admin: ReturnType<typeof createAdminClient>,
  query: string,
): Promise<string[]> {
  const pattern = `%${query}%`;
  const [{ data: byEmail }, { data: byUsername }, { data: byName }] = await Promise.all([
    admin.from("users").select("id").ilike("email", pattern),
    admin.from("users").select("id").ilike("username", pattern),
    admin.from("users").select("id").ilike("full_name", pattern),
  ]);
  const ids = new Set<string>();
  for (const row of byEmail ?? []) ids.add(row.id);
  for (const row of byUsername ?? []) ids.add(row.id);
  for (const row of byName ?? []) ids.add(row.id);
  return Array.from(ids);
}

export default async function AdminAuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; admin?: string }>;
}) {
  const { action, admin: adminQuery } = await searchParams;
  const admin = createAdminClient();

  let matchingAdminIds: string[] | null = null;
  if (adminQuery) {
    matchingAdminIds = await findAdminIdsMatching(admin, adminQuery);
  }

  let entries: unknown[] = [];
  if (!matchingAdminIds || matchingAdminIds.length > 0) {
    let query = admin
      .from("admin_audit_log")
      .select("*, users(email, username, full_name)")
      .order("created_at", { ascending: false })
      .limit(100);

    if (action) query = query.eq("action", action as (typeof ACTIONS)[number]);
    if (matchingAdminIds) query = query.in("admin_id", matchingAdminIds);

    const { data } = await query;
    entries = data ?? [];
  }
  // matchingAdminIds is an empty array (search term matched nobody) —
  // leave entries as [] rather than querying with .in("admin_id", []),
  // which isn't a reliable way to express "no rows" across PostgREST
  // versions.

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">Audit log</h1>
        <p className="text-sm text-text-dim">
          Every admin action — freezes, refunds, pricing changes — who did it, when, and why.
        </p>
      </div>

      <AuditLogFilters actions={ACTIONS} selected={{ action, adminQuery }} />

      <AuditLogTable entries={entries as never} />
    </div>
  );
}
