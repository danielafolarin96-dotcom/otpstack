import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DashboardNav } from "./dashboard-nav";
import { SignOutButton } from "./sign-out-button";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="flex flex-1">
      <aside className="flex w-64 shrink-0 flex-col justify-between border-r border-line bg-paper-raised px-4 py-6">
        <div className="flex flex-col gap-8">
          <span className="px-2 font-display text-xl font-bold text-ink">
            OtpStack
          </span>
          <DashboardNav />
        </div>
        <SignOutButton />
      </aside>
      <main className="flex-1 px-8 py-8">{children}</main>
    </div>
  );
}
