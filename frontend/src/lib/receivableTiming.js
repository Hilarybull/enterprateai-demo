const excluded = new Set(["draft", "cancelled", "canceled", "void", "voided", "written_off", "refunded", "reversed", "chargeback"]);
export function receivableTiming(invoice, today = new Date(), windowDays = 7) {
  const status = String(invoice.status || "pending").toLowerCase();
  const total = Number(invoice.total_amount ?? invoice.amount ?? invoice.subtotal_amount ?? 0);
  const received = invoice.payments?.length ? invoice.payments.reduce((s, p) => s + Number(p.amount || 0), 0)
    : status === "paid" ? (invoice.payment_type === "partial" ? Number(invoice.paid_amount || 0) : total) : 0;
  const credited = (invoice.credit_notes || []).reduce((s, n) => s + Number(n.amount || 0), 0);
  if (invoice.archived || excluded.has(status) || total - received - credited <= 0) return null;
  const due = String(invoice.due_date || "").slice(0, 10);
  const day = today.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return "open_not_due";
  const distance = (Date.parse(due) - Date.parse(day)) / 86400000;
  return distance < 0 ? "overdue" : distance <= windowDays ? "approaching" : "open_not_due";
}
