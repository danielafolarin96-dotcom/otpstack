import { EmptyState } from "../_components/empty-state";

export default function GetANumberPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-2xl font-bold text-ink">Get a number</h1>
      <EmptyState
        title="Service catalog coming soon"
        description="Country and service selection, live-priced, arrives in Phase 3."
      />
    </div>
  );
}
