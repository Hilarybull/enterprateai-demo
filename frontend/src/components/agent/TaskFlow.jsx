import UkDateInput, { ukDate } from "../UkDateInput";
import { useEffect, useRef, useState } from "react";
import { agentErrorMessage, answerRun, cancelRun, fixCustomerEmail, getRun } from "../../lib/agent";
import { formatCurrency } from "../../lib/format";
import { CustomerPicker, LineItems, Modal, checkLines, linesFromText, startingLines } from "./AgentBits";
import SaidLine from "../SaidLine";

// A task started from the Agent box or the chat stays where the owner is. Its questions open in
// a dialog, one after another; what it prepares lands in Needs Approval and is confirmed in a
// line; a task still working is watched until it changes. Nothing here changes the page: the
// task's own page opens only from "See details".

export const WORKING_TEXT = "Working on it…";
const POLL_MS = 1500;
// A3: looked at every 1.5 seconds for the first 90 seconds, then every 5 seconds for 15 minutes more: a long task
// (an idea's research) is followed to its end, never left showing "Working…".
const FAST_POLLS = 60;
const MAX_POLLS = FAST_POLLS + 180;

/** "Working on it… Pricing items…": the step comes from the task while the Agent carries it on. */
export const workingText = (run) => [WORKING_TEXT, run?.step?.doing].filter(Boolean).join(" ");

const PREPARED = { send_quotation: "Quotation", send_contract: "Contract", send_invoice: "Invoice", send_receipt: "Receipt",
  send_proposal: "Proposal", send_purchase_order: "Purchase order", send_credit_note: "Credit note" };

/** "Quotation QUO-12 for £480.00 is ready. It's in Needs Approval." */
export function readyText(run, approval) {
  const p = approval?.payload || {};
  const amount = [p.total, p.amount, p.outstanding].find((v) => typeof v === "number");
  const money = typeof amount === "number" ? formatCurrency(amount, p.currency || "GBP") : "";
  if (approval?.tool_id === "send_payment_reminder") {
    const ref = p.invoice_reference || p.reference || run?.refs?.invoice_reference;
    return `Payment reminder${ref ? ` for ${ref}` : ""}${money ? ` (${money})` : ""} is ready. It's in Needs Approval.`;
  }
  const thing = PREPARED[approval?.tool_id];
  const ref = p.receipt_number || p.reference || run?.refs?.quote_reference || run?.refs?.invoice_reference;
  if (!thing) return `${run?.summary || "I've prepared it."} It's in Needs Approval.`;
  return `${[thing, ref].filter(Boolean).join(" ")}${money ? ` for ${money}` : ""} is ready. It's in Needs Approval.`;
}

/**
 * say(reply): where results go (the line under the ask box, or a chat message). A reply is
 *   { tone, text, next, runId, working }. `working` marks the "Working on it…" line.
 * onChanged(): the Agent card and Needs Approval should reload.
 * onDetails(runId): the owner pressed "See details".
 */
/** The question for a field, in words ("What is the customer email?"), when the server gave none. Never "What should I use?". */
/** Questions in their own words for the fields every document shares (QA R6), not built from the label. */
const ASKS = {
  notes: "Anything you'd like to say to the customer on it?",
  vat_rate: "What VAT rate do you charge?",
  discount: "Any discount to give?",
  valid_until: "How long should it stay valid?",      // C4: a proposal or a quotation alike, never the wrong document
  due_date: "When is payment due?",
  customer_email: "What is the customer's email address?",
  customer_name: "What is the customer's name?",
  customer_id: "Which customer is it for?",
  currency: "Which currency?",
  payment_terms_days: "How many days do they have to pay?",
  save_vat_default: "Use this VAT rate from now on?",
};

export function askFor(field) {
  if (field.question) return field.question;
  if (ASKS[field.key]) return ASKS[field.key];
  const label = String(field.label || "").trim();
  if (!label) return "What should I put here?";
  if (/\?$/.test(label)) return label;
  // C4: a label that is already a question's words ("What the customer needs", "How it was paid") is asked as it reads,
  // never put inside another question ("What is the what the customer needs?").
  if (/^(what|who|how|which|when|where|why)\b/i.test(label)) return `Tell me ${label.charAt(0).toLowerCase()}${label.slice(1)}.`;
  // "VAT rate (%)", "PO number": an acronym keeps its capitals; anything else reads naturally in the sentence.
  const thing = /^[A-Z]{2,}/.test(label) ? label : label.charAt(0).toLowerCase() + label.slice(1);
  if (field.type === "checkbox") return label;
  if (field.type === "choice" || field.type === "customer") return `Which ${thing}?`;
  if (field.type === "line_items") return `What should it include? (${thing})`;
  if (field.type === "date") return `${label}: which date?`;
  return `What is the ${thing}?`;
}

function questionDefault(field) {
  if (field.type === "checkbox") return field.default ?? false;
  if (field.type === "line_items") {
    // The catalogue's only priced offering is chosen already: one tap to confirm, not a blank row.
    const priced = (field.catalogue || []).filter((p) => p.unit_price > 0);
    const given = field.default?.length || field.suggested?.length;
    return !given && priced.length === 1
      ? [{ product_id: priced[0].id, name: "", quantity: 1, unit_price: priced[0].unit_price, other: false }] : startingLines(field);
  }
  if (field.type === "discount") return field.default ?? { type: "percent", value: "" };
  return field.default ?? "";
}

function questionSummary(field, value) {
  if (field.type === "date") return ukDate(value) || String(value ?? "");      // "10/11/2026", never "2026-11-10" (QA R7)
  if (field.type === "line_items") {
    const catalogue = field.catalogue || [];
    return (checkLines(field, value).lines || []).map((r) => {
      const name = r.name || catalogue.find((p) => String(p.id) === String(r.product_id))?.name || "Item";
      const price = Number(r.unit_price) > 0 ? Number(r.unit_price) : catalogue.find((p) => String(p.id) === String(r.product_id))?.unit_price;
      return `${r.quantity || 1} × ${name}${price > 0 ? " at " + formatCurrency(price, field.currency || undefined) : ""}`;
    }).join(", ");
  }
  if (field.type === "customer") {
    if (value === "new") return field.new_label?.replace(/^\+\s*/, "") || (/vendor|supplier/i.test(field.key) ? "New supplier" : "New customer");
    return (field.options || []).find((o) => String(o.value) === String(value))?.label || "";
  }
  if (field.type === "choice") {
    const option = (field.options || []).find((o) => String(o.value) === String(value));
    return option?.label || value || "";
  }
  if (field.type === "checkbox") return value ? "Yes" : "No";
  if (field.type === "discount") {
    if (!value || value.value === "" || value.value == null) return "";
    return value.type === "amount" ? formatCurrency(Number(value.value || 0), field.currency || "GBP") : String(value.value) + "%";
  }
  if (Array.isArray(value)) return value.join(", ");
  if (value && typeof value === "object") return value.label || value.name || value.email || "";
  return String(value ?? "");
}

function questionIsEmpty(field, value) {
  if (field.type === "checkbox") return value !== true;
  if (field.type === "discount") return !value || value.value === "" || value.value == null;
  return value === "" || value == null || (Array.isArray(value) && !value.length);
}

function questionNormalize(field, value) {
  if (field.type === "checkbox") return true;
  if (field.type === "line_items") return checkLines(field, value).lines;
  if (field.type === "discount") {
    const typed = String(value?.value ?? "").trim();
    return { type: value?.type === "amount" ? "amount" : "percent", value: /^\d+(\.\d+)?$/.test(typed) ? Number(typed) : typed };
  }
  return value;
}

/** A field shown inside another field's question ("Save as my default" with the VAT rate): never a question of its own. */
const isCompanion = (field) => Boolean(field?.companion_of);
/** Filled from the owner's own message (QA P5-1): shown once in "From what you said", not asked, unless they choose Edit. */
const isSaid = (field) => Boolean(field?.said) && field.default !== undefined && field.default !== "" && field.default !== null;
const shows = (field, values) => !field.show_if || Object.entries(field.show_if).every(([key, value]) => values[key] === value);

/**
 * How many questions a dialog will ask (E4): only those it actually shows. A field read from the message, a companion
 * shown inside another question, and a question whose condition the current answers rule out are not counted.
 */
export function questionsLeft(fields, values, answered, changingSaid = false) {
  return (fields || []).filter((field) => !isCompanion(field) && (changingSaid || !isSaid(field)) && shows(field, values)).length;
}

/** The email address in what was typed, if there is one ("email: info@asd.co.uk" gives "info@asd.co.uk"). */
export function emailIn(text) {
  const m = String(text ?? "").match(/[^\s@<>(),;:"']+@[^\s@<>(),;:"']+\.[A-Za-z]{2,}/);
  return m ? m[0].replace(/[.]+$/, "") : "";
}

export function ChatQuestionThread({ title, question, fields = [], said = null, step = null, submitLabel = "Send", submitting, onSubmit, onCancel, onDiscard = null, error = "", clearError = null, aside = null, askedBefore = 0, planned = null, onTotal = null }) {
  const [discarding, setDiscarding] = useState(false);      // "Discard this request" asked: confirm before the task is cancelled
  const [values, setValues] = useState(() => Object.fromEntries((fields || []).map((field) => [field.key, questionDefault(field)])));
  const [stage, setStage] = useState(0);
  const [issue, setIssue] = useState("");
  const [typed, setTyped] = useState("");      // items written as words, read into the lines above
  const [changingSaid, setChangingSaid] = useState(false);      // "Edit" on what was read from their message: asked like the rest

  const steps = (fields || []).filter((field) => !isCompanion(field) && (changingSaid || !isSaid(field)));
  const visible = steps.filter((field) => shows(field, values));
  const maxStage = Math.max(visible.length - 1, 0);
  const currentStage = Math.min(stage, maxStage);
  const current = visible[currentStage] || null;
  const done = visible.slice(0, currentStage);
  const note = issue || error;
  const setValue = (key, value) => {
    setIssue("");
    clearError?.();
    setValues((state) => ({ ...state, [key]: value }));
  };

  function submitCurrent(nextValue = current ? values[current.key] : null) {
    if (!current) {
      clearError?.();
      // Nothing left to ask: what was read from their message still goes with it (QA P5-1).
      const given = Object.fromEntries((fields || []).filter((field) => shows(field, values) && !questionIsEmpty(field, values[field.key]))
        .map((field) => [field.key, questionNormalize(field, values[field.key])]));
      onSubmit(given, { asked: 0 });
      return;
    }
    // An email asked for and given inside a sentence ("... email: info@asd.co.uk"): the address is what is kept.
    if (current.type === "email") nextValue = emailIn(nextValue) || nextValue;
    const draft = current ? { ...values, [current.key]: nextValue } : values;
    const empty = questionIsEmpty(current, nextValue);
    if (current.required && empty) {
      setIssue(current.type === "checkbox" ? current.label + " must be checked." : current.label + " is required.");
      return;
    }
    if (current.type === "email" && nextValue && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(nextValue).trim())) {
      setIssue("Enter a valid email address.");
      return;
    }
    if (current.type === "line_items") {
      const checked = checkLines(current, nextValue);
      if (checked.error) { setIssue(checked.error); return; }
    }
    if (current.type === "discount" && !nextValue?.value && current.required) {
      setIssue(current.label + " is required.");
      return;
    }
    setIssue("");
    clearError?.();
    // Which questions apply follows this answer: choosing to start from a quotation leaves nothing else to ask.
    const asked = steps.filter((field) => shows(field, draft));
    const applies = (fields || []).filter((field) => shows(field, draft));
    const at = asked.findIndex((field) => field.key === current.key);
    if (at < asked.length - 1) {
      setValues(draft);
      setStage(at + 1);
      return;
    }
    const out = {};
    for (const field of applies) {
      const value = draft[field.key];
      if (questionIsEmpty(field, value)) {
        if (field.required) {
          setIssue(field.type === "checkbox" ? field.label + " must be checked." : field.label + " is required.");
          return;
        }
        continue;
      }
      if (field.type === "email" && value && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(value).trim())) {
        setIssue("Enter a valid email address.");
        return;
      }
      out[field.key] = questionNormalize(field, value);
    }
    setValues(draft);
    onSubmit(out, { asked: asked.length });      // questions asked here, answered or skipped: the next dialog counts on from them
  }

  // The opening line is what the whole form is for; each field then asks its own question (never both saying the same).
  // QA E5: one question asks once. With a single field, the server's own question is that field's question (no
  // opening line saying it a second way, as "What VAT rate should this quotation use?" + "What VAT rate do you charge?" did).
  const single = visible.length === 1 && Boolean(question);
  // One question at a time: the form's opening line is shown only as a statement. A question there ("What should this
  // proposal say?") read as a second question above the field's own, with one box for both.
  const opening = question || title || "";
  const currentPrompt = single || (current && /\?\s*$/.test(opening)) ? "" : opening;
  // Counted across the whole task (QA E5, U3): fixed when the task first asks, then only ever lower as answers rule
  // questions out. Should the task need more than it said, the "of" is dropped rather than the total raised.
  const answered = new Set(visible.slice(0, currentStage).map((field) => field.key));
  const here = askedBefore + questionsLeft(fields, values, answered, changingSaid);
  const total = planned == null || here <= planned ? here : null;
  useEffect(() => { if (total != null) onTotal?.(total); }, [total]);      // eslint-disable-line react-hooks/exhaustive-deps
  const number = askedBefore + currentStage + 1;
  const stepLabel = total == null ? (number > 1 ? "Question " + String(number) : "") : total > 1 ? "Question " + String(number) + " of " + String(total) : "";
  const companions = (key) => (fields || []).filter((field) => field.companion_of === key && shows(field, values));
  // What came from their message, with what it reads as ("Mark (new)", "$300.00"): one line, shown once (QA P5-1).
  // The same list as the Agent card's form: a field with words of its own for the line (a customer's name read as
  // "Mark (new)" stands for its name field too, so that one isn't listed twice).
  // E3: when the server sends what was read from the message, every field of it is listed (the supplier and items of a
  // purchase order, a contract's price), not only those that are also on this form.
  const saidItems = Array.isArray(said) && said.length
    ? said.map((line) => ({ key: line.key, label: line.label, text: line.text }))
    : (fields || []).filter((field) => ((field.said && field.said_text) || field.said_note) && shows(field, values))
      .map((field) => ({ key: field.key, text: field.said_text || field.said_note }));
  const editSaid = (key) => {
    setChangingSaid(true);
    const at = visible.findIndex((field) => field.key === key);
    setStage(at >= 0 ? at : 0);
  };

  return (
    <form noValidate onSubmit={(e) => { e.preventDefault(); submitCurrent(); }} className="space-y-4" data-thread>
      {stepLabel && <p className="-mt-2 text-[12px] font-semibold uppercase tracking-wide text-slate-400" data-step>{stepLabel}</p>}
      <div className="space-y-3">
        {saidItems.length > 0 && <SaidLine items={saidItems} onEdit={(fields || []).some(isSaid) || (said || []).length ? editSaid : null} editing={changingSaid} />}
        {!single && (currentPrompt || !current) && (
          <div className="flex gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">EA</div>
            <div className="max-w-[calc(100%-3rem)] rounded-2xl rounded-tl-md bg-slate-50 px-3 py-2 text-[14px] leading-6 text-slate-800 dark:bg-slate-800/60 dark:text-slate-100" data-opening>
              {currentPrompt || "A few details and I'll prepare it."}
            </div>
          </div>
        )}
        {done.map((field) => {
          const value = values[field.key];
          const summary = questionSummary(field, value);
          if (!summary) return null;
          return (
            <div key={field.key} className="flex justify-end" data-answer={field.key}>
              <div className="max-w-[calc(100%-3rem)] rounded-2xl rounded-tr-md bg-brand-50 px-3 py-2 text-[13px] leading-6 text-brand-900 dark:bg-brand-900/20 dark:text-brand-100">
                <span className="block text-[11px] font-semibold uppercase tracking-wide text-brand-500 dark:text-brand-200">{field.label}</span>
                <span className="block break-words font-medium">{summary}</span>
              </div>
            </div>
          );
        })}
        {current && (
          <div className="space-y-2" data-current-step>
            <div className="flex gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">EA</div>
              <div className="max-w-[calc(100%-3rem)] rounded-2xl rounded-tl-md bg-slate-50 px-3 py-2 text-[13px] leading-6 text-slate-800 dark:bg-slate-800/60 dark:text-slate-100">
                <span className="block" data-asks>{single ? question : askFor(current)}{!current.required && current.type !== "checkbox" && <span className="ml-1 text-slate-400" data-optional>(optional)</span>}</span>
              </div>
            </div>
            {current.type === "choice" ? (
              <div className="flex flex-wrap gap-2" role="group" aria-label={current.label}>
                {(current.options || []).map((option) => (
                  <button key={option.value} type="button" disabled={submitting} onClick={() => { setValue(current.key, option.value); submitCurrent(option.value); }}
                    className={"rounded-full border px-3 py-1.5 text-[13px] font-semibold transition disabled:opacity-60 " + (String(values[current.key]) === String(option.value) ? "border-brand-500 bg-brand-50 text-brand-800" : "border-slate-200 bg-white text-slate-700 hover:border-brand-300") }>
                    {option.label}
                  </button>
                ))}
              </div>
            ) : current.type === "checkbox" ? (
              <label className="flex items-start gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-700">
                <input type="checkbox" disabled={submitting} checked={values[current.key] === true} onChange={(e) => setValue(current.key, e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-brand-600" />
                <span>{current.label}</span>
              </label>
            ) : current.type === "line_items" ? (
              <div className="space-y-2" data-line-picker>
                <LineItems field={current} value={values[current.key]} onChange={(rows) => setValue(current.key, rows)}
                  vatRate={values.vat_rate !== undefined && values.vat_rate !== "" ? values.vat_rate : current.vat_rate} discount={values.discount} currency={values.currency || current.currency} />
                <div className="flex gap-2">
                  <input disabled={submitting} aria-label="Or type the items" placeholder="Or type them: 3 x office deep clean at £150 each" value={typed} onChange={(e) => setTyped(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); const rows = linesFromText(typed, current.catalogue || []); if (rows.length) { setValue(current.key, rows); setTyped(""); } } }}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" />
                  <button type="button" disabled={submitting || !typed.trim()} data-read-items
                    onClick={() => { const rows = linesFromText(typed, current.catalogue || []); if (rows.length) { setValue(current.key, rows); setTyped(""); } else setIssue("I couldn't read an item there. Try: 3 x office deep clean at £150 each."); }}
                    className="shrink-0 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Add</button>
                </div>
              </div>
            ) : current.type === "date" ? (
              <UkDateInput disabled={submitting} aria-label={current.label} value={values[current.key] || ""} onChange={(v) => setValue(current.key, v)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" />
            ) : current.type === "customer" ? (
              <CustomerPicker field={current} value={values[current.key]} onChange={(v) => setValue(current.key, v)} />
            ) : current.type === "textarea" ? (
              <textarea disabled={submitting} aria-label={current.label} value={values[current.key] || ""} onChange={(e) => setValue(current.key, e.target.value)} rows={4}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" />
            ) : current.type === "discount" ? (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input type="text" inputMode="decimal" disabled={submitting} aria-label={current.label} value={values[current.key]?.value ?? ""} onChange={(e) => setValue(current.key, { type: values[current.key]?.type || "percent", value: e.target.value })}
                    className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" />
                  <div className="flex shrink-0 overflow-hidden rounded-xl border border-slate-200" data-discount-kind>
                    {["percent", "amount"].map((kind) => (
                      <button key={kind} type="button" disabled={submitting} onClick={() => setValue(current.key, { type: kind, value: values[current.key]?.value ?? "" })}
                        className={"px-3 py-2 text-sm font-semibold " + (values[current.key]?.type === kind ? "bg-brand-50 text-brand-800" : "bg-white text-slate-600") }>
                        {kind === "percent" ? "%" : "Amount"}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className={current.prefix ? "relative" : undefined}>
                {current.prefix && <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-slate-400">{current.prefix}</span>}
                <input disabled={submitting} aria-label={current.label} inputMode={current.type === "number" ? "decimal" : undefined} type={current.type === "email" ? "email" : current.type === "date" ? "date" : "text"} 
                  value={values[current.key] || ""} onChange={(e) => setValue(current.key, e.target.value)} className={"w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 " + (current.prefix ? "pl-7" : "")} />
                {Array.isArray(current.chips) && current.chips.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label={current.label}>
                    {current.chips.map((chip) => (
                      <button key={chip.value} type="button" disabled={submitting} onClick={() => setValue(current.key, chip.value)}
                        className={"rounded-full border px-2.5 py-1 text-[12px] font-semibold transition disabled:opacity-60 " + (String(values[current.key]) === String(chip.value) ? "border-brand-500 bg-brand-50 text-brand-800" : "border-slate-200 bg-white text-slate-600 hover:border-brand-300") }>
                        {chip.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {current.hint && <p className="text-[11px] text-slate-400">{current.hint}</p>}
            {companions(current.key).map((extra) => extra.type === "checkbox" && (
              <label key={extra.key} className="flex items-start gap-2 text-[13px] text-slate-700" data-companion={extra.key}>
                <input type="checkbox" disabled={submitting} checked={values[extra.key] === true} onChange={(e) => setValue(extra.key, e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-brand-600" />
                <span>{extra.label}{extra.hint && <span className="block text-[11px] text-slate-400">{extra.hint}</span>}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      {note && <p role={error ? "alert" : "status"} className={"rounded-xl border px-3 py-2 text-[13px] " + (error ? "border-rose-200 bg-rose-50 text-rose-700" : "border-indigo-200 bg-indigo-50 text-indigo-900")}>
        {note}
      </p>}
      {submitting && !error && <p role="status" className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-[13px] text-indigo-900">{WORKING_TEXT}</p>}

      {onDiscard && discarding && (
        <div role="group" aria-label="Discard this request?" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800" data-discard-confirm>
          <p>Discard this request? The task is cancelled and nothing is sent.</p>
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={submitting} onClick={() => onDiscard()} className="rounded-lg bg-rose-600 px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-rose-700">Yes, discard it</button>
            <button type="button" onClick={() => setDiscarding(false)} className="rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-[13px] font-semibold text-rose-800">Keep it</button>
          </div>
        </div>
      )}
      <div data-form-footer className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-2 bg-white px-1 pb-1 pt-3 dark:bg-slate-900">
        <div className="flex flex-wrap items-center gap-3">
          {aside}
          {onDiscard && !discarding && (
            <button type="button" onClick={() => setDiscarding(true)} className="text-[13px] font-semibold text-slate-500 underline-offset-2 hover:text-rose-700 hover:underline">Discard this request</button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onCancel} title="The task stays in Needs You, to finish later" data-close
            className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">Close</button>
          {current && !current.required && current.type !== "checkbox" && (
            // An optional question (a discount, a note) can be passed over: nothing is filled in for it (QA R6).
            <button type="button" disabled={submitting} data-skip onClick={() => { setValue(current.key, questionDefault({ ...current, default: undefined })); submitCurrent(questionDefault({ ...current, default: undefined })); }}
              className="rounded-xl px-3 py-2 text-sm font-semibold text-slate-500 hover:text-slate-800">Skip</button>
          )}
          {current && current.type !== "choice" && (
            <button type="submit" disabled={submitting} className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
              {submitting ? "Working…" : submitLabel}
            </button>
          )}
        </div>
      </div>
    </form>
  );
}

export function useTaskFlow({ say, onChanged, onDetails }) {
  const [open, setOpen] = useState(null);        // { kind: "question" | "problem" | "ask", run, ... }
  const answeredIn = useRef({});      // run id → questions asked in it so far (the counter runs across the task, QA E5)
  const plannedIn = useRef({});       // run id → its question total, fixed at the first question and only ever lowered (QA U3)
  const [sending, setSending] = useState(false);
  const [working, setWorking] = useState(false); // the task is running after an answer: the dialog waits with it
  const [doing, setDoing] = useState("");
  const [error, setError] = useState("");
  const [leaving, setLeaving] = useState(false);      // Cancel was pressed on a question: keep it for later, or discard it?
  const [email, setEmail] = useState("");
  const asked = useRef(0);
  const timer = useRef(null);
  const alive = useRef(true);
  const out = useRef({ say, onChanged, onDetails });
  out.current = { say, onChanged, onDetails };
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; clearTimeout(timer.current); };
  }, []);

  const tell = (reply) => out.current.say?.(reply);
  // A task that moved on (a question, a draft, done) may have just charged credits in the background: the balance
  // in the sidebar is read again each time, so it never shows the figure from before the run (QA R8).
  const changed = () => { out.current.onChanged?.(); window.dispatchEvent(new CustomEvent("ea:credits:refresh")); };
  function settle(reply) {
    setWorking(false);
    setOpen(null);
    if (reply) tell(reply);
    changed();
  }

  async function follow(run, tries = 0) {
    clearTimeout(timer.current);
    if (!alive.current) return;
    if (!run?.id) return settle(null);
    const status = run.status;
    const q = run.pending_question;
    if (status === "running" && q && !q.optional) {
      asked.current += 1;
      setWorking(false);
      setError("");
      setOpen({ kind: "question", run, n: asked.current, fromBox: true });
      tell(null);
      return changed();
    }
    if (status === "awaiting_approval") {
      let approval = null;
      try {
        approval = ((await getRun(run.id))?.approvals || []).find((a) => a.status === "pending") || null;
      } catch { /* the confirmation is still given, without the figures */ }
      if (!alive.current) return undefined;
      return settle({ tone: "emerald", text: readyText(run, approval), runId: run.id });
    }
    if (status === "succeeded") {
      return settle({ tone: "emerald", text: run.summary || "Done.", next: run.next_action || "",
        runId: run.id, links: run.outcome?.links });
    }
    if (status === "cancelled") return settle({ tone: "slate", text: run.summary || "That task was cancelled.", runId: run.id });
    if (status === "failed") {
      if (run.retrying) return settle({ tone: "amber", text: run.error || run.summary || "That didn't go through. I'll have another go shortly.", runId: run.id });
      setWorking(false);
      setError("");
      setEmail("");
      setOpen({ kind: "problem", run });
      tell(null);
      return changed();
    }
    if (run.substatus === "waiting_for_external_event") {
      // Waiting on someone else (a customer's acceptance, a payment): nothing to watch second by second.
      return settle({ tone: "indigo", text: run.next_action || run.summary || "I've started that. I'll carry on as soon as there is news.", runId: run.id });
    }
    // Still running: say so in place and look again shortly.
    if (tries >= MAX_POLLS) return settle({ tone: "indigo", text: "Still working on it. The result will appear on the Agent card.", runId: run.id });
    setWorking(true);
    setDoing(workingText(run));
    tell({ tone: "indigo", text: workingText(run), working: true, runId: run.id });
    timer.current = setTimeout(async () => {
      let next = run;
      try { next = (await getRun(run.id))?.run || run; } catch { /* look again next time */ }
      follow(next, tries + 1);
    }, tries < FAST_POLLS ? POLL_MS : 5000);
    return undefined;
  }

  /** A question already waiting (opened from its tile on the Agent card). */
  function openQuestion(question) {
    asked.current += 1;
    setError("");
    setOpen({ kind: "question", n: asked.current, run: { id: question.run_id, pending_question: question, step: question.step } });
  }

  /** Details needed before a task can start at all ("Which quotation should I invoice?"). */
  function ask({ title, message, fields, onSubmit }) {
    asked.current += 1;
    setError("");
    setOpen({ kind: "ask", n: asked.current, title, message, fields, onSubmit });
  }

  async function answer(values, meta = {}) {
    const run = open?.run;
    if (!run) return;
    const before = answeredIn.current[run.id] || 0;
    answeredIn.current[run.id] = before + (meta.asked ?? Object.keys(values || {}).length);
    setSending(true);
    setError("");
    try {
      setDoing(WORKING_TEXT);
      const res = await answerRun(run.id, values, true);      // carried on by the server; watched here step by step
      await follow(res?.run);
    } catch (e) {
      answeredIn.current[run.id] = before;      // refused: the same questions are still being asked
      setError(agentErrorMessage(e, "That answer couldn't be saved. Please give it again."));
    } finally {
      setSending(false);
    }
  }

  async function saveEmail(e) {
    e.preventDefault();
    const run = open?.run;
    if (!run) return;
    setSending(true);
    setError("");
    try {
      const res = await fixCustomerEmail(run.id, email.trim());
      await follow(res?.run);
    } catch (err) {
      setError(agentErrorMessage(err, "That address couldn't be saved. Please check it and save again."));
    } finally {
      setSending(false);
    }
  }

  function close() {
    clearTimeout(timer.current);
    const was = open;
    setWorking(false);
    setLeaving(false);
    setOpen(null);
    // Closing a question leaves the task waiting: it stays as a tile on the Agent card.
    if (was?.kind === "question" && was.fromBox) {
      tell({ tone: "amber", text: "I've kept that waiting for your answer. It's on the Agent card whenever you're ready.", runId: was.run.id });
    }
    if (was?.kind !== "ask") changed();
  }

  const details = (runId) => { close(); out.current.onDetails?.(runId); };

  /** "Discard this request": the task is cancelled, so it leaves Needs You for History. */
  async function discard() {
    const run = open?.run;
    if (!run) return;
    setSending(true);
    setError("");
    try {
      await cancelRun(run.id);
      clearTimeout(timer.current);
      setWorking(false);
      setLeaving(false);
      setOpen(null);
      if (open.fromBox) tell({ tone: "slate", text: "Discarded. Nothing was sent." });
      changed();
    } catch (e) {
      setError(agentErrorMessage(e, "That couldn't be discarded just now. Please try again."));
    } finally {
      setSending(false);
    }
  }
  const seeDetails = (runId) => (
    <button type="button" onClick={() => details(runId)} className="text-[13px] font-semibold text-brand-600 underline-offset-2 hover:underline dark:text-brand-400">See details</button>
  );

  let element = null;
  if (open?.kind === "question") {
    const q = open.run.pending_question || {};
    const fields = q.fields || [];
    const confirm = fields.some((f) => f.confirm);
    const step = open.run.step;
    element = (
      <Modal compact title={confirm ? "Is this right?" : "A few details"} onClose={close} fullPage={`/agent/runs/${open.run.id}`}>
        <ChatQuestionThread key={open.run.id + ":" + open.n} title={q.question || "A few details"} question={q.question} fields={fields} said={q.said} step={step}
          askedBefore={answeredIn.current[open.run.id] || 0} planned={plannedIn.current[open.run.id] ?? null}
          onTotal={(n) => { const was = plannedIn.current[open.run.id]; if (was == null || n < was) plannedIn.current[open.run.id] = n; }}
          submitLabel={confirm ? "Confirm" : "Send"} submitting={sending || working} onSubmit={answer} onCancel={close} onDiscard={discard} clearError={() => setError("")}
          error={error} aside={open.fromBox ? seeDetails(open.run.id) : null} />
      </Modal>
    );
  } else if (open?.kind === "ask") {
    element = (
      <Modal title={open.title || "A little more detail"} onClose={close} compact>
        <ChatQuestionThread key={"ask:" + open.n} title={open.title || "A little more detail"} question={open.message} fields={open.fields} submitting={sending}
          onSubmit={(values) => { const go = open.onSubmit; setOpen(null); go?.(values); }} onCancel={close} clearError={() => setError("")}
          error={error} submitLabel="Send" />
      </Modal>
    );
  } else if (open?.kind === "problem") {
    const run = open.run;
    const need = run.email_needed;
    element = (
      <Modal compact title={need ? `${need.customer} has no email on record${need.reference ? ` for ${need.reference}` : ""}` : "This needs you"} onClose={close}
        fullPage={`/agent/runs/${run.id}`}>
        <p className="text-sm text-slate-700 dark:text-slate-200">{run.error || run.summary || run.next_action || "This task stopped and needs a look."}</p>
        {need ? (
          <form onSubmit={saveEmail} className="mt-4 space-y-3">
            <label className="block text-[13px] font-semibold text-slate-700 dark:text-slate-300">
              Email address for {need.customer}
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
            </label>
            {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>}
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span className="mr-auto">{seeDetails(run.id)}</span>
              <button type="button" onClick={close} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300">Not now</button>
              <button type="submit" disabled={sending || working} className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
                {sending || working ? "Working…" : "Save and carry on"}
              </button>
            </div>
          </form>
        ) : (
          <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
            <span className="mr-auto">{seeDetails(run.id)}</span>
            <button type="button" onClick={close} className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">Close</button>
          </div>
        )}
      </Modal>
    );
  }
  /** A task named only by its id (a button elsewhere on the page): load it, then handle it here. */
  async function followId(runId) {
    tell({ tone: "indigo", text: WORKING_TEXT, working: true, runId });
    try {
      await follow((await getRun(runId))?.run);
    } catch (e) {
      tell({ tone: "rose", text: agentErrorMessage(e, "That task couldn't be opened. Please try again."), runId });
    }
  }

  return { follow, followId, openQuestion, ask, element, busy: sending || working };
}
