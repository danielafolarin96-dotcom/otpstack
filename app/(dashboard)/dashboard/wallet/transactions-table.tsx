type Transaction = {
  id: string;
  type: string;
  amount_kobo: number;
  reference: string;
  created_at: string;
};

const TYPE_META: Record<string, { label: string; className: string }> = {
  topup: { label: "Top-up", className: "bg-good/15 text-good" },
  purchase: { label: "Purchase", className: "bg-ink/10 text-ink" },
  refund: { label: "Refund", className: "bg-amber/15 text-amber" },
  admin_adjustment: { label: "Adjustment", className: "bg-slate/15 text-slate" },
};

function formatNaira(kobo: number) {
  return (Math.abs(kobo) / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 });
}

export function TransactionsTable({ transactions }: { transactions: Transaction[] }) {
  if (transactions.length === 0) {
    return (
      <div className="flex min-h-[200px] flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed border-line bg-paper-raised px-6 text-center">
        <p className="font-display text-lg font-semibold text-ink">No transactions yet</p>
        <p className="max-w-sm text-sm text-text-dim">
          Your top-ups and purchases will show up here.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-[14px] border border-line bg-paper-raised">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line text-text-dim">
            <th className="px-4 py-3 font-medium">Type</th>
            <th className="px-4 py-3 font-medium">Amount</th>
            <th className="px-4 py-3 font-medium">Reference</th>
            <th className="px-4 py-3 font-medium">Date</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((tx) => {
            const meta = TYPE_META[tx.type] ?? {
              label: tx.type,
              className: "bg-slate/15 text-slate",
            };
            const isCredit = tx.amount_kobo >= 0;

            return (
              <tr key={tx.id} className="border-b border-line last:border-0">
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${meta.className}`}
                  >
                    {meta.label}
                  </span>
                </td>
                <td
                  className={`px-4 py-3 font-technical ${isCredit ? "text-good" : "text-danger"}`}
                >
                  {isCredit ? "+" : "-"}₦{formatNaira(tx.amount_kobo)}
                </td>
                <td className="px-4 py-3 font-technical text-text-dim">{tx.reference}</td>
                <td className="px-4 py-3 text-text-dim">
                  {new Date(tx.created_at).toLocaleDateString("en-NG", {
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
