import { TONE, dateLabel, getPath, newKey } from "../../lib/readiness";

// Small building blocks shared by the readiness screens, and the fields the guided sections
// are drawn from. The sections themselves come from the checklist profile, so a new profile
// version changes the questions without changing this file.

export const inputClass = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50 disabled:text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";

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
      {field.help && <span className="mt-0.5 block text-[12px] text-slate-500 dark:text-slate-400">{field.help}</span>}
      {children}
    </label>
  );
}

function optionsOf(field, data, selfId) {
  if (field.type === "ref" || field.type === "refs") {
    return (getPath(data, field.of) || []).filter((x) => x && x.id && x.id !== selfId).map((x) => ({ value: x.id, label: x[field.show] || "Untitled" }));
  }
  return (field.options || []).map((o) => ({ value: o, label: field.labels?.[o] || (typeof o === "string" ? o.charAt(0).toUpperCase() + o.slice(1).replace(/_/g, " ") : String(o)) }));
}

function Control({ field, id, value, onChange, disabled, data, selfId, evidence }) {
  const common = { id, disabled, className: `mt-1 ${inputClass}` };
  switch (field.type) {
    case "textarea":
      return <textarea {...common} rows={3} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
    case "money":
    case "number":
      // Text, not a number input: blank stays blank (unknown) and is never turned into zero.
      return <input {...common} type="text" inputMode="decimal" value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
    case "date":
      return <input {...common} type="date" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} />;
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
      return (
        <select {...common} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">No evidence attached</option>
          {(evidence || []).map((e) => <option key={e.id} value={e.id}>{e.title} ({dateLabel(e.effective_date)})</option>)}
        </select>
      );
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
  if (!entry) return null;
  return <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">Reused from {entry.source} · copied {dateLabel(entry.as_of)}. Change it here to use your own figure for this check only.</p>;
}

function ListField({ field, items, onChange, disabled, data, errors, evidence, idBase }) {
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
                      <Control field={sub} id={id} value={item[sub.key]} onChange={(v) => update(i, sub.key, v)} disabled={disabled} data={data} selfId={item.id} evidence={evidence} />
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

/** One field of a guided section. `onChange(path, value)`. */
export function Field({ field, data, onChange, errors = {}, disabled, evidence, idBase = "f" }) {
  if (field.when && !Object.entries(field.when).every(([k, v]) => getPath(data, k) === v)) return null;
  const value = getPath(data, field.key);
  if (field.type === "list") {
    return <ListField field={field} items={value} onChange={(v) => onChange(field.key, v)} disabled={disabled} data={data} errors={errors} evidence={evidence} idBase={idBase} />;
  }
  const id = `${idBase}-${field.key}`;
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
        <Control field={field} id={id} value={value} onChange={(v) => onChange(field.key, v)} disabled={disabled} data={data} evidence={evidence} />
      </Label>
      {error && <p role="alert" className="mt-1 text-[12px] font-medium text-rose-600">{error}</p>}
      <Provenance entry={data?.provenance?.[field.key]} />
    </div>
  );
}
