import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { cancelActivation, getActivationState, GrizzlyError } from "@/lib/grizzly/client";
import { cancelOrder, checkOrder, FiveSimError, type FiveSimOrder } from "@/lib/5sim/client";
import { scheduleUpstreamCancelRetry } from "@/lib/qstash/client";
import {
  cancelUpstreamWithRecovery,
  enqueueUpstreamCancel,
  processDueUpstreamCancels,
} from "./upstream-cancel-queue";

vi.mock("@/lib/grizzly/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/grizzly/client")>();
  return { ...actual, cancelActivation: vi.fn(), getActivationState: vi.fn(), finishActivation: vi.fn() };
});
vi.mock("@/lib/5sim/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/5sim/client")>();
  return { ...actual, cancelOrder: vi.fn(), checkOrder: vi.fn() };
});
vi.mock("@/lib/qstash/client", () => ({ scheduleUpstreamCancelRetry: vi.fn() }));

const NOW = new Date("2026-10-29T12:10:00.000Z");
const LOCKED = new GrizzlyError("setStatus", 200, "EARLY_CANCEL_DENIED");

type Row = Record<string, unknown>;

// A tiny in-memory stand-in for the three tables the queue touches. Filters
// are applied for real so the conditional claim/flip logic is exercised.
function fakeDb(initial: { queue?: Row[]; orders?: Row[]; finance?: Row[] } = {}) {
  const tables: Record<string, Row[]> = {
    upstream_cancel_queue: initial.queue ?? [],
    orders: initial.orders ?? [],
    finance_events: initial.finance ?? [],
  };
  const upserts: Row[] = [];
  const financeInserts: Row[] = [];
  let upsertError: unknown = null;

  function query(table: string) {
    const preds: ((r: Row) => boolean)[] = [];
    let patch: Row | null = null;
    const matching = () => tables[table].filter((r) => preds.every((p) => p(r)));
    const run = () => {
      const rows = matching();
      if (patch) for (const r of rows) Object.assign(r, patch);
      return rows;
    };
    const builder = {
      select: () => builder,
      update: (p: Row) => {
        patch = p;
        return builder;
      },
      eq: (c: string, v: unknown) => (preds.push((r) => r[c] === v), builder),
      is: (c: string, v: unknown) => (preds.push((r) => (r[c] ?? null) === v), builder),
      in: (c: string, vs: unknown[]) => (preds.push((r) => vs.includes(r[c])), builder),
      lte: (c: string, v: string) => (preds.push((r) => String(r[c]) <= v), builder),
      order: () => builder,
      limit: () => builder,
      maybeSingle: () => Promise.resolve({ data: run()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => void) => resolve({ data: run(), error: null }),
      upsert: (row: Row) => {
        upserts.push(row);
        return Promise.resolve({ error: upsertError });
      },
      insert: (row: Row) => {
        financeInserts.push(row);
        return Promise.resolve({ error: null });
      },
    };
    return builder;
  }

  const client = { from: vi.fn((table: string) => query(table)) } as unknown as SupabaseClient<Database>;
  return {
    client,
    tables,
    upserts,
    financeInserts,
    failUpserts: (err: unknown) => {
      upsertError = err;
    },
  };
}

function queueRow(overrides: Row = {}): Row {
  return {
    id: "q-1",
    provider: "grizzly",
    provider_order_id: "777",
    order_id: "order-1",
    reason: "cancel_locked",
    not_before: "2026-10-29T12:09:00.000Z",
    give_up_at: "2026-10-29T12:35:00.000Z",
    attempts: 0,
    last_error: "grizzly setStatus failed: 200 EARLY_CANCEL_DENIED",
    resolved_at: null,
    outcome: null,
    ...overrides,
  };
}

const REFUNDED_ORDER: Row = {
  id: "order-1",
  user_id: "user-1",
  service_id: "svc-1",
  country_code: "usa",
  provider: "grizzly",
  status: "expired_refunded",
  upstream_cost_kobo: 162_448,
  upstream_cancel_succeeded: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("processDueUpstreamCancels", () => {
  it("cancels a due row, resolves it, and books the recovered cost once", async () => {
    vi.mocked(cancelActivation).mockResolvedValue(undefined);
    const db = fakeDb({
      queue: [queueRow()],
      orders: [{ ...REFUNDED_ORDER }],
      finance: [{ order_id: "order-1", event_type: "revenue_recognized", provider: "grizzly" }],
    });

    const result = await processDueUpstreamCancels(db.client, NOW);

    expect(result).toMatchObject({ cancelled: 1, retrying: 0 });
    expect(cancelActivation).toHaveBeenCalledWith("777");
    expect(db.tables.upstream_cancel_queue[0]).toMatchObject({ outcome: "cancelled", resolved_at: NOW.toISOString(), attempts: 1 });
    expect(db.tables.orders[0].upstream_cancel_succeeded).toBe(true);
    expect(db.financeInserts).toEqual([
      expect.objectContaining({
        order_id: "order-1",
        event_type: "provider_cost_recovered",
        provider: "grizzly",
        revenue_kobo: 0,
        provider_cost_kobo: -162_448,
        payment_fee_kobo: 0,
      }),
    ]);
  });

  it("does not book a recovery for an order whose cost was already counted as recovered", async () => {
    vi.mocked(cancelActivation).mockResolvedValue(undefined);
    const db = fakeDb({ queue: [queueRow()], orders: [{ ...REFUNDED_ORDER, upstream_cancel_succeeded: true }] });

    await processDueUpstreamCancels(db.client, NOW);

    expect(db.financeInserts).toEqual([]);
  });

  it("keeps retrying while still locked and before give-up, scheduling the next try", async () => {
    vi.mocked(cancelActivation).mockRejectedValue(LOCKED);
    vi.mocked(getActivationState).mockResolvedValue({ state: "waiting" });
    const db = fakeDb({ queue: [queueRow()], orders: [{ ...REFUNDED_ORDER }] });

    const result = await processDueUpstreamCancels(db.client, NOW);

    expect(result).toMatchObject({ retrying: 1, cancelled: 0 });
    expect(db.tables.upstream_cancel_queue[0]).toMatchObject({
      resolved_at: null,
      attempts: 1,
      not_before: "2026-10-29T12:11:00.000Z",
      last_error: "grizzly setStatus failed: 200 EARLY_CANCEL_DENIED",
    });
    expect(scheduleUpstreamCancelRetry).toHaveBeenCalledWith(65);
    expect(db.financeInserts).toEqual([]);
  });

  it("resolves as already_closed (cost recovered) when the cancel fails but Grizzly shows it cancelled", async () => {
    vi.mocked(cancelActivation).mockRejectedValue(new GrizzlyError("setStatus", 200, "BAD_STATUS"));
    vi.mocked(getActivationState).mockResolvedValue({ state: "cancelled" });
    const db = fakeDb({ queue: [queueRow()], orders: [{ ...REFUNDED_ORDER }] });

    const result = await processDueUpstreamCancels(db.client, NOW);

    expect(result.alreadyClosed).toBe(1);
    expect(db.tables.upstream_cancel_queue[0].outcome).toBe("already_closed");
    expect(db.financeInserts).toHaveLength(1);
  });

  it("resolves as sms_arrived — a real loss, no recovery booked", async () => {
    vi.mocked(cancelActivation).mockRejectedValue(LOCKED);
    vi.mocked(getActivationState).mockResolvedValue({ state: "received", code: "1", text: null, smsDateTime: null });
    const db = fakeDb({ queue: [queueRow()], orders: [{ ...REFUNDED_ORDER }] });

    const result = await processDueUpstreamCancels(db.client, NOW);

    expect(result.smsArrived).toBe(1);
    expect(db.tables.orders[0].upstream_cancel_succeeded).toBe(false);
    expect(db.financeInserts).toEqual([]);
  });

  it("gives up after give_up_at when the state is still unknown", async () => {
    vi.mocked(cancelActivation).mockRejectedValue(LOCKED);
    vi.mocked(getActivationState).mockRejectedValue(new Error("unreachable"));
    const db = fakeDb({ queue: [queueRow({ give_up_at: "2026-10-29T12:05:00.000Z" })] });

    const result = await processDueUpstreamCancels(db.client, NOW);

    expect(result.gaveUp).toBe(1);
    expect(db.tables.upstream_cancel_queue[0].outcome).toBe("gave_up");
  });

  it("skips rows that aren't due yet or are already resolved", async () => {
    const db = fakeDb({
      queue: [
        queueRow({ id: "later", not_before: "2026-10-29T12:20:00.000Z" }),
        queueRow({ id: "done", resolved_at: "2026-10-29T12:00:00.000Z", outcome: "cancelled" }),
      ],
    });

    const result = await processDueUpstreamCancels(db.client, NOW);

    expect(cancelActivation).not.toHaveBeenCalled();
    expect(result).toEqual({ cancelled: 0, alreadyClosed: 0, smsArrived: 0, gaveUp: 0, retrying: 0, failed: 0 });
  });

  it("resolves an abandoned purchase (no order) without touching orders or finance", async () => {
    vi.mocked(cancelActivation).mockResolvedValue(undefined);
    const db = fakeDb({ queue: [queueRow({ order_id: null, reason: "price_above_quote" })] });

    const result = await processDueUpstreamCancels(db.client, NOW);

    expect(result.cancelled).toBe(1);
    expect(db.financeInserts).toEqual([]);
  });
});

describe("enqueueUpstreamCancel", () => {
  it("upserts the row (ignoring duplicates) and schedules a retry for when it's due", async () => {
    vi.useFakeTimers({ now: NOW });
    const db = fakeDb();

    const ok = await enqueueUpstreamCancel(db.client, {
      provider: "grizzly",
      providerOrderId: "777",
      reason: "price_above_quote",
      notBefore: new Date(NOW.getTime() + 330_000),
      giveUpAt: new Date(NOW.getTime() + 1_800_000),
    });

    expect(ok).toBe(true);
    expect(db.upserts[0]).toMatchObject({ provider: "grizzly", provider_order_id: "777", order_id: null, reason: "price_above_quote" });
    expect(scheduleUpstreamCancelRetry).toHaveBeenCalledWith(335);
    vi.useRealTimers();
  });

  it("never throws when the insert fails", async () => {
    const db = fakeDb();
    db.failUpserts({ message: "db down" });

    await expect(
      enqueueUpstreamCancel(db.client, {
        provider: "grizzly",
        providerOrderId: "777",
        reason: "cancel_locked",
        notBefore: NOW,
        giveUpAt: NOW,
      }),
    ).resolves.toBe(false);
    expect(scheduleUpstreamCancelRetry).not.toHaveBeenCalled();
  });
});

describe("cancelUpstreamWithRecovery", () => {
  const GRIZZLY_ORDER = { id: "order-1", provider: "grizzly", provider_order_id: "777" };
  const FIVESIM_ORDER = { id: "order-2", provider: "5sim", provider_order_id: "999" };

  it("succeeds outright when the cancel lands", async () => {
    vi.mocked(cancelActivation).mockResolvedValue(undefined);
    await expect(cancelUpstreamWithRecovery(fakeDb().client, GRIZZLY_ORDER)).resolves.toEqual({
      succeeded: true,
      error: null,
      queued: false,
    });
  });

  it("queues a Grizzly cancel refused by the lock, reporting it as not (yet) recovered", async () => {
    vi.mocked(cancelActivation).mockRejectedValue(LOCKED);
    vi.mocked(getActivationState).mockResolvedValue({ state: "waiting" });
    const db = fakeDb();

    const outcome = await cancelUpstreamWithRecovery(db.client, GRIZZLY_ORDER);

    expect(outcome).toEqual({ succeeded: false, error: "grizzly setStatus failed: 200 EARLY_CANCEL_DENIED", queued: true });
    expect(db.upserts[0]).toMatchObject({ order_id: "order-1", reason: "cancel_locked" });
  });

  it("decision 6 (Grizzly): a failed cancel on an activation already cancelled upstream counts as recovered, error kept", async () => {
    vi.mocked(cancelActivation).mockRejectedValue(new GrizzlyError("setStatus", 200, "BAD_STATUS"));
    vi.mocked(getActivationState).mockResolvedValue({ state: "cancelled" });
    const db = fakeDb();

    const outcome = await cancelUpstreamWithRecovery(db.client, GRIZZLY_ORDER);

    expect(outcome).toEqual({ succeeded: true, error: "grizzly setStatus failed: 200 BAD_STATUS", queued: false });
    expect(db.upserts).toEqual([]);
  });

  it("decision 6 (5sim): a failed cancel on an order 5sim already timed out with no SMS counts as recovered", async () => {
    vi.mocked(cancelOrder).mockRejectedValue(new FiveSimError("/user/cancel/999", 400, "order expired"));
    vi.mocked(checkOrder).mockResolvedValue({ status: "TIMEOUT", sms: [] } as unknown as FiveSimOrder);

    const outcome = await cancelUpstreamWithRecovery(fakeDb().client, FIVESIM_ORDER);

    expect(outcome).toEqual({ succeeded: true, error: "5sim /user/cancel/999 failed: 400 order expired", queued: false });
  });

  it("5sim: a failed cancel on an order that has SMS stays a loss and is never queued", async () => {
    vi.mocked(cancelOrder).mockRejectedValue(new FiveSimError("/user/cancel/999", 400, "order has sms"));
    vi.mocked(checkOrder).mockResolvedValue({ status: "RECEIVED", sms: [{ code: "1" }] } as unknown as FiveSimOrder);
    const db = fakeDb();

    const outcome = await cancelUpstreamWithRecovery(db.client, FIVESIM_ORDER);

    expect(outcome.succeeded).toBe(false);
    expect(outcome.queued).toBe(false);
    expect(db.upserts).toEqual([]);
  });
});
