export function normalizeTextKey(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, " ")
    .trim();
}

export function dedupeText(items) {
  const arr = Array.isArray(items) ? items : [];
  const out = [];
  const seen = new Set();
  for (const raw of arr) {
    const s = String(raw || "").trim();
    if (!s) continue;
    const key = normalizeTextKey(s);
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

export function categorizeInsight(text) {
  const t = normalizeTextKey(text);
  if (!t) return "other";

  const has = (q) => t.includes(q);

  if ((has("price") || has("pricing")) && (has("variable cost") || has("unit cost") || has("cost per unit"))) return "unit_price_vs_variable";
  if (has("contribution margin") || (has("margin") && (has("price") || has("variable") || has("cost")))) return "unit_margin";
  if (has("price") && (has("packaging") || has("package") || has("value proposition") || has("value"))) return "pricing_packaging";
  if (has("assumption") || (has("realistic") && (has("price") || has("units")))) return "assumptions";
  if (has("break even") || has("break-even")) return "break_even";
  if (has("runway") || has("burn") || has("cash")) return "runway_cash";
  if (has("capacity") || has("utilization") || has("hire") || has("staff")) return "capacity";
  if (has("validate") || has("outreach") || has("pre sales") || has("presales") || has("demand")) return "demand_validation";
  if (has("reduce") && has("fixed")) return "fixed_costs";

  return "other";
}

export function buildActionPlan({ validation, ideaValidation, maxItems = 10 }) {
  const actions = [];
  const m = validation?.metrics ?? {};

  const revenue = typeof m.revenue_monthly === "number" ? m.revenue_monthly : null;
  const costs = typeof m.costs_monthly === "number" ? m.costs_monthly : null;
  const margin = typeof m.margin === "number" ? m.margin : null;
  const breakEven = typeof m.break_even_months === "number" ? m.break_even_months : null;
  const runway = typeof m.runway_months === "number" ? m.runway_months : null;
  const utilization = typeof m.capacity?.utilization === "number" ? m.capacity.utilization : null;

  const price = typeof ideaValidation?.offer?.price_per_unit === "number" ? ideaValidation.offer.price_per_unit : null;
  const variableCost = typeof ideaValidation?.costs?.variable_cost_per_unit === "number" ? ideaValidation.costs.variable_cost_per_unit : null;
  const units = typeof ideaValidation?.demand?.expected_units_per_month === "number" ? ideaValidation.demand.expected_units_per_month : null;

  if (!revenue || revenue <= 0) {
    actions.push("Fill in price per unit and expected units/month so the baseline model can compute revenue and margin.");
  }
  if (price !== null && variableCost !== null && price <= variableCost) {
    actions.push("Your price is at/below variable cost — raise price or cut variable costs so each unit is profitable.");
  }
  if (margin !== null && margin < 0.25) {
    actions.push("Improve contribution margin by adjusting price, variable costs, or deliverable scope.");
  }
  if (breakEven !== null && breakEven > 12) {
    actions.push("Reduce fixed costs or increase monthly volume to reach break-even sooner.");
  }
  if (runway !== null && runway < 6) {
    actions.push("Extend runway: reduce monthly burn, increase starting cash, or tighten payment terms.");
  }
  if (costs !== null && revenue !== null && costs > revenue) {
    actions.push("Bring recurring monthly costs below revenue to become cashflow-positive.");
  }
  if (utilization !== null && utilization > 1) {
    actions.push("Demand exceeds delivery capacity — expand capacity (team/tools) or reduce scope before scaling.");
  }
  if (units !== null && units > 0 && units < 10) {
    actions.push("Validate demand with targeted outreach and pre-sales before investing heavily.");
  }

  const recs = dedupeText(validation?.recommendations);

  const selected = [];
  const usedCats = new Set();
  const add = (s) => {
    const cat = categorizeInsight(s);
    if (usedCats.has(cat)) return;
    usedCats.add(cat);
    selected.push(s);
  };

  // Prefer our deterministic, non-repetitive templates first.
  for (const a of dedupeText(actions)) add(a);

  // Then only add recommendations that introduce a new category.
  for (const r of recs) add(r);

  return selected.slice(0, maxItems);
}

