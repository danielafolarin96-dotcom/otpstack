"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAdminAction } from "@/lib/audit/log";

export interface ActionState {
  error?: string;
}

// Freezing only blocks *new* purchases/top-ups (see the checks in
// lib/orders/purchase.ts and app/api/wallet/topup/route.ts) — it doesn't
// touch any order already in flight, which resolves through its normal
// expiry/refund path regardless.
export async function setUserFrozen(
  _prevState: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  try {
    const adminUser = await requireAdmin();

    const userId = String(formData.get("user_id"));
    const frozen = formData.get("frozen") === "true";
    const reason = String(formData.get("reason") ?? "").trim();

    if (!userId) return { error: "Missing user id" };
    if (!reason) {
      return { error: `A reason is required to ${frozen ? "freeze" : "unfreeze"} an account` };
    }

    const admin = createAdminClient();

    const { data: previous, error: fetchError } = await admin
      .from("users")
      .select("is_frozen")
      .eq("id", userId)
      .maybeSingle();
    if (fetchError) return { error: fetchError.message };
    if (!previous) return { error: "User not found" };

    const { error: updateError } = await admin
      .from("users")
      .update({ is_frozen: frozen })
      .eq("id", userId);
    if (updateError) return { error: updateError.message };

    await recordAdminAction(admin, {
      adminId: adminUser.id,
      action: frozen ? "user.freeze" : "user.unfreeze",
      targetType: "user",
      targetId: userId,
      reason,
      metadata: { previous_state: previous.is_frozen, new_state: frozen },
    });

    revalidatePath("/admin/users");
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Something went wrong" };
  }
}
