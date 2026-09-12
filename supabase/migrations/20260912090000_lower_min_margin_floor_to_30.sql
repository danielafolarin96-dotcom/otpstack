-- Product decision: lower the enforced minimum-margin floor from 60% to
-- 30% (see ARCHITECTURE.md "Pricing engine" step 4 and CLAUDE.md's "Target
-- gross margin"). This does not change the markup formulas themselves
-- (percent/flat_kobo/tiered) — it only changes the floor enforceMinMargin()
-- falls back to when a formula's candidate price would otherwise yield
-- less than the configured margin. Concretely: any (service, country) pair
-- whose markup-formula price already cleared 30% margin but not 60% will
-- now sell at that lower, formula-driven price instead of being floored
-- up to a 60%-margin price — a real, intended price decrease for those
-- pairs. Pairs whose formula already clears 60%+ margin are unaffected.
--
-- Idempotent: safe to re-run (updates only rows not already at 30) and
-- reversible (re-run with 60 to restore the prior floor).
alter table public.pricing_rules alter column min_margin_pct set default 30;

update public.pricing_rules
set min_margin_pct = 30, updated_at = now()
where min_margin_pct <> 30;
