import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buyActivation,
  customerFacingPurchaseErrorMessage,
  FiveSimError,
  getProductPrices,
  selectBestOperator,
} from "./client";

describe("selectBestOperator", () => {
  it("picks the reliable operator over a cheaper one below the delivery-rate floor", () => {
    // Real diagnostic scenario (Sept 2026): a TikTok/USA cheapest-cost pick
    // landed on a 45%-rate operator and never delivered a code, while an
    // 80%-rate operator that cost slightly more worked cleanly.
    const result = selectBestOperator({
      cheapButUnreliable: { cost: 0.18, count: 100, rate: 45 },
      pricierButReliable: { cost: 0.2, count: 100, rate: 80 },
    });

    expect(result?.operator).toBe("pricierButReliable");
  });

  it("picks the cheapest among operators that all clear the reliability floor", () => {
    const result = selectBestOperator({
      reliableExpensive: { cost: 0.3, count: 50, rate: 90 },
      reliableCheaper: { cost: 0.2, count: 50, rate: 75 },
    });

    expect(result?.operator).toBe("reliableCheaper");
  });

  it("excludes an operator right below the 70 floor, includes one right at it", () => {
    const result = selectBestOperator({
      justBelowFloor: { cost: 0.1, count: 50, rate: 69 },
      atFloor: { cost: 0.2, count: 50, rate: 70 },
    });

    expect(result?.operator).toBe("atFloor");
  });

  it("excludes out-of-stock operators even when they're cheapest and reliable", () => {
    const result = selectBestOperator({
      outOfStock: { cost: 0.1, count: 0, rate: 95 },
      inStock: { cost: 0.25, count: 10, rate: 70 },
    });

    expect(result?.operator).toBe("inStock");
  });

  it("treats a missing rate as neutral, not disqualifying", () => {
    // Observed live: 5sim omits `rate` entirely for some operators
    // regardless of stock level — that's "no data," not "unreliable."
    const result = selectBestOperator({
      noRateData: { cost: 0.15, count: 100 },
      confirmedUnreliable: { cost: 0.1, count: 100, rate: 20 },
    });

    expect(result?.operator).toBe("noRateData");
  });

  it("falls back to the cheapest in-stock operator when none clear the floor", () => {
    const result = selectBestOperator({
      worse: { cost: 0.3, count: 10, rate: 10 },
      leastBad: { cost: 0.2, count: 10, rate: 30 },
    });

    expect(result?.operator).toBe("leastBad");
  });

  it("returns null when nothing is in stock", () => {
    const result = selectBestOperator({
      onlyOperator: { cost: 0.1, count: 0, rate: 90 },
    });

    expect(result).toBeNull();
  });
});

describe("getProductPrices — usa/whatsapp scoped rate floor", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("excludes virtual8 when its live rate is below the 30 floor, even though it's cheapest and in stock", async () => {
    // Real scenario (Sept 2026): virtual8 was cheapest ($0.85) and had
    // thousands in stock, but its live 5sim rate sat at ~0-1% and 3
    // consecutive orders on it all failed to deliver an SMS — see
    // ROUTE_RATE_FLOORS' comment in client.ts. This is the rate-based
    // successor to a name-based denylist: it re-checks the live rate on
    // every call rather than banning "virtual8" by name.
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            usa: {
              whatsapp: {
                virtual8: { cost: 0.85, count: 7136, rate: 0.28 },
                virtual28: { cost: 1.9231, count: 28871, rate: 49.52 },
              },
            },
          }),
        ),
    } as Response);

    const prices = await getProductPrices("usa");

    expect(prices.whatsapp?.operator).toBe("virtual28");
  });

  it("makes virtual8 eligible again — and picks it as cheapest — once its live rate recovers above the floor", async () => {
    // The whole point of a live floor over a name ban: no code change
    // needed if the underlying operator's real rate improves.
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            usa: {
              whatsapp: {
                virtual8: { cost: 0.85, count: 7136, rate: 35 },
                virtual28: { cost: 1.9231, count: 28871, rate: 49.52 },
              },
            },
          }),
        ),
    } as Response);

    const prices = await getProductPrices("usa");

    expect(prices.whatsapp?.operator).toBe("virtual8");
  });

  it("excludes whichever operator drops below the floor, symmetrically — not just virtual8 by name", async () => {
    // If virtual28 were the one to go bad instead, the same floor catches
    // it without anyone having to notice and hand-edit a list.
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            usa: {
              whatsapp: {
                virtual8: { cost: 0.85, count: 7136, rate: 35 },
                virtual28: { cost: 0.5, count: 28871, rate: 5 },
              },
            },
          }),
        ),
    } as Response);

    const prices = await getProductPrices("usa");

    expect(prices.whatsapp?.operator).toBe("virtual8");
  });

  it("still returns a product when every in-stock operator falls below the route floor, instead of dropping it from the catalog", async () => {
    // Real regression (found live, Sept 2026): virtual28's rate on this
    // route drifted down to 9.47% and virtual8 stayed near-zero at 2.76%,
    // so *both* in-stock operators fell below the 30 floor at once. The
    // route floor is a preference, not a "don't sell this" rule — with no
    // fallback, getProductPrices returned no `whatsapp` key at all, which
    // made WhatsApp silently vanish from the USA "Get a number" page even
    // though it was genuinely in stock and purchasable. Falling back to
    // the full unfiltered operator list (same fallback philosophy as
    // MIN_ACCEPTABLE_DELIVERY_RATE's own in selectBestOperator) picks the
    // cheapest in-stock operator overall instead of nothing.
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            usa: {
              whatsapp: {
                virtual28: { cost: 1.9231, count: 24801, rate: 9.47 },
                virtual51: { cost: 0.8974, count: 0 },
                virtual63: { cost: 1.92, count: 0, rate: 7.41 },
                virtual8: { cost: 0.85, count: 1254, rate: 2.76 },
              },
            },
          }),
        ),
    } as Response);

    const prices = await getProductPrices("usa");

    expect(prices.whatsapp).toBeDefined();
    expect(prices.whatsapp?.operator).toBe("virtual8");
  });

  it("still reports no price when a route-floored product has no stock at all, even after the fallback", async () => {
    // The fallback must not fabricate availability that doesn't exist —
    // it only widens the pool selectBestOperator chooses from, and
    // selectBestOperator still returns null when nothing is in stock.
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            usa: {
              whatsapp: {
                virtual28: { cost: 1.9231, count: 0, rate: 9.47 },
                virtual8: { cost: 0.85, count: 0, rate: 2.76 },
              },
            },
          }),
        ),
    } as Response);

    const prices = await getProductPrices("usa");

    expect(prices.whatsapp).toBeUndefined();
  });

  it("leaves virtual8 selectable for a country/product with no configured route floor", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            england: {
              whatsapp: {
                virtual8: { cost: 0.5, count: 100, rate: 0 },
              },
            },
          }),
        ),
    } as Response);

    const prices = await getProductPrices("england");

    expect(prices.whatsapp?.operator).toBe("virtual8");
  });
});

describe("fiveSimFetch (via buyActivation) — non-JSON response handling", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("throws a FiveSimError instead of an uncaught parser exception when 5sim returns 200 with a plain-text body", async () => {
    // Real bug (Sept 2026): confirmed live against 5sim's actual buy
    // endpoint for a known-zero-stock operator — HTTP 200,
    // Content-Type: text/plain, body "no free phones". response.json()
    // on that throws "Unexpected token 'o', "no free phones" is not
    // valid JSON", which used to escape uncaught all the way to the
    // customer.
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve("no free phones"),
    } as Response);

    await expect(buyActivation("england", "ee", "tiktok")).rejects.toBeInstanceOf(FiveSimError);
    await expect(buyActivation("england", "ee", "tiktok")).rejects.toMatchObject({
      status: 200,
      body: "no free phones",
    });
  });

  it("still returns the parsed order on a normal JSON response", async () => {
    const order = {
      id: 1,
      phone: "+10000000000",
      operator: "ee",
      product: "tiktok",
      price: 0.1,
      status: "PENDING",
      expires: "2026-01-01T00:20:00Z",
      sms: [],
      created_at: "2026-01-01T00:00:00Z",
      country: "england",
    };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(order)),
    } as Response);

    await expect(buyActivation("england", "ee", "tiktok")).resolves.toEqual(order);
  });

  it("throws a FiveSimError for a documented non-2xx error too (e.g. a bad operator)", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve("bad operator"),
    } as Response);

    await expect(buyActivation("england", "nonexistent", "tiktok")).rejects.toMatchObject({
      status: 400,
      body: "bad operator",
    });
  });
});

describe("customerFacingPurchaseErrorMessage", () => {
  it("maps 5sim's 'no free phones' response to an actionable, customer-facing message", () => {
    const message = customerFacingPurchaseErrorMessage(
      "5sim /user/buy/activation/england/ee/tiktok failed: 200 no free phones",
    );

    expect(message).toBe(
      "No numbers currently available for this service/country — try again shortly or pick a different country.",
    );
  });

  // Every other response the buy endpoint documents (5sim.net/docs,
  // confirmed Sept 2026) — none of these are things a customer can act
  // on (they're either our 5sim account/integration issues or transient
  // upstream problems), so none should be shown verbatim. In particular
  // "not enough user balance" is about *our* 5sim account, not the
  // customer's wallet.
  it.each([
    "not enough user balance",
    "not enough rating",
    "select country",
    "select operator",
    "bad country",
    "bad operator",
    "no product",
    "server offline",
    "internal error",
  ])("maps '%s' to the generic message, never the raw 5sim text", (raw) => {
    const message = customerFacingPurchaseErrorMessage(raw);
    expect(message).toBe("Something went wrong purchasing this number — please try again.");
  });

  it("falls back to the generic message for a totally unrecognized error string", () => {
    const message = customerFacingPurchaseErrorMessage("some future 5sim error we've never seen");
    expect(message).toBe("Something went wrong purchasing this number — please try again.");
  });
});
