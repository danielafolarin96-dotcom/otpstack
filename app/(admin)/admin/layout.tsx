import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("users")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile?.is_admin) {
    redirect("/dashboard");
  }

  return (
    <div className="flex flex-1">
      <aside className="flex w-64 shrink-0 flex-col gap-8 border-r border-line bg-paper-raised px-4 py-6">
        <span className="px-2 font-display text-xl font-bold text-ink">
          OtpStack <span className="text-signal">Admin</span>
        </span>
        <nav className="flex flex-col gap-1">
          <Link
            href="/admin"
            className="rounded-[10px] px-3 py-2 text-sm font-medium text-text-dim transition-colors hover:bg-paper hover:text-text"
          >
            Overview
          </Link>
          <Link
            href="/admin/orders"
            className="rounded-[10px] px-3 py-2 text-sm font-medium text-text-dim transition-colors hover:bg-paper hover:text-text"
          >
            Orders
          </Link>
          <Link
            href="/admin/users"
            className="rounded-[10px] px-3 py-2 text-sm font-medium text-text-dim transition-colors hover:bg-paper hover:text-text"
          >
            Users
          </Link>
          <Link
            href="/admin/transactions"
            className="rounded-[10px] px-3 py-2 text-sm font-medium text-text-dim transition-colors hover:bg-paper hover:text-text"
          >
            Transactions
          </Link>
          <Link
            href="/admin/pricing"
            className="rounded-[10px] px-3 py-2 text-sm font-medium text-text-dim transition-colors hover:bg-paper hover:text-text"
          >
            Pricing rules
          </Link>
        </nav>
        <Link
          href="/dashboard"
          className="mt-auto rounded-[10px] px-3 py-2 text-sm font-medium text-text-dim transition-colors hover:bg-paper hover:text-text"
        >
          ← Back to dashboard
        </Link>
      </aside>
      <main className="flex-1 px-8 py-8">{children}</main>
    </div>
  );
}
