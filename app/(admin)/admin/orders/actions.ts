"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { manualRefundOrder } from "@/lib/orders/manual-refund";

export interface ActionState {
  error?: string;
}

export async function refundOrder(
  _prevState: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  try {
    const adminUser = await requireAdmin();

    const orderId = String(formData.get("order_id"));
    const reason = String(formData.get("reason") ?? "").trim();

    if (!orderId) return { error: "Missing order id" };
    if (!reason) return { error: "A reason is required to issue a refund" };

    const admin = createAdminClient();
    const { refunded } = await manualRefundOrder(admin, {
      orderId,
      adminId: adminUser.id,
      reason,
    });

    if (!refunded) {
      return {
        error: "This order can't be refunded — it's already expired, cancelled, refunded, or banned",
      };
    }

    revalidatePath("/admin/orders");
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Something went wrong" };
  }
}
