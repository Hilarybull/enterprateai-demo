import { todayLocal } from "./format";

export function vendorDueDate(vendor, issuedAt = todayLocal()) {
  const terms = String(vendor?.payment_terms ?? vendor?.payment_terms_days ?? "");
  const days = /cash|immediate|on receipt/i.test(terms) ? 0 : Number(terms.match(/\d+/)?.[0]);
  if (!Number.isFinite(days) || !terms.trim()) return "";
  const date = new Date(`${issuedAt.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
}

export function linkSupplierCosts(invoice, expenses, vendors) {
  let next = [...expenses];
  const lines = (invoice.line_items || []).map(line => {
    if (!line.vendor_id) return line;
    const vendor = vendors.find(v => v.id === line.vendor_id && !v.archived);
    if (!vendor) throw new Error("Choose an active vendor for the supplier bill.");
    const amount = Math.round((Number(line.qty) || 1) * Number(line.cost_of_sales || 0) * 100) / 100;
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter a positive cost of sales before linking a supplier bill.");
    const due = line.supplier_due_date || vendorDueDate(vendor, invoice.issued_at);
    if (!due) throw new Error("Enter the supplier bill due date or add payment terms to the vendor.");
    const id = line.supplier_bill_id || `cos-${invoice.id}-${line.id}`;
    const old = next.find(e => e.id === id);
    if (old?.status === "paid" && (Number(old.price || old.amount) !== amount || old.vendor_id !== vendor.id)) throw new Error("This supplier bill is paid. Review the bill before changing its amount or vendor.");
    const bill = {...old,id,vendor_id:vendor.id,vendor_name:vendor.name || vendor.vendor_name,
      description:line.description || "Invoice delivery cost",category:"cost_of_sales",expense_type:"cost_of_sales",
      price:amount,amount,total_amount:amount,currency:invoice.currency,date:invoice.issued_at,due_date:due,
      status:old?.status || "pending",source_invoice_id:invoice.id,source_line_id:line.id};
    next = old ? next.map(e => e.id === id ? bill : e) : [...next,bill];
    return {...line,supplier_bill_id:id,supplier_due_date:due};
  });
  return {invoice:{...invoice,line_items:lines},expenses:next};
}
