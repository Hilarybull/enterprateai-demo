export function monthlyEmployeePay(employee) {
  if (employee?.salary_amount == null || employee.salary_amount === "") return null;
  const multiplier = {annual:1/12,weekly:52/12,monthly:1}[employee.salary_frequency || "monthly"];
  if (multiplier == null) return null;
  const gross = Number(employee.salary_amount), benefits = Number(employee.benefits_monthly || 0);
  if (!Number.isFinite(gross) || gross < 0 || !Number.isFinite(benefits) || benefits < 0) return null;
  return Math.round((gross * multiplier + benefits) * 100) / 100;
}
