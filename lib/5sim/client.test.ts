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
});

describe("selectOperatorForRoute — usa/whatsapp operator pin", () => {
  it("pins usa/whatsapp to virtual28 even though virtual8 is cheaper, in stock, and has a better live rate", () => {
    // The pin (see ROUTE_OPERATOR_PINS in client.ts) is a deliberate
    // reliability choice for this exact route, not a rate/cost comparison
    // — it wins even in the scenario that would otherwise favor virtual8
    // on every axis selectBestOperator considers.
    const result = selectOperatorForRoute("usa", "whatsapp", {
      virtual28: { cost: 1.9231, count: 100, rate: 20 },
      virtual8: { cost: 0.85, count: 100, rate: 90 },
    });

    expect(result?.operator).toBe("virtual28");
  });

  it("keeps virtual28 pinned even when its own live rate craters — unlike the old floor-based exclusion", () => {
    // This is the behavior change from the previous rate-floor-only
    // design: a live rate dip used to be able to exclude virtual28 (see
    // ROUTE_RATE_FLOORS). The pin intentionally ignores rate entirely so
    // the customer-facing operator (and price) stays stable rather than
    // flipping between requests as 5sim's live rate figure moves.
    const result = selectOperatorForRoute("usa", "whatsapp", {
      virtual28: { cost: 1.9231, count: 50, rate: 2 },
      virtual8: { cost: 0.85, count: 50, rate: 90 },
    });

    expect(result?.operator).toBe("virtual28");
  });

  it("falls through to the route floor + fallback selection when the pinned operator is out of stock", () => {
    // A pin only applies when the pinned operator is actually sellable.
    // With virtual28 out of stock, selection proceeds exactly as it did
    // before the pin existed: apply ROUTE_RATE_FLOORS (30 for this
    // route), then selectBestOperator over whatever survives.
    const result = selectOperatorForRoute("usa", "whatsapp", {
      virtual28: { cost: 1.9231, count: 0, rate: 50 },
      virtual8: { cost: 0.85, count: 100, rate: 10 },
      virtual99: { cost: 1, count: 50, rate: 40 },
    });

    expect(result?.operator).toBe("virtual99");
  });

  it("does not apply the pin to a different product in the same country", () => {
    // ROUTE_OPERATOR_PINS is keyed by (country, product) — usa/signal
    // isn't pinned, so an in-stock virtual28 here must not win just
    // because it happens to share a name with the pinned usa/whatsapp
    // operator.
    const result = selectOperatorForRoute("usa", "signal", {
      virtual28: { cost: 0.1, count: 10, rate: 5 },
      virtual51: { cost: 0.05, count: 10, rate: 90 },
    });

    expect(result?.operator).toBe("virtual51");
  });

  it("does not apply the pin to the same operator name in a different country", () => {
    const result = selectOperatorForRoute("canada", "whatsapp", {
      virtual28: { cost: 0.1, count: 10, rate: 5 },
      virtual8: { cost: 0.05, count: 10, rate: 90 },
    });

    expect(result?.operator).toBe("virtual8");
  });
});

describe("getProductPrices — usa/whatsapp route floor + operator pin", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("pins usa/whatsapp to virtual28 through the full getProductPrices call, even though virtual8 is cheaper and in stock", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            usa: {
              whatsapp: {
                virtual8: { cost: 0.85, count: 7136, rate: 90 },
                virtual28: { cost: 1.9231, count: 28871, rate: 49.52 },
              },
            },
          }),
        ),
    } as Response);

    const prices = await getProductPrices("usa");

    expect(prices.whatsapp?.operator).toBe("virtual28");
  });

  it("still returns a product via the floor + fallback path when the pinned operator is out of stock and every remaining in-stock operator falls below the route floor", async () => {
    // Real regression this route hit twice (Sept 2026): first with no pin
    // at all, both in-stock operators (virtual28, virtual8) fell below the
    // 30 floor at once and the product vanished from the catalog with no
    // fallback. Now that virtual28 is pinned, the same fallback path still
    // needs to work for the case where virtual28 itself is the one that's
    // out of stock — the pin isn't a replacement for the floor/fallback
    // mechanism, only a higher-precedence override of it.
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            usa: {
              whatsapp: {
                virtual28: { cost: 1.9231, count: 0, rate: 9.47 },
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
