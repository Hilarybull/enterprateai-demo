import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "../../api/client";

const field = "rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800";

function dateLabel(value) {
  if (!value) return "No expiry";
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function discountLabel(item) {
  const value = item.percent_off != null
    ? `${item.percent_off}% off`
    : item.amount_off != null
      ? `${item.currency ? `${item.currency.toUpperCase()} ` : ""}${(item.amount_off / 100).toFixed(2)} off`
      : "Discount";
  const term = item.duration === "forever"
    ? "forever"
    : item.duration === "once"
      ? "once"
      : `for ${item.duration_in_months || 1} month${item.duration_in_months === 1 ? "" : "s"}`;
  return `${value} ${term}`;
}

export default function DiscountsAdmin() {
  const [items, setItems] = useState([]);
  const [livemode, setLivemode] = useState(null);
  const [partial, setPartial] = useState(false);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", code: "", percent_off: "10", duration: "repeating", duration_in_months: "6", max_redemptions: "", redeem_by: "" });

  const load = useCallback(async () => {
    setLoading(true);
    setProblem("");
    try {
      const result = await apiRequest("/admin/discounts", "GET");
      setItems(result.items || []);
      setLivemode(Boolean(result.livemode));
      setPartial(Boolean(result.partial));
    } catch (error) {
      setProblem(error.message || "Discounts couldn't be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function update(key) {
    return (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  }

  async function create(event) {
    event.preventDefault();
    setBusy(true);
    setProblem("");
    setNotice("");
    try {
      const created = await apiRequest("/admin/discounts", "POST", {
        name: form.name.trim() || form.code.trim(),
        code: form.code.trim(),
        percent_off: Number(form.percent_off),
        duration: form.duration,
        duration_in_months: form.duration === "repeating" ? Number(form.duration_in_months) : null,
        max_redemptions: form.max_redemptions ? Number(form.max_redemptions) : null,
        redeem_by: form.redeem_by || null,
      });
      setItems((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      setLivemode(Boolean(created.livemode));
      setNotice(`Discount code ${created.code} is ready for checkout.`);
      setForm({ name: "", code: "", percent_off: "10", duration: "repeating", duration_in_months: "6", max_redemptions: "", redeem_by: "" });
    } catch (error) {
      setProblem(error.message || "Discount couldn't be created.");
    } finally {
      setBusy(false);
    }
  }

  async function deactivate(item) {
    setBusy(true);
    setProblem("");
    setNotice("");
    try {
      const updated = await apiRequest(`/admin/discounts/${encodeURIComponent(item.id)}`, "PATCH", { active: false });
      setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, ...updated } : entry));
      setNotice(`${item.code} has been deactivated.`);
    } catch (error) {
      setProblem(error.message || "Discount couldn't be deactivated.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <form onSubmit={create} className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">Create a pricing discount</h2>
        <p className="mt-1 text-xs text-slate-500">Customers enter the code during checkout. New codes apply to configured paid plans only, for the first stated number of subscription months.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="grid gap-1 text-xs font-medium text-slate-600">Offer name<input className={field} value={form.name} onChange={update("name")} placeholder="London growth offer" maxLength={80} /></label>
          <label className="grid gap-1 text-xs font-medium text-slate-600">Customer code<input className={field} value={form.code} onChange={update("code")} placeholder="GrowLondon" minLength={3} maxLength={50} pattern="[A-Za-z0-9]+" required /></label>
          <label className="grid gap-1 text-xs font-medium text-slate-600">Discount (%)<input className={field} type="number" min="0.01" max="100" step="0.01" value={form.percent_off} onChange={update("percent_off")} required /></label>
          <label className="grid gap-1 text-xs font-medium text-slate-600">Discount duration<select className={field} value={form.duration} onChange={update("duration")}><option value="once">One invoice</option><option value="repeating">Repeat for a set number of months</option><option value="forever">For the life of the subscription</option></select></label>
          {form.duration === "repeating" && <label className="grid gap-1 text-xs font-medium text-slate-600">Duration (months)<input className={field} type="number" min="1" max="36" step="1" value={form.duration_in_months} onChange={update("duration_in_months")} required /></label>}
          <label className="grid gap-1 text-xs font-medium text-slate-600">Maximum redemptions <span className="font-normal text-slate-400">(optional)</span><input className={field} type="number" min="1" step="1" value={form.max_redemptions} onChange={update("max_redemptions")} placeholder="No limit" /></label>
          <label className="grid gap-1 text-xs font-medium text-slate-600">Last day to redeem <span className="font-normal text-slate-400">(optional)</span><input className={field} type="date" value={form.redeem_by} onChange={update("redeem_by")} /></label>
        </div>
        {problem && <p role="alert" className="mt-3 text-sm text-rose-600">{problem}</p>}
        {notice && <p role="status" className="mt-3 text-sm text-emerald-700">{notice}</p>}
        <button disabled={busy} className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : "Create discount"}</button>
      </form>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="mb-3 flex items-center justify-between gap-3"><div><h2 className="text-sm font-semibold text-slate-900">Discount codes {livemode !== null && <span className={`ml-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${livemode ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{livemode ? "Live" : "Test"}</span>}</h2><p className="mt-1 text-xs text-slate-500">Codes are created in the payment account connected to this environment.{partial ? " Showing the most recent 2,000 codes." : ""}</p></div><button type="button" onClick={load} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700">Refresh</button></div>
        {loading ? <p role="status" className="py-6 text-center text-sm text-slate-400">Loading discount codes…</p> : items.length === 0 ? <p className="py-6 text-center text-sm text-slate-400">No discount codes found.</p> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="text-xs uppercase tracking-wide text-slate-400"><tr>{["Code", "Offer", "Discount", "Redemptions", "Redeem by", "Status", ""].map((heading) => <th key={heading} className="px-2 py-2 font-semibold">{heading}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{items.map((item) => <tr key={item.id}><td className="px-2 py-3 font-semibold text-slate-900">{item.code}</td><td className="px-2 py-3 text-slate-600">{item.name || item.coupon_name || "—"}</td><td className="px-2 py-3 text-slate-600">{discountLabel(item)}</td><td className="px-2 py-3 text-slate-600">{item.times_redeemed ?? 0}{item.max_redemptions ? ` / ${item.max_redemptions}` : ""}</td><td className="px-2 py-3 text-slate-600">{dateLabel(item.expires_at || item.redeem_by)}</td><td className="px-2 py-3"><span className={`rounded-full px-2 py-1 text-xs font-medium ${item.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{item.active ? "Active" : "Inactive"}</span></td><td className="px-2 py-3 text-right">{item.active && <button type="button" disabled={busy} onClick={() => deactivate(item)} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-50">Deactivate</button>}</td></tr>)}</tbody></table></div>
        )}
      </section>
    </div>
  );
}
