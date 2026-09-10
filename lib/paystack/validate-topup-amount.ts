// ₦500 minimum, per ARCHITECTURE.md's Paystack funding flow / SECURITY.md.
export const MIN_TOPUP_KOBO = 50_000;

export function isValidTopupAmount(amountKobo: unknown): amountKobo is number {
  return (
    typeof amountKobo === "number" &&
    Number.isInteger(amountKobo) &&
    amountKobo >= MIN_TOPUP_KOBO
  );
}
