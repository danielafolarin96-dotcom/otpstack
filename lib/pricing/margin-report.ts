import { marginPct } from "./calculate";

// Phase 9 monitoring: orders.upstream_cost_kobo is snapshotted at purchase
// time specifically for this (see ARCHITECTURE.md's orders table note) —
// 5sim's actually-charged price can drift from the quote priceForServiceCountry
// computed moments earlier (see lib/orders/purchase.ts), so the 30% floor
// enforced at quote time doesn't guarantee 30% is what actually lands. This
// is what actually did land.
export const TARGET_MARGIN_PCT = 30; // CLAUDE.md's "Target gross margin"

// expired_refunded/cancelled_refunded give the user their price_kobo back
// (see the expire-and-refund and cancel routes) — that revenue isn't ours
// to count. "banned" deliberately gets no automatic refund (ARCHITECTURE.md
// / app/api/orders/[id]/status/route.ts), so it stays revenue-kept unless
// an admin manually refunds it later.
const REVENUE_KEPT_STATUSES = new Set(["pending", "sms_received", "banned"]);
const REFUNDED_STATUSES = new Set(["expired_refunded", "cancelled_refunded"]);

export interface MarginOrderInput {
  status: string;
  priceKobo: number;
  upstreamCostKobo: number;
  serviceId: string;
  serviceName: string;
  // Set by lib/orders/expire-and-refund.ts / the manual-cancel route at
  // refund time: did the upstream 5sim cancelOrder() call actually
  // succeed? null covers non-refunded orders and refunds written before
  // this field existed (see the migration's backfill) or where the
  // best-effort tracking write itself failed.
  upstreamCancelSucceeded: boolean | null;
}

export interface MarginBucket {
  orderCount: number;
  revenueKobo: number;
  costKobo: number;
  marginPct: number;
}

export interface ServiceMarginRow extends MarginBucket {
  serviceId: string;
  serviceName: string;
}

export interface RefundOutcomeBucket {
  orderCount: number;
  costKobo: number;
}

export interface MarginReport {
  overall: MarginBucket;
  // 5sim isn't refunded when we refund the user unless our own cancelOrder
  // call actually succeeded upstream — see `recovered` vs `lost` below.
  // Neither is netted into `overall`, which only covers revenue we
  // actually kept.
  refunded: {
    orderCount: number;
    costKobo: number;
    // cancelOrder() succeeded — this cost was actually recovered from
    // 5sim, not a real loss despite the customer being refunded.
    recovered: RefundOutcomeBucket;
    // cancelOrder() was attempted and failed — this cost is a genuine,
    // separate loss on top of the customer refund. This is the number the
    // expire-sweep-frequency fix (see that commit) is meant to shrink.
    lost: RefundOutcomeBucket;
    // upstreamCancelSucceeded is null — pre-migration refund, or the
    // best-effort tracking write itself failed. Can't tell recovered from
    // lost for these.
    unknown: RefundOutcomeBucket;
  };
  byService: ServiceMarginRow[];
}

function emptyBucket(): MarginBucket {
  return { orderCount: 0, revenueKobo: 0, costKobo: 0, marginPct: 0 };
}

function emptyRefundOutcomeBucket(): RefundOutcomeBucket {
  return { orderCount: 0, costKobo: 0 };
}

function finalizeBucket(bucket: MarginBucket): MarginBucket {
  return { ...bucket, marginPct: marginPct(bucket.revenueKobo, bucket.costKobo) };
}

export function summarizeMargin(orders: MarginOrderInput[]): MarginReport {
  const overall = emptyBucket();
  const refunded = {
    orderCount: 0,
    costKobo: 0,
    recovered: emptyRefundOutcomeBucket(),
    lost: emptyRefundOutcomeBucket(),
    unknown: emptyRefundOutcomeBucket(),
  };
  const byServiceMap = new Map<string, ServiceMarginRow>();

  for (const order of orders) {
    if (REFUNDED_STATUSES.has(order.status)) {
      refunded.orderCount += 1;
      refunded.costKobo += order.upstreamCostKobo;

      const outcomeBucket =
        order.upstreamCancelSucceeded === true
          ? refunded.recovered
          : order.upstreamCancelSucceeded === false
            ? refunded.lost
            : refunded.unknown;
      outcomeBucket.orderCount += 1;
      outcomeBucket.costKobo += order.upstreamCostKobo;
      continue;
    }
    if (!REVENUE_KEPT_STATUSES.has(order.status)) continue; // unknown/future status — skip rather than guess

    overall.orderCount += 1;
    overall.revenueKobo += order.priceKobo;
    overall.costKobo += order.upstreamCostKobo;

    const existing = byServiceMap.get(order.serviceId) ?? {
      serviceId: order.serviceId,
      serviceName: order.serviceName,
      ...emptyBucket(),
    };
    existing.orderCount += 1;
    existing.revenueKobo += order.priceKobo;
    existing.costKobo += order.upstreamCostKobo;
    byServiceMap.set(order.serviceId, existing);
  }

  const byService = Array.from(byServiceMap.values())
    .map((row) => ({ ...row, marginPct: marginPct(row.revenueKobo, row.costKobo) }))
    // Worst margin first — that's what needs attention for "tune
    // pricing_rules accordingly" (DEVELOPMENT_PLAN.md's Phase 9).
    .sort((a, b) => a.marginPct - b.marginPct);

  return { overall: finalizeBucket(overall), refunded, byService };
}
