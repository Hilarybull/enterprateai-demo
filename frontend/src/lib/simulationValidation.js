export function validateSimulationInputs(params = {}, required = []) {
  const months = params.timeline_months ?? 6;
  const check = (key, value, min, max = Infinity, whole = false) => {
    const n = value == null || String(value).trim() === "" ? NaN : Number(value);
    if (!Number.isFinite(n) || n < min || n > max || (whole && !Number.isInteger(n))) {
      throw new Error(`${key.replaceAll("_", " ")}: enter ${whole ? "a whole number " : ""}${max === Infinity ? `${min} or more` : `from ${min} to ${max}`}.`);
    }
  };
  check("timeline_months", months, 3, 24, true);
  for (const key of required) {
    if (params[key] == null || String(params[key]).trim() === "") throw new Error(`${key.replaceAll("_", " ")}: enter a value before running.`);
  }
  for (const [key, value] of Object.entries(params)) {
    if (key === "timeline_months" || value == null || value === "") continue;
    if (key === "steps") value.forEach(step => validateSimulationInputs({ ...step.params, timeline_months: months }));
    else if (key === "price_change_pct") check(key, value, -50, 200);
    else if (key.endsWith("_pct")) check(key, value, 0, 100);
    else if (key === "employee_count") check(key, value, 1, 100, true);
    else if (key === "loan_term_months") check(key, value, 1, 360, true);
    else if (key.endsWith("_month") || ["delay_months", "ramp_months"].includes(key)) check(key, value, 1, Number(months), true);
    else if (key.endsWith("_months")) check(key, value, 1, 360, true);
    else if (key === "cost_classification" && !["operating", "direct"].includes(value)) throw new Error("Cost classification must be operating or direct.");
    else if (["amount", "cost", "monthly", "per_hire"].some(part => key.includes(part)) && key !== "cost_classification") check(key, value, 0);
  }
}

export function validateSimulationSettings(settings, months) {
  for (const [key, value] of Object.entries(settings || {})) {
    if (value == null || value === "" || ["tax_country", "profit_tax_regime", "payroll_in_recorded_expenses", "funding_type"].includes(key)) continue;
    const n = Number(value);
    const high = key.endsWith("_pct") ? 100 : key.endsWith("_month") ? Number(months) : Infinity;
    const low = key.endsWith("_month") || key.endsWith("_months") ? 1 : 0;
    const whole = key.endsWith("_month") || key.endsWith("_months") || key.endsWith("_count");
    if (!Number.isFinite(n) || n < low || n > high || (whole && !Number.isInteger(n))) throw new Error(`${key.replaceAll("_", " ")}: enter ${whole ? "a whole number " : ""}${high === Infinity ? `${low} or more` : `from ${low} to ${high}`}.`);
  }
}
