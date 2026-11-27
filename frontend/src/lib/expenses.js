export const EXPENSE_TYPES = [["staff_payments", "Staff payments"], ["operations", "Operations"], ["cost_of_sales", "Cost of sales / supplier bill"], ["other", "Other"]];
export function expenseType(expense) {
  if (EXPENSE_TYPES.some(([key]) => key === expense?.expense_type)) return expense.expense_type;
  const category = String(expense?.category || "").trim();
  if (/salar|wage|payroll|staff (?:cost|payment)/i.test(category)) return "staff_payments";
  return !category || /^operations?$/i.test(category) ? "operations" : "other";
}
export function expenseParty(expense, employees = []) {
  return employees.find(e => e.id === expense?.employee_id)?.name || expense?.employee_name || expense?.vendor_name || expense?.party_name || expense?.counterparty_name || "—";
}
export function expenseCategory(type, other = "") {
  return type === "staff_payments" ? "payroll" : type === "cost_of_sales" ? "cost_of_sales" : type === "other" ? other.trim() : "operations";
}
