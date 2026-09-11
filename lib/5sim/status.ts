import type { FiveSimSmsMessage } from "./client";

export type OrderStatus =
  | "pending"
  | "sms_received"
  | "expired_refunded"
  | "cancelled_refunded"
  | "banned";

// A real test purchase (see lib/5sim/client.ts's header comment) showed
// 5sim can return status "RECEIVED" with an EMPTY sms array immediately
// after buying — "RECEIVED" there meant the number was successfully
// allocated, not that an OTP had arrived. So whether a code has actually
// arrived is decided by `sms` having entries, never by the status string
// alone; the status string only matters for the terminal states 5sim
// reports on its own (CANCELED/TIMEOUT/BANNED/FINISHED).
export function mapFiveSimOrderToStatus(order: {
  status: string;
  sms: unknown[] | null;
}): OrderStatus {
  if (order.sms && order.sms.length > 0) {
    return "sms_received";
  }

  switch (order.status) {
    case "CANCELED":
      return "cancelled_refunded";
    case "TIMEOUT":
      return "expired_refunded";
    case "BANNED":
      return "banned";
    case "FINISHED":
      // Shouldn't happen with no sms (we only call finish ourselves after
      // sms_received) — fail safe rather than throw on an unexpected shape.
      return "sms_received";
    case "PENDING":
    case "RECEIVED":
    default:
      return "pending";
  }
}

// Item shape is unverified (see FiveSimSmsMessage's comment) — try the
// fields that would plausibly hold the code, falling back to the newest
// message's raw text rather than returning nothing.
export function extractOtpCode(sms: FiveSimSmsMessage[] | null): string | null {
  if (!sms || sms.length === 0) return null;
  const latest = sms[sms.length - 1];
  return latest.code ?? latest.text ?? null;
}
