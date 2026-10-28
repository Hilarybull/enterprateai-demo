import UkDateInput from "../UkDateInput";
import { useState } from "react";
import { getCurrencySymbol } from "../../lib/currencies";
import { TONE, dateLabel, getPath, newKey } from "../../lib/readiness";

// Small building blocks shared by the readiness screens, and the fields the guided sections
// are drawn from. The sections themselves come from the checklist profile, so a new profile
// version changes the questions without changing this file.

export const inputClass = "min-w-0 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50 disabled:text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";

export function Panel({ title, description, actions, children, className = "", id }) {
  return (
    <section id={id} className={`rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900 ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            {title && <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">{title}</h2>}
            {description && <p className="mt-0.5 text-[13px] text-slate-500 dark:text-slate-400">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** Status in words and a mark, so it never depends on colour alone. */
export function Pill({ tone = "slate", mark, children, className = "" }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[12px] font-semibold ${TONE[tone] || TONE.slate} ${className}`}>
      {/* A tick or a cross is a sign; "?" and "!" in front of a sentence read as stray punctuation, so those show a dot. */}
      {mark && (mark === "?" || mark === "!"
        ? <span aria-hidden="true" data-mark={mark} className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-70" />
        : <span aria-hidden="true">{mark}</span>)}
      {children}
    </span>
  );
}

export function Btn({ kind = "secondary", className = "", ...props }) {
  const styles = {
    primary: "bg-brand-600 text-white hover:bg-brand-700 disabled:bg-slate-300",
    secondary: "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200",
    danger: "bg-rose-600 text-white hover:bg-rose-700 disabled:bg-slate-300",
    link: "text-brand-600 underline-offset-2 hover:underline disabled:text-slate-400 !px-0 !py-0",
  };
  return <button type="button" {...props} className={`rounded-xl px-3.5 py-2 text-sm font-semibold transition disabled:cursor-not-allowed ${styles[kind]} ${className}`} />;
}

export function Notice({ tone = "slate", children, role = "status", className = "" }) {
  return <div role={role} className={`rounded-xl border p-3 text-[13px] ${TONE[tone] || TONE.slate} ${className}`}>{children}</div>;
}

function Label({ field, htmlFor, children }) {
  return (
    <label htmlFor={htmlFor} className="block">
      <span className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">{field.label}</span>
      {field.help && <span className="mt-0.5 block whitespace-normal break-words text-[12px] text-slate-500 dark:text-slate-400">{field.help}</span>}
      {children}
    </label>
  );
}

/** An amount with its currency symbol and separators ("₦ 5,000,000"); typed as digits, kept as typed while editing.
 *  Blank stays blank (unknown), never zero. */
export function MoneyInput({ value, currency, onChange, className = "", ...rest }) {
  const [typing, setTyping] = useState(null);
  const plain = value === null || value === undefined || value === "" ? "" : String(value);
  const shown = typing !== null ? typing : /^-?\d+(\.\d+)?$/.test(plain) ? Number(plain).toLocaleString("en-GB", { maximumFractionDigits: 2 }) : plain;
  const sign = currency ? getCurrencySymbol(currency) : "";
  return (
    <span className="relative block" data-money-input>
      {sign && <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 mt-0.5 -translate-y-1/2 text-[14px] text-slate-500">{sign}</span>}
      <input {...rest} type="text" inputMode="decimal" value={shown} className={`${className} ${sign ? "pl-8" : ""}`}
        onFocus={() => setTyping(plain)} onBlur={() => setTyping(null)}
        onChange={(e) => { const raw = e.target.value.replace(/(\d),(?=\d)/g, "$1").replace(/^\s+|\s+$/g, ""); setTyping(e.target.value); onChange(raw); }} />
    </span>
  );
}

function optionsOf(field, data, selfId) {
  if (field.type === "ref" || field.type === "refs") {
    return (getPath(data, field.of) || []).filter((x) => x && x.id && x.id !== selfId).map((x) => ({ value: x.id, label: x[field.show] || "Untitled" }));
  }
  return (field.options || []).map((o) => ({ value: o, label: field.labels?.[o] || (typeof o === "string" ? o.charAt(0).toUpperCase() + o.slice(1).replace(/_/g, " ") : String(o)) }));
}

function EvidencePick({ common, value, onChange, evidence, upload, label, disabled }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const pick = async (file) => {
    if (!file || !upload) return;
    setBusy(true);
    setProblem("");
    try { const made = await upload(file, label); if (made) onChange(made); }
    catch { setProblem("That file couldn't be saved. Try again."); }
    finally { setBusy(false); }
  };
  return (
    <span className="block">
      <span className="flex flex-wrap items-center gap-2">
        <select {...common} className={`${common.className} !w-auto min-w-0 flex-1`} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">No evidence attached</option>
          {(evidence || []).map((e) => <option key={e.id} value={e.id}>{e.title} ({dateLabel(e.effective_date)})</option>)}
        </select>
        {upload && !disabled && (
          <label className={`mt-1 inline-flex cursor-pointer items-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 ${busy ? "pointer-events-none opacity-60" : ""}`}>
            {busy ? "Uploading…" : "Upload a file"}
            <input type="file" className="sr-only" accept=".pdf,.png,.jpg,.jpeg,.txt,.csv,.docx,.xlsx" data-evidence-upload
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; pick(f); }} />
          </label>
        )}
      </span>
      {problem && <span role="alert" className="mt-1 block text-[12px] text-rose-700">{problem}</span>}
    </span>
  );
}

function Control({ field, id, value, onChange, disabled, data, selfId, evidence, upload = null, uploadLabel = "" }) {
  const common = { id, disabled, className: `mt-1 ${inputClass}` };
  switch (field.type) {
    case "textarea":
      return <textarea {...common} rows={3} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
    case "money":
      return <MoneyInput {...common} value={value} currency={data?.currency} onChange={onChange} />;
    case "number":
      // Text, not a number input: blank stays blank (unknown) and is never turned into zero.
      return <input {...common} type="text" inputMode="decimal" value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
    case "date":
      return <UkDateInput {...common} value={value ?? ""} onChange={(v) => onChange(v || null)} />;      // dd/mm/yyyy (QA P2-12)
    case "month":
      return <input {...common} type="month" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} />;
    case "select":
    case "ref":
      return (
        <select {...common} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">{field.type === "ref" ? "None chosen" : "Not answered"}</option>
          {optionsOf(field, data, selfId).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
    case "evidence":
      // Choose what is on record, or upload it here (the owner's QA, 23 Oct: "no evidence attached yet, no place or option
      // to attach it"): saved as evidence dated today, and chosen
      return <EvidencePick common={common} value={value} onChange={onChange} evidence={evidence} upload={upload} label={uploadLabel} disabled={disabled} />;
    case "refs": {
      const chosen = Array.isArray(value) ? value : [];
      const options = optionsOf(field, data, selfId);
      if (!options.length) return <p className="mt-1 text-[12px] text-slate-400">Nothing else to depend on yet.</p>;
      return (
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
          {options.map((o) => (
            <label key={o.value} className="inline-flex items-center gap-1.5 text-[13px] text-slate-700 dark:text-slate-200">
              <input type="checkbox" disabled={disabled} checked={chosen.includes(o.value)}
                onChange={(e) => onChange(e.target.checked ? [...chosen, o.value] : chosen.filter((v) => v !== o.value))} />
              {o.label}
            </label>
          ))}
        </div>
      );
    }
    default:
      return <input {...common} type="text" value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
  }
}

function Provenance({ entry }) {
  // Where an answer came from is said once, on its section (the owner's brief, 20 Oct); here only "Changed by you", on a
  // field you edited yourself; "From you" on one you told the Agent in chat.
  if (/^From you\b/.test(String(entry?.source || ""))) return <p className="mt-1 text-[11px] font-medium text-slate-500 dark:text-slate-400" data-from-you>From you</p>;
  if (!entry || !/\b(you|your edit|edited|changed)\b/i.test(String(entry.source || "")) || /chat|agent|records|profile|research|invoices|expenses|catalogue/i.test(String(entry.source || ""))) return null;
  return <p className="mt-1 text-[11px] font-medium text-slate-500 dark:text-slate-400" data-changed-by-you>Changed by you</p>;
}

function ListField({ field, items, onChange, disabled, data, errors, evidence, idBase, upload = null }) {
  const list = Array.isArray(items) ? items : [];
  const update = (i, key, value) => onChange(list.map((item, n) => (n === i ? { ...item, [key]: value } : item)));
  return (
    <div>
      <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">{field.label}</p>
      {errors[field.key] && <p role="alert" className="mt-1 text-[12px] font-medium text-rose-600">{errors[field.key]}</p>}
      {list.length === 0 && <p className="mt-1 text-[13px] text-slate-500">None added yet.</p>}
      <ul className="mt-2 space-y-3">
        {list.map((item, i) => (
          <li key={item.id || i} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
            <div className="grid gap-3 sm:grid-cols-2">
              {field.fields.map((sub) => {
                // A follow-up only where it is asked for ("Why it does not apply" once it doesn't apply)
                if (sub.when && !Object.entries(sub.when).every(([k, v]) => item[k] === v)) return null;
                const id = `${idBase}-${field.key}-${i}-${sub.key}`;
                const error = errors[`${field.key}.${i}.${sub.key}`];
                if (sub.type === "boolean") {
                  return (
                    <label key={sub.key} className="flex items-center gap-2 text-[13px] text-slate-700 dark:text-slate-200">
                      <input id={id} type="checkbox" disabled={disabled} checked={Boolean(item[sub.key])} onChange={(e) => update(i, sub.key, e.target.checked)} />
                      {sub.label}
                    </label>
                  );
                }
                return (
                  <div key={sub.key}>
                    <Label field={sub} htmlFor={id}>
                      <Control field={sub} id={id} value={item[sub.key]} onChange={(v) => update(i, sub.key, v)} disabled={disabled} data={data} selfId={item.id} evidence={evidence}
                        upload={upload ? (file, title) => upload(field.key, file, title) : null} uploadLabel={item.name || item.outcome || field.item || field.label} />
                    </Label>
                    {error && <p role="alert" className="mt-1 text-[12px] font-medium text-rose-600">{error}</p>}
                  </div>
                );
              })}
            </div>
            {!disabled && (
              <div className="mt-2 text-right">
                <Btn kind="link" className="text-[12px] !text-rose-600" onClick={() => onChange(list.filter((_, n) => n !== i))}>Remove this {field.item}</Btn>
              </div>
            )}
          </li>
        ))}
      </ul>
      {!disabled && <Btn className="mt-2" onClick={() => onChange([...list, { id: newKey() }])}>Add {/^[aeiou]/.test(field.item) ? "an" : "a"} {field.item}</Btn>}
    </div>
  );
}

/** The Agent's draft for one field, waiting beside it (the owner's brief, 25 Oct; F-10): Accept puts it in the field, Edit
 *  puts it there to change, Reject removes it for good. A field that already holds a value keeps it until Accept. */
export function DraftBox({ field, draft, data, onChange, inputId }) {
  const amount = field.type === "money" && /^\s*-?\d[\d,]*(\.\d+)?\s*$/.test(String(draft.value ?? ""));
  const sign = getCurrencySymbol(data?.currency) || "";
  const shown = Array.isArray(draft.value)
    ? draft.value.map((r) => Object.entries(r || {}).filter(([k, v]) => k !== "id" && v).map(([, v]) => v).join(": ")).filter(Boolean)
    : [amount ? `${sign}${Math.round(Number(String(draft.value).replace(/,/g, ""))).toLocaleString("en-GB")}` : String(draft.value)];
  const rest = () => Object.fromEntries(Object.entries(data?.agent_drafts || {}).filter(([k]) => k !== field.key));
  const use = (focus) => {
    onChange(field.key, draft.value);
    onChange("agent_drafts", rest());
    if (focus) setTimeout(() => document.getElementById(inputId)?.focus(), 50);
  };
  const reject = () => {
    onChange("agent_drafts", rest());
    onChange("rejected_drafts", [...new Set([...(data?.rejected_drafts || []), field.key])]);
  };
  const replaces = draft.replaces !== undefined && draft.replaces !== null && draft.replaces !== "";
  return (
    <div className="mt-2 rounded-lg border border-indigo-200 bg-indigo-50/60 p-2.5 text-[13px] text-slate-800 dark:border-indigo-800 dark:bg-indigo-900/20 dark:text-slate-100" data-agent-draft={field.key}>
      <p className="text-[12px] font-semibold text-indigo-700 dark:text-indigo-300">{replaces ? "AI suggestion" : "AI draft"}</p>
      {shown.length > 1 ? <ul className="mt-1 list-disc space-y-0.5 pl-5">{shown.map((t) => <li key={t}>{t}</li>)}</ul> : <p className="mt-1 whitespace-pre-wrap">{shown[0]}</p>}
      <p className="mt-1 text-[12px] text-slate-500">{/^suggested/i.test(String(draft.source || "")) ? `${String(draft.source)[0].toUpperCase()}${String(draft.source).slice(1)}.` : `Drafted ${draft.source || "from your records and research"}.`}{replaces ? " Your current answer stays until you accept." : ""}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Btn kind="primary" className="!px-3 !py-1 text-[12.5px]" onClick={() => use(false)} data-draft-accept>Accept</Btn>
        <Btn className="!px-3 !py-1 text-[12.5px]" onClick={() => use(true)} data-draft-edit>Edit</Btn>
        <Btn className="!px-3 !py-1 text-[12.5px]" onClick={reject} data-draft-reject>Reject</Btn>
      </div>
    </div>
  );
}

/** One field of a guided section. `onChange(path, value)`. */
export function Field({ field, data, onChange, errors = {}, disabled, evidence, idBase = "f", upload = null }) {
  if (field.when && !Object.entries(field.when).every(([k, v]) => getPath(data, k) === v)) return null;
  const value = getPath(data, field.key);
  const raw = !disabled ? (data?.agent_drafts || {})[field.key] : null;
  // A draft that says what the field already says is no draft (the owner, 25 Oct: suggestions word for word the answer)
  const draft = raw && !(JSON.stringify(raw.value ?? "") === JSON.stringify(value ?? "") || String(raw.value ?? "").trim() === String(value ?? "").trim()) ? raw : null;
  const id = `${idBase}-${field.key}`;
  const box = draft ? <DraftBox field={field} draft={draft} data={data} onChange={onChange} inputId={id} /> : null;
  if (field.type === "list") {
    return <div><ListField field={field} items={value} onChange={(v) => onChange(field.key, v)} disabled={disabled} data={data} errors={errors} evidence={evidence} idBase={idBase} upload={upload} />{box}</div>;
  }
  const error = errors[field.key];
  if (field.type === "boolean") {
    return (
      <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
        <input id={id} type="checkbox" className="mt-1" disabled={disabled} checked={Boolean(value)} onChange={(e) => onChange(field.key, e.target.checked)} />
        <span>{field.label}</span>
      </label>
    );
  }
  return (
    <div>
      <Label field={field} htmlFor={id}>
        <Control field={field} id={id} value={value} onChange={(v) => onChange(field.key, v)} disabled={disabled} data={data} evidence={evidence}
          upload={upload ? (file, title) => upload(field.key, file, title) : null} uploadLabel={field.label} />
      </Label>
      {error && <p role="alert" className="mt-1 text-[12px] font-medium text-rose-600">{error}</p>}
      <Provenance entry={data?.provenance?.[field.key]} />
      {box}
    </div>
  );
}
