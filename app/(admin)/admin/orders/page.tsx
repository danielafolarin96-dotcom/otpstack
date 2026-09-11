import { createAdminClient } from "@/lib/supabase/admin";
import { OrdersFilters } from "./orders-filters";
import { AdminOrdersTable } from "./orders-table";

const STATUSES = [
  "pending",
  "sms_received",
  "expired_refunded",
  "cancelled_refunded",
  "banned",
] as const;

// Two separate ilike lookups + merge instead of a single .or("email.ilike...,username.ilike...")
// string — that string gets built from the raw search box input, and
// PostgREST's or() syntax treats commas/parens as filter-structure
// delimiters, so a search term containing them would need escaping. .ilike()
// takes its pattern as a parameterized value, so this sidesteps that
// entirely.
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

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; service?: string; user?: string }>;
}) {
  const { status, service: serviceId, user: userQuery } = await searchParams;
  const admin = createAdminClient();

  const { data: services } = await admin.from("services").select("id, name").order("name");

  let matchingUserIds: string[] | null = null;
  if (userQuery) {
    matchingUserIds = await findUserIdsMatching(admin, userQuery);
  }

  let orders: unknown[] = [];
  if (!matchingUserIds || matchingUserIds.length > 0) {
    let query = admin
      .from("orders")
      .select("*, services(name), users(email, username, full_name)")
      .order("created_at", { ascending: false })
      .limit(100);

    if (status) query = query.eq("status", status as (typeof STATUSES)[number]);
    if (serviceId) query = query.eq("service_id", serviceId);
    if (matchingUserIds) query = query.in("user_id", matchingUserIds);

    const { data } = await query;
    orders = data ?? [];
  }
  // matchingUserIds is an empty array (search term matched nobody) — leave
  // orders as [] rather than querying, since .in("user_id", []) is not a
  // reliable way to express "no rows" across PostgREST versions.

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">Orders</h1>
        <p className="text-sm text-text-dim">All orders across every user, most recent first.</p>
      </div>

      <OrdersFilters
        services={services ?? []}
        statuses={STATUSES}
        selected={{ status, serviceId, userQuery }}
      />

      <AdminOrdersTable orders={orders as never} />
    </div>
  );
}
