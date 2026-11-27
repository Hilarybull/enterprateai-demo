import { isoOf, pinnedRate } from "./fx";

export function monthlyEmployeePay(employee, targetCurrency = null, rates = {}) {
  if (employee?.salary_amount == null || employee.salary_amount === "") return null;
  const multiplier = {annual:1/12,weekly:52/12,monthly:1}[employee.salary_frequency || "monthly"];
  if (multiplier == null) return null;
  const gross = Number(employee.salary_amount), benefits = Number(employee.benefits_monthly || 0);
  if (!Number.isFinite(gross) || gross < 0 || !Number.isFinite(benefits) || benefits < 0) return null;
  const from = isoOf(employee.currency) || isoOf(targetCurrency);
  const to = isoOf(targetCurrency);
  const rate = !to || from === to ? 1 : pinnedRate(employee, to) ?? Number(rates[from]);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return Math.round((gross * multiplier + benefits) * rate * 100) / 100;
}
