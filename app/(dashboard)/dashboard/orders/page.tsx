import { EmptyState } from "../_components/empty-state";

export default function OrderHistoryPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-2xl font-bold text-ink">Order history</h1>
      <EmptyState
        title="No orders yet"
        description="Your rented numbers and their status will show up here once the order flow ships in Phase 4."
      />
    </div>
  );
}
