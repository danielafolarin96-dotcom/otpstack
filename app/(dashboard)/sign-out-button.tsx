"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      onClick={handleSignOut}
      className="rounded-[10px] px-3 py-2 text-left text-sm font-medium text-text-dim transition-colors hover:bg-paper hover:text-danger"
    >
      Log out
    </button>
  );
}
