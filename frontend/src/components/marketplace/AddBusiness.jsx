import { useEffect, useRef, useState } from "react";
import { AdminTable, Chip } from "../admin/AdminUI";
import { Btn, Notice, Panel, inputClass } from "../readiness/Fields";
import { addBusiness, checkBusiness, directoryError, editDirectoryProfile, importBusinesses } from "../../lib/directory";

// Adding businesses to the index by hand: a form (the main way), a CSV import with a preview,
// and editing a record that is already there. A location is a town or region, never an address.

export const VISIBILITY_OPTION = { inherit: "Follow the global setting", hidden: "Hidden (moderators and invitation links)", invite_only: "Invite only (plus exact-match lookup)", public: "Public (listed and searchable)" };
const STATUSES = [["active", "Active"], ["dormant", "Dormant"], ["dissolved", "Dissolved"], ["closed", "Closed"]];
const today = () => new Date().toISOString().slice(0, 10);
const BLANK = { name: "", trading_name: "", company_number: "", country: "United Kingdom", category: "", location: "", website: "", description: "", tags: "", business_status: "active",
  contact_email: "", provider: "", reference: "", retrieved_at: today(), visibility: "inherit" };

const toRecord = (f) => ({
  name: f.name.trim(), trading_name: f.trading_name.trim() || null, company_number: f.company_number.trim() || null, country: f.country.trim() || "United Kingdom", category: f.category,
  location: f.location.trim(), website: f.website.trim() || null, description: f.description.trim() || null, service_tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean),
  business_status: f.business_status, contact_email: f.contact_email.trim() || null, visibility: f.visibility,
  source: { provider: f.provider, record_id: f.reference.trim(), retrieved_at: f.retrieved_at },
});
const RESULT = { published: ["Ready to be shown", "emerald"], noindex: ["Kept out of search engines", "amber"], unpublished: ["Not shown yet (needs more detail)", "slate"] };

/** When a save is refused, go to the first field that needs fixing: the person is at the Save button, the problem may be far above. */
function useFirstError(errors) {
  const form = useRef(null);
  useEffect(() => {
    if (!errors || !Object.keys(errors).length) return;
    const field = form.current?.querySelector('[data-invalid="true"] input, [data-invalid="true"] select, [data-invalid="true"] textarea');
    if (!field) return;
    field.scrollIntoView?.({ block: "center", behavior: "smooth" });
    field.focus({ preventScroll: true });
  }, [errors]);
  return form;
}

function Field({ label, error, required, hint, children, className = "" }) {
  return (
    <div className={className} data-invalid={error ? "true" : undefined}>
      <label className="block text-[13px] font-semibold text-slate-800 dark:text-slate-100">{label}{required && <span className="text-rose-600" aria-hidden="true"> *</span>}{children}</label>
      {hint && <span className="mt-0.5 block text-[12px] text-slate-500">{hint}</span>}
      {error && <span role="alert" className="mt-1 block text-[12px] font-medium text-rose-600">{error}</span>}
    </div>
  );
}

function Duplicates({ items }) {
  return (
    <ul className="mt-1 space-y-1">
      {items.map((x) => (
        <li key={`${x.kind}-${x.id}`} className="flex flex-wrap items-center justify-between gap-2">
          <span><span className="font-semibold">{x.name}</span>{x.location ? `, ${x.location}` : ""} · matched on {x.matched_on}</span>
          {x.kind === "profile" && x.slug && <a href={`/marketplace/business/${x.slug}`} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-600 hover:underline">Open existing</a>}
        </li>
      ))}
    </ul>
  );
}

/** The form. `options` carries the category list and the source providers from the server. */
export function AddBusinessForm({ options, onAdded, onClose }) {
  const [form, setForm] = useState(BLANK);
  const [state, setState] = useState({});
  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setState((s) => ({ ...s, done: null })); };
  const errors = state.errors || {};
  const formRef = useFirstError(state.errors);

  async function save(e, anyway = false) {
    e?.preventDefault();
    setState({ busy: true });
    const record = toRecord(form);
    try {
      if (!anyway) {
        // Look before saving: problems to fix, and anything that may already be this business.
        const checked = await checkBusiness(record);
        if (Object.keys(checked.errors).length || checked.duplicates.length) { setState({ errors: checked.errors, duplicates: checked.duplicates }); return; }
      }
      const made = await addBusiness(record, anyway);
      setState({ done: made });
      setForm({ ...BLANK, provider: form.provider, retrieved_at: form.retrieved_at });
      onAdded?.(made);
    } catch (err) {
      const p = directoryError(err, "That couldn't be saved. Nothing was added; try again.");
      setState(p.code === "possible_duplicate" ? { duplicates: p.duplicates, blocked: !p.can_add_anyway } : { errors: p.errors, problem: Object.keys(p.errors || {}).length ? null : p.message });
    }
  }
  const sameRecord = (state.duplicates || []).some((x) => ["company number", "website"].includes(x.matched_on));
  const done = state.done;
  return (
    <form ref={formRef} onSubmit={save} aria-label="Add business" className="space-y-4" noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Legal name" required error={errors.name}><input className={`mt-1 ${inputClass}`} value={form.name} onChange={set("name")} /></Field>
        <Field label="Trading name"><input className={`mt-1 ${inputClass}`} value={form.trading_name} onChange={set("trading_name")} /></Field>
        <Field label="Company number"><input className={`mt-1 ${inputClass}`} value={form.company_number} onChange={set("company_number")} /></Field>
        <Field label="Country"><input className={`mt-1 ${inputClass}`} value={form.country} onChange={set("country")} /></Field>
        <Field label="Category" required error={errors.category}>
          <select className={`mt-1 ${inputClass}`} value={form.category} onChange={set("category")}><option value="">Choose…</option>{(options?.categories || []).map((c) => <option key={c} value={c}>{c}</option>)}</select>
        </Field>
        <Field label="Town or region" required error={errors.location} hint="No street address or full postcode."><input className={`mt-1 ${inputClass}`} value={form.location} onChange={set("location")} placeholder="Leeds" /></Field>
        <Field label="Website" error={errors.website}><input className={`mt-1 ${inputClass}`} value={form.website} onChange={set("website")} placeholder="example.co.uk" /></Field>
        <Field label="Business status" error={errors.business_status}>
          <select className={`mt-1 ${inputClass}`} value={form.business_status} onChange={set("business_status")}>{STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </Field>
        <Field label="Short description" className="sm:col-span-2" hint="40 characters or more counts towards quality."><textarea rows={2} className={`mt-1 ${inputClass}`} value={form.description} onChange={set("description")} /></Field>
        <Field label="Service tags (separate with commas)"><input className={`mt-1 ${inputClass}`} value={form.tags} onChange={set("tags")} placeholder="Bookkeeping, Payroll" /></Field>
        <Field label="Private contact email" error={errors.contact_email} hint="For invitations only. Never shown or searchable."><input type="email" className={`mt-1 ${inputClass}`} value={form.contact_email} onChange={set("contact_email")} /></Field>
      </div>
      <fieldset className="grid gap-3 rounded-xl border border-slate-200 p-3 sm:grid-cols-3 dark:border-slate-700">
        <legend className="px-1 text-[13px] font-semibold text-slate-800 dark:text-slate-100">Where this came from</legend>
        <Field label="Source" required error={errors["source.provider"]}>
          <select className={`mt-1 ${inputClass}`} value={form.provider} onChange={set("provider")}><option value="">Choose…</option>{(options?.providers || []).map((c) => <option key={c} value={c}>{c}</option>)}</select>
        </Field>
        <Field label="Source link or reference" required error={errors["source.record_id"]}><input className={`mt-1 ${inputClass}`} value={form.reference} onChange={set("reference")} /></Field>
        <Field label="Retrieved on" required error={errors["source.retrieved_at"]}><input type="date" className={`mt-1 ${inputClass}`} value={form.retrieved_at} onChange={set("retrieved_at")} /></Field>
      </fieldset>
      <Field label="Visibility" error={errors.visibility} className="sm:max-w-sm">
        <select className={`mt-1 ${inputClass}`} value={form.visibility} onChange={set("visibility")}>{Object.entries(VISIBILITY_OPTION).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      </Field>

      {state.problem && <Notice tone="rose" role="alert">{state.problem}</Notice>}
      {state.duplicates?.length > 0 && (
        <Notice tone="amber" role="alert">
          <p className="font-semibold">This business may already exist.</p>
          <Duplicates items={state.duplicates} />
          {!sameRecord && !state.blocked
            ? <Btn className="mt-2 !py-1.5 !text-[13px]" disabled={state.busy} onClick={(e) => save(e, true)}>It's a different business: add it anyway</Btn>
            : <p className="mt-2 text-[12px]">The same company number or website is the same record. Open it and edit it instead.</p>}
        </Notice>
      )}
      {done && (
        <Notice tone={done.result === "excluded" ? "amber" : "emerald"}>
          {done.result === "excluded" ? <><span className="font-semibold">{done.name} was not added.</span> {done.reasons?.join(" ")}</> : (
            <>
              <span className="font-semibold">Added.</span> <Chip tone={(RESULT[done.publication] || RESULT.unpublished)[1]}>{(RESULT[done.publication] || RESULT.unpublished)[0]}</Chip>{" "}
              {done.reasons?.length ? `Missing: ${done.reasons.join(" ")} ` : ""}
              {done.suggested_visibility === "public" && done.visibility !== "public" ? "Good enough to be public if you choose: change its visibility from the list. " : ""}
              {done.link && <a href={done.link} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-600 hover:underline">Open the profile</a>}
            </>
          )}
        </Notice>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        {onClose && <Btn onClick={onClose}>Close</Btn>}
        <Btn kind="primary" type="submit" disabled={state.busy}>{state.busy ? "Checking…" : "Save business"}</Btn>
      </div>
    </form>
  );
}

// ── CSV ───────────────────────────────────────────────────────────────────────

export const CSV_COLUMNS = ["name", "trading_name", "company_number", "country", "category", "location", "website", "description", "service_tags", "business_status", "contact_email",
  "source_provider", "source_reference", "retrieved_at", "visibility"];
const CSV_EXAMPLE = ["Example Advisory Ltd", "Example Advisory", "12345678", "United Kingdom", "Consulting", "Leeds", "https://example.co.uk",
  "Independent advisers helping small firms set prices and plan growth.", "Pricing; Strategy", "active", "hello@example.co.uk", "Companies House", "12345678", today(), "inherit"];

/** A small CSV reader: quoted fields, doubled quotes and line breaks inside quotes. */
export function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  const src = String(text || "").replace(/^﻿/, "");
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && src[i + 1] === "\n") i += 1; row.push(cell); cell = ""; if (row.some((c) => c.trim())) rows.push(row); row = []; }
    else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => {
    const o = Object.fromEntries(head.map((h, i) => [h, (r[i] || "").trim()]));
    return { name: o.name, trading_name: o.trading_name || null, company_number: o.company_number || null, country: o.country || "United Kingdom", category: o.category, location: o.location,
      website: o.website || null, description: o.description || null, service_tags: (o.service_tags || "").split(/[;|]/).map((t) => t.trim()).filter(Boolean),
      business_status: o.business_status || "active", contact_email: o.contact_email || null, visibility: o.visibility || "inherit",
      source: { provider: o.source_provider, record_id: o.source_reference, retrieved_at: o.retrieved_at } };
  });
}

function downloadTemplate() {
  const quote = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const url = URL.createObjectURL(new Blob([`${CSV_COLUMNS.join(",")}\n${CSV_EXAMPLE.map(quote).join(",")}\n`], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "marketplace-businesses-template.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function ImportCsv({ onImported }) {
  const [records, setRecords] = useState(null);
  const [preview, setPreview] = useState(null);
  const [state, setState] = useState({});

  async function choose(file) {
    setPreview(null); setState({ busy: true });
    try {
      const rows = parseCsv(await file.text());
      if (!rows.length) { setState({ problem: "That file has no rows under its heading line." }); return; }
      setRecords(rows);
      setPreview(await importBusinesses(rows, false));
      setState({});
    } catch (e) { setState({ problem: directoryError(e, "That file couldn't be read.").message }); }
  }
  async function commit() {
    setState({ busy: true });
    try { const done = await importBusinesses(records, true); setPreview(done); setState({}); onImported?.(done); }
    catch (e) { setState({ problem: directoryError(e).message }); }
  }
  const s = preview?.summary;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="cursor-pointer rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
          Choose a CSV file
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) choose(f); }} />
        </label>
        <Btn kind="link" className="text-[13px]" onClick={downloadTemplate}>Download the template</Btn>
      </div>
      <p className="text-[12px] text-slate-500">Same columns as the form. Separate service tags with semicolons. Nothing is added until you have seen the preview.</p>
      {state.problem && <Notice tone="rose" role="alert">{state.problem}</Notice>}
      {state.busy && <p role="status" className="text-sm text-slate-500">Checking…</p>}
      {preview && (
        <>
          <p role="status" className="text-[13px] text-slate-700 dark:text-slate-200">
            {preview.committed
              ? `Added ${s.added} of ${s.total}. ${s.with_problems} had problems and ${s.duplicates} may already exist; those were left out.`
              : `${s.total} row${s.total === 1 ? "" : "s"}: ${s.ready} ready to add, ${s.with_problems} with problems, ${s.duplicates} that may already exist.`}
          </p>
          <AdminTable caption="CSV preview" minWidth={640} rows={preview.rows} rowKey={(r) => r.row} pageSize={50} columns={[
            { key: "row", label: "Row" },
            { key: "name", label: "Business", render: (r) => r.name || "—" },
            { key: "state", label: "Result", render: (r) => (r.result ? <Chip tone="emerald">Added</Chip> : Object.keys(r.errors).length ? <Chip tone="rose">Needs fixing</Chip> : r.duplicates.length ? <Chip tone="amber">May already exist</Chip> : <Chip tone="sky">Ready</Chip>) },
            { key: "detail", label: "Detail", tdClass: "break-words", render: (r) => (Object.keys(r.errors).length ? Object.values(r.errors).join(" ")
              : r.duplicates.length ? <Duplicates items={r.duplicates} /> : r.verdict ? (RESULT[r.verdict.publication] || RESULT.unpublished)[0] : "") },
          ]} />
          {!preview.committed && <Btn kind="primary" disabled={state.busy || s.ready === 0} onClick={commit}>{`Import ${s.ready} ready row${s.ready === 1 ? "" : "s"}`}</Btn>}
        </>
      )}
    </div>
  );
}

// ── editing a record that is already there ────────────────────────────────────

export function EditBusinessForm({ profile, options, onSaved, onClose }) {
  const first = { name: profile.name || "", trading_name: profile.trading_name || "", company_number: profile.company_number || "", country: profile.country || "", category: profile.category || "",
    location: profile.location || "", website: profile.website || "", description: profile.description || "", tags: (profile.service_tags || []).join(", "), business_status: profile.business_status || "active" };
  const [form, setForm] = useState(first);
  const [reason, setReason] = useState("");
  const [state, setState] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const errors = state.errors || {};
  const formRef = useFirstError(state.errors);
  async function save(e) {
    e.preventDefault();
    const changes = {};
    for (const k of Object.keys(first)) if (form[k] !== first[k]) changes[k === "tags" ? "service_tags" : k] = k === "tags" ? form.tags.split(",").map((t) => t.trim()).filter(Boolean) : form[k];
    if (!Object.keys(changes).length) { setState({ problem: "Nothing has changed." }); return; }
    setState({ busy: true });
    try { onSaved(await editDirectoryProfile(profile.slug, changes, reason)); }
    catch (err) { const p = directoryError(err, "That couldn't be saved."); setState({ errors: p.errors, problem: Object.keys(p.errors || {}).length ? null : p.message }); }
  }
  return (
    <form ref={formRef} onSubmit={save} aria-label={`Edit ${profile.name}`} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Edit {profile.name}</p>
      <p className="text-[13px] text-slate-500">The earlier value and where it came from are kept in the profile's history. Its address doesn't change.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Legal name" error={errors.name}><input className={`mt-1 ${inputClass}`} value={form.name} onChange={set("name")} /></Field>
        <Field label="Trading name"><input className={`mt-1 ${inputClass}`} value={form.trading_name} onChange={set("trading_name")} /></Field>
        <Field label="Company number"><input className={`mt-1 ${inputClass}`} value={form.company_number} onChange={set("company_number")} /></Field>
        <Field label="Category" error={errors.category}>
          <select className={`mt-1 ${inputClass}`} value={form.category} onChange={set("category")}>
            {!(options?.categories || []).includes(form.category) && <option value={form.category}>{form.category || "Choose…"}</option>}
            {(options?.categories || []).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Town or region" error={errors.location} hint="No street address or full postcode."><input className={`mt-1 ${inputClass}`} value={form.location} onChange={set("location")} /></Field>
        <Field label="Website" error={errors.website}><input className={`mt-1 ${inputClass}`} value={form.website} onChange={set("website")} /></Field>
        <Field label="Short description" className="sm:col-span-2"><textarea rows={2} className={`mt-1 ${inputClass}`} value={form.description} onChange={set("description")} /></Field>
        <Field label="Service tags (separate with commas)"><input className={`mt-1 ${inputClass}`} value={form.tags} onChange={set("tags")} /></Field>
        <Field label="Reason for the change"><input className={`mt-1 ${inputClass}`} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
      {state.problem && <p role="alert" className="text-[13px] font-medium text-rose-600">{state.problem}</p>}
      <div className="flex flex-wrap gap-2"><Btn kind="primary" type="submit" disabled={state.busy}>{state.busy ? "Saving…" : "Save changes"}</Btn><Btn onClick={onClose}>Cancel</Btn></div>
    </form>
  );
}

/** The "Index & invites" tab's adding tools: the form first, CSV next, raw JSON behind "Advanced". */
export default function AddBusinesses({ options, onChange }) {
  const [open, setOpen] = useState(null);      // "form" | "csv"
  return (
    <Panel title="Add businesses" description="Add one from a form, or many from a CSV file. Each needs a town or region and a source.">
      <div className="flex flex-wrap gap-2">
        <Btn kind={open === "form" ? "secondary" : "primary"} aria-expanded={open === "form"} onClick={() => setOpen(open === "form" ? null : "form")}>Add business</Btn>
        <Btn aria-expanded={open === "csv"} onClick={() => setOpen(open === "csv" ? null : "csv")}>Import CSV</Btn>
      </div>
      {open === "form" && <div className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-800"><AddBusinessForm options={options} onAdded={onChange} onClose={() => setOpen(null)} /></div>}
      {open === "csv" && <div className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-800"><ImportCsv onImported={onChange} /></div>}
    </Panel>
  );
}
