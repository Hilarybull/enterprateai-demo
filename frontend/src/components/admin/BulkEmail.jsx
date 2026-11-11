import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "../../api/client";
import { AdminTable, Chip } from "./AdminUI";
import { Btn, Notice, inputClass } from "../readiness/Fields";
import { confirmDialog } from "../../lib/dialog";

// Bulk email (the owner, 11 Nov): pick people from users, workspaces, claimed and unclaimed Marketplace profiles, filter
// them, add addresses by hand, and send one message. Each person gets their own copy with an unsubscribe link.

const SOURCES = [["users", "Users"], ["workspaces", "Workspaces"], ["claimed", "Claimed profiles"], ["unclaimed", "Unclaimed profiles"]];
const MARKETING = { agreed: ["Agreed", "emerald"], not_agreed: ["Not agreed", "slate"], unsubscribed: ["Unsubscribed", "rose"], unknown: ["Unknown", "slate"] };
const EMPTY_FILTER = { q: "", plan: "", marketing: "", category: "", since: "", withEmail: true };
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const problemOf = (e) => String((typeof e?.detail === "string" && e.detail) || e?.message || "Something went wrong.").replace(/^HTTP \d+:\s*/, "");

const pickable = (r) => Boolean(r.email) && r.marketing !== "unsubscribed";

export default function BulkEmail() {
  const [source, setSource] = useState("users");
  const [lists, setLists] = useState({});
  const [problem, setProblem] = useState(null);
  const [filter, setFilter] = useState(EMPTY_FILTER);
  const [picked, setPicked] = useState(() => new Map());      // key -> { email, name, from }
  const [typed, setTyped] = useState("");
  const [form, setForm] = useState({ subject: "", body: "", reply_to: "" });
  const [state, setState] = useState({});
  const [job, setJob] = useState(null);

  useEffect(() => {
    if (lists[source]) return;
    setProblem(null);
    apiRequest(`/admin/emails/audience?source=${source}`, "GET")
      .then((r) => setLists((l) => ({ ...l, [source]: r.items || [] })))
      .catch((e) => setProblem(problemOf(e)));
  }, [source, lists]);
  useEffect(() => { setFilter(EMPTY_FILTER); }, [source]);

  // A running send: check on it every two seconds until it's done.
  useEffect(() => {
    if (!job?.id || job.finished_at) return undefined;
    const t = setTimeout(() => apiRequest(`/admin/emails/bulk/${job.id}`, "GET").then((r) => setJob((j) => ({ ...j, ...r }))).catch((e) => setJob((j) => ({ ...j, lost: problemOf(e), finished_at: "lost" }))), 2000);
    return () => clearTimeout(t);
  }, [job]);

  const rows = lists[source];
  const options = useMemo(() => {
    const of = (k) => [...new Set((rows || []).map((r) => r[k]).filter(Boolean))].sort();
    return { plans: of("plan"), categories: of("category") };
  }, [rows]);
  const shown = useMemo(() => (rows || []).filter((r) => {
    const words = filter.q.trim().toLowerCase();
    if (words && !`${r.name} ${r.email} ${r.owner || ""} ${r.location || ""} ${r.category || ""}`.toLowerCase().includes(words)) return false;
    if (filter.withEmail && !r.email) return false;
    if (filter.plan && r.plan !== filter.plan) return false;
    if (filter.marketing && r.marketing !== filter.marketing) return false;
    if (filter.category && r.category !== filter.category) return false;
    if (filter.since && (r.since || "") < filter.since) return false;
    return true;
  }), [rows, filter]);

  const label = SOURCES.find(([k]) => k === source)[1];
  const add = (list) => setPicked((m) => { const next = new Map(m); list.filter(pickable).forEach((r) => next.set(r.key, { email: r.email, name: r.name, from: label })); return next; });
  const selection = {
    selected: new Set([...picked.keys()].filter((k) => (rows || []).some((r) => r.key === k))),
    onChange: (keys) => setPicked((m) => {
      const next = new Map([...m].filter(([k]) => keys.has(k) || !(rows || []).some((r) => r.key === k)));
      (rows || []).filter((r) => keys.has(r.key) && pickable(r)).forEach((r) => next.set(r.key, { email: r.email, name: r.name, from: label }));
      return next;
    }),
  };

  const typedList = typed.split(/[\s,;]+/).map((a) => a.trim().toLowerCase()).filter(Boolean);
  const badTyped = typedList.filter((a) => !EMAIL.test(a));
  const recipients = useMemo(() => {
    const seen = new Set();
    return [...picked.values(), ...typedList.filter((a) => EMAIL.test(a)).map((email) => ({ email, name: "", from: "Added by hand" }))]
      .filter((r) => { const k = r.email.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  }, [picked, typed]); // eslint-disable-line react-hooks/exhaustive-deps
  const ready = recipients.length > 0 && form.subject.trim().length >= 3 && form.body.trim().length >= 5;
  const payload = (test) => ({ recipients: recipients.map(({ email, name }) => ({ email, name })), subject: form.subject, body: form.body, reply_to: form.reply_to.trim() || null, test });

  async function test() {
    setState({ busy: true });
    try {
      const r = await apiRequest("/admin/emails/bulk", "POST", payload(true));
      setState({ note: r.sent ? `A test went to ${r.to}, filled in for the first person on the list.` : `The test wasn't sent: ${r.error}` });
    } catch (e) { setState({ problem: problemOf(e) }); }
  }
  async function send() {
    const who = `${recipients.length.toLocaleString()} ${recipients.length === 1 ? "person" : "people"}`;
    if (!await confirmDialog(`"${form.subject.trim()}" goes to ${who}, each with their own copy. Once it starts it can't be stopped.`,
      { title: `Send to ${who}?`, confirmLabel: `Send to ${who}` })) return;
    setState({ busy: true });
    try {
      const r = await apiRequest("/admin/emails/bulk", "POST", payload(false));
      setJob(r); setState({}); setPicked(new Map()); setTyped(""); setForm({ subject: "", body: "", reply_to: "" });
    } catch (e) { setState({ problem: problemOf(e) }); }
  }

  const columns = {
    users: [
      { key: "name", label: "Name", render: (r) => r.name || <span className="text-slate-400">No name</span> },
      { key: "email", label: "Email", tdClass: "break-all" },
      { key: "plan", label: "Plan", render: (r) => <span className="capitalize">{r.plan}</span> },
      { key: "marketing", label: "Marketing emails", render: (r) => <Chip tone={(MARKETING[r.marketing] || MARKETING.unknown)[1]}>{(MARKETING[r.marketing] || MARKETING.unknown)[0]}</Chip> },
      { key: "since", label: "Joined", tdClass: "whitespace-nowrap" },
    ],
    workspaces: [
      { key: "name", label: "Workspace" },
      { key: "email", label: "Owner", tdClass: "break-all", render: (r) => <>{r.owner && <span className="block">{r.owner}</span>}{r.email || <span className="text-slate-400">No email</span>}</> },
      { key: "plan", label: "Plan", render: (r) => <span className="capitalize">{r.plan}</span> },
      { key: "marketing", label: "Marketing emails", render: (r) => <Chip tone={(MARKETING[r.marketing] || MARKETING.unknown)[1]}>{(MARKETING[r.marketing] || MARKETING.unknown)[0]}</Chip> },
      { key: "since", label: "Created", tdClass: "whitespace-nowrap" },
    ],
    profile: [
      { key: "name", label: "Business" },
      { key: "email", label: "Email", tdClass: "break-all", render: (r) => r.email || <span className="text-slate-400">No email</span> },
      { key: "category", label: "Category" },
      { key: "location", label: "Location" },
    ],
  };
  const people = source === "users" || source === "workspaces";
  const addable = shown.filter(pickable).length;

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-slate-500">Pick people from any list below, or type addresses in, then write one message. Each person gets their own copy with an unsubscribe link. People who unsubscribed are left out.</p>

      <section aria-label="Choose people" className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div role="tablist" aria-label="Who from" className="flex flex-wrap gap-1.5">
          {SOURCES.map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={source === k} onClick={() => setSource(k)}
              className={`rounded-full px-3 py-1.5 text-[13px] font-semibold ${source === k ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200"}`}>{l}</button>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <input aria-label="Search" placeholder={people ? "Search name or email" : "Search business, email, place"} className={inputClass} value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} />
          {people && (
            <select aria-label="Plan" className={inputClass} value={filter.plan} onChange={(e) => setFilter({ ...filter, plan: e.target.value })}>
              <option value="">Every plan</option>{options.plans.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          )}
          {people && (
            <select aria-label="Marketing emails" className={inputClass} value={filter.marketing} onChange={(e) => setFilter({ ...filter, marketing: e.target.value })}>
              <option value="">Any marketing choice</option><option value="agreed">Agreed to marketing</option><option value="not_agreed">Not agreed</option><option value="unsubscribed">Unsubscribed</option>
            </select>
          )}
          {!people && (
            <select aria-label="Category" className={inputClass} value={filter.category} onChange={(e) => setFilter({ ...filter, category: e.target.value })}>
              <option value="">Every category</option>{options.categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          <label className="flex items-center gap-2 text-[12px] font-semibold text-slate-600 dark:text-slate-300">{people ? "Joined from" : "Listed from"}
            <input type="date" aria-label={people ? "Joined from" : "Listed from"} className={inputClass} value={filter.since} onChange={(e) => setFilter({ ...filter, since: e.target.value })} /></label>
          {!people && (
            <label className="flex items-center gap-2 text-[13px] text-slate-600 dark:text-slate-300">
              <input type="checkbox" checked={filter.withEmail} onChange={(e) => setFilter({ ...filter, withEmail: e.target.checked })} /> Only ones with an email</label>
          )}
        </div>
        {problem && <Notice tone="rose" role="alert">{problem}</Notice>}
        {!rows ? (!problem && <p role="status" className="text-sm text-slate-500">Loading…</p>) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              <span className="text-slate-500">{shown.length.toLocaleString()} shown</span>
              <Btn className="!py-1.5 !text-[13px]" disabled={!addable} onClick={() => add(shown)}>Pick all {addable.toLocaleString()} shown</Btn>
              {(filter.q || filter.plan || filter.marketing || filter.category || filter.since) && <Btn kind="link" className="text-[13px]" onClick={() => setFilter(EMPTY_FILTER)}>Clear filters</Btn>}
            </div>
            <AdminTable caption={label} minWidth={640} rows={shown} rowKey={(r) => r.key} rowLabel={(r) => r.name || r.email} selection={selection}
              emptyText="Nobody matches these filters." columns={columns[people ? source : "profile"]} />
          </>
        )}
        <label className="block text-[12px] font-semibold text-slate-700 dark:text-slate-200">Add addresses by hand (commas or new lines)
          <textarea rows={2} className={`mt-1 ${inputClass}`} value={typed} onChange={(e) => setTyped(e.target.value)} /></label>
        {badTyped.length > 0 && <p role="alert" className="text-[12px] font-medium text-rose-600">Check these addresses: {badTyped.join(", ")}</p>}
      </section>

      <section aria-label="Write the email" className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{recipients.length.toLocaleString()} {recipients.length === 1 ? "person" : "people"} picked</p>
          {recipients.length > 0 && <Btn kind="link" className="text-[13px]" onClick={() => { setPicked(new Map()); setTyped(""); }}>Clear all</Btn>}
        </div>
        {recipients.length > 0 && (
          <ul aria-label="People picked" className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
            {recipients.slice(0, 60).map((r) => (
              <li key={r.email} className="flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[12px] text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                <span title={r.from}>{r.name ? `${r.name} · ` : ""}{r.email}</span>
                {r.from !== "Added by hand" && <button type="button" aria-label={`Remove ${r.email}`} className="font-bold text-slate-400 hover:text-slate-700"
                  onClick={() => setPicked((m) => new Map([...m].filter(([, v]) => v.email !== r.email)))}>×</button>}
              </li>
            ))}
            {recipients.length > 60 && <li className="px-2 py-1 text-[12px] text-slate-500">and {(recipients.length - 60).toLocaleString()} more</li>}
          </ul>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-[12px] font-semibold text-slate-700 dark:text-slate-200">Subject<input className={`mt-1 ${inputClass}`} value={form.subject} maxLength={300} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></label>
          <label className="block text-[12px] font-semibold text-slate-700 dark:text-slate-200">Replies go to (optional)<input type="email" className={`mt-1 ${inputClass}`} value={form.reply_to} onChange={(e) => setForm({ ...form, reply_to: e.target.value })} placeholder="Our usual address" /></label>
        </div>
        <label className="block text-[12px] font-semibold text-slate-700 dark:text-slate-200">Message
          <textarea rows={8} className={`mt-1 ${inputClass}`} value={form.body} maxLength={8000} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder={"Hi {name},\n\n"} /></label>
        <p className="text-[12px] text-slate-500">Write {"{name}"} to use each person's or business's name. Up to 2,000 people at a time; they go out at about two a second.</p>
        {state.problem && <p role="alert" className="text-[12px] font-medium text-rose-600">{state.problem}</p>}
        {state.note && <Notice tone="emerald">{state.note}</Notice>}
        <div className="flex flex-wrap gap-2">
          <Btn disabled={state.busy || !ready} onClick={test}>Send me a test</Btn>
          <Btn kind="primary" disabled={state.busy || !ready || badTyped.length > 0 || (job && !job.finished_at)} onClick={send}>
            {state.busy ? "Starting…" : `Send to ${recipients.length.toLocaleString()} ${recipients.length === 1 ? "person" : "people"}`}</Btn>
        </div>
      </section>

      {job && (
        <Notice tone={job.lost ? "amber" : job.finished_at ? (job.failed ? "amber" : "emerald") : "slate"}>
          <span>
            {job.lost ? job.lost
              : job.finished_at ? `"${job.subject}" finished: ${job.sent} sent${job.opted_out ? `, ${job.opted_out} had unsubscribed` : ""}${job.failed ? `, ${job.failed} not sent` : ""}. Each one is in the Sent tab.`
                : `Sending "${job.subject}": ${job.done} of ${job.total}…`}
            {job.left_out && (job.left_out.unsubscribed > 0 || job.left_out.duplicates > 0) && ` Left out: ${[job.left_out.unsubscribed && `${job.left_out.unsubscribed} unsubscribed`, job.left_out.duplicates && `${job.left_out.duplicates} repeated`].filter(Boolean).join(", ")}.`}
          </span>
        </Notice>
      )}
    </div>
  );
}
