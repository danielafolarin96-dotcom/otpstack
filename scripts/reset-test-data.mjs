#!/usr/bin/env node
// Dev/pre-launch-only helper: wipes ALL transactional test data (orders,
// wallet_transactions, wallets) and deletes every auth user, leaving the
// catalog config (services, countries, pricing_rules, fx_rates) and
// admin_audit_log intact. Meant to be run exactly once, right before
// opening signups to real customers.
//
// This does NOT touch Paystack or 5sim — it only clears your own database.
// The real money from any live test top-up already happened on Paystack's
// side and isn't affected by anything this script does.
//
// Usage:
//   node scripts/reset-test-data.mjs --dry-run   # see what would be deleted
//   node scripts/reset-test-data.mjs --yes        # actually delete
//
// Reads Supabase creds from .env.local in the repo root (same file `next
// dev` uses) — no extra dependency required.

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
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const confirmed = args.includes("--yes");

  if (!dryRun && !confirmed) {
    console.error(
      "Refusing to run without --dry-run or --yes. This deletes real data.\n" +
        "  node scripts/reset-test-data.mjs --dry-run   (preview counts)\n" +
        "  node scripts/reset-test-data.mjs --yes        (actually delete)",
    );
    process.exit(1);
  }

  const env = loadEnvLocal();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local",
    );
    process.exit(1);
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // --- Count what's there first, regardless of mode ---
  const [{ count: txCount }, { count: orderCount }, { count: walletCount }] =
    await Promise.all([
      admin.from("wallet_transactions").select("*", { count: "exact", head: true }),
      admin.from("orders").select("*", { count: "exact", head: true }),
      admin.from("wallets").select("*", { count: "exact", head: true }),
    ]);

  const {
    data: { users: authUsers },
    error: listErr,
  } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (listErr) throw listErr;

  console.log("Current state:");
  console.log(`  wallet_transactions: ${txCount ?? "?"} rows`);
  console.log(`  orders:              ${orderCount ?? "?"} rows`);
  console.log(`  wallets:             ${walletCount ?? "?"} rows`);
  console.log(`  auth users:          ${authUsers.length}`);
  authUsers.forEach((u) => console.log(`    - ${u.email} (${u.id})`));

  if (dryRun) {
    console.log("\nDry run only — nothing deleted. Re-run with --yes to actually clear this.");
    return;
  }

  console.log("\nDeleting, in dependency-safe order...");

  // wallet_transactions references orders and users — delete first.
  const { error: txErr } = await admin
    .from("wallet_transactions")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (txErr) throw txErr;
  console.log("  wallet_transactions cleared");

  // orders references users — delete next.
  const { error: orderErr } = await admin
    .from("orders")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (orderErr) throw orderErr;
  console.log("  orders cleared");

  // wallets references users — delete next.
  const { error: walletErr } = await admin
    .from("wallets")
    .delete()
    .neq("user_id", "00000000-0000-0000-0000-000000000000");
  if (walletErr) throw walletErr;
  console.log("  wallets cleared");

  // public.users profile rows, then auth.users via the Admin API (this also
  // removes the Supabase Auth identity, not just the profile row). Delete
  // the profile row explicitly first in case there's no FK cascade set up
  // from auth.users -> public.users.
  const { error: profileErr } = await admin
    .from("users")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (profileErr) throw profileErr;
  console.log("  public.users profile rows cleared");

  for (const u of authUsers) {
    const { error: delErr } = await admin.auth.admin.deleteUser(u.id);
    if (delErr) {
      console.error(`  failed to delete auth user ${u.email} (${u.id}):`, delErr.message);
    } else {
      console.log(`  deleted auth user ${u.email}`);
    }
  }

  console.log(
    "\nDone. Catalog tables (services, countries, pricing_rules, fx_rates) and " +
      "admin_audit_log were left untouched — only transactional/test-account data was cleared.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
