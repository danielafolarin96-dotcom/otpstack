import { createClient } from "@/lib/supabase/server";
import { ProfileForm } from "./profile-form";
import { ChangePasswordForm } from "./change-password-form";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null; // layout above already redirects unauthenticated requests

  const { data: profile } = await supabase
    .from("users")
    .select("full_name, username, email")
    .eq("id", user.id)
    .maybeSingle();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-2xl font-bold text-ink">Settings</h1>

      <div className="max-w-lg rounded-[14px] border border-line bg-paper-raised p-6">
        <h2 className="font-display text-lg font-bold text-ink">Profile</h2>
        <p className="mt-1 text-sm text-text-dim">
          {profile?.email}
          <span className="ml-1.5 text-xs text-slate-dim">(email can&apos;t be changed here yet)</span>
        </p>
        <ProfileForm initialFullName={profile?.full_name ?? ""} initialUsername={profile?.username ?? ""} />
      </div>

      <div className="max-w-lg rounded-[14px] border border-line bg-paper-raised p-6">
        <h2 className="font-display text-lg font-bold text-ink">Change password</h2>
        <ChangePasswordForm />
      </div>
    </div>
  );
}
