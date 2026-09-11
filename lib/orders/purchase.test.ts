import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { buyActivation, cancelOrder, getProductPrices } from "@/lib/5sim/client";
import { PurchaseError, purchaseNumber } from "./purchase";

vi.mock("@/lib/5sim/client", () => ({
  buyActivation: vi.fn(),
  cancelOrder: vi.fn(),
  getProductPrices: vi.fn(),
}));

const SERVICE = {
  id: "service-1",
  name: "WhatsApp",
  fivesim_product_code: "whatsapp",
  category: "Messaging",
  icon_key: "whatsapp",
  is_active: true,
};

const COUNTRY = {
  id: "country-1",
  name: "Nigeria",
  fivesim_country_code: "nigeria",
  flag_emoji: "🇳🇬",
  is_active: true,
};

const GLOBAL_RULE = {
  id: "global-rule",
  scope: "global" as const,
  service_id: null,
  country_id: null,
  priority: 10,
  markup_type: "percent" as const,
  markup_value: 100, // 100% markup: price = 2x cost, margin 50%... use min_margin_pct 0 to keep math simple
  min_margin_pct: 0,
};

const FIVESIM_ORDER = {
  id: 999,
  phone: "+2348000000000",
  operator: "virtual2",
  product: "whatsapp",
  price: 0.28,
  status: "RECEIVED",
  expires: new Date(Date.now() + 15 * 60_000).toISOString(),
  sms: [],
  created_at: new Date().toISOString(),
  country: "nigeria",
};

function fakeAdminClient(
  configs: Record<string, { data: unknown; error: unknown }>,
  rpcResult: { data: unknown; error: unknown },
) {
  const from = vi.fn((table: string) => {
    const result = configs[table] ?? { data: null, error: null };
    const builder: {
      select: () => typeof builder;
      eq: () => typeof builder;
      order: () => typeof builder;
      limit: () => typeof builder;
      maybeSingle: () => Promise<unknown>;
      single: () => Promise<unknown>;
      then: (resolve: (v: unknown) => void) => void;
    } = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      limit: () => builder,
      maybeSingle: () => Promise.resolve(result),
      single: () => Promise.resolve(result),
      then: (resolve) => resolve(result),
    };
    return builder;
  });
  const rpc = vi.fn(() => Promise.resolve(rpcResult));
  return { from, rpc } as unknown as SupabaseClient<Database>;
}

const baseConfigs = (): Record<string, { data: unknown; error: unknown }> => ({
  services: { data: SERVICE, error: null },
  countries: { data: COUNTRY, error: null },
  pricing_rules: { data: [GLOBAL_RULE], error: null },
  fx_rates: { data: { rate: 1600 }, error: null },
  wallets: { data: { balance_kobo: 1_000_000 }, error: null },
});

const baseRpcResult = () => ({
  data: {
    id: "order-1",
    phone_number: FIVESIM_ORDER.phone,
    expires_at: new Date().toISOString(),
  },
  error: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getProductPrices).mockResolvedValue({
    whatsapp: { Category: "activation", Qty: 100, Price: 0.28 },
  });
  vi.mocked(buyActivation).mockResolvedValue(FIVESIM_ORDER);
  vi.mocked(cancelOrder).mockResolvedValue({ ...FIVESIM_ORDER, status: "CANCELED" });
});

describe("purchaseNumber", () => {
  it("buys from 5sim, then atomically creates the order and debits the wallet via RPC", async () => {
    const client = fakeAdminClient(baseConfigs(), baseRpcResult());

    const result = await purchaseNumber(client, {
      userId: "user-1",
      serviceId: SERVICE.id,
      countryId: COUNTRY.id,
    });

    expect(result.order.id).toBe("order-1");
    expect(result.order.phoneNumber).toBe(FIVESIM_ORDER.phone);
    expect(buyActivation).toHaveBeenCalledWith("nigeria", "whatsapp");
    expect(client.rpc).toHaveBeenCalledWith(
      "create_order_and_debit_wallet",
      expect.objectContaining({
        p_user_id: "user-1",
        p_service_id: SERVICE.id,
        p_country_code: "nigeria",
        p_fivesim_order_id: String(FIVESIM_ORDER.id),
        p_phone_number: FIVESIM_ORDER.phone,
      }),
    );
    expect(cancelOrder).not.toHaveBeenCalled();
  });

  it("rejects with 404 when the service doesn't exist or is inactive", async () => {
    const configs = baseConfigs();
    configs.services = { data: null, error: null };
    const client = fakeAdminClient(configs, baseRpcResult());

    await expect(
      purchaseNumber(client, { userId: "user-1", serviceId: "x", countryId: COUNTRY.id }),
    ).rejects.toMatchObject({ status: 404 });
    expect(buyActivation).not.toHaveBeenCalled();
  });

  it("rejects with 409 when 5sim doesn't offer this product in this country", async () => {
    vi.mocked(getProductPrices).mockResolvedValue({}); // whatsapp missing
    const client = fakeAdminClient(baseConfigs(), baseRpcResult());

    await expect(
      purchaseNumber(client, { userId: "user-1", serviceId: SERVICE.id, countryId: COUNTRY.id }),
    ).rejects.toMatchObject({ status: 409 });
    expect(buyActivation).not.toHaveBeenCalled();
  });

  it("rejects with 402 when the wallet balance is insufficient, before ever calling 5sim", async () => {
    const configs = baseConfigs();
    configs.wallets = { data: { balance_kobo: 0 }, error: null };
    const client = fakeAdminClient(configs, baseRpcResult());

    await expect(
      purchaseNumber(client, { userId: "user-1", serviceId: SERVICE.id, countryId: COUNTRY.id }),
    ).rejects.toMatchObject({ status: 402 });
    expect(buyActivation).not.toHaveBeenCalled();
  });

  it("rejects with 502 and touches nothing else when the 5sim buy call itself fails", async () => {
    vi.mocked(buyActivation).mockRejectedValue(new Error("5sim: out of stock"));
    const client = fakeAdminClient(baseConfigs(), baseRpcResult());

    await expect(
      purchaseNumber(client, { userId: "user-1", serviceId: SERVICE.id, countryId: COUNTRY.id }),
    ).rejects.toMatchObject({ status: 502 });
    expect(client.rpc).not.toHaveBeenCalled();
    expect(cancelOrder).not.toHaveBeenCalled();
  });

  it("cancels upstream and reports insufficient balance when the RPC's atomic debit loses a balance race", async () => {
    const client = fakeAdminClient(baseConfigs(), {
      data: null,
      error: { message: "sync_wallet_balance: balance would go negative for user_id x", code: "P0001" },
    });

    await expect(
      purchaseNumber(client, { userId: "user-1", serviceId: SERVICE.id, countryId: COUNTRY.id }),
    ).rejects.toMatchObject({ status: 402, message: "Insufficient wallet balance" });
    expect(cancelOrder).toHaveBeenCalledWith(String(FIVESIM_ORDER.id));
  });

  it("still cancels upstream on a non-balance RPC failure, with a generic reversal error — no orphaned order to compensate for since the transaction already rolled it back", async () => {
    const client = fakeAdminClient(baseConfigs(), {
      data: null,
      error: { message: "connection reset", code: "08000" },
    });

    await expect(
      purchaseNumber(client, { userId: "user-1", serviceId: SERVICE.id, countryId: COUNTRY.id }),
    ).rejects.toMatchObject({ status: 500, message: "Failed to record the purchase — it was reversed" });
    expect(cancelOrder).toHaveBeenCalledWith(String(FIVESIM_ORDER.id));
  });
});

describe("PurchaseError", () => {
  it("carries a status code alongside the message", () => {
    const err = new PurchaseError("nope", 418);
    expect(err.message).toBe("nope");
    expect(err.status).toBe(418);
  });
});
