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
    <div className="flex flex-1 flex-col md:flex-row">
      <aside className="flex w-full flex-col border-b border-line bg-paper-raised md:w-64 md:shrink-0 md:justify-between md:border-b-0 md:border-r md:px-4 md:py-6">
        <div className="flex items-center gap-3 px-4 py-3 md:flex-col md:items-stretch md:gap-8 md:px-0 md:py-0">
          <span className="shrink-0 px-2 font-display text-lg font-bold text-ink md:text-xl">
            OtpStack
          </span>
          <DashboardNav />
        </div>
        <div className="border-t border-line px-4 py-2 md:border-t-0 md:px-0 md:py-0">
          <SignOutButton />
        </div>
      </aside>
      <main className="flex-1 px-5 py-6 md:px-8 md:py-8">{children}</main>
    </div>
  );
}
