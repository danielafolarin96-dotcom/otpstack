#!/usr/bin/env node
// Applies the 44.7%-standing-margin reprice agreed with the user. Updates
// 5 pricing_rules rows, leaves the 2 excluded WhatsApp/USA and
// WhatsApp/Australia overrides untouched, and writes one admin_audit_log
// row per rule changed. Does NOT touch min_margin_pct on any rule.
//
// Usage: node scripts/apply-margin-reprice.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function loadEnvLocal() {
  const envPath = path.join(repoRoot, ".env.local");
  const raw = readFileSync(envPath, "utf8");
  const env = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

const TARGET_MARGIN_PCT = 44.7;
const TARGET_MARKUP_PCT = 80.83; // 44.7 / (100 - 44.7) * 100, rounded per user's own figure
const ADMIN_ID = "095c1a3a-aa74-4831-9c85-f647ef4d7f40"; // confirmed sole is_admin=true user
const REASON = "reprice to new 44.7% standing target margin per user request";

const EXCLUDED_IDS = new Set([
  "da86f295-2010-477c-8c35-7c54b2e52fc0", // WhatsApp / USA — stays at 30% floor
  "26319bd2-c68b-47d1-a859-46ed3092070d", // WhatsApp / Australia — stays at 30% floor
]);

async function fiveSimFetch(path_, apiKey) {
  const res = await fetch(`https://5sim.net/v1${path_}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`5sim ${path_} failed: ${res.status} ${body.slice(0, 200)}`);
  return JSON.parse(body);
}

function selectBestOperator(operators) {
  const inStock = Object.entries(operators)
    .filter(([, p]) => p.count > 0)
    .map(([operator, p]) => ({ operator, ...p }));
  if (inStock.length === 0) return null;
  const reliable = inStock.filter((p) => p.rate === undefined || p.rate >= 70);
  const pool = reliable.length > 0 ? reliable : inStock;
  return pool.reduce((best, p) => (p.cost < best.cost ? p : best));
}

function fmtKobo(kobo) {
  return `₦${((kobo ?? 0) / 100).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function main() {
  const env = loadEnvLocal();
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: rules, error: rulesErr } = await admin.from("pricing_rules").select("*");
  if (rulesErr) throw rulesErr;

  const [{ data: fxRows, error: fxErr }] = await Promise.all([
    admin.from("fx_rates").select("*").order("fetched_at", { ascending: false }).limit(1),
  ]);
  if (fxErr) throw fxErr;
  const fxRate = Number(fxRows[0].rate);

  // Recompute the TikTok/UK flat_kobo value against a fresh live cost, as
  // agreed (this rule is the only flat_kobo rule left in scope for change).
  const tiktokUkPrices = await fiveSimFetch("/guest/prices?country=england&product=tiktok", env.FIVESIM_API_KEY);
  const tiktokUkOperators = tiktokUkPrices.england.tiktok;
  const best = selectBestOperator(tiktokUkOperators);
  if (!best) throw new Error("No in-stock TikTok/UK operator found — cannot recompute d2a03330's flat_kobo value");
  const tiktokUkCostKobo = Math.round(best.cost * fxRate * 100);
  const tiktokUkFlatKobo = Math.round((tiktokUkCostKobo * TARGET_MARKUP_PCT) / 100);
  console.log(
    `Live TikTok/UK cost: $${best.cost} (operator=${best.operator}, rate=${best.rate ?? "n/a"}) -> ₦${(tiktokUkCostKobo / 100).toFixed(2)} at fx=${fxRate}`,
  );
  console.log(`New flat_kobo for d2a03330 (TikTok/UK): ${tiktokUkFlatKobo} (${fmtKobo(tiktokUkFlatKobo)})`);

  const byId = new Map(rules.map((r) => [r.id, r]));

  const changes = [
    {
      id: "5d001d06-9659-42b6-a99b-2a9eb6dd8ff6",
      label: "global default",
      newMarkupType: "tiered",
      newMarkupValue: (byId.get("5d001d06-9659-42b6-a99b-2a9eb6dd8ff6").markup_value ?? []).map((t) => ({
        ...t,
        markup_pct: TARGET_MARKUP_PCT,
      })),
    },
    {
      id: "0dc228d8-0d32-4f9f-ac69-0ad4a98b112c",
      label: "country / Nigeria",
      newMarkupType: "percent",
      newMarkupValue: TARGET_MARKUP_PCT,
    },
    {
      id: "f5178e94-3c7d-4715-8a4f-18664a761949",
      label: "service / WhatsApp",
      newMarkupType: "percent",
      newMarkupValue: TARGET_MARKUP_PCT,
    },
    {
      id: "2be8afb0-5948-474b-a0d7-ce47530e5946",
      label: "service_country / WhatsApp+Nigeria",
      newMarkupType: "percent",
      newMarkupValue: TARGET_MARKUP_PCT,
    },
    {
      id: "d2a03330-680d-463e-b3cd-c97a75cbb687",
      label: "service_country / TikTok+UK",
      newMarkupType: "flat_kobo",
      newMarkupValue: tiktokUkFlatKobo,
    },
  ];

  // Safety: refuse to touch anything not in our reviewed list, and refuse
  // to touch either excluded id no matter what.
  for (const c of changes) {
    if (EXCLUDED_IDS.has(c.id)) {
      throw new Error(`Refusing to change excluded rule ${c.id}`);
    }
    if (!byId.has(c.id)) {
      throw new Error(`Rule ${c.id} not found in current pricing_rules — aborting before any writes`);
    }
  }
  for (const r of rules) {
    if (!changes.some((c) => c.id === r.id) && !EXCLUDED_IDS.has(r.id)) {
      throw new Error(`Unexpected pricing_rules row ${r.id} not accounted for in change list or exclusions — aborting`);
    }
  }

  console.log(`\nApplying ${changes.length} updates (2 rules excluded, untouched)...\n`);

  for (const c of changes) {
    const before = byId.get(c.id);
    const { data: updated, error: updateErr } = await admin
      .from("pricing_rules")
      .update({ markup_type: c.newMarkupType, markup_value: c.newMarkupValue })
      .eq("id", c.id)
      .select()
      .single();
    if (updateErr) throw updateErr;

    // min_margin_pct must be unchanged — verify, don't just assume.
    if (updated.min_margin_pct !== before.min_margin_pct) {
      throw new Error(`min_margin_pct changed unexpectedly on ${c.id} — this should never happen`);
    }

    await admin.from("admin_audit_log").insert({
      admin_id: ADMIN_ID,
      action: "pricing_rule.update",
      target_type: "pricing_rule",
      target_id: c.id,
      reason: REASON,
      metadata: {
        scope: before.scope,
        service_id: before.service_id,
        country_id: before.country_id,
        old_markup_type: before.markup_type,
        old_markup_value: before.markup_value,
        new_markup_type: c.newMarkupType,
        new_markup_value: c.newMarkupValue,
        min_margin_pct: before.min_margin_pct,
        target_margin_pct: TARGET_MARGIN_PCT,
      },
    });

    console.log(
      `  [OK] ${c.label} (${c.id})\n       old: ${before.markup_type} ${JSON.stringify(before.markup_value)}\n       new: ${c.newMarkupType} ${JSON.stringify(c.newMarkupValue)}`,
    );
  }

  console.log("\nVerifying excluded rules are untouched...");
  const { data: excludedCheck, error: excludedErr } = await admin
    .from("pricing_rules")
    .select("*")
    .in("id", [...EXCLUDED_IDS]);
  if (excludedErr) throw excludedErr;
  for (const r of excludedCheck) {
    console.log(`  ${r.id}: markup_type=${r.markup_type} markup_value=${JSON.stringify(r.markup_value)} (unchanged, as expected)`);
  }

  console.log("\nDone. 5 rules updated, 2 excluded rules confirmed untouched, 5 admin_audit_log rows written.");
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
