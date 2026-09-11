type AdminUserRow = {
  id: string;
  full_name: string;
  username: string;
  email: string;
  is_admin: boolean;
  is_frozen: boolean;
  created_at: string;
  wallets: { balance_kobo: number } | null;
};

export function UsersTable({ users }: { users: AdminUserRow[] }) {
  if (users.length === 0) {
    return (
      <div className="flex min-h-[200px] flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed border-line bg-paper-raised px-6 text-center">
        <p className="font-display text-lg font-semibold text-ink">No accounts match</p>
        <p className="max-w-sm text-sm text-text-dim">Try clearing a filter.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-[14px] border border-line bg-paper-raised">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line text-text-dim">
            <th className="px-4 py-3 font-medium">User</th>
            <th className="px-4 py-3 font-medium">Wallet balance</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Joined</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id} className="border-b border-line last:border-0">
              <td className="px-4 py-3">
                <div className="flex flex-col">
                  <span className="flex items-center gap-2 text-text">
                    {user.full_name || user.username}
                    {user.is_admin && (
                      <span className="rounded-full bg-signal/15 px-2 py-0.5 text-xs font-medium text-signal">
                        Admin
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-text-dim">
                    {user.email} · @{user.username}
                  </span>
                </div>
              </td>
              <td className="px-4 py-3 font-technical">
                ₦{((user.wallets?.balance_kobo ?? 0) / 100).toLocaleString("en-NG", {
                  minimumFractionDigits: 2,
                })}
              </td>
              <td className="px-4 py-3">
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                    user.is_frozen ? "bg-danger/15 text-danger" : "bg-good/15 text-good"
                  }`}
                >
                  {user.is_frozen ? "Frozen" : "Active"}
                </span>
              </td>
              <td className="px-4 py-3 text-text-dim">
                {new Date(user.created_at).toLocaleDateString("en-NG", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
