import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";

export interface RecordAdminActionInput {
  adminId: string;
  action: string;
  targetType: string;
  targetId: string;
  reason?: string | null;
  metadata?: Record<string, Json>;
}

// The only place server code writes to admin_audit_log. Pass an admin
// (service-role) client: RLS grants no insert on this table to any other
// role. Every mutating admin action (pricing rule changes, freeze/unfreeze,
// manual refund) must call this after requireAdmin() — see SECURITY.md
// "Admin actions".
export async function recordAdminAction(
  supabase: SupabaseClient<Database>,
  input: RecordAdminActionInput,
): Promise<void> {
  const { error } = await supabase.from("admin_audit_log").insert({
    admin_id: input.adminId,
    action: input.action,
    target_type: input.targetType,
    target_id: input.targetId,
    reason: input.reason ?? null,
    metadata: input.metadata ?? {},
  });

  if (error) throw error;
}
