import { useState } from "react";
import UkDateInput from "./UkDateInput";
import { formatCurrency } from "../lib/format";
import { vendorDueDate } from "../lib/supplierCosts";

export default function SupplierBillLink({ item, index, vendors, bills = [], currency, issuedAt, onChange }) {
  const [editing, setEditing] = useState(false);
  const vendor = vendors.find(v => v.id === item.vendor_id);
  const bill = bills.find(b => b.id === item.supplier_bill_id);
  const amount = Math.max(0, Number(item.qty || 1) * Number(item.cost_of_sales || 0));
  const paid = String(bill?.status || "").trim().toLowerCase() === "paid" ? amount :
    Math.max(Number(bill?.paid_amount || 0), (bill?.payments || []).reduce((sum, p) => sum + Number(p.amount || 0), 0));
  const outstanding = Math.max(0, amount - paid);
  const due = item.supplier_due_date || vendorDueDate(vendor, issuedAt);
  const dueLabel = due ? new Date(`${due.slice(0, 10)}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "Choose a due date";
  return <div className="w-full min-w-0 space-y-2 text-left">
    <div className="flex flex-col items-end gap-1">
      <button type="button" aria-expanded={editing} onClick={() => setEditing(!editing)}
        className={`min-h-11 rounded-lg border px-3 py-2 text-xs font-semibold ${item.vendor_id ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-violet-200 bg-white text-violet-700"}`}>
        {item.vendor_id ? "Supplier bill linked" : "Link supplier bill"}
      </button>
      {!item.vendor_id && <span className="text-[11px] text-slate-500">Cost estimate only</span>}
    </div>
    {editing && <div className="space-y-3 rounded-xl border border-violet-200 bg-white p-3">
      <label className="block text-xs font-medium text-slate-700">Vendor / supplier
        <select aria-label={`Supplier for line ${index + 1}`} className="ea-input mt-1" value={item.vendor_id || ""} onChange={e => {
          const next = vendors.find(v => v.id === e.target.value);
          onChange({ vendor_id: e.target.value, supplier_due_date: vendorDueDate(next, issuedAt), supplier_due_date_manual: false });
          if (next) setEditing(false);
        }}><option value="" disabled={!!item.supplier_bill_id}>Cost estimate only</option>{vendors.filter(v => !v.archived || v.id === item.vendor_id).map(v => <option key={v.id} value={v.id}>{v.name || v.vendor_name}</option>)}</select>
      </label>
      {item.vendor_id && <label className="block text-xs font-medium text-slate-700">Supplier bill due date
        <UkDateInput aria-label={`Supplier bill due date for line ${index + 1}`} value={due || ""}
          onChange={value => onChange({ supplier_due_date: value, supplier_due_date_manual: true })} className="ea-input mt-1" />
        <span className="mt-1 block font-normal text-slate-500">From vendor payment terms; change if needed.</span>
      </label>}
      <button type="button" className="min-h-11 text-xs font-semibold text-indigo-700" onClick={() => setEditing(false)}>Done</button>
    </div>}
    {item.vendor_id && <div className="space-y-2 rounded-xl border border-violet-200 bg-violet-50 p-3 text-xs text-slate-700">
      <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">Linked supplier bill</span><span className="rounded bg-white px-2 py-1">{outstanding <= 0 && amount > 0 ? "Paid" : paid > 0 ? "Part-paid" : "Unpaid"}</span></div>
      <p className="break-words">{vendor?.name || vendor?.vendor_name || bill?.vendor_name || "Supplier"}</p>
      <div className="flex justify-between gap-2"><span>Outstanding</span><strong>{formatCurrency(outstanding, currency)}</strong></div>
      <div className="flex justify-between gap-2"><span>Due date</span><span>{dueLabel}</span></div>
      <p className="border-t border-violet-200 pt-2">Scheduled cash outflow: <strong>{formatCurrency(outstanding, currency)}</strong></p>
      {!item.supplier_bill_id && <p className="text-[11px] text-slate-500">The supplier bill is created in Expenses when you save the invoice.</p>}
      {amount <= 0 && <p role="alert" className="text-rose-700">Enter a cost of sales above zero to save this supplier bill.</p>}
    </div>}
  </div>;
}
