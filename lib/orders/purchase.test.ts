import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { buyActivation, cancelOrder, FiveSimError, getOperatorPrices } from "@/lib/5sim/client";
import { scheduleOrderExpiry } from "@/lib/qstash/client";
import { PurchaseError, purchaseNumber } from "./purchase";

vi.mock("@/lib/5sim/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/5sim/client")>("@/lib/5sim/client");
  // FiveSimError and customerFacingPurchaseErrorMessage stay real — the
  // point of these tests is exercising that actual mapping, not mocking
  // it away.
  return { ...actual, buyActivation: vi.fn(), cancelOrder: vi.fn(), getOperatorPrices: vi.fn() };
});

// Real scheduleOrderExpiry would construct an actual QStash client and
// attempt a real network call — mocked so these tests never depend on
// network access or real credentials.
vi.mock("@/lib/qstash/client", () => ({ scheduleOrderExpiry: vi.fn() }));

const SERVICE = {
  id: "service-1",
  name: "WhatsApp",
  fivesim_product_code: "whatsapp",
  category: "Messaging",
  icon_key: "whatsapp",
  is_active: true,
  provider: "5sim",
};

const FEE_SCHEDULE = {
  id: "fee-schedule-1",
  payment_method: "default",
  percent_bps: 150,
  flat_kobo: 0,
  cap_kobo: null,
  is_default: true,
  effective_from: new Date(Date.now() - 60_000).toISOString(),
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

const CHOSEN_OPERATOR = { operator: "virtual2", cost: 0.28, count: 100, rate: 80 };

function fakeAdminClient(
  configs: Record<string, { data: unknown; error: unknown; count?: number }>,
  rpcResult: { data: unknown; error: unknown },
) {
  const from = vi.fn((table: string) => {
    const result = configs[table] ?? { data: null, error: null };
    const builder: {
      select: () => typeof builder;
      eq: () => typeof builder;
      in: () => typeof builder;
      lte: () => typeof builder;
      order: () => typeof builder;
      limit: () => typeof builder;
      maybeSingle: () => Promise<unknown>;
      single: () => Promise<unknown>;
      then: (resolve: (v: unknown) => void) => void;
    } = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      lte: () => builder,
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

const baseConfigs = (): Record<string, { data: unknown; error: unknown; count?: number }> => ({
  users: { data: { is_frozen: false }, error: null },
  orders: { data: null, error: null, count: 0 },
  services: { data: SERVICE, error: null },
  countries: { data: COUNTRY, error: null },
  pricing_rules: { data: [GLOBAL_RULE], error: null },
  fx_rates: { data: { rate: 1600 }, error: null },
  wallets: { data: { balance_kobo: 1_000_000 }, error: null },
  payment_fee_schedules: { data: FEE_SCHEDULE, error: null },
});

const baseRpcResult = () => ({
  data: {
    id: "order-1",
    phone_number: FIVESIM_ORDER.phone,
    expires_at: new Date().toISOString(),
  },
  error: null,
});

interface PurchaseParams {
  userId: string;
  serviceId: string;
  countryId: string;
  operator: string;
}

const purchaseParams = (overrides: Partial<PurchaseParams> = {}): PurchaseParams => ({
  userId: "user-1",
  serviceId: SERVICE.id,
  countryId: COUNTRY.id,
  operator: CHOSEN_OPERATOR.operator,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getOperatorPrices).mockResolvedValue({
    recommended: CHOSEN_OPERATOR,
    options: [CHOSEN_OPERATOR],
  });
  vi.mocked(buyActivation).mockResolvedValue(FIVESIM_ORDER);
  vi.mocked(cancelOrder).mockResolvedValue({ ...FIVESIM_ORDER, status: "CANCELED" });
});

describe("purchaseNumber", () => {
  it("buys from the exact operator the customer chose, then atomically creates the order and debits the wallet via RPC", async () => {
    const client = fakeAdminClient(baseConfigs(), baseRpcResult());

    const result = await purchaseNumber(client, purchaseParams());

    expect(result.order.id).toBe("order-1");
    expect(result.order.phoneNumber).toBe(FIVESIM_ORDER.phone);
    expect(buyActivation).toHaveBeenCalledWith("nigeria", "virtual2", "whatsapp");
    expect(client.rpc).toHaveBeenCalledWith(
      "create_order_and_debit_wallet",
      expect.objectContaining({
        p_user_id: "user-1",
        p_service_id: SERVICE.id,
        p_country_code: "nigeria",
        p_fivesim_order_id: String(FIVESIM_ORDER.id),
        p_phone_number: FIVESIM_ORDER.phone,
        p_fivesim_operator: "virtual2",
        p_fivesim_operator_rate: 80,
        p_provider: "5sim",
        p_fee_schedule_id: FEE_SCHEDULE.id,
      }),
    );
    expect(cancelOrder).not.toHaveBeenCalled();
  });

  it("schedules a QStash expiry callback for the TTL plus a 10s pad, after the order is created — the blocker fix's actual trigger", async () => {
    const client = fakeAdminClient(baseConfigs(), baseRpcResult());

    await purchaseNumber(client, purchaseParams());

    // 3-minute TTL (see purchase.ts's ORDER_TTL_MINUTES comment) in seconds,
    // plus the 10s QSTASH_CALLBACK_PADDING_SECONDS pad so the callback never
    // fires before expires_at and gets skipped by the cron route's query.
    expect(scheduleOrderExpiry).toHaveBeenCalledWith("order-1", 190);
  });

  it("still returns the purchase result even when scheduling the expiry callback fails — best-effort, never blocks the response", async () => {
    vi.mocked(scheduleOrderExpiry).mockRejectedValue(new Error("qstash unreachable"));
    const client = fakeAdminClient(baseConfigs(), baseRpcResult());

    const result = await purchaseNumber(client, purchaseParams());

    expect(result.order.id).toBe("order-1");
  });

  it("picks the chosen operator out of several options, not just the first one", async () => {
    const otherOperator = { operator: "virtual9", cost: 0.5, count: 10, rate: 40 };
    vi.mocked(getOperatorPrices).mockResolvedValue({
      recommended: CHOSEN_OPERATOR,
      options: [CHOSEN_OPERATOR, otherOperator],
    });
    const client = fakeAdminClient(baseConfigs(), baseRpcResult());

    await purchaseNumber(client, purchaseParams({ operator: "virtual9" }));

    expect(buyActivation).toHaveBeenCalledWith("nigeria", "virtual9", "whatsapp");
    expect(client.rpc).toHaveBeenCalledWith(
      "create_order_and_debit_wallet",
      expect.objectContaining({ p_fivesim_operator: "virtual9", p_fivesim_operator_rate: 40 }),
    );
  });

  it("rejects with 409 when the chosen operator is no longer in the ranked options — stock/rate shifted since the customer picked it", async () => {
    vi.mocked(getOperatorPrices).mockResolvedValue({ recommended: null, options: [] });
    const client = fakeAdminClient(baseConfigs(), baseRpcResult());

    await expect(
      purchaseNumber(client, purchaseParams({ operator: "virtual2" })),
    ).rejects.toMatchObject({ status: 409 });
    expect(buyActivation).not.toHaveBeenCalled();
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("rejects with 409 when the chosen operator exists in the response but under a different operator — never silently substitutes a different one", async () => {
    vi.mocked(getOperatorPrices).mockResolvedValue({
      recommended: CHOSEN_OPERATOR,
      options: [CHOSEN_OPERATOR], // doesn't include "virtual_gone"
    });
    const client = fakeAdminClient(baseConfigs(), baseRpcResult());

    await expect(
      purchaseNumber(client, purchaseParams({ operator: "virtual_gone" })),
    ).rejects.toMatchObject({ status: 409 });
    expect(buyActivation).not.toHaveBeenCalled();
  });

  it("computes the payment fee from the active fee schedule and passes it to the RPC", async () => {
    const client = fakeAdminClient(baseConfigs(), baseRpcResult());

    await purchaseNumber(client, purchaseParams());

    // resolved price = upstream cost (0.28 USD * 1600 rate = ₦448 = 44,800
    // kobo) * 2 (the 100% global markup rule) = 89,600 kobo; 1.5% of that,
    // rounded, is 1,344 kobo.
    expect(client.rpc).toHaveBeenCalledWith(
      "create_order_and_debit_wallet",
      expect.objectContaining({ p_payment_fee_kobo: 1_344 }),
    );
  });

  it("defaults the payment fee to 0 when no fee schedule is configured, without blocking the purchase", async () => {
    const configs = baseConfigs();
    configs.payment_fee_schedules = { data: null, error: null };
    const client = fakeAdminClient(configs, baseRpcResult());

    const result = await purchaseNumber(client, purchaseParams());

    expect(result.order.id).toBe("order-1");
    expect(client.rpc).toHaveBeenCalledWith(
      "create_order_and_debit_wallet",
      expect.objectContaining({ p_payment_fee_kobo: 0, p_fee_schedule_id: undefined }),
    );
  });

  it("rejects with 403 when the account is frozen, before ever calling 5sim", async () => {
    const configs = baseConfigs();
    configs.users = { data: { is_frozen: true }, error: null };
    const client = fakeAdminClient(configs, baseRpcResult());

    await expect(purchaseNumber(client, purchaseParams())).rejects.toMatchObject({ status: 403 });
    expect(getOperatorPrices).not.toHaveBeenCalled();
    expect(buyActivation).not.toHaveBeenCalled();
  });

  it("rejects with 404 when the user row doesn't exist", async () => {
    const configs = baseConfigs();
    configs.users = { data: null, error: null };
    const client = fakeAdminClient(configs, baseRpcResult());

    await expect(purchaseNumber(client, purchaseParams())).rejects.toMatchObject({
      status: 404,
      message: "User not found",
    });
    expect(buyActivation).not.toHaveBeenCalled();
  });

  it("rejects with 429 when the user already holds the max concurrent orders, before ever calling 5sim", async () => {
    const configs = baseConfigs();
    configs.orders = { data: null, error: null, count: 3 };
    const client = fakeAdminClient(configs, baseRpcResult());

    await expect(purchaseNumber(client, purchaseParams())).rejects.toMatchObject({ status: 429 });
    expect(getOperatorPrices).not.toHaveBeenCalled();
    expect(buyActivation).not.toHaveBeenCalled();
  });

  it("rejects with 404 when the service doesn't exist or is inactive", async () => {
    const configs = baseConfigs();
    configs.services = { data: null, error: null };
    const client = fakeAdminClient(configs, baseRpcResult());

    await expect(
      purchaseNumber(client, purchaseParams({ serviceId: "x" })),
    ).rejects.toMatchObject({ status: 404 });
    expect(buyActivation).not.toHaveBeenCalled();
  });

  it("rejects with 402 when the wallet balance is insufficient, before ever calling 5sim", async () => {
    const configs = baseConfigs();
    configs.wallets = { data: { balance_kobo: 0 }, error: null };
    const client = fakeAdminClient(configs, baseRpcResult());

    await expect(purchaseNumber(client, purchaseParams())).rejects.toMatchObject({ status: 402 });
    expect(buyActivation).not.toHaveBeenCalled();
  });

  it("rejects with 502 and touches nothing else when the 5sim buy call itself fails", async () => {
    vi.mocked(buyActivation).mockRejectedValue(new Error("5sim: out of stock"));
    const client = fakeAdminClient(baseConfigs(), baseRpcResult());

    await expect(purchaseNumber(client, purchaseParams())).rejects.toMatchObject({ status: 502 });
    // No wallet debit, no order row — confirms ARCHITECTURE.md's ordering
    // (buy succeeds -> THEN debit + order) held: a failed 5sim purchase
    // never reaches the money-moving RPC at all.
    expect(client.rpc).not.toHaveBeenCalled();
    expect(cancelOrder).not.toHaveBeenCalled();
  });

  it("never leaks 5sim's raw error text to the customer — maps it to a clean, actionable message instead", async () => {
    // Real bug (Sept 2026): a live TikTok/UK purchase hit 5sim's
    // documented "no free phones" response (HTTP 200, plain text — see
    // lib/5sim/client.ts's fiveSimFetch comment) and the raw parser
    // exception message ("Unexpected token 'o', "no free phones" is not
    // valid JSON") ended up shown to the customer verbatim.
    vi.mocked(buyActivation).mockRejectedValue(
      new FiveSimError("/user/buy/activation/england/ee/tiktok", 200, "no free phones"),
    );
    const client = fakeAdminClient(baseConfigs(), baseRpcResult());

    await expect(purchaseNumber(client, purchaseParams())).rejects.toMatchObject({
      status: 502,
      message: "No numbers currently available for this service/country — try again shortly or pick a different country.",
    });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("cancels upstream and reports insufficient balance when the RPC's atomic debit loses a balance race", async () => {
    const client = fakeAdminClient(baseConfigs(), {
      data: null,
      error: { message: "sync_wallet_balance: balance would go negative for user_id x", code: "P0001" },
    });

    await expect(purchaseNumber(client, purchaseParams())).rejects.toMatchObject({
      status: 402,
      message: "Insufficient wallet balance",
    });
    expect(cancelOrder).toHaveBeenCalledWith(String(FIVESIM_ORDER.id));
  });

  it("still cancels upstream on a non-balance RPC failure, with a generic reversal error — no orphaned order to compensate for since the transaction already rolled it back", async () => {
    const client = fakeAdminClient(baseConfigs(), {
      data: null,
      error: { message: "connection reset", code: "08000" },
    });

    await expect(purchaseNumber(client, purchaseParams())).rejects.toMatchObject({
      status: 500,
      message: "Failed to record the purchase — it was reversed",
    });
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
