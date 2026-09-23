// Pure aggregation over finance_events rows — no DB access here, same split
// lib/pricing/margin-report.ts uses (the admin page fetches, this function
// summarizes) so the math is unit-testable without mocking Supabase.
//
// finance_events is an append-only ledger (see the create_finance_tracking
// migration): a 'revenue_recognized' row at purchase time, plus a
// 'refund_issued' row if that order is later refunded. Per-order and
// aggregate profit are always just sums over these rows, which is what
// makes "refunds automatically update the calculations" true for free.

export interface FinanceEventInput {
  orderId: string;
  eventType: "revenue_recognized" | "refund_issued";
  serviceId: string;
  serviceName: string;
  countryCode: string;
  countryName: string;
  provider: string;
  revenueKobo: number;
  providerCostKobo: number;
  paymentFeeKobo: number;
  createdAt: string;
}

export interface FinanceFilterOptions {
  fromDate?: string | null; // ISO, inclusive
  toDate?: string | null; // ISO, exclusive
  countryCode?: string | null;
  serviceId?: string | null;
  provider?: string | null;
}

export interface OrderFinanceRow {
  orderId: string;
  createdAt: string; // of the revenue_recognized event, i.e. when the order was placed
  serviceId: string;
  serviceName: string;
  countryCode: string;
  countryName: string;
  provider: string;
  revenueKobo: number;
  providerCostKobo: number;
  paymentFeeKobo: number;
  refundKobo: number;
  grossProfitKobo: number;
  netProfitKobo: number;
}

export interface FinanceTotals {
  orderCount: number;
  refundedOrderCount: number;
  revenueKobo: number;
  providerCostKobo: number;
  paymentFeeKobo: number;
  refundKobo: number;
  grossProfitKobo: number;
  netProfitKobo: number;
  grossMarginPct: number;
  netMarginPct: number;
}

export interface FinanceReport {
  totals: FinanceTotals;
  rows: OrderFinanceRow[];
}

function grossMarginPct(revenueKobo: number, providerCostKobo: number): number {
  if (revenueKobo <= 0) return 0;
  return ((revenueKobo - providerCostKobo) / revenueKobo) * 100;
}

function netMarginPct(revenueKobo: number, providerCostKobo: number, paymentFeeKobo: number): number {
  if (revenueKobo <= 0) return 0;
  return ((revenueKobo - providerCostKobo - paymentFeeKobo) / revenueKobo) * 100;
}

export function summarizeFinanceEvents(
  events: FinanceEventInput[],
  filters: FinanceFilterOptions = {},
): FinanceReport {
  const fromMs = filters.fromDate ? new Date(filters.fromDate).getTime() : null;
  const toMs = filters.toDate ? new Date(filters.toDate).getTime() : null;

  // Group by order FIRST, before any filtering — a refund can land outside
  // the display window even when the order itself was created inside it
  // (e.g. "today" view, an order from yesterday refunded today). Filtering
  // is applied per-order below, keyed on the revenue_recognized event, so
  // an order's full financial outcome (including a later refund) always
  // stays attached to it rather than being split across two windows.
  const byOrder = new Map<string, FinanceEventInput[]>();
  for (const event of events) {
    const list = byOrder.get(event.orderId) ?? [];
    list.push(event);
    byOrder.set(event.orderId, list);
  }

  const rows: OrderFinanceRow[] = [];
  for (const orderEvents of byOrder.values()) {
    const recognized = orderEvents.find((e) => e.eventType === "revenue_recognized");
    if (!recognized) continue; // shouldn't happen — a refund_issued row always pairs with one

    if (fromMs !== null && new Date(recognized.createdAt).getTime() < fromMs) continue;
    if (toMs !== null && new Date(recognized.createdAt).getTime() >= toMs) continue;
    if (filters.countryCode && recognized.countryCode !== filters.countryCode) continue;
    if (filters.serviceId && recognized.serviceId !== filters.serviceId) continue;
    if (filters.provider && recognized.provider !== filters.provider) continue;

    const revenueKobo = orderEvents.reduce((sum, e) => sum + e.revenueKobo, 0);
    const providerCostKobo = orderEvents.reduce((sum, e) => sum + e.providerCostKobo, 0);
    const paymentFeeKobo = orderEvents.reduce((sum, e) => sum + e.paymentFeeKobo, 0);
    const refundKobo = orderEvents
      .filter((e) => e.eventType === "refund_issued")
      .reduce((sum, e) => sum + Math.abs(e.revenueKobo), 0);

    rows.push({
      orderId: recognized.orderId,
      createdAt: recognized.createdAt,
      serviceId: recognized.serviceId,
      serviceName: recognized.serviceName,
      countryCode: recognized.countryCode,
      countryName: recognized.countryName,
      provider: recognized.provider,
      revenueKobo,
      providerCostKobo,
      paymentFeeKobo,
      refundKobo,
      grossProfitKobo: revenueKobo - providerCostKobo,
      netProfitKobo: revenueKobo - providerCostKobo - paymentFeeKobo,
    });
  }

  rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const totals = rows.reduce<FinanceTotals>(
    (acc, row) => {
      acc.orderCount += 1;
      if (row.refundKobo > 0) acc.refundedOrderCount += 1;
      acc.revenueKobo += row.revenueKobo;
      acc.providerCostKobo += row.providerCostKobo;
      acc.paymentFeeKobo += row.paymentFeeKobo;
      acc.refundKobo += row.refundKobo;
      acc.grossProfitKobo += row.grossProfitKobo;
      acc.netProfitKobo += row.netProfitKobo;
      return acc;
    },
    {
      orderCount: 0,
      refundedOrderCount: 0,
      revenueKobo: 0,
      providerCostKobo: 0,
      paymentFeeKobo: 0,
      refundKobo: 0,
      grossProfitKobo: 0,
      netProfitKobo: 0,
      grossMarginPct: 0,
      netMarginPct: 0,
    },
  );
  totals.grossMarginPct = grossMarginPct(totals.revenueKobo, totals.providerCostKobo);
  totals.netMarginPct = netMarginPct(totals.revenueKobo, totals.providerCostKobo, totals.paymentFeeKobo);

  return { totals, rows };
}
