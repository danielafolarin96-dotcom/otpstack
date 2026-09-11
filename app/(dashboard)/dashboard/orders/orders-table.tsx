type OrderRow = {
  id: string;
  phone_number: string;
  status: string;
  price_kobo: number;
  created_at: string;
  services: { name: string } | null;
};

const STATUS_META: Record<string, { label: string; className: string }> = {
  pending: { label: "Pending", className: "bg-amber/15 text-amber" },
  sms_received: { label: "Delivered", className: "bg-good/15 text-good" },
  expired_refunded: { label: "Refunded", className: "bg-slate/15 text-slate" },
  cancelled_refunded: { label: "Refunded", className: "bg-slate/15 text-slate" },
  banned: { label: "Banned", className: "bg-danger/15 text-danger" },
};

export function OrdersTable({ orders }: { orders: OrderRow[] }) {
  if (orders.length === 0) {
    return (
      <div className="flex min-h-[200px] flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed border-line bg-paper-raised px-6 text-center">
        <p className="font-display text-lg font-semibold text-ink">No orders yet</p>
        <p className="max-w-sm text-sm text-text-dim">
          Numbers you rent will show up here with their delivery status.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-[14px] border border-line bg-paper-raised">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line text-text-dim">
            <th className="px-4 py-3 font-medium">Service</th>
            <th className="px-4 py-3 font-medium">Number</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Price</th>
            <th className="px-4 py-3 font-medium">Date</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => {
            const meta = STATUS_META[order.status] ?? {
              label: order.status,
              className: "bg-slate/15 text-slate",
            };
            return (
              <tr key={order.id} className="border-b border-line last:border-0">
                <td className="px-4 py-3">{order.services?.name ?? "—"}</td>
                <td className="px-4 py-3 font-technical text-text-dim">{order.phone_number}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${meta.className}`}>
                    {meta.label}
                  </span>
                </td>
                <td className="px-4 py-3 font-technical">
                  ₦{(order.price_kobo / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })}
                </td>
                <td className="px-4 py-3 text-text-dim">
                  {new Date(order.created_at).toLocaleDateString("en-NG", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
