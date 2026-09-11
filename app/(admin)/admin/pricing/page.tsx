import { createAdminClient } from "@/lib/supabase/admin";
import { RuleForm } from "./rule-form";
import { RulesTable } from "./rules-table";

export default async function AdminPricingPage() {
  const admin = createAdminClient();

  const [{ data: rules }, { data: services }, { data: countries }] = await Promise.all([
    admin.from("pricing_rules").select("*"),
    admin.from("services").select("id, name").eq("is_active", true).order("name"),
    admin.from("countries").select("id, name").eq("is_active", true).order("name"),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">Pricing rules</h1>
        <p className="text-sm text-text-dim">
          Resolved most-specific first: service + country, then service, then country, then global.
        </p>
      </div>

      <RuleForm services={services ?? []} countries={countries ?? []} />
      <RulesTable rules={rules ?? []} services={services ?? []} countries={countries ?? []} />
    </div>
  );
}
