import { useExit } from "../../lib/motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { agentErrorMessage, approveAction, editDraft, getRun, rejectAction } from "../../lib/agent";
import { formatCurrency } from "../../lib/format";
import { ButtonSpinner, LoadError, SkeletonRegion, SkeletonTable, SkeletonText } from "../Skeleton";
import { ApprovalReview, Icon } from "./AgentBits";

// Editing a document that is waiting for approval. The editor has the same layout as the
// document it replaces (recipient, sent to, reference, items, totals, valid until, payment
// terms), with fields where the values were. Saving cancels the approval that was waiting
// and asks again for the new version.

const input = "w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";
const VAT_RATES = [0, 5, 20];
const TERMS = [7, 14, 30];
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const num = (v) => (v === "" || v == null ? NaN : Number(v));
const same = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

/** "£" for GBP, "$" for USD…: what the app's own money format puts in front of a figure. */
export const signOf = (currency) => formatCurrency(0, currency || "GBP").replace(/[\d.,\s-]/g, "") || "£";

/** A money field with its currency sign shown inside, on the left. */
function Money({ sign, className = "", ...props }) {
  return (
    <span className="relative block">
      <span data-currency aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-slate-400">{sign}</span>
      <input type="number" min="0" step="0.01" {...props} className={`${input} pl-7 text-right tabular-nums ${className}`} />
    </span>
  );
}

let rowKey = 0;
function lineFrom(item, catalogue) {
  const name = String(item?.description ?? item?.name ?? "");
  const product = catalogue.find((p) => String(p.name).trim().toLowerCase() === name.trim().toLowerCase());
  rowKey += 1;
  return { key: `row-${rowKey}`, name, product_id: product ? product.id : null, qty: item?.qty ?? item?.quantity ?? 1, price: item?.unit_price ?? "" };
}

/** What is wrong with one line, by field; empty when it is fine. */
function lineProblems(row) {
  const out = {};
  if (!String(row.name || "").trim()) out.name = "Choose an item or type a description.";
  if (!(num(row.qty) >= 1)) out.qty = "Quantity must be 1 or more.";
  if (!(num(row.price) >= 0)) out.price = "Enter a price of 0 or more.";
  return out;
}

function daysOf(terms) {
  const m = String(terms || "").match(/(\d+)/);
  return m ? Number(m[1]) : "";
}

const KIND = { send_quotation: "quotation", send_invoice: "invoice", send_contract: "contract", send_payment_reminder: "reminder", send_receipt: "receipt",
  send_proposal: "proposal", send_purchase_order: "purchase_order", send_credit_note: "credit_note" };
export const kindOf = (approval, options) => options?.document || KIND[approval?.tool_id] || "quotation";

/** The editor for whatever is waiting: items and totals for a quotation or an invoice; the
 *  scope and value of a contract; the wording of a reminder or a receipt. */
export default function DraftEditor(props) {
  const kind = kindOf(props.approval, props.options);
  return ["quotation", "invoice", "purchase_order"].includes(kind) ? <ItemsEditor {...props} kind={kind} /> : <WordingEditor {...props} kind={kind} />;
}

function EditorFooter({ saving, disabled, onCancel, summary }) {
  return (
    <div data-editor-footer className="sticky bottom-0 z-10 -mx-4 -mb-4 mt-4 flex flex-wrap items-center justify-end gap-2 rounded-b-2xl border-t border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900">
      <span className="mr-auto text-[13px] text-slate-500">{summary}</span>
      <button type="button" onClick={onCancel} disabled={saving} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300">Cancel</button>
      <button type="submit" disabled={disabled || saving} className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
        {saving && <ButtonSpinner />}{saving ? "Saving…" : "Save changes"}
      </button>
    </div>
  );
}

/** A contract (what is agreed, its value, its terms), or the wording of a reminder or a receipt. */
function WordingEditor({ approval, options, kind, saving = false, problem = "", onCancel, onSave }) {
  const p = approval?.payload || {};
  const money = (v) => formatCurrency(Number(v || 0), p.currency || "GBP");
  const startMessage = options?.wording?.message || p.message || "";
  const startAsked = p.amount_requested ?? p.outstanding ?? "";
  const startTerms = daysOf(p.payment_terms);
  const [email, setEmail] = useState(p.to_email || "");
  const [message, setMessage] = useState(startMessage);
  const [asked, setAsked] = useState(startAsked === "" ? "" : String(startAsked));
  const [scope, setScope] = useState(p.description || "");
  const [value, setValue] = useState(p.total == null ? "" : String(p.total));
  const [terms, setTerms] = useState(startTerms === "" ? "" : String(startTerms));
  const [needs, setNeeds] = useState(p.problem || "");
  const [proposes, setProposes] = useState(p.solution || "");
  const [timeline, setTimeline] = useState(p.timeline || "");
  const [validUntil, setValidUntil] = useState(String(p.valid_until || "").slice(0, 10));
  const [reason, setReason] = useState(p.reason || "");
  const [refund, setRefund] = useState(p.refund_amount ? String(p.refund_amount) : "");
  const priced = ["contract", "proposal", "credit_note"].includes(kind);      // these carry one figure that can be changed

  const emailBad = !EMAIL.test(String(email).trim());
  const askedBad = kind === "reminder" && !(num(asked) > 0 && num(asked) <= Number(p.outstanding || 0) + 0.005);
  const scopeBad = kind === "contract" && !scope.trim();
  const valueBad = priced && (!(num(value) > 0) || (kind === "credit_note" && num(value) > Number(p.invoice_total || Infinity) + 0.005));
  const termsBad = kind === "contract" && terms !== "" && !(num(terms) >= 0 && num(terms) <= 365);
  const proposesBad = kind === "proposal" && !proposes.trim();
  const reasonBad = kind === "credit_note" && !reason.trim();
  const refundBad = kind === "credit_note" && refund !== "" && !(num(refund) >= 0 && num(refund) <= num(value) + 0.005);
  const valid = !emailBad && !askedBad && !scopeBad && !valueBad && !termsBad && !proposesBad && !reasonBad && !refundBad;

  function changes() {
    const out = {};
    if (String(email).trim() !== String(p.to_email || "").trim()) out.customer_email = String(email).trim();
    if (kind === "contract") {
      if (scope.trim() !== String(p.description || "").trim()) out.description = scope.trim();
      if (!same(value, p.total)) out.total = Number(value);
      if (terms !== "" && Number(terms) !== startTerms) out.payment_terms_days = Number(terms);
    } else if (kind === "proposal") {
      if (needs.trim() !== String(p.problem || "").trim()) out.problem = needs.trim();
      if (proposes.trim() !== String(p.solution || "").trim()) out.solution = proposes.trim();
      if (!same(value, p.total)) out.total = Number(value);
      if (timeline.trim() !== String(p.timeline || "").trim()) out.timeline = timeline.trim();
      if (validUntil && validUntil !== String(p.valid_until || "").slice(0, 10)) out.valid_until = validUntil;
    } else if (kind === "credit_note") {
      if (!same(value, p.total)) out.total = Number(value);
      if (reason.trim() !== String(p.reason || "").trim()) out.reason = reason.trim();
      if (!same(refund || 0, p.refund_amount || 0)) out.refund_amount = Number(refund || 0);
    } else {
      if (message.trim() !== String(startMessage).trim()) out.message = message.trim();
      if (kind === "reminder" && !same(asked, startAsked)) out.amount_requested = Number(asked);
    }
    return out;
  }
  const dirty = Object.keys(changes()).length > 0;
  const field = "text-[11px] font-semibold uppercase tracking-wide text-slate-400";
  const bad = (text) => (text ? <p role="alert" className="mt-1 text-[11px] font-medium text-rose-600">{text}</p> : null);

  return (
    <form aria-label="Edit draft" noValidate className="rounded-2xl border border-brand-200 bg-white p-4 dark:border-brand-900/50 dark:bg-slate-900"
      onSubmit={(e) => { e.preventDefault(); if (valid && dirty && !saving) onSave(changes()); }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-bold text-slate-900 dark:text-slate-100">Editing: {approval.title}</div>
        <span className="text-[11px] text-slate-400">Version {approval.payload_version}</span>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div><span className={field}>Recipient</span><p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">{p.customer_name}</p></div>
        <label className="block"><span className={field}>Sent to</span>
          <input type="email" className={`${input} mt-1`} value={email} aria-label="Sent to" aria-invalid={emailBad} onChange={(e) => setEmail(e.target.value)} />
          {bad(emailBad ? "Enter a valid email address." : "")}
        </label>
        <div><span className={field}>{kind === "receipt" ? "Receipt" : kind === "reminder" ? "Invoice" : "Reference"}</span>
          <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">{p.receipt_number || p.reference}</p></div>
        {kind === "receipt" && <div><span className={field}>Amount received</span><p className="mt-1 text-sm text-slate-700 dark:text-slate-200">{money(p.amount)} <span className="text-[11px] text-slate-400">· what was paid can't be changed here</span></p></div>}
        {kind === "reminder" && (
          <label className="block"><span className={field}>Amount to ask for now</span>
            <span className="mt-1 block"><Money sign={signOf(p.currency)} value={asked} aria-label="Amount to ask for now" aria-invalid={askedBad} onChange={(e) => setAsked(e.target.value)} /></span>
            <p className="mt-0.5 text-[11px] text-slate-400">Outstanding {money(p.outstanding)}. The reminder always shows the full amount owed too.</p>
            {bad(askedBad ? `Enter an amount above 0, up to ${money(p.outstanding)}.` : "")}
          </label>
        )}
        {kind === "contract" && (
          <>
            <label className="block"><span className={field}>Contract value</span>
              <span className="mt-1 block"><Money sign={signOf(p.currency)} value={value} aria-label="Contract value" aria-invalid={valueBad} onChange={(e) => setValue(e.target.value)} /></span>
              {typeof p.total === "number" && num(value) > 0 && !same(value, p.total) && <p data-total-change className="mt-0.5 text-[12px] text-slate-500">was {money(p.total)} → now {money(value)}</p>}
              {bad(valueBad ? "Enter a value above 0." : "")}
            </label>
            <label className="block"><span className={field}>Payment terms (days)</span>
              <input type="number" min="0" max="365" className={`${input} mt-1 text-right`} value={terms} aria-label="Payment terms (days)" aria-invalid={termsBad} onChange={(e) => setTerms(e.target.value)} />
              {bad(termsBad ? "Between 0 and 365 days." : "")}
            </label>
          </>
        )}
        {kind === "proposal" && (
          <>
            <label className="block"><span className={field}>Price</span>
              <span className="mt-1 block"><Money sign={signOf(p.currency)} value={value} aria-label="Price" aria-invalid={valueBad} onChange={(e) => setValue(e.target.value)} /></span>
              {typeof p.total === "number" && num(value) > 0 && !same(value, p.total) && <p data-total-change className="mt-0.5 text-[12px] text-slate-500">was {money(p.total)} → now {money(value)}</p>}
              {bad(valueBad ? "Enter a price above 0." : "")}
            </label>
            <label className="block"><span className={field}>Timeline</span>
              <input className={`${input} mt-1`} aria-label="Timeline" maxLength={200} value={timeline} onChange={(e) => setTimeline(e.target.value)} />
            </label>
            <label className="block"><span className={field}>Valid until</span>
              <input type="date" className={`${input} mt-1`} aria-label="Valid until" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
            </label>
            <label className="block sm:col-span-2"><span className={field}>What the customer needs</span>
              <textarea className={`${input} mt-1 min-h-[72px]`} aria-label="What the customer needs" maxLength={4000} value={needs} onChange={(e) => setNeeds(e.target.value)} />
            </label>
            <label className="block sm:col-span-2"><span className={field}>What you propose</span>
              <textarea className={`${input} mt-1 min-h-[120px]`} aria-label="What you propose" maxLength={6000} value={proposes} aria-invalid={proposesBad} onChange={(e) => setProposes(e.target.value)} />
              {bad(proposesBad ? "Say what you propose." : "")}
            </label>
          </>
        )}
        {kind === "credit_note" && (
          <>
            <div><span className={field}>Invoice</span><p className="mt-1 text-sm text-slate-700 dark:text-slate-200">{p.invoice_reference} · {money(p.invoice_total)}</p></div>
            <label className="block"><span className={field}>Amount to credit</span>
              <span className="mt-1 block"><Money sign={signOf(p.currency)} value={value} aria-label="Amount to credit" aria-invalid={valueBad} onChange={(e) => setValue(e.target.value)} /></span>
              {typeof p.total === "number" && num(value) > 0 && !same(value, p.total) && <p data-total-change className="mt-0.5 text-[12px] text-slate-500">was {money(p.total)} → now {money(value)}</p>}
              {bad(valueBad ? `Enter an amount above 0, up to ${money(p.invoice_total)}.` : "")}
            </label>
            <label className="block"><span className={field}>Amount to refund</span>
              <span className="mt-1 block"><Money sign={signOf(p.currency)} placeholder="None" value={refund} aria-label="Amount to refund" aria-invalid={refundBad} onChange={(e) => setRefund(e.target.value)} /></span>
              {bad(refundBad ? "The refund can't be more than the credit." : "")}
            </label>
            <label className="block sm:col-span-2"><span className={field}>Reason</span>
              <input className={`${input} mt-1`} aria-label="Reason" maxLength={500} value={reason} aria-invalid={reasonBad} onChange={(e) => setReason(e.target.value)} />
              {bad(reasonBad ? "A credit note needs a reason." : "")}
            </label>
          </>
        )}
        {kind === "proposal" || kind === "credit_note" ? null : kind === "contract" ? (
          <label className="block sm:col-span-2"><span className={field}>What is agreed</span>
            <textarea className={`${input} mt-1 min-h-[120px]`} aria-label="What is agreed" maxLength={4000} value={scope} aria-invalid={scopeBad} onChange={(e) => setScope(e.target.value)} />
            {bad(scopeBad ? "Describe what is agreed." : "")}
          </label>
        ) : (
          <label className="block sm:col-span-2"><span className={field}>Your message</span>
            <textarea className={`${input} mt-1 min-h-[96px]`} aria-label="Your message" maxLength={1500} value={message} onChange={(e) => setMessage(e.target.value)}
              placeholder={kind === "reminder" ? "Add your own words to the reminder (optional)" : "Add a note to the receipt (optional)"} />
            <p className="mt-0.5 text-[11px] text-slate-400">Added to the standard {kind === "reminder" ? "reminder" : "receipt"}, above the figures.</p>
          </label>
        )}
      </div>
      {problem && <p role="alert" className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{problem}</p>}
      <EditorFooter saving={saving} disabled={!valid || !dirty} onCancel={onCancel} summary="It will need approving again" />
    </form>
  );
}

function ItemsEditor({ approval, options, kind, saving = false, problem = "", onCancel, onSave }) {
  const invoice = kind === "invoice";
  const po = kind === "purchase_order";
  const noun = po ? "purchase order" : invoice ? "invoice" : "quotation";
  const p = approval?.payload || {};
  const catalogue = useMemo(() => (options?.catalogue || []).filter((c) => c.name), [options]);
  const customers = options?.customers || [];
  const currency = p.currency || "GBP";
  const money = (v) => formatCurrency(Number(v || 0), currency);
  const startCustomer = customers.find((c) => String(c.name).trim().toLowerCase() === String(p.customer_name || "").trim().toLowerCase())?.id || "";

  const [rows, setRows] = useState(() => (p.items?.length ? p.items.map((i) => lineFrom(i, catalogue)) : [lineFrom({}, catalogue)]));
  const [customerId, setCustomerId] = useState(startCustomer);
  const [email, setEmail] = useState(p.to_email || "");
  const [notes, setNotes] = useState(p.notes || "");
  const [validUntil, setValidUntil] = useState(String(p.valid_until || "").slice(0, 10));
  const startTerms = daysOf(p.payment_terms);
  const [terms, setTerms] = useState(startTerms === "" ? "" : String(startTerms));
  const [customTerms, setCustomTerms] = useState(startTerms !== "" && !TERMS.includes(startTerms));
  const startVat = Number(p.vat_rate || 0);
  const [vat, setVat] = useState(String(startVat));
  const [customVat, setCustomVat] = useState(!VAT_RATES.includes(startVat));
  const [dueDate, setDueDate] = useState(String(p.due_date || "").slice(0, 10));
  const [deliverBy, setDeliverBy] = useState(String(p.delivery_date || "").slice(0, 10));
  const startDiscount = p.discount?.value ? { type: p.discount.type === "amount" ? "amount" : "percent", value: Number(p.discount.value) } : { type: "percent", value: 0 };
  const [discountType, setDiscountType] = useState(startDiscount.type);
  const [discountValue, setDiscountValue] = useState(startDiscount.value ? String(startDiscount.value) : "");
  const [touched, setTouched] = useState(false);
  const dragged = useRef(null);
  const listId = useRef(`catalogue-${Math.random().toString(36).slice(2)}`).current;

  const change = (fn) => { setTouched(true); fn(); };
  const update = (key, patch) => change(() => setRows((all) => all.map((r) => (r.key === key ? { ...r, ...patch } : r))));
  function nameChanged(row, value) {
    // Picking (or typing) a catalogue item fills in its price; anything else is the owner's own item.
    const product = catalogue.find((c) => String(c.name).trim().toLowerCase() === value.trim().toLowerCase());
    update(row.key, product ? { name: product.name, product_id: product.id, price: product.unit_price > 0 ? product.unit_price : row.price }
      : { name: value, product_id: null });
  }
  function move(from, to) {
    if (to < 0 || to >= rows.length || from === to) return;
    change(() => setRows((all) => { const next = [...all]; const [it] = next.splice(from, 1); next.splice(to, 0, it); return next; }));
  }

  const subtotal = rows.reduce((sum, r) => sum + (num(r.qty) > 0 && num(r.price) > 0 ? num(r.qty) * num(r.price) : 0), 0);
  const vatRate = num(vat) >= 0 ? num(vat) : 0;
  // A discount comes off before VAT: a percentage of the subtotal, or an amount (never more than the subtotal).
  const discountNumber = num(discountValue) > 0 ? num(discountValue) : 0;
  const discount = Math.round(Math.min(subtotal, discountType === "percent" ? (subtotal * discountNumber) / 100 : discountNumber) * 100) / 100;
  const net = subtotal - discount;
  const vatAmount = Math.round(net * vatRate) / 100;
  const total = Math.round((net + vatAmount) * 100) / 100;
  const discountBad = discountValue !== "" && (!(num(discountValue) >= 0) || (discountType === "percent" && num(discountValue) > 100));

  const problems = rows.map(lineProblems);
  const emailBad = !EMAIL.test(String(email).trim());
  const vatBad = !(num(vat) >= 0 && num(vat) <= 100);
  const termsBad = terms !== "" && !(num(terms) >= 0 && num(terms) <= 365);
  const totalBad = rows.length > 0 && !(total > 0);      // a line may be free; the document must still come to something
  const valid = rows.length > 0 && problems.every((x) => !Object.keys(x).length) && !emailBad && !vatBad && !termsBad && !discountBad && !totalBad;

  function changes() {
    const out = {};
    const before = (p.items || []).map((i) => [String(i.description), Number(i.qty), Number(i.unit_price)].join("|")).join("~");
    const after = rows.map((r) => [String(r.name).trim(), Number(r.qty), Number(r.price)].join("|")).join("~");
    if (before !== after) out.items = rows.map((r) => ({ product_id: r.product_id || null, name: String(r.name).trim(), quantity: Number(r.qty), unit_price: Number(r.price) }));
    if (!same(vatRate, startVat)) out.vat_rate = vatRate;
    if (!invoice && (notes || "") !== (p.notes || "")) out.notes = notes;
    if (!invoice && !po && customerId && customerId !== startCustomer) out.customer_id = customerId;
    if (po && deliverBy && deliverBy !== String(p.delivery_date || "").slice(0, 10)) out.delivery_date = deliverBy;
    if (String(email).trim() !== String(p.to_email || "").trim()) out.customer_email = String(email).trim();
    if (!invoice && !po && validUntil && validUntil !== String(p.valid_until || "").slice(0, 10)) out.valid_until = validUntil;
    if (invoice && dueDate && dueDate !== String(p.due_date || "").slice(0, 10)) out.due_date = dueDate;
    if (!po && (discountNumber !== startDiscount.value || (discountNumber > 0 && discountType !== startDiscount.type))) out.discount = { type: discountType, value: discountNumber };
    if (po && terms !== "") delete out.payment_terms_days;      // a purchase order has no payment terms of its own here
    if (terms !== "" && Number(terms) !== startTerms) out.payment_terms_days = Number(terms);
    return out;
  }
  const dirty = Object.keys(changes()).length > 0;

  const field = "text-[11px] font-semibold uppercase tracking-wide text-slate-400";
  const fieldError = (text) => (text ? <p role="alert" className="mt-1 text-[11px] font-medium text-rose-600">{text}</p> : null);

  return (
    <form aria-label="Edit draft" noValidate className="rounded-2xl border border-brand-200 bg-white p-4 dark:border-brand-900/50 dark:bg-slate-900"
      onSubmit={(e) => { e.preventDefault(); if (valid && dirty && !saving) onSave(changes()); }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-bold text-slate-900 dark:text-slate-100">Editing: {approval.title}</div>
        <span className="text-[11px] text-slate-400">Version {approval.payload_version}</span>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block"><span className={field}>Recipient</span>
          {customers.length > 0 && !invoice && !po ? (
            <select className={`${input} mt-1`} value={customerId} aria-label="Recipient"
              onChange={(e) => change(() => {
                setCustomerId(e.target.value);
                const picked = customers.find((c) => String(c.id) === e.target.value);
                if (picked?.email) setEmail(picked.email);      // "Sent to" follows the customer
              })}>
              {!startCustomer && <option value="">{p.customer_name || "Choose a customer"}</option>}
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          ) : <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">{p.customer_name}</p>}
        </label>
        <label className="block"><span className={field}>Sent to</span>
          <input type="email" className={`${input} mt-1`} value={email} aria-label="Sent to" aria-invalid={emailBad} onChange={(e) => change(() => setEmail(e.target.value))} />
          {fieldError(emailBad ? "Enter a valid email address." : "")}
        </label>
        <div><span className={field}>From</span><p className="mt-1 text-sm text-slate-700 dark:text-slate-200">{p.company}</p></div>
        <div><span className={field}>Reference</span><p className="mt-1 text-sm text-slate-700 dark:text-slate-200">{p.reference}</p></div>
      </div>

      {/* Items: a table from 640px (one row per item), stacked cards on a phone. One set of fields either way. */}
      <datalist id={listId}>{catalogue.map((c) => <option key={c.id} value={c.name} />)}</datalist>
      <div role="table" aria-label="Items" className="mt-4 rounded-xl border border-slate-200 dark:border-slate-700">
        <div role="row" className="hidden grid-cols-[1.5rem_minmax(0,1fr)_5rem_8rem_7rem_2rem] gap-2 bg-slate-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:grid dark:bg-slate-800">
          <span role="columnheader" aria-label="Order" /><span role="columnheader">Item</span><span role="columnheader" className="text-right">Qty</span>
          <span role="columnheader" className="text-right">Unit price</span><span role="columnheader" className="text-right">Amount</span><span role="columnheader" aria-label="Remove" />
        </div>
        {rows.map((r, i) => {
          const product = catalogue.find((c) => String(c.id) === String(r.product_id ?? ""));
          const source = !product ? "Your price" : same(r.price, product.unit_price) ? "Catalogue price" : "Edited";
          const bad = touched ? problems[i] : {};
          const amount = num(r.qty) > 0 && num(r.price) >= 0 ? num(r.qty) * num(r.price) : 0;
          return (
            <div key={r.key} role="row" data-line draggable onDragStart={() => { dragged.current = i; }} onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); if (dragged.current != null) move(dragged.current, i); dragged.current = null; }}
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-t border-slate-100 px-3 py-2.5 first:border-t-0 sm:grid-cols-[1.5rem_minmax(0,1fr)_5rem_8rem_7rem_2rem] sm:items-start dark:border-slate-800">
              <span role="cell" className="hidden cursor-grab select-none flex-col items-center pt-1 text-slate-300 sm:flex" title="Drag to reorder">
                <button type="button" aria-label={`Move ${r.name || "item"} up`} disabled={i === 0} onClick={() => move(i, i - 1)} className="leading-none hover:text-slate-600 disabled:opacity-30">▲</button>
                <button type="button" aria-label={`Move ${r.name || "item"} down`} disabled={i === rows.length - 1} onClick={() => move(i, i + 1)} className="leading-none hover:text-slate-600 disabled:opacity-30">▼</button>
              </span>
              <div role="cell" className="col-span-2 sm:col-span-1">
                <input className={input} list={listId} value={r.name} aria-label="Item" aria-invalid={Boolean(bad.name)} placeholder="Search your catalogue, or type another item"
                  onChange={(e) => nameChanged(r, e.target.value)} />
                {fieldError(bad.name)}
              </div>
              <div role="cell" className="flex items-center gap-2 sm:block">
                <span className="w-16 text-[12px] text-slate-500 sm:hidden">Qty</span>
                <div className="flex-1"><input className={`${input} text-right tabular-nums`} type="number" min="1" step="1" value={r.qty} aria-label="Quantity" aria-invalid={Boolean(bad.qty)}
                  onChange={(e) => update(r.key, { qty: e.target.value })} />{fieldError(bad.qty)}</div>
              </div>
              <button type="button" aria-label={`Remove ${r.name || "item"}`} onClick={() => change(() => setRows((all) => all.filter((x) => x.key !== r.key)))}
                className="row-start-1 col-start-2 flex h-8 w-8 items-center justify-center self-start rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 sm:order-last sm:col-start-6 sm:row-start-auto">
                <Icon name="x" className="h-4 w-4" />
              </button>
              <div role="cell" className="col-span-2 flex items-start gap-2 sm:col-span-1 sm:block">
                <span className="w-16 pt-2 text-[12px] text-slate-500 sm:hidden">Unit price</span>
                <div className="flex-1">
                  <Money sign={signOf(currency)} value={r.price} aria-label="Unit price" aria-invalid={Boolean(bad.price)} onChange={(e) => update(r.key, { price: e.target.value })} />
                  <p data-price-source className={`mt-0.5 text-right text-[11px] ${source === "Edited" ? "font-semibold text-amber-600" : "text-slate-400"}`}>{source}</p>
                  {fieldError(bad.price)}
                </div>
              </div>
              <div role="cell" data-amount className="col-span-2 flex items-center justify-between pt-1 text-sm tabular-nums text-slate-800 sm:col-span-1 sm:block sm:pt-2 sm:text-right dark:text-slate-200">
                <span className="text-[12px] text-slate-500 sm:hidden">{num(r.qty) || 0} × {money(num(r.price) || 0)} =</span>
                <span className="font-semibold">{money(amount)}</span>
              </div>
            </div>
          );
        })}
        {rows.length === 0 && <p role="alert" className="px-3 py-3 text-[13px] font-medium text-rose-600">Add at least one item.</p>}
      </div>
      <button type="button" onClick={() => change(() => setRows((all) => [...all, lineFrom({}, catalogue)]))} className="mt-2 text-[13px] font-semibold text-brand-600 hover:underline">+ Add item</button>

      <dl className="mt-3 space-y-1.5 text-sm" aria-label="Totals">
        <div className="flex items-center justify-between"><dt className="text-slate-500">Subtotal</dt><dd data-subtotal className="tabular-nums font-medium text-slate-900 dark:text-slate-100">{money(subtotal)}</dd></div>
        <div className={`flex items-center justify-between gap-3 ${po ? "hidden" : ""}`}>
          <dt className="flex items-center gap-2 text-slate-500">Discount
            <select className={`${input} w-auto`} aria-label="Discount type" value={discountType} onChange={(e) => change(() => setDiscountType(e.target.value))}>
              <option value="percent">%</option>
              <option value="amount">{signOf(currency)}</option>
            </select>
            {discountType === "amount"
              ? <span className="w-28"><Money sign={signOf(currency)} placeholder="None" aria-label="Discount" aria-invalid={discountBad} value={discountValue} onChange={(e) => change(() => setDiscountValue(e.target.value))} /></span>
              : <input className={`${input} w-24 text-right`} type="number" min="0" max="100" step="0.01" placeholder="None" aria-label="Discount" aria-invalid={discountBad} value={discountValue}
                  onChange={(e) => change(() => setDiscountValue(e.target.value))} />}
          </dt>
          <dd data-discount className="tabular-nums font-medium text-slate-900 dark:text-slate-100">{discount > 0 ? `-${money(discount)}` : money(0)}</dd>
        </div>
        {fieldError(discountBad ? "A discount is between 0 and 100%, or an amount of 0 or more." : "")}
        <div className="flex items-center justify-between gap-3">
          <dt className="flex items-center gap-2 text-slate-500">VAT
            <select className={`${input} w-auto`} aria-label="VAT rate" value={customVat ? "custom" : String(Number(vat))}
              onChange={(e) => change(() => { if (e.target.value === "custom") { setCustomVat(true); } else { setCustomVat(false); setVat(e.target.value); } })}>
              {VAT_RATES.map((r) => <option key={r} value={String(r)}>{r}%</option>)}
              <option value="custom">Custom</option>
            </select>
            {customVat && <input className={`${input} w-20 text-right`} type="number" min="0" max="100" step="0.1" aria-label="Custom VAT rate (%)" aria-invalid={vatBad} value={vat} onChange={(e) => change(() => setVat(e.target.value))} />}
          </dt>
          <dd data-vat className="tabular-nums font-medium text-slate-900 dark:text-slate-100">{money(vatAmount)}</dd>
        </div>
        {fieldError(vatBad ? "VAT must be between 0 and 100%." : "")}
        <div className="flex items-center justify-between border-t border-slate-200 pt-2 dark:border-slate-700">
          <dt className="font-semibold text-slate-700 dark:text-slate-200">Total</dt>
          <dd className="text-right"><span data-total className="text-base font-bold tabular-nums text-slate-900 dark:text-slate-100">{money(total)}</span>
            {typeof p.total === "number" && !same(total, p.total) && <span data-total-change className="block text-[12px] text-slate-500">was {money(p.total)} → now {money(total)}</span>}
          </dd>
        </div>
        {fieldError(totalBad ? `A line can be free, but the ${noun} must come to more than 0.` : "")}
      </dl>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {po ? (
          <label className="block"><span className={field}>Deliver by</span>
            <input type="date" className={`${input} mt-1`} aria-label="Deliver by" value={deliverBy} onChange={(e) => change(() => setDeliverBy(e.target.value))} />
          </label>
        ) : invoice ? (
          <label className="block"><span className={field}>Due date</span>
            <input type="date" className={`${input} mt-1`} aria-label="Due date" value={dueDate} onChange={(e) => change(() => setDueDate(e.target.value))} />
          </label>
        ) : (
          <label className="block"><span className={field}>Valid until</span>
            <input type="date" className={`${input} mt-1`} aria-label="Valid until" value={validUntil} onChange={(e) => change(() => setValidUntil(e.target.value))} />
          </label>
        )}
        <div className={po ? "hidden" : ""}><span className={field}>Payment terms</span>
          <div className="mt-1 flex gap-2">
            <select className={input} aria-label="Payment terms" value={customTerms ? "custom" : terms}
              onChange={(e) => change(() => { if (e.target.value === "custom") { setCustomTerms(true); } else { setCustomTerms(false); setTerms(e.target.value); } })}>
              {terms === "" && !customTerms && <option value="">Not set</option>}
              {TERMS.map((d) => <option key={d} value={String(d)}>Net {d}</option>)}
              <option value="custom">Custom</option>
            </select>
            {customTerms && <input className={`${input} w-24 text-right`} type="number" min="0" max="365" aria-label="Payment terms (days)" aria-invalid={termsBad} value={terms} onChange={(e) => change(() => setTerms(e.target.value))} />}
          </div>
          {fieldError(termsBad ? "Between 0 and 365 days." : "")}
        </div>
        {!invoice && (
          <label className="block sm:col-span-2"><span className={field}>{po ? "Notes to the supplier" : "Notes to the customer"}</span>
            <textarea className={`${input} mt-1 min-h-[72px]`} aria-label={po ? "Notes to the supplier" : "Notes to the customer"} maxLength={2000} value={notes} onChange={(e) => change(() => setNotes(e.target.value))} />
          </label>
        )}
      </div>

      {problem && <p role="alert" className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{problem}</p>}
      <EditorFooter saving={saving} disabled={!valid || !dirty} onCancel={onCancel}
        summary={<>Total <span className="font-bold tabular-nums text-slate-900 dark:text-slate-100">{money(total)}</span> · it will need approving again</>} />
    </form>
  );
}

/** Which approvals can be edited from a list: every document the Agent prepares to send. */
export const editableApproval = (item) => Boolean(KIND[item?.tool_id]);

/** A document waiting for approval, in a drawer on the right: its preview with Approve, Decline
 *  and Edit draft, and the editor in the same place. Nothing here leaves the page. */
export function DraftDrawer({ runId, onClose, onSaved, onOpenTask, startEditing = true }) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState("");
  const [busy, setBusy] = useState("");
  const [problem, setProblem] = useState("");
  const [editing, setEditing] = useState(startEditing);
  const [done, setDone] = useState("");      // what happened, once it is no longer waiting
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setFailed("");
    getRun(runId).then((res) => { if (alive) setData(res); }, (e) => { if (alive) setFailed(agentErrorMessage(e, "This document could not be loaded.")); });
    return () => { alive = false; };
  }, [runId, attempt]);

  const pending = (data?.approvals || []).find((a) => a.status === "pending");
  async function act(name, fn, after) {
    setBusy(name);
    setProblem("");
    try {
      const res = await fn();
      const fresh = await getRun(runId);
      setData(fresh);
      after?.(res, fresh);
      onSaved?.();
    } catch (e) {
      setProblem(agentErrorMessage(e, "That didn't go through. Nothing was changed; please try again."));
    } finally {
      setBusy("");
    }
  }
  const save = (changed) => act("edit", () => editDraft(runId, changed), () => setEditing(false));
  const [leaving, close] = useExit(onClose);      // the drawer slides back out when it is closed by hand
  const said = (res, fresh, fallback) => setDone(res?.message || fresh?.run?.summary || fallback);
  const button = "rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300";

  return (
    <div className={`m-backdrop fixed inset-0 z-[80] flex items-start justify-end bg-slate-950/40 ${leaving ? "m-leaving" : ""}`} onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) close(); }}>
      {/* As tall as what it holds, up to the height of the window (then it scrolls and the buttons stay in view). */}
      <aside role="dialog" aria-modal="true" aria-label={editing ? "Edit draft" : "Approval"} data-drawer
        className="m-drawer max-h-full w-full max-w-[720px] overflow-y-auto rounded-bl-2xl max-sm:h-full max-sm:rounded-none border-b border-l border-slate-200 bg-slate-50 p-4 shadow-2xl sm:p-5 dark:border-slate-800 dark:bg-slate-950">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">{editing && pending ? "Edit draft" : done ? "Done" : "Needs your approval"}</h2>
          <button type="button" onClick={close} aria-label="Close" className="text-slate-400 hover:text-slate-600"><Icon name="x" className="h-4 w-4" /></button>
        </div>
        {failed ? <LoadError what="this document" detail={failed} onRetry={() => setAttempt((n) => n + 1)} />
          : !data ? <SkeletonRegion label="this document" className="space-y-4"><SkeletonText lines={3} /><SkeletonTable rows={3} cols={4} /></SkeletonRegion>
          : !pending ? (
            <div className="space-y-3">
              <p role="status" className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                {done || data.run?.summary || "This document is no longer waiting for approval."}
              </p>
              <div className="flex justify-end gap-2">
                {onOpenTask && <button type="button" onClick={() => onOpenTask(runId)} className={button}>See details</button>}
                <button type="button" onClick={onClose} className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">Done</button>
              </div>
            </div>
          ) : editing && data.can?.edit_draft ? (
            <DraftEditor approval={pending} options={data.draft_options} saving={busy === "edit"} problem={problem}
              onCancel={() => (startEditing ? onClose() : (setEditing(false), setProblem("")))} onSave={save} />
          ) : (
            <div className="space-y-3">
              <ApprovalReview approval={pending} lastEdit={data.run?.last_edit} editedByYou={data.draft_options?.edited_by_you} />
              {problem && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{problem}</p>}
              <div data-drawer-actions className="sticky bottom-0 -mx-4 -mb-4 flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3 sm:-mx-5 sm:-mb-5 sm:px-5 dark:border-slate-800 dark:bg-slate-950">
                {onOpenTask && <button type="button" onClick={() => onOpenTask(runId)} className="mr-auto text-[13px] font-semibold text-brand-600 underline-offset-2 hover:underline">See details</button>}
                {data.can?.edit_draft && <button type="button" disabled={!!busy} onClick={() => { setProblem(""); setEditing(true); }} className={button}>Edit draft</button>}
                {data.can?.approve ? (
                  <>
                    <button type="button" disabled={!!busy} onClick={() => act("reject", () => rejectAction(runId, pending.id), (res, fresh) => said(res, fresh, "Declined. Nothing was sent."))} className={button}>
                      {busy === "reject" && <ButtonSpinner />}{busy === "reject" ? "Declining…" : "Decline"}
                    </button>
                    <button type="button" disabled={!!busy} onClick={() => act("approve", () => approveAction(runId, pending.id), (res, fresh) => said(res, fresh, "Approved and sent."))}
                      className="rounded-xl bg-brand-600 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
                      {busy === "approve" && <ButtonSpinner />}{busy === "approve" ? "Sending…" : "Approve and send"}
                    </button>
                  </>
                ) : <span className="text-[12px] text-slate-500">Only the workspace owner (or a member they have authorised) can approve this.</span>}
              </div>
            </div>
          )}
      </aside>
    </div>
  );
}
