import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "../../api/client";
import { AdminTable, Chip } from "./AdminUI";
import { Btn, Notice, inputClass } from "../readiness/Fields";
import BulkEmail from "./BulkEmail";
import RichEmailEditor, { EMAIL_VARIABLES, VariableSpacing, unknownVariables } from "./RichEmailEditor";
import { confirmDialog } from "../../lib/dialog";

// The superadmin's Emails area (the owner, 10 Nov): what was sent, which kinds of email are on, their wording, and
// one-off emails. Essential emails (getting into an account, things a person asked for) can't be switched off.

const STATUS = {
  sent: ["Sent", "emerald"], failed: ["Failed", "rose"], uncertain: ["Not confirmed", "amber"],
  switched_off: ["Switched off", "slate"], not_configured: ["Email not set up", "rose"], opted_out: ["Opted out", "slate"],
};
const TRACKED = [["delivered", "Delivered"], ["opened", "Opened"], ["not_opened", "Sent, not opened"], ["clicked", "Clicked"], ["bounced", "Bounced"], ["complained", "Marked as spam"]];

// What happened after sending, from the email provider: delivered, opened, clicked, bounced, marked as spam.
function Tracking({ r }) {
  const parts = [];
  if (r.bounced_at) parts.push(<Chip key="b" tone="rose">Bounced</Chip>);
  else if (r.delivered_at) parts.push(<Chip key="d" tone="emerald">Delivered</Chip>);
  if (r.opened_at) parts.push(<Chip key="o" tone="sky">Opened{r.open_count > 1 ? ` ×${r.open_count}` : ""}</Chip>);
  if (r.clicked_at) parts.push(<Chip key="c" tone="sky">Clicked{r.click_count > 1 ? ` ×${r.click_count}` : ""}</Chip>);
  if (r.complained_at) parts.push(<Chip key="s" tone="rose">Marked as spam</Chip>);
  if (!parts.length) return <span className="text-[12px] text-slate-400">{r.status === "sent" ? "No news yet" : ""}</span>;
  return (
    <span className="flex flex-wrap gap-1" title={[r.delivered_at && `Delivered ${when(r.delivered_at)}`, r.opened_at && `First opened ${when(r.opened_at)}`, r.last_opened_at && r.open_count > 1 && `Last opened ${when(r.last_opened_at)}`,
      r.clicked_at && `First clicked ${when(r.clicked_at)}`, r.last_clicked_link && `Last link: ${r.last_clicked_link}`, r.bounce_reason && `Bounce: ${r.bounce_reason}`].filter(Boolean).join("\n")}>{parts}</span>
  );
}
const when = (v) => (v ? new Date(v).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const problemOf = (e) => {
  const d = e?.detail ?? e?.data?.detail;
  if (d && typeof d === "object") return { message: d.message || "That couldn't be saved.", errors: d.errors || {} };
  return { message: (typeof d === "string" && d) || String(e?.message || "Something went wrong.").replace(/^HTTP \d+:\s*/, ""), errors: {} };
};

function Sent({ kinds }) {
  const [rows, setRows] = useState(null);
  const [filter, setFilter] = useState({ kind: "", status: "", q: "", tracked: "" });
  const [problem, setProblem] = useState(null);
  const load = useCallback(() => {
    const p = new URLSearchParams(Object.entries({ kind: filter.kind, status_is: filter.status, q: filter.q.trim(), tracked: filter.tracked }).filter(([, v]) => v));
    apiRequest(`/admin/emails/log?${p}`, "GET").then((r) => { setRows(r.items || []); setProblem(null); }).catch((e) => setProblem(problemOf(e).message));
  }, [filter]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  const labelOf = (k) => kinds.find((x) => x.key === k)?.label || k;
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <input aria-label="Search by address or subject" placeholder="Search address or subject" className={inputClass} value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} />
        <select aria-label="Kind of email" className={inputClass} value={filter.kind} onChange={(e) => setFilter({ ...filter, kind: e.target.value })}>
          <option value="">Every kind</option>{kinds.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
        </select>
        <select aria-label="What happened" className={inputClass} value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
          <option value="">Any outcome</option>{Object.entries(STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select aria-label="After sending" className={inputClass} value={filter.tracked} onChange={(e) => setFilter({ ...filter, tracked: e.target.value })}>
          <option value="">Anything after sending</option>{TRACKED.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
      {problem && <Notice tone="rose" role="alert">{problem}</Notice>}
      {!rows ? (!problem && <p role="status" className="text-sm text-slate-500">Loading…</p>) : (
        <AdminTable caption="Emails sent" minWidth={760} rows={rows} rowKey={(r) => r.id} rowLabel={(r) => r.to_email} emptyText="No emails match." columns={[
          { key: "created_at", label: "When", tdClass: "whitespace-nowrap", render: (r) => when(r.created_at) },
          { key: "to_email", label: "To", tdClass: "break-all", render: (r) => r.to_email },
          { key: "subject", label: "Subject", render: (r) => <span className="break-words">{r.subject}</span> },
          { key: "kind", label: "Kind", render: (r) => <>{labelOf(r.kind)}{r.sent_by ? <span className="block text-[12px] text-slate-500">by {r.sent_by}</span> : null}</> },
          { key: "status", label: "What happened", render: (r) => <><Chip tone={(STATUS[r.status] || STATUS.failed)[1]}>{(STATUS[r.status] || [r.status])[0]}</Chip>{r.error ? <span className="mt-1 block max-w-[16rem] text-[12px] text-slate-500">{r.error}</span> : null}</> },
          { key: "after", label: "After sending", render: (r) => <Tracking r={r} /> },
        ]} />
      )}
      <p className="text-[12px] text-slate-500">Sent: the email left us. Delivered: it reached the person's inbox. Opened and clicked are a good guide, not exact, because some mail apps hide or fake opens. Point at a label to see when it happened. The latest 300 are listed; search to find older ones.</p>
    </div>
  );
}

// What each detail of a platform email is, for the Variables menu of its wording.
const KIND_VARIABLES = {
  headline: "The email's headline", message: "The main message, written for each business", business_name: "The business's name",
  waiting: "How many requests are waiting, when there are any", link: "Their own link. On a line of its own it becomes the button",
  opt_out: "Their own link to stop these emails", reason: "Why it was decided", next_step: "What to do next", action: "The button's words",
  app_name: "EnterprateAI", code: "The code. On a line of its own it shows as a code box", saving: "What saving the code does",
  email: "Their email address", minutes: "How many minutes the link works", article: "\"a\" or \"an\"", doc_type: "The kind of document",
  customer_name: "The customer's name", reference: "The document's reference", total: "The total", valid_days: "How many days it is valid",
  outcome: "The outcome", detail: "More detail", question: "Their question", greeting: "The greeting with their name",
  inviter_email: "Who invited them", access_level: "Their access level", expires: "When it expires", name: "Their name",
  company: "Their company", phone: "Their phone number", role: "Their role or interest", sender_label: "Who sent it",
  doc_label: "The document's name", sender_name: "Who sent it", request_title: "The request's title",
  request_description: "The request's description", requirements: "The requirements",
};
const titleOf = (key) => key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, " ");
const isFormatted = (body) => String(body || "").trimStart().startsWith("<");
const escapeText = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** Plain wording, as written before the formatting tools, opened in the editor: one paragraph per block of lines. */
const asEditorHtml = (body) => (isFormatted(body) ? body
  : String(body || "").trim().split(/\n\s*\n/).map((para) => `<p>${escapeText(para.trim()).replace(/\n/g, "<br>")}</p>`).join(""));

export function Wording({ kind, onSaved, onClose }) {
  const [form, setForm] = useState({ subject: kind.subject || "", body: kind.body || "", button_label: kind.button_label || "" });
  const [plain, setPlain] = useState(kind.body || "");      // the message as words, for the spacing check
  const editor = useRef(null);
  const variables = kind.variables.map((key) => ({ key, label: titleOf(key), hint: KIND_VARIABLES[key] || "Filled in for each email" }));
  const [preview, setPreview] = useState(null);
  const [state, setState] = useState({});
  useEffect(() => {
    const t = setTimeout(() => apiRequest(`/admin/emails/kinds/${kind.key}/preview`, "POST", form).then(setPreview).catch(() => {}), 400);
    return () => clearTimeout(t);
  }, [form, kind.key]);
  async function save() {
    setState({ busy: true });
    try { await apiRequest(`/admin/emails/kinds/${kind.key}`, "PUT", form); onSaved(`${kind.label}: new wording saved. It's used from the next email.`); }
    catch (e) { const p = problemOf(e); setState({ problem: Object.keys(p.errors).length ? null : p.message, errors: p.errors }); }
  }
  async function reset() {
    setState({ busy: true });
    try { await apiRequest(`/admin/emails/kinds/${kind.key}/wording`, "DELETE"); onSaved(`${kind.label}: back to the product's wording.`); }
    catch (e) { setState({ problem: problemOf(e).message }); }
  }
  const errors = { ...(preview?.errors || {}), ...(state.errors || {}) };
  const field = (key, label, el) => (
    <label className="block text-[12px] font-semibold text-slate-700 dark:text-slate-200">{label}{el}
      {errors[key] && <span role="alert" className="mt-1 block text-[12px] font-medium text-rose-600">{errors[key]}</span>}</label>
  );
  return (
    <section aria-label={`Wording of ${kind.label}`} className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{kind.label}</p>
          <p className="text-[13px] text-slate-500">Details you can use: {kind.variables.map((v) => `{${v}}`).join(", ")}. Put {kind.required.map((v) => `{${v}}`).join(" and ")} on a line of its own: it becomes the {kind.required.includes("code") ? "code box" : "button"}.</p></div>
        <Btn className="!py-1.5 !text-[13px]" onClick={onClose}>Close</Btn>
      </div>
      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          {field("subject", "Subject", <input className={`mt-1 ${inputClass}`} value={form.subject} maxLength={300} onChange={(e) => setForm({ ...form, subject: e.target.value })} />)}
          <div>
            <RichEmailEditor ref={editor} variables={variables} initialHtml={asEditorHtml(form.body)} variablesNote="Filled in for each email as it is sent. You can type these in the subject too."
              onChange={({ html, text }) => { setForm((f) => ({ ...f, body: html })); setPlain(text); }} />
            <VariableSpacing texts={[form.subject, plain]} />
            {errors.body && <span role="alert" className="mt-1 block text-[12px] font-medium text-rose-600">{errors.body}</span>}
          </div>
          {kind.required.includes("link") && field("button", "Button label", <input className={`mt-1 ${inputClass}`} value={form.button_label} maxLength={80} onChange={(e) => setForm({ ...form, button_label: e.target.value })} />)}
          {state.problem && <p role="alert" className="text-[12px] font-medium text-rose-600">{state.problem}</p>}
          <div className="flex flex-wrap gap-2">
            <Btn kind="primary" disabled={state.busy || Object.keys(preview?.errors || {}).length > 0} onClick={save}>{state.busy ? "Saving…" : "Save wording"}</Btn>
            <Btn disabled={state.busy} onClick={() => { setForm({ ...kind.default }); editor.current?.setHtml(asEditorHtml(kind.default.body)); }}>Use the product's wording</Btn>
            {kind.edited && <Btn kind="link" disabled={state.busy} onClick={reset}>Reset to the product's wording</Btn>}
          </div>
        </div>
        <div>
          <p className="text-[12px] font-semibold text-slate-700 dark:text-slate-200">Preview, with example details</p>
          {preview ? (
            <div className="mt-1 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
              <p className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-[13px] font-semibold text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">{preview.subject}</p>
              <iframe title={`Preview of ${kind.label}`} sandbox="" srcDoc={preview.html} className="h-[26rem] w-full bg-white" />
            </div>
          ) : <p role="status" className="mt-1 text-sm text-slate-500">Loading…</p>}
        </div>
      </div>
    </section>
  );
}

function Kinds({ data, reload, onOpenTab }) {
  const [editing, setEditing] = useState(null);
  const [note, setNote] = useState(null);
  const [problem, setProblem] = useState(null);
  async function toggle(k) {
    setNote(null); setProblem(null);
    try {
      await apiRequest(`/admin/emails/kinds/${k.key}`, "PUT", { enabled: !k.enabled });
      setNote(`${k.label} is switched ${k.enabled ? "off. Nothing of this kind is sent until it's switched back on; each one held back is still logged" : "on"}.`);
      reload();
    } catch (e) { setProblem(problemOf(e).message); }
  }
  const count = (k, s) => k.last_30_days?.[s] || 0;
  return (
    <div className="space-y-3">
      {note && <Notice tone="emerald">{note}</Notice>}
      {problem && <Notice tone="rose" role="alert">{problem}</Notice>}
      {editing && <Wording kind={editing} onClose={() => setEditing(null)} onSaved={(text) => { setEditing(null); setNote(text); reload(); }} />}
      <AdminTable caption="Kinds of email" minWidth={760} rows={data.items} rowKey={(k) => k.key} rowLabel={(k) => k.label} pageSize={50} columns={[
        { key: "label", label: "Email", render: (k) => <><p className="font-semibold text-slate-900 dark:text-slate-100">{k.label}</p><p className="text-[12px] text-slate-500">{k.description}</p></> },
        { key: "on", label: "Switched", render: (k) => (k.essential
          ? <span title="People need it to get into their account, or asked for it themselves" className="text-[12px] text-slate-500">Always on</span>
          : <button type="button" role="switch" aria-checked={k.enabled} aria-label={`${k.label}: ${k.enabled ? "on" : "off"}`} onClick={() => toggle(k)}
            className={`rounded-full px-2.5 py-1 text-[12px] font-semibold ${k.enabled ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{k.enabled ? "On" : "Off"}</button>) },
        { key: "wording", label: "Wording", render: (k) => (k.editable
          ? <Btn kind="link" className="text-[13px]" onClick={() => setEditing(k)}>{k.edited ? "Edited · change" : "Edit"}</Btn>
          : k.written === "activation" && onOpenTab
            ? <Btn kind="link" className="text-[13px]" onClick={() => onOpenTab("activation")}>Edit in Activation emails</Btn>
            : <span className="text-[12px] text-slate-500">{k.written === "each_time" ? "Written for each email" : k.written === "none" ? "Not one email" : "Set in the product"}</span>) },
        { key: "month", label: "Last 30 days", render: (k) => <span className="text-[12px] text-slate-600 dark:text-slate-300">{count(k, "sent")} sent{count(k, "opened") ? ` · ${count(k, "opened")} opened` : ""}{count(k, "clicked") ? ` · ${count(k, "clicked")} clicked` : ""}{count(k, "failed") ? ` · ${count(k, "failed")} failed` : ""}{count(k, "switched_off") ? ` · ${count(k, "switched_off")} held back` : ""}{count(k, "opted_out") ? ` · ${count(k, "opted_out")} opted out` : ""}</span> },
        { key: "by", label: "Changed", render: (k) => (k.updated_by ? <span className="text-[12px] text-slate-500">{k.updated_by}<br />{when(k.updated_at)}</span> : <span className="text-[12px] text-slate-400">Never</span>) },
      ]} />
    </div>
  );
}

function SendOne() {
  const BLANK = { to: "", subject: "", body: "", html: "", reply_to: "", attachments: [] };
  const [form, setForm] = useState(BLANK);
  const [state, setState] = useState({});
  const editor = useRef(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const unknown = unknownVariables(form.subject, form.body);
  async function send(e) {
    e.preventDefault();
    setState({ busy: true });
    try {
      const r = await apiRequest("/admin/emails/send", "POST", { ...form, reply_to: form.reply_to || null,
        attachments: form.attachments.map(({ filename, content }) => ({ filename, content })) });
      setState({ result: r });
      if (!r.failed) { setForm(BLANK); editor.current?.clear(); }
    } catch (err) { setState({ problem: problemOf(err).message }); }
  }
  return (
    <form onSubmit={send} aria-label="Send an email" className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <p className="text-[13px] text-slate-500">Each address gets its own copy, so nobody sees the others. Up to 20 at a time. To write to many people, use Bulk email.</p>
      <label className="block text-[12px] font-semibold text-slate-700 dark:text-slate-200">To (separate addresses with commas or new lines)
        <textarea rows={2} className={`mt-1 ${inputClass}`} value={form.to} onChange={set("to")} /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-[12px] font-semibold text-slate-700 dark:text-slate-200">Subject<input className={`mt-1 ${inputClass}`} value={form.subject} maxLength={300} onChange={set("subject")} /></label>
        <label className="block text-[12px] font-semibold text-slate-700 dark:text-slate-200">Replies go to (optional)<input type="email" className={`mt-1 ${inputClass}`} value={form.reply_to} onChange={set("reply_to")} placeholder="Our usual address" /></label>
      </div>
      <RichEmailEditor ref={editor} variables={EMAIL_VARIABLES.filter((v) => v.who.includes("one"))} files={form.attachments}
        onFiles={(attachments) => setForm((f) => ({ ...f, attachments }))} onChange={({ html, text }) => setForm((f) => ({ ...f, html, body: text }))} />
      <VariableSpacing texts={[form.subject, form.body]} />
      {unknown.length > 0 && <p role="alert" className="text-[12px] font-medium text-amber-700">{unknown.join(", ")} can't be filled in. Pick from Variables, or take {unknown.length > 1 ? "them" : "it"} out.</p>}
      {state.problem && <p role="alert" className="text-[12px] font-medium text-rose-600">{state.problem}</p>}
      {state.result && (
        <Notice tone={state.result.failed ? "amber" : "emerald"}>
          {state.result.sent} sent{state.result.failed ? `, ${state.result.failed} not sent:` : "."}
          {state.result.failed > 0 && <ul className="mt-1 list-disc pl-5">{state.result.results.filter((r) => !r.sent).map((r) => <li key={r.to}>{r.to}: {r.error}</li>)}</ul>}
        </Notice>
      )}
      <Btn kind="primary" type="submit" disabled={state.busy || unknown.length > 0 || !form.to.trim() || form.subject.trim().length < 3 || form.body.trim().length < 5}>{state.busy ? "Sending…" : "Send"}</Btn>
    </form>
  );
}

function OptedOut({ kinds }) {
  const [rows, setRows] = useState(null);
  const [problem, setProblem] = useState(null);
  const [note, setNote] = useState(null);
  const load = useCallback(() => apiRequest("/admin/emails/optouts", "GET").then((r) => { setRows(r.items || []); setProblem(null); }).catch((e) => setProblem(problemOf(e).message)), []);
  useEffect(() => { load(); }, [load]);
  const labelOf = (k) => (k === "all" ? "Every optional email" : kinds.find((x) => x.key === k)?.label || k);
  async function undo(r) {
    if (!await confirmDialog(`Only do this if ${r.email} asked for them again.`, { title: `Send "${labelOf(r.kind)}" emails to ${r.email} again?`, confirmLabel: "Send them again" })) return;
    try { await apiRequest(`/admin/emails/optouts?email=${encodeURIComponent(r.email)}&kind=${encodeURIComponent(r.kind)}`, "DELETE"); setNote(`${r.email} gets "${labelOf(r.kind)}" emails again.`); load(); }
    catch (e) { setProblem(problemOf(e).message); }
  }
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-slate-500">People who used an email's Unsubscribe link (or their mail app's unsubscribe button). Their opt-out holds for optional emails only: account emails and things they ask for always go.</p>
      {note && <Notice tone="emerald">{note}</Notice>}
      {problem && <Notice tone="rose" role="alert">{problem}</Notice>}
      {!rows ? (!problem && <p role="status" className="text-sm text-slate-500">Loading…</p>) : (
        <AdminTable caption="Opted out" minWidth={560} rows={rows} rowKey={(r) => `${r.email}|${r.kind}`} rowLabel={(r) => r.email} emptyText="Nobody has opted out." columns={[
          { key: "email", label: "Address", tdClass: "break-all" },
          { key: "kind", label: "Opted out of", render: (r) => labelOf(r.kind) },
          { key: "source", label: "How", render: (r) => ({ unsubscribe_link: "Unsubscribe link", one_click: "Mail app's button", admin: "By the team" }[r.source] || r.source || "") },
          { key: "created_at", label: "When", tdClass: "whitespace-nowrap", render: (r) => when(r.created_at) },
          { key: "undo", label: "", render: (r) => <Btn kind="link" className="text-[13px]" onClick={() => undo(r)}>Undo</Btn> },
        ]} />
      )}
    </div>
  );
}

export default function EmailsAdmin({ onOpenTab }) {
  const [view, setView] = useState("sent");
  const [data, setData] = useState(null);
  const [problem, setProblem] = useState(null);
  const load = useCallback(() => apiRequest("/admin/emails/kinds", "GET").then((r) => { setData(r); setProblem(null); }).catch((e) => setProblem(problemOf(e).message)), []);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Emails</h1>
        <p className="text-[13px] text-slate-500">Everything the platform emails: what was sent, which kinds are switched on, their wording, and emails from you to one person or many.</p>
      </div>
      {data && !data.set_up && <Notice tone="amber">The Emails area isn't set up yet: run migration 047_email_admin.sql in Supabase. Until then nothing is logged and every email goes out as written in the product.</Notice>}
      {problem && <Notice tone="rose" role="alert">{problem}</Notice>}
      <div role="tablist" aria-label="Emails" className="flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-800">
        {[["sent", "Sent"], ["kinds", "Kinds of email"], ["optouts", "Opted out"], ["send", "Send an email"], ["bulk", "Bulk email"]].map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => setView(k)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${view === k ? "border-brand-600 text-brand-700 dark:text-brand-300" : "border-transparent text-slate-500 hover:text-slate-700"}`}>{l}</button>
        ))}
      </div>
      {view === "sent" && <Sent kinds={data?.items || []} />}
      {view === "kinds" && (data ? <Kinds data={data} reload={load} onOpenTab={onOpenTab} /> : !problem && <p role="status" className="text-sm text-slate-500">Loading…</p>)}
      {view === "optouts" && <OptedOut kinds={data?.items || []} />}
      {view === "send" && <SendOne />}
      {view === "bulk" && <BulkEmail />}
    </div>
  );
}
