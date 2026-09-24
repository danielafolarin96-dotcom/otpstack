import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buyActivation,
  customerFacingPurchaseErrorMessage,
  FiveSimError,
  getProductPrices,
  selectBestOperator,
  selectOperatorForRoute,
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

  it("with allowUnreliableFallback: false, returns null instead of falling back when none clear the floor", () => {
    // The hard-floor mode selectOperatorForRoute uses for
    // HARD_RELIABILITY_FLOOR_ROUTES — a below-floor operator must never be
    // sold on these routes, not just deprioritized.
    const result = selectBestOperator(
      { worse: { cost: 0.3, count: 10, rate: 10 }, leastBad: { cost: 0.2, count: 10, rate: 30 } },
      { allowUnreliableFallback: false },
    );

    expect(result).toBeNull();
  });

  it("with allowUnreliableFallback: false, still returns the cheapest operator that does clear the floor", () => {
    const result = selectBestOperator(
      { unreliable: { cost: 0.1, count: 10, rate: 10 }, reliable: { cost: 0.3, count: 10, rate: 80 } },
      { allowUnreliableFallback: false },
    );

    expect(result?.operator).toBe("reliable");
  });

  it("with allowUnreliableFallback: false, still treats a missing rate as neutral, not disqualifying", () => {
    const result = selectBestOperator(
      { noRateData: { cost: 0.15, count: 100 }, confirmedUnreliable: { cost: 0.1, count: 100, rate: 20 } },
      { allowUnreliableFallback: false },
    );

    expect(result?.operator).toBe("noRateData");
  });
});

describe("selectOperatorForRoute — hard reliability floor on usa/whatsapp and usa/telegram", () => {
  // 2026-09-24 investigation: usa/whatsapp had been hardcoded to virtual28
  // regardless of rate (the old ROUTE_OPERATOR_PINS), and usa/telegram had
  // no route-specific handling at all — both ended up selling through
  // operators well under MIN_ACCEPTABLE_DELIVERY_RATE via the general
  // fallback, at a refund rate real order data showed was ~50-86%. Both
  // routes are now in HARD_RELIABILITY_FLOOR_ROUTES: no fallback to an
  // unreliable operator, ever.
  it("does not fall back to a below-floor operator on usa/whatsapp — returns null instead", () => {
    const result = selectOperatorForRoute("usa", "whatsapp", {
      virtual28: { cost: 1.9231, count: 100, rate: 20 },
      virtual8: { cost: 0.85, count: 100, rate: 10 },
    });

    expect(result).toBeNull();
  });

  it("does not fall back to a below-floor operator on usa/telegram — returns null instead", () => {
    const result = selectOperatorForRoute("usa", "telegram", {
      virtual63: { cost: 0.55, count: 100, rate: 33.33 },
      virtual51: { cost: 0.9, count: 100, rate: 34.72 },
    });

    expect(result).toBeNull();
  });

  it("still sells usa/whatsapp when an operator actually clears the standard 70 floor", () => {
    const result = selectOperatorForRoute("usa", "whatsapp", {
      virtual28: { cost: 1.9231, count: 100, rate: 20 },
      virtualReliable: { cost: 2.5, count: 100, rate: 75 },
    });

    expect(result?.operator).toBe("virtualReliable");
  });

  it("does not apply the hard floor to a different product in the same country", () => {
    // usa/signal isn't in HARD_RELIABILITY_FLOOR_ROUTES, so it keeps the
    // normal fallback-to-cheapest-in-stock behavior.
    const result = selectOperatorForRoute("usa", "signal", {
      virtual28: { cost: 0.1, count: 10, rate: 5 },
    });

    expect(result?.operator).toBe("virtual28");
  });

  it("does not apply the hard floor to the same product in a different country", () => {
    const result = selectOperatorForRoute("canada", "whatsapp", {
      virtual28: { cost: 0.1, count: 10, rate: 5 },
    });

    expect(result?.operator).toBe("virtual28");
  });
});

describe("getProductPrices — usa/whatsapp and usa/telegram hard reliability floor", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("omits usa/whatsapp entirely through the full getProductPrices call when nothing on the route clears 70", async () => {
    // Live shape this actually hit (2026-09-24): both in-stock operators
    // well under the floor, refunding roughly half of orders sold through
    // the old pin. No product entry at all now — computeCatalogPrices
    // renders that as "price unavailable" and purchaseNumber 409s.
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            usa: {
              whatsapp: {
                virtual8: { cost: 0.85, count: 165, rate: 0 },
                virtual28: { cost: 1.9231, count: 25925, rate: 18.8 },
              },
            },
          }),
        ),
    } as Response);

    const prices = await getProductPrices("usa");

    expect(prices.whatsapp).toBeUndefined();
  });

  it("omits usa/telegram entirely when nothing on the route clears 70, instead of selling through virtual63 as before", async () => {
    // Live shape this actually hit (2026-09-24): every operator under 35%,
    // refunding 6 of 7 orders sold via the un-floored general fallback.
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            usa: {
              telegram: {
                virtual63: { cost: 0.55, count: 1160, rate: 33.33 },
                virtual51: { cost: 0.9, count: 8011, rate: 34.72 },
                virtual8: { cost: 0.7692, count: 892, rate: 13.79 },
              },
            },
          }),
        ),
    } as Response);

    const prices = await getProductPrices("usa");

    expect(prices.telegram).toBeUndefined();
  });

  it("still sells usa/whatsapp when an in-stock operator actually clears 70", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            usa: {
              whatsapp: {
                virtual28: { cost: 1.9231, count: 100, rate: 18.8 },
                virtualReliable: { cost: 2.5, count: 100, rate: 82 },
              },
            },
          }),
        ),
    } as Response);

    const prices = await getProductPrices("usa");

    expect(prices.whatsapp?.operator).toBe("virtualReliable");
  });

  it("leaves a below-floor operator selectable for a country/product with no hard reliability floor configured", async () => {
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
