import { deletePricingRule } from "./actions";

interface Option {
  id: string;
  name: string;
}

interface PricingRuleRow {
  id: string;
  scope: string;
  service_id: string | null;
  country_id: string | null;
  markup_type: string;
  markup_value: unknown;
  min_margin_pct: number;
  priority: number;
}

export function RulesTable({
  rules,
  services,
  countries,
}: {
  rules: PricingRuleRow[];
  services: Option[];
  countries: Option[];
}) {
  if (rules.length === 0) {
    return (
      <div className="flex min-h-[160px] flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed border-line bg-paper-raised px-6 text-center">
        <p className="font-display text-lg font-semibold text-ink">No pricing rules yet</p>
        <p className="max-w-sm text-sm text-text-dim">
          Create at least a global rule above — the engine has no fallback without one.
        </p>
      </div>
    );
  }

  const nameOf = (options: Option[], id: string | null) =>
    id ? (options.find((o) => o.id === id)?.name ?? id) : "—";

  return (
    <div className="overflow-x-auto rounded-[14px] border border-line bg-paper-raised">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line text-text-dim">
            <th className="px-4 py-3 font-medium">Scope</th>
            <th className="px-4 py-3 font-medium">Service</th>
            <th className="px-4 py-3 font-medium">Country</th>
            <th className="px-4 py-3 font-medium">Markup</th>
            <th className="px-4 py-3 font-medium">Min margin</th>
            <th className="px-4 py-3 font-medium">Priority</th>
            <th className="px-4 py-3 font-medium" />
          </tr>
        </thead>
        <tbody>
          {rules
            .slice()
            .sort((a, b) => b.priority - a.priority)
            .map((rule) => (
              <tr key={rule.id} className="border-b border-line last:border-0">
                <td className="px-4 py-3 capitalize">{rule.scope.replace("_", " + ")}</td>
                <td className="px-4 py-3">{nameOf(services, rule.service_id)}</td>
                <td className="px-4 py-3">{nameOf(countries, rule.country_id)}</td>
                <td className="px-4 py-3 font-technical text-text-dim">
                  {rule.markup_type}: {JSON.stringify(rule.markup_value)}
                </td>
                <td className="px-4 py-3 font-technical">{rule.min_margin_pct}%</td>
                <td className="px-4 py-3 font-technical">{rule.priority}</td>
                <td className="px-4 py-3">
                  <form action={deletePricingRule}>
                    <input type="hidden" name="id" value={rule.id} />
                    <button
                      type="submit"
                      className="text-sm font-medium text-danger hover:underline"
                    >
                      Delete
                    </button>
                  </form>
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
