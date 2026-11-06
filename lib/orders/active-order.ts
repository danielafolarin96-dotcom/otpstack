// Which order (if any) the dashboard's "Active number" card should show.
// Pure, so it's testable without Supabase — see active-order.test.ts.
//
// Bug fix (Nov 2026): the dashboard used to fetch "the newest order that is
// pending or sms_received". Once the newest order expired/was cancelled, it
// no longer matched, so the query skipped it and fell back to an OLDER
// delivered order — a customer saw a Hinge code from days ago pop back up
// as their "active number" right after a TikTok number expired. Now the
// page fetches the newest order of ANY status and passes it here: only that
// order can ever be shown, so an older one can never resurface.
//
// A delivered code also stops showing once it's stale: DELIVERED_GRACE_MS
// after the order's hold ended. By then the customer has had their code
// for a while; it stays in Order History. This is server-side, so it holds
// on every device, unlike the per-browser dismiss/copy memory in
// active-number-panel.tsx.

export const DELIVERED_GRACE_MS = 30 * 60 * 1000;

export interface LatestOrderLike {
  status: string;
  expires_at: string;
}

export function shouldShowOnDashboard(order: LatestOrderLike | null, nowMs: number = Date.now()): boolean {
  if (!order) return false;
  if (order.status === "pending") return true;
  if (order.status === "sms_received") {
    const expiresMs = new Date(order.expires_at).getTime();
    // Unreadable timestamp: show it rather than hide a code the customer may need.
    if (Number.isNaN(expiresMs)) return true;
    return nowMs <= expiresMs + DELIVERED_GRACE_MS;
  }
  // expired_refunded / cancelled_refunded / banned: nothing active.
  return false;
}
