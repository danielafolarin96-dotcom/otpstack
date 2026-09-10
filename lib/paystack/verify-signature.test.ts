import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { verifyPaystackSignature } from "./verify-signature";

const SECRET = "test-secret";
const BODY = JSON.stringify({ event: "charge.success", data: { reference: "ref_1" } });

function sign(body: string, secret: string) {
  return createHmac("sha512", secret).update(body).digest("hex");
}

describe("verifyPaystackSignature", () => {
  it("accepts a signature computed with the correct secret over the raw body", () => {
    const signature = sign(BODY, SECRET);
    expect(verifyPaystackSignature(BODY, signature, SECRET)).toBe(true);
  });

  it("rejects a signature computed with the wrong secret", () => {
    const signature = sign(BODY, "wrong-secret");
    expect(verifyPaystackSignature(BODY, signature, SECRET)).toBe(false);
  });

  it("rejects a signature that doesn't match a tampered body", () => {
    const signature = sign(BODY, SECRET);
    const tamperedBody = JSON.stringify({ event: "charge.success", data: { reference: "ref_2" } });
    expect(verifyPaystackSignature(tamperedBody, signature, SECRET)).toBe(false);
  });

  it("rejects a missing signature header", () => {
    expect(verifyPaystackSignature(BODY, null, SECRET)).toBe(false);
  });

  it("rejects a non-hex signature header without throwing", () => {
    expect(verifyPaystackSignature(BODY, "not-hex-!!", SECRET)).toBe(false);
  });
});
