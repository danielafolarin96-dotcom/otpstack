// ₦500 minimum, per ARCHITECTURE.md's Paystack funding flow / SECURITY.md.
export const MIN_TOPUP_KOBO = 50_000;

const SHORTFALL_TOPUP_STEP_KOBO = 5_000; // ₦50

// Top-up amount suggested after a purchase fails for insufficient balance:
// the shortfall rounded up to the next ₦50, but never below the minimum
// top-up Paystack funding accepts.
export function topupAmountForShortfall(shortfallKobo: number): number {
  const rounded = Math.ceil(shortfallKobo / SHORTFALL_TOPUP_STEP_KOBO) * SHORTFALL_TOPUP_STEP_KOBO;
  return Math.max(rounded, MIN_TOPUP_KOBO);
}

export function isValidTopupAmount(amountKobo: unknown): amountKobo is number {
  return (
    typeof amountKobo === "number" &&
    Number.isInteger(amountKobo) &&
    amountKobo >= MIN_TOPUP_KOBO
  );
}
