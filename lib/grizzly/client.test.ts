import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buyActivation,
  cancelActivation,
  clearGrizzlyPricesCache,
  customerFacingGrizzlyPurchaseMessage,
  extractActivationId,
  finishActivation,
  getActivationState,
  getBalance,
  getCachedServicePrices,
  getSupplierPrices,
  GrizzlyError,
  parsePricesV3,
  rankSuppliers,
  type GrizzlySupplier,
} from "./client";

const KEY = "test-grizzly-key-123";

function textResponse(body: string, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: () => Promise.resolve(body) } as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  clearGrizzlyPricesCache();
  vi.stubEnv("GRIZZLY_API_KEY", KEY);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function calledParams(call = 0): URLSearchParams {
  return new URL(String(fetchMock.mock.calls[call][0])).searchParams;
}

// Real response captured 29 Oct 2026 (wa / 187, trimmed to three suppliers).
const WA_USA = {
  "187": {
    wa: {
      price: 1,
      count: 107396,
      providers: {
        "11": { count: 1048, price: [1.35], provider_id: 11 },
        "62": { count: 20, price: [1], provider_id: 62 },
        "4": { count: 69, price: [1.2], provider_id: 4 },
      },
    },
  },
};

const supplier = (supplierId: string, cost: number, count: number): GrizzlySupplier => ({
  supplierId,
  cost,
  count,
  prices: [cost],
});

describe("parsePricesV3", () => {
  it("turns each supplier into an option priced at its highest step, ignoring the headline price", () => {
    const parsed = parsePricesV3(
      { "16": { wa: { price: 0.05, count: 9, providers: { "438": { count: 30, price: [0.3, 0.52, 0.4], provider_id: 438 } } } } },
      "wa",
    );
    expect(parsed["16"]).toEqual([{ supplierId: "438", count: 30, prices: [0.3, 0.52, 0.4], cost: 0.52 }]);
  });

  it("accepts a bare-number price and an empty providers array", () => {
    const parsed = parsePricesV3(
      {
        "1": { wa: { providers: { "9": { count: 5, price: 0.7, provider_id: 9 } } } },
        "2": { wa: { providers: [] } },
      },
      "wa",
    );
    expect(parsed["1"]).toEqual([{ supplierId: "9", count: 5, prices: [0.7], cost: 0.7 }]);
    expect(parsed["2"]).toEqual([]);
  });

  it("drops suppliers without a usable price and countries without the service", () => {
    const parsed = parsePricesV3(
      { "1": { wa: { providers: { "9": { count: 5, price: [], provider_id: 9 } } } }, "2": { tg: { providers: {} } } },
      "wa",
    );
    expect(parsed).toEqual({ "1": [] });
  });
});

describe("rankSuppliers", () => {
  it("sorts by price and recommends the cheapest supplier with stock >= 20", () => {
    const ranked = rankSuppliers([supplier("a", 1.0, 5), supplier("b", 0.9, 3), supplier("c", 1.2, 20), supplier("d", 1.1, 19)]);
    expect(ranked.options.map((s) => s.supplierId)).toEqual(["b", "a", "d", "c"]);
    expect(ranked.recommended?.supplierId).toBe("c");
  });

  it("falls back to the cheapest in-stock supplier when none has 20", () => {
    const ranked = rankSuppliers([supplier("a", 1.0, 5), supplier("b", 0.9, 3)]);
    expect(ranked.recommended?.supplierId).toBe("b");
  });

  it("excludes suppliers with no stock", () => {
    const ranked = rankSuppliers([supplier("a", 0.1, 0), supplier("b", 0.9, 25)]);
    expect(ranked.options.map((s) => s.supplierId)).toEqual(["b"]);
  });

  it("returns no recommendation when nothing is in stock", () => {
    expect(rankSuppliers([supplier("a", 0.1, 0)])).toEqual({ recommended: null, options: [] });
  });
});

describe("prices fetching", () => {
  it("getSupplierPrices asks for one service+country, fresh every time", async () => {
    fetchMock.mockResolvedValue(textResponse(JSON.stringify(WA_USA)));
    const first = await getSupplierPrices("wa", 187);
    await getSupplierPrices("wa", 187);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(calledParams().get("action")).toBe("getPricesV3");
    expect(calledParams().get("service")).toBe("wa");
    expect(calledParams().get("country")).toBe("187");
    expect(first?.map((s) => s.supplierId).sort()).toEqual(["11", "4", "62"]);
  });

  it("getSupplierPrices returns null when Grizzly doesn't list the country", async () => {
    fetchMock.mockResolvedValue(textResponse("{}"));
    expect(await getSupplierPrices("wa", 999)).toBeNull();
  });

  it("getCachedServicePrices fetches all countries once per 60s per service", async () => {
    fetchMock.mockResolvedValue(textResponse(JSON.stringify(WA_USA)));
    await getCachedServicePrices("wa");
    await getCachedServicePrices("wa");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(calledParams().has("country")).toBe(false);
  });

  it("does not cache a failed fetch", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("BAD_KEY")).mockResolvedValueOnce(textResponse(JSON.stringify(WA_USA)));
    await expect(getCachedServicePrices("wa")).rejects.toBeInstanceOf(GrizzlyError);
    await expect(getCachedServicePrices("wa")).resolves.toHaveProperty("187");
  });
});

describe("buyActivation", () => {
  const SUCCESS = {
    activationId: 38496653,
    phoneNumber: "66846426435",
    activationCost: 0.52,
    currency: 840,
    countryCode: "2",
    canGetAnotherSms: "1",
    activationTime: "2026-10-29 12:00:00",
  };

  it("sends the chosen supplier as providerIds and our quote as maxPrice", async () => {
    fetchMock.mockResolvedValue(textResponse(JSON.stringify(SUCCESS)));
    const result = await buyActivation({ service: "wa", countryId: 187, supplierId: "438", maxPrice: 0.52 });
    const params = calledParams();
    expect(params.get("action")).toBe("getNumberV2");
    expect(params.get("providerIds")).toBe("438");
    expect(params.get("maxPrice")).toBe("0.52");
    expect(params.get("country")).toBe("187");
    expect(result).toEqual({
      activationId: "38496653",
      phoneNumber: "+66846426435",
      activationCost: 0.52,
      currency: 840,
      activationTime: "2026-10-29 12:00:00",
    });
  });

  it.each(["NO_NUMBERS", "NO_BALANCE", "BAD_KEY"])("throws a GrizzlyError carrying %s", async (body) => {
    fetchMock.mockResolvedValue(textResponse(body));
    await expect(buyActivation({ service: "wa", countryId: 187, supplierId: "438", maxPrice: 1 })).rejects.toMatchObject({
      action: "getNumberV2",
      body,
    });
  });

  it("rejects a JSON body missing the activation fields", async () => {
    fetchMock.mockResolvedValue(textResponse(JSON.stringify({ hello: 1 })));
    await expect(buyActivation({ service: "wa", countryId: 187, supplierId: "438", maxPrice: 1 })).rejects.toBeInstanceOf(GrizzlyError);
  });
});

describe("unusable getNumberV2 responses that still carry an activation id", () => {
  it("exposes the id when the JSON is missing the other fields", async () => {
    fetchMock.mockResolvedValue(textResponse(JSON.stringify({ activationId: 555, activationCost: "n/a" })));
    await expect(buyActivation({ service: "wa", countryId: 187, supplierId: "438", maxPrice: 1 })).rejects.toMatchObject({
      action: "getNumberV2",
      activationId: "555",
    });
  });

  it("exposes the id from a v1-style ACCESS_NUMBER text body", async () => {
    fetchMock.mockResolvedValue(textResponse("ACCESS_NUMBER:38496653:66846426435"));
    await expect(buyActivation({ service: "wa", countryId: 187, supplierId: "438", maxPrice: 1 })).rejects.toMatchObject({
      activationId: "38496653",
    });
  });

  it("exposes the id from a non-2xx body, read before the body is truncated", async () => {
    fetchMock.mockResolvedValue(textResponse("x".repeat(400) + '{"activationId": 777}', 500));
    const err = (await buyActivation({ service: "wa", countryId: 187, supplierId: "438", maxPrice: 1 }).catch(
      (e: unknown) => e,
    )) as GrizzlyError;
    expect(err.activationId).toBe("777");
    expect(err.body).toHaveLength(300);
  });

  it("has no id for plain error tokens, or for other actions", async () => {
    fetchMock.mockResolvedValue(textResponse("NO_NUMBERS"));
    await expect(buyActivation({ service: "wa", countryId: 187, supplierId: "438", maxPrice: 1 })).rejects.toMatchObject({
      activationId: undefined,
    });
    expect(new GrizzlyError("getStatus", 200, '{"activationId": 1}').activationId).toBeUndefined();
  });

  it("extractActivationId accepts only digit ids", () => {
    expect(extractActivationId('{"activationId":"123"}')).toBe("123");
    expect(extractActivationId('{"activationId":"abc"}')).toBeUndefined();
    expect(extractActivationId("garbage")).toBeUndefined();
  });
});

describe("customerFacingGrizzlyPurchaseMessage", () => {
  it("only NO_NUMBERS gets a specific message; NO_BALANCE (our account) stays generic", () => {
    expect(customerFacingGrizzlyPurchaseMessage("NO_NUMBERS")).toMatch(/No numbers currently available/);
    expect(customerFacingGrizzlyPurchaseMessage("NO_BALANCE")).toBe("Something went wrong purchasing this number — please try again.");
  });
});

describe("getActivationState", () => {
  it("is waiting on STATUS_WAIT_CODE, with a single call", async () => {
    fetchMock.mockResolvedValue(textResponse("STATUS_WAIT_CODE"));
    expect(await getActivationState("1")).toEqual({ state: "waiting" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("is cancelled on STATUS_CANCEL", async () => {
    fetchMock.mockResolvedValue(textResponse("STATUS_CANCEL"));
    expect(await getActivationState("1")).toEqual({ state: "cancelled" });
  });

  it("on STATUS_OK fetches getStatusV2 for the full SMS and its time", async () => {
    fetchMock
      .mockResolvedValueOnce(textResponse("STATUS_OK:852508"))
      .mockResolvedValueOnce(
        textResponse(JSON.stringify({ verificationType: 2, sms: { dateTime: "2026-02-26 12:05:55", code: "852508", text: "Your code 852508" } })),
      );
    expect(await getActivationState("1")).toEqual({
      state: "received",
      code: "852508",
      text: "Your code 852508",
      smsDateTime: "2026-02-26 12:05:55",
    });
    expect(calledParams(1).get("action")).toBe("getStatusV2");
  });

  it("still returns the getStatus code when getStatusV2 fails", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("STATUS_OK:111")).mockResolvedValueOnce(textResponse("oops", 500));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await getActivationState("1")).toEqual({ state: "received", code: "111", text: null, smsDateTime: null });
  });

  it("throws on an unrecognised status", async () => {
    fetchMock.mockResolvedValue(textResponse("NO_ACTIVATION"));
    await expect(getActivationState("1")).rejects.toBeInstanceOf(GrizzlyError);
  });
});

describe("setStatus helpers", () => {
  it("cancelActivation sends status 8 and succeeds only on ACCESS_CANCEL", async () => {
    fetchMock.mockResolvedValue(textResponse("ACCESS_CANCEL"));
    await expect(cancelActivation("42")).resolves.toBeUndefined();
    expect(calledParams().get("status")).toBe("8");
    expect(calledParams().get("id")).toBe("42");
  });

  it("cancelActivation throws on the early-cancel refusal (or anything else)", async () => {
    fetchMock.mockResolvedValue(textResponse("EARLY_CANCEL_DENIED"));
    await expect(cancelActivation("42")).rejects.toMatchObject({ body: "EARLY_CANCEL_DENIED" });
  });

  it("finishActivation sends status 6", async () => {
    fetchMock.mockResolvedValue(textResponse("ACCESS_ACTIVATION"));
    await finishActivation("42");
    expect(calledParams().get("status")).toBe("6");
  });
});

describe("getBalance", () => {
  it("parses the live response shape", async () => {
    fetchMock.mockResolvedValue(textResponse("ACCESS_BALANCE:3.0000"));
    expect(await getBalance()).toBe(3);
  });

  it("throws on anything else", async () => {
    fetchMock.mockResolvedValue(textResponse("BAD_KEY"));
    await expect(getBalance()).rejects.toBeInstanceOf(GrizzlyError);
  });
});

describe("key handling", () => {
  it("sends the key as api_key but never includes it in an error", async () => {
    fetchMock.mockResolvedValue(textResponse(`BAD_KEY ${KEY}`, 401));
    const err = (await getBalance().catch((e: unknown) => e)) as GrizzlyError;
    expect(calledParams().get("api_key")).toBe(KEY);
    expect(err.message).not.toContain(KEY);
    expect(err.message).not.toContain("api_key");
    expect(err.message).toContain("[redacted]");
  });

  it("never puts the URL into a network-failure error", async () => {
    fetchMock.mockRejectedValue(new TypeError(`fetch failed for https://api.grizzlysms.com/?api_key=${KEY}`));
    const err = (await getBalance().catch((e: unknown) => e)) as GrizzlyError;
    expect(err).toBeInstanceOf(GrizzlyError);
    expect(err.message).not.toContain(KEY);
  });
});
