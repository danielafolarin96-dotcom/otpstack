// Client-safe provider facts (no server-only import), shared by the API
// routes and the dashboard's active-number panel so the Cancel button and
// the cancel route can never disagree.

export type ProviderName = "5sim" | "grizzly";

export function asProviderName(value: string | null | undefined): ProviderName {
  return value === "grizzly" ? "grizzly" : "5sim";
}

// Grizzly locks cancel for ~5 minutes after purchase — the whole 5-minute
// hold — so a Grizzly number is never cancellable by the customer; it
// refunds automatically at expiry if no code arrived (product decision,
// 29 Oct 2026). 5sim numbers keep manual cancel.
export function customerCanCancel(provider: string | null | undefined): boolean {
  return asProviderName(provider) !== "grizzly";
}
