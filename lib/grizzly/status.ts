// Pure parsing for Grizzly's activation-status responses — no network, so
// it's unit-testable without mocking fetch (lib/grizzly/client.ts does the
// calls). Shapes are from https://grizzlysms.com/docs (fetched 29 Oct
// 2026):
//
//   getStatus   -> plain text: STATUS_WAIT_CODE, STATUS_WAIT_RETRY:<last>,
//                  STATUS_WAIT_RESEND, STATUS_CANCEL, STATUS_OK:<code>
//   getStatusV2 -> JSON; the docs only show the SMS-received case:
//                  {"verificationType":2,"sms":{"dateTime":"2026-02-26 12:05:55","code":"852508","text":"852508"}}
//
// The docs don't show getStatusV2 for a waiting or cancelled activation,
// so the state machine is driven by getStatus (every state documented) and
// getStatusV2 is only used for the SMS details once getStatus says OK. Not
// verified against a live response yet — confirm on the first real test
// purchase (see ARCHITECTURE.md's Grizzly section).

export type GrizzlyActivationState =
  | { state: "waiting" }
  | { state: "cancelled" }
  | { state: "received"; code: string; text: string | null; smsDateTime: string | null };

// null = not a status we recognise; the caller treats that as "unknown",
// which every money path handles as "not cancelled, no SMS proven".
export function parseGetStatus(body: string): GrizzlyActivationState | null {
  const text = body.trim();
  if (text === "STATUS_WAIT_CODE" || text === "STATUS_WAIT_RESEND" || text.startsWith("STATUS_WAIT_RETRY")) {
    return { state: "waiting" };
  }
  if (text === "STATUS_CANCEL") return { state: "cancelled" };
  if (text.startsWith("STATUS_OK:")) {
    const code = text.slice("STATUS_OK:".length).trim();
    return { state: "received", code, text: null, smsDateTime: null };
  }
  return null;
}

export interface GrizzlySmsDetails {
  code: string | null;
  text: string | null;
  dateTime: string | null;
}

// The docs show `sms` as one object; an array (several SMS) is handled too,
// taking the newest, in case a resent code ever comes back that way.
export function parseGetStatusV2(body: string): GrizzlySmsDetails | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  let sms = (parsed as { sms?: unknown }).sms;
  if (Array.isArray(sms)) sms = sms[sms.length - 1];
  if (!sms || typeof sms !== "object") return null;
  const s = sms as { code?: unknown; text?: unknown; dateTime?: unknown };
  const str = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v : typeof v === "number" ? String(v) : null);
  const details = { code: str(s.code), text: str(s.text), dateTime: str(s.dateTime) };
  return details.code || details.text ? details : null;
}

// Grizzly sends "YYYY-MM-DD HH:MM:SS" with no timezone. Parsed as if UTC —
// the absolute value is meaningless on its own, only differences between
// two Grizzly timestamps are used (see smsArrivedAtOnOurClock).
function parseNaiveDateTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match.map(Number);
  return Date.UTC(y, mo - 1, d, h, mi, s);
}

// When the SMS arrived, on our clock (epoch ms), for the "did the code
// arrive inside the window the customer paid for" check. Grizzly's
// timezone is undocumented, so instead of trusting the absolute value this
// measures how long after Grizzly's own activationTime the SMS landed and
// adds that to our orders.created_at. Null when either timestamp is
// missing or unparseable — callers treat that as "not proven on time".
export function smsArrivedAtOnOurClock(
  order: { created_at: string; upstream_activation_time: string | null },
  smsDateTime: string | null,
): number | null {
  const activation = parseNaiveDateTime(order.upstream_activation_time);
  const sms = parseNaiveDateTime(smsDateTime);
  const createdAt = new Date(order.created_at).getTime();
  if (activation === null || sms === null || Number.isNaN(createdAt)) return null;
  return createdAt + (sms - activation);
}
