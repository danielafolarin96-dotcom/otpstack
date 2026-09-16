"use client";

import { useActionState, useState } from "react";
import { createPricingRule } from "./actions";

// text-base below sm:, not text-sm alone: iOS Safari auto-zooms the page
// on focus of any input under 16px computed font-size.
const inputClass =
  "w-full rounded-[10px] border border-line bg-paper px-3.5 py-2.5 text-base text-text focus:border-signal focus:outline-none focus:ring-1 focus:ring-signal sm:text-sm";

interface Option {
  id: string;
  name: string;
}

export function RuleForm({ services, countries }: { services: Option[]; countries: Option[] }) {
  const [state, formAction, isPending] = useActionState(createPricingRule, {});
  const [scope, setScope] = useState("global");
  const [markupType, setMarkupType] = useState("percent");

  const needsService = scope === "service" || scope === "service_country";
  const needsCountry = scope === "country" || scope === "service_country";

  return (
    <form
      action={formAction}
      className="flex flex-col gap-4 rounded-[14px] border border-line bg-paper-raised p-6"
    >
      <p className="font-display text-lg font-semibold text-ink">New pricing rule</p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="scope" className="text-sm font-medium text-text">
            Scope
          </label>
          <select
            id="scope"
            name="scope"
            className={inputClass}
            value={scope}
            onChange={(e) => setScope(e.target.value)}
          >
            <option value="global">Global</option>
            <option value="service">Service</option>
            <option value="country">Country</option>
            <option value="service_country">Service + Country</option>
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="markup_type" className="text-sm font-medium text-text">
            Markup type
          </label>
          <select
            id="markup_type"
            name="markup_type"
            className={inputClass}
            value={markupType}
            onChange={(e) => setMarkupType(e.target.value)}
          >
            <option value="percent">Percent</option>
            <option value="flat_kobo">Flat (₦)</option>
            <option value="tiered">Tiered</option>
          </select>
        </div>

        {needsService && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="service_id" className="text-sm font-medium text-text">
              Service
            </label>
            <select id="service_id" name="service_id" className={inputClass} required>
              <option value="">Select a service…</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {needsCountry && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="country_id" className="text-sm font-medium text-text">
              Country
            </label>
            <select id="country_id" name="country_id" className={inputClass} required>
              <option value="">Select a country…</option>
              {countries.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {markupType === "percent" && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="markup_value_percent" className="text-sm font-medium text-text">
              Markup %
            </label>
            <input
              id="markup_value_percent"
              name="markup_value_percent"
              type="number"
              step="0.01"
              required
              className={inputClass}
            />
          </div>
        )}

        {markupType === "flat_kobo" && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="markup_value_naira" className="text-sm font-medium text-text">
              Flat markup (₦)
            </label>
            <input
              id="markup_value_naira"
              name="markup_value_naira"
              type="number"
              step="0.01"
              required
              className={inputClass}
            />
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="min_margin_pct" className="text-sm font-medium text-text">
            Minimum margin %
          </label>
          <input
            id="min_margin_pct"
            name="min_margin_pct"
            type="number"
            step="0.01"
            defaultValue={30}
            required
            className={inputClass}
          />
        </div>
      </div>

      {markupType === "tiered" && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="markup_value_json" className="text-sm font-medium text-text">
            Tiers (JSON array, ascending by max_cost_kobo)
          </label>
          <textarea
            id="markup_value_json"
            name="markup_value_json"
            rows={3}
            required
            placeholder='[{"max_cost_kobo": 50000, "markup_pct": 200}, {"max_cost_kobo": 500000, "markup_pct": 140}]'
            className={`${inputClass} font-technical`}
          />
        </div>
      )}

      {state.error && <p className="text-sm text-danger">{state.error}</p>}

      <button
        type="submit"
        disabled={isPending}
        className="self-start rounded-[10px] bg-signal px-4 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-signal-bright disabled:opacity-60"
      >
        {isPending ? "Saving…" : "Create rule"}
      </button>
    </form>
  );
}
