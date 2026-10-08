import { useExit } from "../../lib/motion";
import { createPortal } from "react-dom";
import { useState } from "react";
import { formatCurrency } from "../../lib/format";
import { ButtonSpinner } from "../Skeleton";

const S = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" };

export function Icon({ name, className = "h-5 w-5" }) {
  const p = { viewBox: "0 0 24 24", className, "aria-hidden": true, ...S };
  switch (name) {
    case "sparkle":
      return <svg {...p} fill="currentColor" stroke="none"><path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9L12 2zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z" /></svg>;
    case "doc":
      return <svg {...p}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></svg>;
    case "alert":
      return <svg {...p}><path d="M12 4l9 16H3z" /><path d="M12 10v4M12 17.5v.01" /></svg>;
    case "chat":
      return <svg {...p}><path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-5 4v-4H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" /></svg>;
    case "card":
      return <svg {...p}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M7 15h3" /></svg>;
    case "mail":
      return <svg {...p}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></svg>;
    case "bars":
      return <svg {...p}><path d="M6 20V10M12 20V4M18 20v-7" /></svg>;
    case "send":
      return <svg {...p}><path d="M21 3L10 14M21 3l-7 18-4-7-7-4z" /></svg>;
    case "chevron":
      return <svg {...p} strokeWidth={2.2}><path d="M9 6l6 6-6 6" /></svg>;
    case "crown":
      return <svg {...p} fill="currentColor" stroke="none"><path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" /></svg>;
    case "info":
      return <svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.5v.01" /></svg>;
    case "bulb":
      return <svg {...p}><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" /></svg>;
    case "cash":
      return <svg {...p}><path d="M4 19h16M6 16V9M10 16V5M14 16v-5M18 16V8" /><path d="M4 12l5-4 4 3 7-6" /></svg>;
    case "report":
      return <svg {...p}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 17v-3M12 17v-5M15 17v-2" /></svg>;
    case "check":
      return <svg {...p} strokeWidth={2.4}><path d="M5 12l5 5L20 7" /></svg>;
    case "clock":
      return <svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
    case "x":
      return <svg {...p} strokeWidth={2.2}><path d="M6 6l12 12M18 6L6 18" /></svg>;
    case "calendar":
      return <svg {...p}><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16" /></svg>;
    default:
      return <svg {...p}><circle cx="12" cy="12" r="9" /></svg>;
  }
}

export const KIND_ICON = { quote: "doc", contract: "doc", invoice: "doc", payment: "card", receipt: "doc", alert: "alert", action: "doc" };

const TONES = {
  emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rose: "bg-rose-50 text-rose-700 border-rose-200",
  amber: "bg-amber-50 text-amber-700 border-amber-200",
  indigo: "bg-indigo-50 text-indigo-700 border-indigo-200",
  slate: "bg-slate-100 text-slate-600 border-slate-200",
};

export function Pill({ tone = "slate", children }) {
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${TONES[tone] || TONES.slate}`}>{children}</span>;
}

const inputCls = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";

/** A line as the form holds it: a catalogue item with its price filled in, or an item typed in ("other"). */
function lineOf(row, catalogue) {
  const product = catalogue.find((p) => String(p.id) === String(row?.product_id ?? ""));
  const blank = row?.unit_price === "" || row?.unit_price == null;
  return {
    product_id: product ? product.id : null,
    name: product ? "" : (row?.name || ""),
    quantity: row?.quantity ?? 1,
    unit_price: blank && product?.unit_price > 0 ? product.unit_price : (row?.unit_price ?? ""),
    // A price with no catalogue item behind it is an item typed in: its description is asked for.
    other: !product && Boolean(row?.other || row?.name || !blank || !catalogue.length),
  };
}

/** The lines a form starts with: what the Agent suggests, else one line to fill in. */
function startingLines(field) {
  const catalogue = field.catalogue || [];
  const given = field.default?.length ? field.default : field.suggested || [];
  return given.length ? given.map((r) => lineOf(r, catalogue)) : [lineOf({}, catalogue)];
}

function LineItems({ field, value, onChange, vatRate, discount, currency }) {
  const catalogue = field.catalogue || [];
  const rows = value?.length ? value : startingLines(field);
  const update = (i, patch) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-2">
      {rows.map((r, i) => {
        const product = catalogue.find((p) => String(p.id) === String(r.product_id ?? ""));
        const typed = !product && r.other;
        return (
          <div key={i} className="grid grid-cols-12 gap-2">
            {catalogue.length > 0 && (
              <select className={`${inputCls} col-span-12 sm:col-span-5`} value={product ? String(r.product_id) : typed ? "other" : ""} aria-label="Item"
                onChange={(e) => {
                  const picked = catalogue.find((p) => String(p.id) === e.target.value);
                  // Choosing a catalogue item fills in its price, which can then be changed.
                  update(i, picked ? { product_id: picked.id, name: "", other: false, unit_price: picked.unit_price > 0 ? picked.unit_price : "" }
                    : { product_id: null, other: e.target.value === "other", unit_price: "" });
                }}>
                <option value="">Choose from your catalogue…</option>
                {catalogue.map((p) => <option key={p.id} value={String(p.id)}>{p.name}{p.unit_price > 0 ? "" : " (no price set)"}</option>)}
                <option value="other">Other item…</option>
              </select>
            )}
            {typed && (
              <input className={`${inputCls} col-span-12 ${catalogue.length ? "sm:col-span-7" : ""}`} placeholder="Item description" aria-label="Item description" value={r.name || ""} onChange={(e) => update(i, { name: e.target.value })} />
            )}
            <input className={`${inputCls} col-span-4 ${typed ? "sm:col-span-3" : "sm:col-span-2"}`} type="number" min="1" aria-label="Quantity" placeholder="Qty"
              value={r.quantity ?? 1} onChange={(e) => update(i, { quantity: e.target.value })} />
            <input className={`${inputCls} col-span-6 ${typed ? "sm:col-span-7" : "sm:col-span-4"}`} type="number" min="0" step="0.01" aria-label="Unit price"
              placeholder="Unit price" value={r.unit_price ?? ""} onChange={(e) => update(i, { unit_price: e.target.value })} />
            <button type="button" aria-label="Remove item" onClick={() => onChange(rows.length > 1 ? rows.filter((_, j) => j !== i) : [lineOf({}, catalogue)])}
              className="col-span-2 sm:col-span-1 flex items-center justify-center rounded-xl border border-slate-200 text-slate-400 hover:text-rose-600 dark:border-slate-700">
              <Icon name="x" className="h-4 w-4" />
            </button>
          </div>
        );
      })}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {catalogue.length > 0 && (
          <button type="button" onClick={() => onChange([...rows, lineOf({}, catalogue)])} className="text-[13px] font-semibold text-brand-600 hover:underline">+ Add item</button>
        )}
        <button type="button" onClick={() => onChange([...rows, lineOf({ other: true }, catalogue)])} className="text-[13px] font-semibold text-brand-600 hover:underline">+ Other item</button>
      </div>
      <p className="text-[11px] text-slate-400">Prices come from your catalogue and can be changed here. Other items need a description and a price.</p>
      <LineTotals rows={rows} vatRate={vatRate} discount={discount} currency={currency} />
    </div>
  );
}

/** Subtotal, VAT and total of the lines as they stand, updated as they are typed. */
function LineTotals({ rows, vatRate, discount, currency }) {
  const money = (v) => formatCurrency(v, currency || undefined);
  const subtotal = rows.reduce((sum, r) => sum + (Number(r.quantity) > 0 && Number(r.unit_price) > 0 ? Number(r.quantity) * Number(r.unit_price) : 0), 0);
  const rate = Number(vatRate) > 0 ? Number(vatRate) : 0;
  // A discount comes off before VAT: a percentage of the subtotal, or an amount (never more than the subtotal).
  const given = Number(discount?.value) > 0 ? Number(discount.value) : 0;
  const off = Math.round(Math.min(subtotal, discount?.type === "amount" ? given : (subtotal * given) / 100) * 100) / 100;
  const vat = Math.round((subtotal - off) * rate) / 100;
  const line = "flex items-center justify-between";
  return (
    <dl data-line-totals className="mt-1 space-y-1 rounded-xl bg-slate-50 px-3 py-2 text-[13px] dark:bg-slate-800/60">
      <div className={line}><dt className="text-slate-500">Subtotal</dt><dd data-subtotal className="tabular-nums text-slate-800 dark:text-slate-100">{money(subtotal)}</dd></div>
      {off > 0 && <div className={line}><dt className="text-slate-500">Discount</dt><dd data-discount className="tabular-nums text-slate-800 dark:text-slate-100">-{money(off)}</dd></div>}
      {rate > 0 && <div className={line}><dt className="text-slate-500">VAT ({rate}%)</dt><dd data-vat className="tabular-nums text-slate-800 dark:text-slate-100">{money(vat)}</dd></div>}
      <div className={line}><dt className="font-semibold text-slate-700 dark:text-slate-200">Total</dt><dd data-total className="font-bold tabular-nums text-slate-900 dark:text-slate-100">{money(subtotal - off + vat)}</dd></div>
    </dl>
  );
}

/** Pick a customer already on record (searchable), or choose to add a new one. */
function CustomerPicker({ field, value, onChange }) {
  const [search, setSearch] = useState("");
  const options = field.options || [];
  const term = search.trim().toLowerCase();
  const shown = term ? options.filter((o) => `${o.label} ${o.email || ""}`.toLowerCase().includes(term)) : options;
  const row = (picked) => `flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2 text-sm transition ${picked
    ? "border-brand-500 bg-brand-50 text-brand-800 dark:bg-brand-900/20 dark:text-brand-200" : "border-slate-200 text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:text-slate-300"}`;
  return (
    <div className="space-y-1.5">
      <input className={inputCls} type="search" placeholder="Search your customers" aria-label="Search your customers" value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="max-h-44 space-y-1.5 overflow-y-auto" role="radiogroup" aria-label={field.label}>
        {shown.map((o) => (
          <label key={o.value} className={row(value === o.value)}>
            <input type="radio" name={field.key} className="accent-brand-600" checked={value === o.value} onChange={() => onChange(o.value)} />
            <span className="min-w-0 flex-1 truncate">{o.label}</span>
            {o.email && <span className="hidden shrink-0 truncate text-[12px] text-slate-400 sm:inline">{o.email}</span>}
          </label>
        ))}
        {shown.length === 0 && <p className="px-1 py-1 text-[12px] text-slate-400">No customer matches “{search.trim()}”.</p>}
      </div>
      <label className={row(value === "new")}>
        <input type="radio" name={field.key} className="accent-brand-600" checked={value === "new"} onChange={() => onChange("new")} />
        {field.new_label || "+ New customer"}
      </label>
    </div>
  );
}

/** Renders the questions the Agent asks when it is missing information. It never guesses. */
export function QuestionForm({ question, fields, onSubmit, submitting, submitLabel = "Continue", onCancel, note = null, aside = null }) {
  const [values, setValues] = useState(() => Object.fromEntries((fields || []).map((f) => [f.key, f.type === "line_items" ? startingLines(f) : (f.default ?? "")])));
  const [error, setError] = useState("");
  // Fields the Agent filled from the owner's own message (`said`): shown together under "From what
  // you said" for a yes, not asked again. Optional extras step aside too, so only what is missing is asked.
  const said = (fields || []).filter((f) => f.said);
  const [changing, setChanging] = useState(false);
  const [more, setMore] = useState(false);
  // Listed there too: what was read but still needs something from the owner (an amount with no description yet, the currency).
  const noted = (fields || []).filter((f) => (f.said && f.said_text) || f.said_note);
  const brief = (said.length > 0 || noted.length > 0) && !changing;
  const set = (k) => (v) => setValues((s) => ({ ...s, [k]: v }));
  // A field may only apply after another answer (a new customer's name, once "+ New customer" is chosen).
  const applies = (f) => !f.show_if || Object.entries(f.show_if).every(([k, v]) => values[k] === v);

  function submit(e) {
    e.preventDefault();
    const asked = (fields || []).filter(applies);
    const out = {};
    for (const f of asked) {
      let v = values[f.key];
      if (f.type === "line_items") {
        const catalogue = f.catalogue || [];
        const lines = (v || []).filter((r) => r.product_id || r.other || String(r.name || "").trim());
        if (f.required && !lines.length) { setError("Choose at least one item."); return; }
        const bad = lines.find((r) => !r.product_id && (!String(r.name || "").trim() || !(Number(r.unit_price) > 0)));
        if (bad) { setError("Other items need a description and a price."); return; }
        const unpriced = lines.find((r) => r.product_id && !(Number(r.unit_price) > 0)
          && !(catalogue.find((p) => String(p.id) === String(r.product_id))?.unit_price > 0));
        if (unpriced) { setError("That catalogue item has no price set. Enter a unit price."); return; }
        v = lines.map((r) => ({ product_id: r.product_id || null, name: r.name || "", quantity: r.quantity, unit_price: r.unit_price }));
      }
      const empty = v === "" || v == null || (Array.isArray(v) && !v.length);
      const fail = (text) => { if (f.said) setChanging(true); setError(text); };      // a problem in something tucked away opens it
      if (f.required && empty) { fail(f.type === "customer" ? "Choose a customer, or add a new one." : `${f.label} is required.`); return; }
      if (f.type === "email" && v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v).trim())) { fail("Enter a valid email address."); return; }
      if (f.type === "checkbox") {
        if (v === true) out[f.key] = true;
        continue;
      }
      if (f.type === "discount") {
        if (Number(v?.value) > 0) out[f.key] = { type: v.type === "amount" ? "amount" : "percent", value: Number(v.value) };
        continue;
      }
      if (!(v === "" && !f.required)) out[f.key] = v;
    }
    setError("");
    onSubmit(out);
  }

  const extra = (f) => !f.required && !f.toggle && f.type !== "checkbox";      // an optional field that can step aside
  const shown = (fields || []).filter(applies).filter((f) => !(brief && f.said) && !(brief && !more && extra(f)));
  const tucked = brief && !more ? (fields || []).filter(applies).filter((f) => !f.said && extra(f)) : [];
  const nothingToAsk = brief && shown.every((f) => f.toggle);

  return (
    <form onSubmit={submit} className="space-y-4">
      {question && <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{question}</p>}
      {brief && (
        <div className="rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-slate-800/60" data-said>
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">From what you said</p>
            {said.length > 0 && <button type="button" onClick={() => setChanging(true)} className="text-[12px] font-semibold text-brand-700 underline-offset-2 hover:underline dark:text-brand-300">Change</button>}
          </div>
          <dl className="mt-1 space-y-0.5">
            {noted.filter(applies).map((f) => (
              <div key={f.key} className="flex gap-2 text-[13px]">
                <dt className="shrink-0 text-slate-500">{f.said_label || f.label}:</dt>
                <dd className="min-w-0 font-medium text-slate-800 dark:text-slate-100">{f.said_text || f.said_note}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {shown.map((f) => (
        <div key={f.key} className={f.type === "checkbox" ? "-mt-2" : undefined}>
          {f.type !== "checkbox" && (
            <label className="mb-1.5 block text-[13px] font-semibold text-slate-700 dark:text-slate-300">
              {f.label}{!f.required && <span className="ml-1 font-normal text-slate-400">(optional)</span>}
            </label>
          )}
          {f.type === "checkbox" ? (
            <label className="flex cursor-pointer items-center gap-2 text-[13px] font-medium text-slate-700 dark:text-slate-300">
              <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={values[f.key] === true} onChange={(e) => set(f.key)(e.target.checked)} />
              {f.label}
            </label>
          ) : f.type === "choice" ? (
            <div className="space-y-1.5">
              {f.options.map((o) => (
                <label key={o.value} className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2 text-sm transition ${values[f.key] === o.value ? "border-brand-500 bg-brand-50 text-brand-800 dark:bg-brand-900/20 dark:text-brand-200" : "border-slate-200 text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:text-slate-300"}`}>
                  <input type="radio" name={f.key} className="accent-brand-600" checked={values[f.key] === o.value} onChange={() => set(f.key)(o.value)} />
                  {o.label}
                </label>
              ))}
            </div>
          ) : f.type === "textarea" ? (
            <textarea className={`${inputCls} min-h-[120px]`} aria-label={f.label} value={values[f.key]} onChange={(e) => set(f.key)(e.target.value)} />
          ) : f.type === "discount" ? (
            <div className="flex items-center gap-2">
              <select className={`${inputCls} w-auto`} aria-label="Discount type" value={values[f.key]?.type || "percent"}
                onChange={(e) => set(f.key)({ type: e.target.value, value: values[f.key]?.value ?? "" })}>
                <option value="percent">%</option>
                <option value="amount">{formatCurrency(0).replace(/[\d.,\s-]/g, "") || "£"}</option>
              </select>
              <input className={`${inputCls} w-32`} type="number" min="0" step="0.01" placeholder="None" aria-label={f.label} value={values[f.key]?.value ?? ""}
                onChange={(e) => set(f.key)({ type: values[f.key]?.type || "percent", value: e.target.value })} />
            </div>
          ) : f.type === "customer" ? (
            <CustomerPicker field={f} value={values[f.key]} onChange={set(f.key)} />
          ) : f.type === "line_items" ? (
            <LineItems field={f} value={values[f.key]} onChange={set(f.key)} vatRate={values.vat_rate !== undefined && values.vat_rate !== "" ? values.vat_rate : f.vat_rate} discount={values.discount} currency={values.currency} />
          ) : (
            <>
              <div className={f.prefix ? "relative" : undefined}>
                {f.prefix && <span data-currency aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-slate-400">{f.prefix}</span>}
                <input className={`${inputCls} ${f.prefix ? "pl-7" : ""}`} aria-label={f.label} type={f.type === "number" ? "number" : f.type === "email" ? "email" : f.type === "date" ? "date" : "text"} step={f.type === "number" ? "0.01" : undefined}
                  min={f.type === "number" ? "0" : undefined} value={values[f.key]} onChange={(e) => set(f.key)(e.target.value)} />
              </div>
              {f.chips?.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label={`Common answers for ${f.label}`}>
                  {f.chips.map((c) => (
                    <button key={c.value} type="button" onClick={() => set(f.key)(c.value)} aria-pressed={String(values[f.key]) === String(c.value)}
                      className={`rounded-full border px-2.5 py-1 text-[12px] font-medium transition ${String(values[f.key]) === String(c.value)
                        ? "border-brand-500 bg-brand-50 text-brand-800 dark:bg-brand-900/20 dark:text-brand-200" : "border-slate-200 text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:text-slate-300"}`}>
                      {c.label}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          {f.hint && <p className="mt-1 text-[11px] text-slate-400">{f.hint}</p>}
        </div>
      ))}
      {tucked.length > 0 && (
        <button type="button" onClick={() => setMore(true)} data-more-options className="text-[13px] font-semibold text-brand-600 hover:underline">
          Add {tucked.map((f) => f.label.toLowerCase()).join(", ").replace(/, ([^,]*)$/, " or $1")}
        </button>
      )}
      {error && <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>}
      {note}
      {/* The buttons stay in view however long the form is: they sit at the foot of the scrolling area. */}
      <div data-form-footer className="sticky bottom-0 z-10 -mx-1 flex items-center justify-end gap-2 bg-white px-1 pb-1 pt-3 dark:bg-slate-900">
        {aside && <span className="mr-auto">{aside}</span>}
        {onCancel && <button type="button" onClick={onCancel} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">Cancel</button>}
        <button type="submit" disabled={submitting} className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
          {submitting && <ButtonSpinner />}{submitting ? "Working…" : nothingToAsk && submitLabel === "Continue" ? "That's right, continue" : submitLabel}
        </button>
      </div>
    </form>
  );
}

export function Modal({ title, onClose, children, compact = false }) {
  const [leaving, close] = useExit(onClose);      // closing by the cross or the backdrop plays the way in, backwards
  const sheet = (
    // A bottom sheet on a phone (full width, rising from the bottom edge); a centred dialog from 640px.
    <div className={`m-backdrop fixed inset-0 z-[1000] flex items-end justify-center bg-slate-950/40 sm:items-center sm:p-4 ${leaving ? "m-leaving" : ""}`} onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div role="dialog" aria-modal="true" aria-label={title} data-sheet className={`${compact ? "max-h-[85vh] sm:max-h-[80vh]" : "max-h-[90vh]"} w-full max-w-lg overflow-y-auto rounded-t-2xl border border-slate-200 bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl motion-safe:max-sm:animate-[ea-sheet-up_.22s_ease-out] motion-safe:sm:animate-[m-scale-in_.25s_cubic-bezier(.2,.8,.2,1)] sm:rounded-2xl sm:p-6 dark:border-slate-800 dark:bg-slate-900`}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">{title}</h2>
          <button type="button" onClick={close} aria-label="Close" className="text-slate-400 hover:text-slate-600"><Icon name="x" className="h-4 w-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
  return typeof document !== "undefined" ? createPortal(sheet, document.body) : sheet;
}

const PRICE_SOURCE = {
  catalogue: "Catalogue price",
  user_confirmed: "Price you entered",
  user_edited: "Price you entered when editing",
};

const CONSEQUENCE = {
  send_quotation: "The customer will receive this quotation by email with a link to accept or decline it.",
  send_contract: "The customer will receive this contract by email. Once sent it can't be recalled.",
  send_invoice: "The customer will receive this invoice by email and it will be marked as sent.",
  send_payment_reminder: "The customer will receive this payment reminder by email.",
  send_receipt: "The customer will receive this receipt by email.",
  send_proposal: "The customer will receive this proposal by email.",
  send_purchase_order: "The supplier will receive this purchase order by email. Once sent it is an order.",
  send_credit_note: "The customer will receive this credit note by email, and the credit is applied to the invoice.",
};

function Row({ label, value }) {
  if (value === "" || value == null) return null;
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-900 dark:text-slate-100">{value}</span>
    </div>
  );
}

/** The exact action awaiting approval: recipient, document, value, destination, terms, version and consequence (s18.4). */
export function ApprovalReview({ approval, lastEdit = null, editedByYou = false }) {
  const p = approval.payload || {};
  const cur = p.currency || "GBP";
  const money = (v) => formatCurrency(Number(v || 0), cur);
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-700 dark:bg-slate-800/40">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-bold text-slate-900 dark:text-slate-100">{approval.title}</div>
        <span data-version className={`text-[11px] ${lastEdit ? "rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" : "text-slate-400"}`}>
          Version {approval.payload_version}{lastEdit ? (editedByYou ? " · edited by you" : " · edited") : ""}
        </span>
      </div>
      {lastEdit?.changes && <p data-what-changed className="mt-2 text-[12px] text-slate-600 dark:text-slate-300"><span className="font-semibold">What changed:</span> {lastEdit.changes}</p>}
      <div className="mt-3 divide-y divide-slate-200/70 dark:divide-slate-700">
        <Row label="Recipient" value={p.customer_name} />
        <Row label="Sent to" value={p.to_email ? `${p.to_email} (email)` : null} />
        <Row label="From" value={p.company} />
        <Row label="Reference" value={p.reference || p.receipt_number} />
        {p.invoice_reference && <Row label="Invoice" value={p.invoice_reference} />}
      </div>
      {Array.isArray(p.items) && p.items.length > 0 && (
        <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          <table className="w-full text-left text-[13px]">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-800">
              <tr><th className="px-3 py-2 font-semibold">Item</th><th className="px-3 py-2 text-right font-semibold">Qty</th><th className="px-3 py-2 text-right font-semibold">Unit price</th><th className="px-3 py-2 text-right font-semibold">Amount</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {p.items.map((i, k) => (
                <tr key={k}><td className="px-3 py-2 text-slate-800 dark:text-slate-200">{i.description}
                  {PRICE_SOURCE[i.price_source] && <span className="block text-[11px] text-slate-400">{PRICE_SOURCE[i.price_source]}</span>}</td><td className="px-3 py-2 text-right tabular-nums">{i.qty}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(i.unit_price)}</td><td className="px-3 py-2 text-right tabular-nums">{money(i.qty * i.unit_price)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {p.differs_from_quote && (
        <p role="alert" className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-800">
          This invoice total ({money(p.total)}) is different from the accepted quotation{p.quote_reference ? ` ${p.quote_reference}` : ""} ({money(p.quote_total)}). Check it is what you agreed with the customer.
        </p>
      )}
      <div className="mt-3 divide-y divide-slate-200/70 dark:divide-slate-700">
        {p.subtotal != null && <Row label="Subtotal" value={money(p.subtotal)} />}
        {p.discount_amount > 0 && <Row label={p.discount_label || "Discount"} value={`-${money(p.discount_amount)}`} />}
        {p.vat_rate > 0 && <Row label={`VAT (${p.vat_rate}%)`} value={money(p.vat_amount)} />}
        {p.total != null && <Row label="Total" value={<span className="text-base font-bold">{money(p.total)}</span>} />}
        {p.amount != null && <Row label="Amount received" value={<span className="text-base font-bold">{money(p.amount)}</span>} />}
        {p.outstanding != null && <Row label="Outstanding" value={money(p.outstanding)} />}
        {p.amount_requested > 0 && <Row label="Amount asked for now" value={money(p.amount_requested)} />}
        {p.message && <Row label="Your message" value={<span className="whitespace-pre-wrap">{p.message}</span>} />}
        {p.description && !p.items && <Row label="Scope" value={p.description} />}
        {p.problem && <Row label="What the customer needs" value={<span className="whitespace-pre-wrap">{p.problem}</span>} />}
        {p.solution && <Row label="What you propose" value={<span className="whitespace-pre-wrap">{p.solution}</span>} />}
        <Row label="Timeline" value={p.timeline} />
        {p.document === "credit_note" && <Row label="Effect" value={p.full_credit ? "Credits the invoice in full" : "Taken off what is still owed"} />}
        {p.refund_amount > 0 && <Row label="Refund to send" value={money(p.refund_amount)} />}
        <Row label="Reason" value={p.reason} />
        <Row label="Term" value={p.term} />
        <Row label="Start date" value={p.start_date} />
        <Row label="Deliver by" value={p.delivery_date} />
        {p.quote_reference && !p.differs_from_quote && p.quote_total != null && <Row label="From quotation" value={`${p.quote_reference} · matches`} />}
        <Row label="Valid until" value={p.valid_until} />
        <Row label="Due date" value={p.due_date ? `${p.due_date}${p.days_overdue ? ` · ${p.days_overdue} days overdue` : ""}` : null} />
        <Row label="Payment terms" value={p.payment_terms} />
        <Row label="Payment date" value={p.paid_at} />
        {p.stage && <Row label="Reminder" value={`Reminder ${p.stage}`} />}
        <Row label="Notes" value={p.notes} />
      </div>
      <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-[12px] text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
        {CONSEQUENCE[approval.tool_id] || "This action will be carried out as shown."} If anything above changes, this approval is cancelled and you'll be asked again.
      </p>
    </div>
  );
}

export const OUT_OF_CREDITS_TIP = "Out of AI Credits · Upgrade";

/** Shown in place of starting an Agent task when there are no AI Credits left. */
export function OutOfCreditsNote({ onPlans, onClose, className = "" }) {
  return (
    <div role="status" className={`rounded-xl border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-900 ${className}`}>
      <p>You're out of AI Credits. Your records are safe. Top up or upgrade to let the Agent do this.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={onPlans} className="rounded-lg bg-amber-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-amber-700">See plans and credits</button>
        <button type="button" onClick={onClose} className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-amber-900 hover:bg-amber-100">Not now</button>
      </div>
    </div>
  );
}
