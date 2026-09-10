import { createHmac, timingSafeEqual } from "node:crypto";

// Paystack signs the raw webhook body with HMAC SHA512 using the secret
// key; see SECURITY.md "Payments (Paystack)". Verify against the raw
// request body text, never a re-serialized/re-parsed version of it.
export function verifyPaystackSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader) return false;

  const expectedHex = createHmac("sha512", secret).update(rawBody).digest("hex");

  const expected = Buffer.from(expectedHex, "hex");
  let actual: Buffer;
  try {
    actual = Buffer.from(signatureHeader, "hex");
  } catch {
    return false;
  }

  if (expected.length !== actual.length) return false;

  return timingSafeEqual(expected, actual);
}
