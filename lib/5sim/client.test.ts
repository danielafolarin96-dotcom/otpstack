import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buyActivation,
  clearGuestPricesCache,
  customerFacingPurchaseErrorMessage,
  FiveSimError,
  getOperatorPrices,
  getProductPrices,
  GUEST_PRICES_CACHE_TTL_MS,
  judgedRate,
  rankOperators,
} from "./client";

beforeEach(() => {
  clearGuestPricesCache();
});

function mockPricesResponse(body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response);
}

describe("rankOperators", () => {
  it("excludes an operator right below the 20 floor, includes one right at it", () => {
    const result = rankOperators({
      justBelowFloor: { cost: 0.1, count: 50, rate: 19 },
      atFloor: { cost: 0.2, count: 50, rate: 20 },
    });

    expect(result.options.map((o) => o.operator)).toEqual(["atFloor"]);
    expect(result.recommended?.operator).toBe("atFloor");
  });

  it("excludes out-of-stock operators even when they're cheapest and highest-rated", () => {
    const result = rankOperators({
      outOfStock: { cost: 0.1, count: 0, rate: 95 },
      inStock: { cost: 0.25, count: 10, rate: 70 },
    });

    expect(result.options.map((o) => o.operator)).toEqual(["inStock"]);
  });

  it("recommends the highest-rate operator, not the cheapest", () => {
    const result = rankOperators({
      cheapButLowerRate: { cost: 0.18, count: 100, rate: 45 },
      pricierHigherRate: { cost: 0.2, count: 100, rate: 80 },
    });

    expect(result.recommended?.operator).toBe("pricierHigherRate");
    expect(result.options.map((o) => o.operator)).toEqual(["pricierHigherRate", "cheapButLowerRate"]);
  });

  it("breaks a rate tie by cost — cheaper wins", () => {
    const result = rankOperators({
      pricier: { cost: 0.3, count: 50, rate: 90 },
      cheaper: { cost: 0.2, count: 50, rate: 90 },
    });

    expect(result.recommended?.operator).toBe("cheaper");
  });

  it("treats a missing rate as unrated, not disqualifying — but ranked after every rated operator that clears the floor", () => {
    const result = rankOperators({
      unrated: { cost: 0.05, count: 100 },
      rated: { cost: 10, count: 100, rate: 21 },
    });

    // The unrated operator is far cheaper, but a confirmed rate above the
    // floor — however close to it — outranks no data at all.
    expect(result.options.map((o) => o.operator)).toEqual(["rated", "unrated"]);
    expect(result.recommended?.operator).toBe("rated");
  });

  it("recommends the cheapest unrated operator when nothing rated clears the floor", () => {
    const result = rankOperators({
      unratedPricier: { cost: 0.3, count: 10 },
      unratedCheaper: { cost: 0.1, count: 10 },
      belowFloor: { cost: 0.05, count: 10, rate: 10 },
    });

    expect(result.options.map((o) => o.operator)).toEqual(["unratedCheaper", "unratedPricier"]);
    expect(result.recommended?.operator).toBe("unratedCheaper");
  });

  it("sorts multiple rated operators by rate descending, unrated operators after by cost ascending", () => {
    const result = rankOperators({
      rate30: { cost: 0.1, count: 10, rate: 30 },
      rate80: { cost: 0.5, count: 10, rate: 80 },
      rate50: { cost: 0.2, count: 10, rate: 50 },
      unratedCheap: { cost: 0.01, count: 10 },
      unratedPricier: { cost: 0.2, count: 10 },
    });

    expect(result.options.map((o) => o.operator)).toEqual([
      "rate80",
      "rate50",
      "rate30",
      "unratedCheap",
      "unratedPricier",
    ]);
  });

  it("returns an empty options list and null recommended when nothing is in stock", () => {
    const result = rankOperators({
      onlyOperator: { cost: 0.1, count: 0, rate: 90 },
    });

    expect(result.options).toEqual([]);
    expect(result.recommended).toBeNull();
  });

  it("returns an empty options list when everything in stock is below the floor and nothing is unrated", () => {
    const result = rankOperators({
      worse: { cost: 0.3, count: 10, rate: 10 },
      leastBad: { cost: 0.2, count: 10, rate: 19 },
    });

    expect(result.options).toEqual([]);
    expect(result.recommended).toBeNull();
  });

  describe("7-day rate168", () => {
    it("is eligible on rate 11 when rate168 is 30 — the floor is judged on rate168", () => {
      const result = rankOperators({ op: { cost: 0.1, count: 10, rate: 11, rate168: 30 } });
      expect(result.options.map((o) => o.operator)).toEqual(["op"]);
    });

    it("is not eligible on rate 30 when rate168 is 5", () => {
      const result = rankOperators({ op: { cost: 0.1, count: 10, rate: 30, rate168: 5 } });
      expect(result.options).toEqual([]);
      expect(result.recommended).toBeNull();
    });

    it("falls back to rate when rate168 is missing", () => {
      const result = rankOperators({
        noRate168Good: { cost: 0.1, count: 10, rate: 25 },
        noRate168Bad: { cost: 0.1, count: 10, rate: 15 },
      });
      expect(result.options.map((o) => o.operator)).toEqual(["noRate168Good"]);
    });

    it("treats rate168 0 as a real (failing) value, not as missing", () => {
      const result = rankOperators({ op: { cost: 0.1, count: 10, rate: 90, rate168: 0 } });
      expect(result.options).toEqual([]);
    });

    it("still treats an operator with neither rate nor rate168 as unrated", () => {
      const result = rankOperators({
        unrated: { cost: 0.05, count: 10 },
        rated: { cost: 1, count: 10, rate168: 21 },
      });
      expect(result.options.map((o) => o.operator)).toEqual(["rated", "unrated"]);
    });

    it("ranks by rate168 when present, not by the overall rate", () => {
      const result = rankOperators({
        highOverallLowRecent: { cost: 0.1, count: 10, rate: 95, rate168: 40 },
        lowOverallHighRecent: { cost: 0.1, count: 10, rate: 25, rate168: 80 },
        overallOnly: { cost: 0.1, count: 10, rate: 60 },
      });
      expect(result.options.map((o) => o.operator)).toEqual([
        "lowOverallHighRecent",
        "overallOnly",
        "highOverallLowRecent",
      ]);
    });

    it("keeps both raw rate fields on the returned options", () => {
      const result = rankOperators({ op: { cost: 0.1, count: 10, rate: 11, rate168: 30 } });
      expect(result.recommended).toEqual({ operator: "op", cost: 0.1, count: 10, rate: 11, rate168: 30 });
    });
  });
});

describe("judgedRate", () => {
  it("prefers rate168, falls back to rate, undefined when neither", () => {
    expect(judgedRate({ rate: 11, rate168: 30 })).toBe(30);
    expect(judgedRate({ rate: 11 })).toBe(11);
    expect(judgedRate({})).toBeUndefined();
  });
});

describe("getProductPrices — now sellable on usa/whatsapp, usa/telegram, and malaysia/whatsapp once something clears 20", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("sells usa/whatsapp using the recommended (highest-rate) operator — the route that used to be hard-blocked", () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            usa: {
              whatsapp: {
                virtual8: { cost: 0.85, count: 165, rate: 3.23 },
                virtual28: { cost: 1.9231, count: 25925, rate: 42.86 },
              },
            },
          }),
        ),
    } as Response);

    return getProductPrices("usa").then((prices) => {
      expect(prices.whatsapp?.operator).toBe("virtual28");
    });
  });

  it("keeps a listed product as null (not omitted) when nothing clears 20 and nothing is unrated", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            usa: {
              whatsapp: {
                virtual8: { cost: 0.85, count: 165, rate: 0 },
                virtual63: { cost: 1.92, count: 4, rate: 14 },
              },
            },
          }),
        ),
    } as Response);

    const prices = await getProductPrices("usa");
    expect(prices).toHaveProperty("whatsapp", null);
  });

  it("keeps a listed but fully out-of-stock product as null, and leaves products 5sim doesn't list absent", async () => {
    global.fetch = mockPricesResponse({
      usa: { telegram: { virtual51: { cost: 0.9, count: 0, rate: 90 } } },
    });

    const prices = await getProductPrices("usa");
    expect(prices).toHaveProperty("telegram", null);
    expect(prices).not.toHaveProperty("whatsapp");
  });
});

describe("getProductPrices — 60s cache", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
  });

  const BODY = { usa: { whatsapp: { virtual28: { cost: 1, count: 10, rate: 50 } } } };

  it("serves repeat calls for the same country from cache within 60s, and refetches after", async () => {
    vi.useFakeTimers();
    global.fetch = mockPricesResponse(BODY);

    await getProductPrices("usa");
    await getProductPrices("usa");
    expect(global.fetch).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(GUEST_PRICES_CACHE_TTL_MS + 1);
    await getProductPrices("usa");
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("caches per country", async () => {
    global.fetch = mockPricesResponse(BODY);

    await getProductPrices("usa");
    await getProductPrices("england");
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("does not cache a failed fetch", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, text: () => Promise.resolve("server offline") } as Response)
      .mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(BODY)) } as Response);

    await expect(getProductPrices("usa")).rejects.toBeInstanceOf(FiveSimError);
    const prices = await getProductPrices("usa");
    expect(prices.whatsapp?.operator).toBe("virtual28");
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("never serves getOperatorPrices (picker / purchase re-validation) from the cache", async () => {
    global.fetch = mockPricesResponse(BODY);

    await getProductPrices("usa");
    await getOperatorPrices("usa", "whatsapp");
    await getOperatorPrices("usa", "whatsapp");
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });
});

describe("getOperatorPrices", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns every eligible operator for one product, not just the recommended one", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            usa: {
              telegram: {
                virtual51: { cost: 0.9, count: 18040, rate: 24.64 },
                virtual8: { cost: 0.7692, count: 3215, rate: 0 },
                belowFloor: { cost: 0.5, count: 527, rate: 3.03 },
              },
            },
          }),
        ),
    } as Response);

    const result = await getOperatorPrices("usa", "telegram");

    expect(result.options.map((o) => o.operator)).toEqual(["virtual51"]);
    expect(result.recommended?.operator).toBe("virtual51");
  });

  it("returns an empty result for a product the country doesn't carry at all", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ usa: {} })),
    } as Response);

    const result = await getOperatorPrices("usa", "nonexistent");
    expect(result.options).toEqual([]);
    expect(result.recommended).toBeNull();
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
