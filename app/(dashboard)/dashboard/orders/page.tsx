import { createClient } from "@/lib/supabase/server";
import { OrdersTable } from "./orders-table";

export default async function OrderHistoryPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null; // layout above already redirects unauthenticated requests

  const { data: orders } = await supabase
    .from("orders")
    .select("*, services(name)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-2xl font-bold text-ink">Order history</h1>
      <OrdersTable orders={(orders as never) ?? []} />
    </div>
  );
}
