import { EmptyState } from "../_components/empty-state";

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-2xl font-bold text-ink">Settings</h1>
      <EmptyState
        title="Profile settings coming soon"
        description="Editing your name, username, and password will land in a later phase."
      />
    </div>
  );
}
