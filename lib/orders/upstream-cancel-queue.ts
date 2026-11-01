import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { recordFinanceEvent } from "@/lib/finance/ledger";
import { scheduleUpstreamCancelRetry } from "@/lib/qstash/client";
import { asProviderName } from "@/lib/providers/policy";
import {
  cancelUpstream,
  describeUpstreamError,
  fetchUpstreamState,
  type UpstreamOrderRef,
} from "@/lib/providers/upstream";

// Grizzly refuses setStatus=8 (cancel) for roughly the first 5 minutes of
// an activation (observed live 29 Oct 2026). Anything we need cancelled
// before then — a purchase we abandon (Grizzly charged above our quote, or
// our order write failed), or an expiry cancel that still lands inside the
// lock — goes into upstream_cancel_queue and is retried by
// /api/cron/expire-orders (a QStash call scheduled here, plus the existing
// backstop sweeps). Grizzly only charges when an SMS arrives, so this isn't
// about getting a hold back: it closes the number before a late SMS can
// bill us for a customer who has already been refunded.

// The lock is "~5 minutes"; a deliberate 30s margin past it.
export const GRIZZLY_CANCEL_LOCK_SECONDS = 330;
export const CANCEL_RETRY_INTERVAL_SECONDS = 60;
// Grizzly activations last 20 minutes and then close on their own, so
// past this a retry has nothing left to protect — the row resolves on the
// last status check instead.
export const CANCEL_GIVE_UP_AFTER_MS = 30 * 60_000;
// A few seconds of slack so the QStash call never lands before not_before.
const SCHEDULE_PADDING_SECONDS = 5;
const MAX_ROWS_PER_RUN = 25;

export type UpstreamCancelReason = "price_above_quote" | "order_record_failed" | "cancel_locked";

export interface EnqueueUpstreamCancelInput {
  provider: string;
  providerOrderId: string;
  orderId?: string | null;
  reason: UpstreamCancelReason;
  notBefore: Date;
  giveUpAt: Date;
  lastError?: string | null;
}

// Best-effort and never throws — not on the insert, not on the retry
// scheduling after it: it runs inside refund paths between claiming an
// order and crediting the wallet, so it must never stop them. A failed
// insert is logged loudly since it leaves an activation we meant to close
// open until Grizzly's own 20-minute expiry. Returns whether the row was
// queued (a failed QStash schedule still counts: the sweeps pick it up).
export async function enqueueUpstreamCancel(
  admin: SupabaseClient<Database>,
  input: EnqueueUpstreamCancelInput,
): Promise<boolean> {
  try {
    const { error } = await admin.from("upstream_cancel_queue").upsert(
      {
        provider: input.provider,
        provider_order_id: input.providerOrderId,
        order_id: input.orderId ?? null,
        reason: input.reason,
        not_before: input.notBefore.toISOString(),
        give_up_at: input.giveUpAt.toISOString(),
        last_error: input.lastError ?? null,
      },
      { onConflict: "provider,provider_order_id", ignoreDuplicates: true },
    );
    if (error) throw error;
  } catch (err) {
    console.error(
      `Failed to queue upstream cancel for ${input.provider} order ${input.providerOrderId} (${input.reason}):`,
      err,
    );
    return false;
  }

  try {
    await scheduleUpstreamCancelRetry(
      Math.max(0, (input.notBefore.getTime() - Date.now()) / 1000) + SCHEDULE_PADDING_SECONDS,
    );
  } catch (err) {
    console.error("Failed to schedule the upstream cancel retry — the backstop sweeps will process it:", err);
  }
  return true;
}

export interface UpstreamCancelOutcome {
  // true = the upstream cost is recovered: either our cancel landed, or it
  // failed but a re-check shows the order already closed upstream with no
  // SMS (decision 6, 29 Oct 2026 — neither provider charges for those).
  succeeded: boolean;
  // The cancel call's error, kept even when succeeded is true via the
  // re-check, so a failed cancel is still diagnosable.
  error: string | null;
  // A Grizzly cancel that hit the lock and was queued for retry.
  queued: boolean;
}

// The cancel step every refund path shares (expiry, manual cancel, admin
// refund). Never throws: it runs after the order has been claimed as
// refunded and before the wallet is credited, so any failure in here
// (cancel, re-check, queueing, even describing the error) degrades to "not
// recovered" and the refund still happens.
export async function cancelUpstreamWithRecovery(
  admin: SupabaseClient<Database>,
  order: UpstreamOrderRef & { id: string },
): Promise<UpstreamCancelOutcome> {
  try {
    return await cancelWithRecovery(admin, order);
  } catch (err) {
    console.error(`Upstream cancel handling failed for order ${order.id} — treating the cost as not recovered:`, err);
    let error: string;
    try {
      error = describeUpstreamError(err);
    } catch {
      error = "upstream cancel handling failed";
    }
    return { succeeded: false, error, queued: false };
  }
}

async function cancelWithRecovery(
  admin: SupabaseClient<Database>,
  order: UpstreamOrderRef & { id: string },
): Promise<UpstreamCancelOutcome> {
  try {
    await cancelUpstream(order);
    return { succeeded: true, error: null, queued: false };
  } catch (err) {
    console.error(`Upstream cancel failed for ${asProviderName(order.provider)} order ${order.provider_order_id}:`, err);
    const error = describeUpstreamError(err);

    const recheck = await fetchUpstreamState(order);
    if (recheck?.closedWithoutSms) {
      return { succeeded: true, error, queued: false };
    }

    if (asProviderName(order.provider) === "grizzly" && !recheck?.hasSms) {
      const now = Date.now();
      const queued = await enqueueUpstreamCancel(admin, {
        provider: "grizzly",
        providerOrderId: order.provider_order_id,
        orderId: order.id,
        reason: "cancel_locked",
        notBefore: new Date(now + CANCEL_RETRY_INTERVAL_SECONDS * 1000),
        giveUpAt: new Date(now + CANCEL_GIVE_UP_AFTER_MS),
        lastError: error,
      });
      return { succeeded: false, error, queued };
    }

    return { succeeded: false, error, queued: false };
  }
}

// A refund booked as "cost lost" (upstream_cancel_succeeded = false,
// refund_issued with provider_cost_kobo = 0) whose queued cancel later
// succeeded: record the recovery as its own append-only finance event, then
// flip the order. Safe to repeat after a partial failure — the finance
// insert comes first and a duplicate is a no-op (unique (order_id,
// event_type)), and only once it's written does the flag flip, so a retry
// can never skip the finance row. Throws on failure so the caller leaves
// the queue row retryable.
async function recordCostRecovered(admin: SupabaseClient<Database>, orderId: string): Promise<void> {
  const { data: order, error } = await admin
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .eq("upstream_cancel_succeeded", false)
    .in("status", ["expired_refunded", "cancelled_refunded"])
    .maybeSingle();
  if (error) throw error;
  if (!order) return; // never booked as lost, or already recovered

  const { data: recognized } = await admin
    .from("finance_events")
    .select("provider")
    .eq("order_id", orderId)
    .eq("event_type", "revenue_recognized")
    .maybeSingle();

  await recordFinanceEvent(admin, {
    orderId,
    userId: order.user_id,
    eventType: "provider_cost_recovered",
    serviceId: order.service_id,
    countryCode: order.country_code,
    provider: recognized?.provider ?? order.provider,
    revenueKobo: 0,
    providerCostKobo: -order.upstream_cost_kobo,
    paymentFeeKobo: 0,
    metadata: { source: "upstream_cancel_queue" },
  });

  const { error: flipError } = await admin
    .from("orders")
    .update({ upstream_cancel_succeeded: true })
    .eq("id", orderId)
    .eq("upstream_cancel_succeeded", false);
  if (flipError) throw flipError;
}

export interface ProcessQueueResult {
  cancelled: number;
  alreadyClosed: number;
  smsArrived: number;
  gaveUp: number;
  retrying: number;
  failed: number;
}

type QueueRow = Database["public"]["Tables"]["upstream_cancel_queue"]["Row"];

// Works through due, unresolved rows. Each row is claimed first by bumping
// `attempts` conditionally on its current value (and pushing not_before a
// retry interval out), so two overlapping runs never both act on a row.
export async function processDueUpstreamCancels(
  admin: SupabaseClient<Database>,
  now: Date = new Date(),
): Promise<ProcessQueueResult> {
  const result: ProcessQueueResult = { cancelled: 0, alreadyClosed: 0, smsArrived: 0, gaveUp: 0, retrying: 0, failed: 0 };

  const { data: due, error } = await admin
    .from("upstream_cancel_queue")
    .select("*")
    .is("resolved_at", null)
    .lte("not_before", now.toISOString())
    .order("not_before", { ascending: true })
    .limit(MAX_ROWS_PER_RUN);
  if (error) throw error;

  for (const row of (due ?? []) as QueueRow[]) {
    try {
      const { data: claimed, error: claimError } = await admin
        .from("upstream_cancel_queue")
        .update({
          attempts: row.attempts + 1,
          not_before: new Date(now.getTime() + CANCEL_RETRY_INTERVAL_SECONDS * 1000).toISOString(),
        })
        .eq("id", row.id)
        .eq("attempts", row.attempts)
        .is("resolved_at", null)
        .select()
        .maybeSingle();
      if (claimError) throw claimError;
      if (!claimed) continue; // another run took it

      const ref: UpstreamOrderRef = { provider: row.provider, provider_order_id: row.provider_order_id };
      let outcome: "cancelled" | "already_closed" | "sms_arrived" | "gave_up" | null = null;
      let lastError: string | null = row.last_error;
      try {
        await cancelUpstream(ref);
        outcome = "cancelled";
      } catch (err) {
        lastError = describeUpstreamError(err);
        const state = await fetchUpstreamState(ref);
        if (state?.closedWithoutSms) outcome = "already_closed";
        else if (state?.hasSms) outcome = "sms_arrived";
        else if (now.getTime() >= new Date(row.give_up_at).getTime()) outcome = "gave_up";
      }

      if (!outcome) {
        await admin.from("upstream_cancel_queue").update({ last_error: lastError }).eq("id", row.id);
        result.retrying += 1;
        continue;
      }

      // The recovery is booked BEFORE the row is resolved: if booking
      // fails, this throws, the row stays unresolved (its claim already
      // pushed not_before a retry interval out) and the next run tries
      // again — the cancel then fails as already done, the re-check says
      // already_closed, and the booking is retried.
      if ((outcome === "cancelled" || outcome === "already_closed") && row.order_id) {
        await recordCostRecovered(admin, row.order_id);
      }

      const { error: resolveError } = await admin
        .from("upstream_cancel_queue")
        .update({ resolved_at: now.toISOString(), outcome, last_error: lastError })
        .eq("id", row.id);
      if (resolveError) throw resolveError;

      if (outcome === "sms_arrived") {
        // A late SMS reached a number we had already refunded — Grizzly
        // bills us for it. Nothing to undo; it shows as a lost cost on the
        // Margin page.
        console.error(`Late SMS on ${row.provider} order ${row.provider_order_id} before its queued cancel landed.`);
      }

      if (outcome === "cancelled") result.cancelled += 1;
      else if (outcome === "already_closed") result.alreadyClosed += 1;
      else if (outcome === "sms_arrived") result.smsArrived += 1;
      else result.gaveUp += 1;
    } catch (err) {
      console.error(`Failed to process upstream cancel queue row ${row.id}:`, err);
      result.failed += 1;
    }
  }

  if (result.retrying > 0) {
    try {
      await scheduleUpstreamCancelRetry(CANCEL_RETRY_INTERVAL_SECONDS + SCHEDULE_PADDING_SECONDS);
    } catch (err) {
      console.error("Failed to schedule the upstream cancel retry — the backstop sweeps will process it:", err);
    }
  }
  return result;
}
