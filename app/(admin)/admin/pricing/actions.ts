"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPricingTierArray } from "@/lib/pricing/calculate";
import type { Json } from "@/types/database";

const PRIORITY_BY_SCOPE: Record<string, number> = {
  global: 10,
  country: 20,
  service: 30,
  service_country: 40,
};

const SCOPES = ["global", "service", "country", "service_country"] as const;
const MARKUP_TYPES = ["percent", "flat_kobo", "tiered"] as const;

export interface ActionState {
  error?: string;
}

export async function createPricingRule(
  _prevState: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin();

    const rawScope = String(formData.get("scope"));
    const rawMarkupType = String(formData.get("markup_type"));
    const serviceId = formData.get("service_id") ? String(formData.get("service_id")) : null;
    const countryId = formData.get("country_id") ? String(formData.get("country_id")) : null;
    const minMarginPct = Number(formData.get("min_margin_pct"));

    if (!SCOPES.includes(rawScope as (typeof SCOPES)[number])) {
      return { error: "Invalid scope" };
    }
    if (!MARKUP_TYPES.includes(rawMarkupType as (typeof MARKUP_TYPES)[number])) {
      return { error: "Invalid markup type" };
    }
    const scope = rawScope as (typeof SCOPES)[number];
    const markupType = rawMarkupType as (typeof MARKUP_TYPES)[number];
    if (!Number.isFinite(minMarginPct) || minMarginPct < 0 || minMarginPct >= 100) {
      return { error: "Minimum margin must be a number between 0 and 100" };
    }

    // Matches the DB check constraint (pricing_rules_scope_columns_check)
    // — validate here too so the admin gets a clear message instead of a
    // raw Postgres error.
    const needsService = scope === "service" || scope === "service_country";
    const needsCountry = scope === "country" || scope === "service_country";
    if (needsService && !serviceId) return { error: "This scope requires a service" };
    if (needsCountry && !countryId) return { error: "This scope requires a country" };
    if (!needsService && serviceId) return { error: "This scope must not have a service" };
    if (!needsCountry && countryId) return { error: "This scope must not have a country" };

    let markupValue: Json;
    if (markupType === "tiered") {
      const raw = String(formData.get("markup_value_json") ?? "");
      try {
        markupValue = JSON.parse(raw);
      } catch {
        return { error: "Tiered markup value must be valid JSON" };
      }
      if (!isPricingTierArray(markupValue)) {
        return {
          error: 'Tiered markup value must be a non-empty array of {"max_cost_kobo": number, "markup_pct": number}',
        };
      }
    } else if (markupType === "percent") {
      const pct = Number(formData.get("markup_value_percent"));
      if (!Number.isFinite(pct)) return { error: "Markup percent must be a number" };
      markupValue = pct;
    } else {
      // flat_kobo — the form collects Naira; convert to kobo for storage.
      const naira = Number(formData.get("markup_value_naira"));
      if (!Number.isFinite(naira)) return { error: "Flat markup must be a number" };
      markupValue = Math.round(naira * 100);
    }

    const admin = createAdminClient();
    const { error } = await admin.from("pricing_rules").insert({
      scope,
      service_id: serviceId,
      country_id: countryId,
      markup_type: markupType,
      markup_value: markupValue,
      min_margin_pct: minMarginPct,
      priority: PRIORITY_BY_SCOPE[scope],
    });

    if (error) return { error: error.message };

    revalidatePath("/admin/pricing");
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Something went wrong" };
  }
}

export async function deletePricingRule(formData: FormData): Promise<void> {
  await requireAdmin();

  const id = String(formData.get("id"));
  if (!id) throw new Error("Missing rule id");

  const admin = createAdminClient();
  const { error } = await admin.from("pricing_rules").delete().eq("id", id);
  if (error) throw error;

  revalidatePath("/admin/pricing");
}
