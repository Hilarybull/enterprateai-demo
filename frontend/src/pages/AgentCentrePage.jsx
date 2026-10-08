import { DraftDrawer } from "../components/agent/DraftEditor";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import { LoadError, SettingsSkeleton, SkeletonRegion, SkeletonTable } from "../components/Skeleton";
import AgentPanel from "../components/agent/AgentPanel";
import { Icon, Modal, Pill, QuestionForm } from "../components/agent/AgentBits";
import { agentErrorMessage, answerRun, forgetAgentFact, getAgentMemory, getAgentPolicy, getAgentSummary, listDocuments, listRuns, queryOf, runStateLabel, runTone, saveAgentFact, saveAgentPolicy } from "../lib/agent";
import { useWorkspaceStore } from "../store/workspace";
import Pagination, { PAGE_SIZE, pageSlice } from "../components/Pagination";

const TABS = [
  { key: "active", label: "Active", empty: "No tasks in progress." },
  { key: "needs_approval", label: "Needs Approval", empty: "Nothing is waiting for approval." },
  { key: "needs_attention", label: "Needs You", empty: "Nothing needs you right now. The Agent is handling the rest." },
  { key: "completed", label: "Recently Completed", empty: "No completed tasks yet." },
  { key: "history", label: "History", empty: "No tasks match these filters." },
  { key: "documents", label: "Documents", empty: "No documents yet. Ask for a quotation, an invoice or a proposal and it will appear here." },
];
const DOC_TONE = { awaiting_approval: "amber", draft: "slate", sent: "indigo", viewed: "indigo", pending: "indigo", accepted: "emerald", won: "emerald", paid: "emerald",
  signed: "emerald", overdue: "rose", declined: "rose", lost: "rose", disputed: "rose", credited: "slate", void: "slate", voided: "slate", cancelled: "slate", expired: "slate" };
const docMoney = (d) => {
  try { return new Intl.NumberFormat("en-GB", { style: "currency", currency: d.currency || "GBP" }).format(Number(d.total || 0)); } catch { return String(d.total ?? ""); }
};

/** Every document on record: what it is, who it is for, its amount and status, and Edit draft while it waits for approval. */
export function DocumentList({ documents, kind, onKind, onOpen, onEdit, search: searchProp, order: orderProp, onSearch, onOrder }) {
  // Given onSearch/onOrder, the page owns the search and order (kept in the address, applied by the server) and the rows arrive ready.
  const paged = typeof onSearch === "function";
  const [localSearch, setLocalSearch] = useState("");
  const [localOrder, setLocalOrder] = useState("newest");
  const search = paged ? (searchProp || "") : localSearch;
  const order = paged ? (orderProp || "newest") : localOrder;
  const setSearch = paged ? onSearch : setLocalSearch;
  const setOrder = paged ? onOrder : setLocalOrder;
  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const all = documents?.items || [];
  const items = paged ? all : all
    .filter((d) => !kind || d.kind === kind)
    .filter((d) => words.every((w) => `${d.kind_label} ${d.reference} ${d.party} ${d.status_label} ${d.total}`.toLowerCase().includes(w)))
    // What waits for approval always leads; the rest by the document's date.
    .map((d, i) => [d, i])
    .sort(([a, i], [b, j]) => (Number(b.status === "awaiting_approval") - Number(a.status === "awaiting_approval"))
      || (order === "oldest" ? String(a.date || "").localeCompare(String(b.date || "")) : String(b.date || "").localeCompare(String(a.date || ""))) || i - j)
    .map(([d]) => d);
  return (
    <div data-documents>
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-3 dark:border-slate-800">
        <select aria-label="Document type" className={selectCls} value={kind} onChange={(e) => onKind(e.target.value)}>
          <option value="">All documents ({documents?.all_total ?? documents?.total ?? 0})</option>
          {(documents?.kinds || []).map((k) => <option key={k.key} value={k.key}>{k.label}s ({documents?.counts?.[k.key] || 0})</option>)}
        </select>
        <input type="search" aria-label="Search documents" placeholder="Search by number, customer or status" value={search} onChange={(e) => setSearch(e.target.value)}
          className={`${selectCls} min-w-0 flex-1 sm:max-w-xs`} />
        <select aria-label="Order by date" className={selectCls} value={order} onChange={(e) => setOrder(e.target.value)}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
        <p className="w-full text-[12px] text-slate-500">Quotations, invoices, contracts, proposals, purchase orders, credit notes and receipts. A draft can be edited while it waits for your approval.</p>
      </div>
      {items.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-slate-500">{(paged ? documents?.all_total : all.length) && (words.length || kind) ? "No documents match." : TABS.find((t) => t.key === "documents").empty}</p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {items.map((d) => (
            <li key={`${d.kind}:${d.id}`} className="flex items-center" data-document={d.kind}>
              <button type="button" onClick={() => onOpen(d)} disabled={!d.run_id}
                className="flex min-w-0 flex-1 items-center gap-4 px-5 py-3.5 text-left transition hover:bg-slate-50 disabled:cursor-default disabled:hover:bg-transparent dark:hover:bg-slate-800/60">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-slate-800">
                  <Icon name={d.kind === "receipt" ? "mail" : "doc"} className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{d.kind_label} {d.reference}</span>
                    <Pill tone={DOC_TONE[d.status] || "slate"}>{d.status_label}</Pill>
                    {!d.run_id && !d.from_agent && <span data-by-hand className="rounded-full border border-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-500 dark:border-slate-700">Made by hand</span>}
                    {d.duplicate_number && <Pill tone="rose">Number used twice</Pill>}
                  </span>
                  <span className="mt-0.5 block truncate text-[13px] text-slate-500" title={[d.party, docMoney(d), d.date].filter(Boolean).join(" · ")}>
                    {[d.party, docMoney(d)].filter(Boolean).join(" · ")}<span className="sm:hidden">{d.date ? ` · ${d.date}` : ""}</span>
                  </span>
                </span>
                <span className="hidden shrink-0 text-right text-[12px] text-slate-400 sm:block">{d.date}</span>
                {d.run_id && <span className="shrink-0 text-slate-300"><Icon name="chevron" className="h-4 w-4" /></span>}
              </button>
              {d.can_edit && (
                <button type="button" onClick={() => onEdit(d)} aria-label={`Edit draft ${d.kind_label} ${d.reference}`}
                  className="mr-4 shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-[13px] font-semibold text-slate-600 hover:border-brand-300 hover:text-brand-700 dark:border-slate-700 dark:text-slate-300">Edit draft</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
const CAPABILITIES = [
  ["enquiry_to_quote", "Enquiry to Quote"], ["quote_to_cash", "Quote to Cash"], ["payment_followup", "Payment Follow-up"],
  ["receipt_send", "Receipt Sending"], ["risk_concentration", "Risk & Concentration"], ["scenario_help", "Scenario Help"],
  ["readiness_refresh", "Readiness Refresh"], ["launch_evidence_gaps", "Launch Evidence Gaps"], ["funding_pack_draft", "Funding Pack Draft"],
  ["registration_checklist", "Registration Checklist"], ["price_test", "Price Test"],
];
const STATUSES = [["running", "In progress"], ["awaiting_approval", "Needs approval"], ["succeeded", "Completed"], ["failed", "Needs attention"], ["cancelled", "Cancelled"]];
const fmt = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const browserZone = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
};
// Every IANA zone the browser knows, with the current choice always present.
function zoneOptions(current) {
  let zones = [];
  try { zones = Intl.supportedValuesOf("timeZone"); } catch { zones = []; }
  return [...new Set([current, browserZone(), "UTC", ...zones].filter(Boolean))];
}

const selectCls = "rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200";

const STARTS = {
  automatic: ["Starts by itself", "emerald"], suggested: ["Suggested to you", "slate"],
  upgrade: ["Needs an upgrade", "amber"], nothing: ["No task", "slate"],
};
const STARTS_TONE = { emerald: "bg-emerald-50 text-emerald-700", amber: "bg-amber-50 text-amber-700", slate: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" };

/** What the Agent does when something happens elsewhere in the product, as this business is set up now. */
/** Every capability: the plan it needs, what it costs, whether it waits for approval, and whether it can start by itself. */
export function CapabilityTable({ capabilities, items = {} }) {
  if (!capabilities?.length) return null;
  const families = [...new Set(capabilities.map((c) => c.family || "Other"))];
  return (
    <div data-capabilities>
      <p className="mb-1 text-[13px] font-semibold text-slate-700 dark:text-slate-300">What the Agent can do</p>
      <p className="mb-2 text-[12px] text-slate-500">Ask for any of these in your own words. It asks only for what it can't find in your records.</p>
      <div className="max-h-72 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700">
        <table className="w-full text-left text-[12px]">
          <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-800">
            <tr><th className="px-3 py-2 font-semibold">Task</th><th className="px-3 py-2 font-semibold">Plan</th><th className="px-3 py-2 font-semibold">AI Credits</th><th className="px-3 py-2 font-semibold">Starts by itself</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {families.map((family) => capabilities.filter((c) => (c.family || "Other") === family).map((c) => {
              const auto = c.automatic || [];
              const on = auto.some((a) => (a.key in items ? items[a.key] : a.on));
              return (
                <tr key={c.capability} data-capability={c.capability} className={c.available ? "" : "opacity-60"}>
                  <td className="px-3 py-2"><span className="font-semibold text-slate-800 dark:text-slate-100">{c.title}</span>
                    <span className="block text-[11px] text-slate-400">{family}{c.needs_approval ? " · waits for your approval before anything is sent" : ""}</span></td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{c.minimum_plan_label}{c.available ? "" : " (upgrade)"}</td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{c.credits}</td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{auto.length ? (on ? "Yes (switch above)" : "Can, switched off above") : "Only when you ask"}</td>
                </tr>
              );
            }))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EventList({ events, items, onToggle, canEdit }) {
  if (!events?.length) return null;
  return (
    <section aria-label="What the Agent does by itself" className="space-y-2">
      <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">What the Agent does by itself</h3>
      <p className="text-[12px] text-slate-500 dark:text-slate-400">Switch any of these off and the Agent will suggest it instead of doing it. Anything that goes to a customer still waits in Needs Approval. Payments, bank actions and legal filings are never automatic.</p>
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
        {events.map((e) => {
          const on = e.switchable ? (items?.[e.key] ?? e.on) : false;
          const starts = !e.capability ? "nothing" : !e.available ? "upgrade" : on ? "automatic" : "suggested";
          return (
            <li key={e.event} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">{e.event}{e.task ? ` → ${e.task}` : ""}</p>
                <p className="text-[12px] text-slate-500 dark:text-slate-400">{e.approval}{e.minimum_plan_label ? ` Needs the ${e.minimum_plan_label} plan.` : ""}{e.credits ? ` Cost: ${e.credits}.` : ""}</p>
              </div>
              <span className="flex shrink-0 items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STARTS_TONE[(STARTS[starts] || STARTS.nothing)[1]]}`}>{(STARTS[starts] || STARTS.nothing)[0]}</span>
                {e.switchable && (
                  <input type="checkbox" role="switch" className="h-4 w-4 accent-brand-600" aria-label={`${e.event}: do this automatically`}
                    checked={Boolean(on && e.available)} disabled={!canEdit || !e.available} onChange={(ev) => onToggle(e.key, ev.target.checked)} />
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The facts the owner has asked the assistant to remember about this business. */
function Memory({ businessId }) {
  const [state, setState] = useState(null);
  const [text, setText] = useState("");
  const [problem, setProblem] = useState("");
  const load = useCallback(() => getAgentMemory(businessId).then(setState).catch(() => setState({ facts: [], can_edit: false })), [businessId]);
  useEffect(() => { load(); }, [load]);
  if (!state) return null;
  async function add(e) {
    e.preventDefault();
    setProblem("");
    try { await saveAgentFact(businessId, text.trim()); setText(""); await load(); } catch (err) { setProblem(agentErrorMessage(err, "That couldn't be saved.")); }
  }
  async function forget(id) {
    try { await forgetAgentFact(businessId, id); await load(); } catch (err) { setProblem(agentErrorMessage(err, "That couldn't be removed.")); }
  }
  return (
    <section aria-label="What the assistant remembers" className="space-y-2">
      <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">What the assistant remembers</h3>
      <p className="text-[12px] text-slate-500 dark:text-slate-400">Facts you've confirmed about this business. They're used for this business only. In the chat, say “remember that…” to add one.</p>
      {state.facts.length === 0 && <p className="text-[13px] text-slate-500">Nothing saved yet.</p>}
      <ul className="space-y-1">
        {state.facts.map((f) => (
          <li key={f.id} className="flex items-start justify-between gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-[13px] text-slate-700 dark:border-slate-700 dark:text-slate-200">
            <span className="min-w-0 break-words">{f.text}</span>
            {state.can_edit && <button type="button" onClick={() => forget(f.id)} aria-label={`Forget: ${f.text}`} className="shrink-0 text-[12px] font-semibold text-rose-600 hover:underline">Forget</button>}
          </li>
        ))}
      </ul>
      {state.can_edit && (
        <form onSubmit={add} className="flex gap-2">
          <input aria-label="A fact to remember" value={text} onChange={(e) => setText(e.target.value)} maxLength={300} placeholder="For example: we don't take bookings in August"
            className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900" />
          <button type="submit" disabled={text.trim().length < 3} className="rounded-xl border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200">Remember</button>
        </form>
      )}
      {problem && <p role="alert" className="text-[12px] text-rose-600">{problem}</p>}
    </section>
  );
}

function Settings({ businessId, onClose }) {
  const [state, setState] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setError("");
    getAgentPolicy(businessId).then((res) => {
      setState(res);
      const p = res.policy;
      setForm({
        contract_route: p.contract_route, vat: p.default_vat_rate == null ? "" : String(p.default_vat_rate),
        quote_validity_days: p.quote_validity_days, default_payment_terms_days: p.default_payment_terms_days,
        member_can_approve: !!p.member_can_approve, reminders_auto_send: !!p.reminders?.auto_send,
        items: Object.fromEntries((res.events || []).filter((e) => e.key).map((e) => [e.key, Boolean(e.on)])),
        credit_cap: res.automatic_budget?.cap ?? 50,
        cadence: (p.reminders?.cadence_days_overdue || []).join(", "), max_reminders: p.reminders?.max_reminders ?? 3,
        concentration_alert_pct: p.risk?.concentration_alert_pct ?? 40,
        timezone: res.timezone || browserZone(),
      });
    }).catch((e) => setError(agentErrorMessage(e)));
  }, [businessId, attempt]);

  async function save() {
    setSaving(true);
    setError("");
    try {
      await saveAgentPolicy(businessId, {
        contract_route: form.contract_route,
        ...(form.vat === "" ? { clear_vat_rate: true } : { default_vat_rate: Number(form.vat) }),
        quote_validity_days: Number(form.quote_validity_days), default_payment_terms_days: Number(form.default_payment_terms_days),
        member_can_approve: form.member_can_approve, reminders_auto_send: form.reminders_auto_send,
        automation_items: form.items, automation_credit_cap: Math.max(0, Number(form.credit_cap) || 0),
        reminder_cadence_days: String(form.cadence).split(",").map((s) => Number(s.trim())).filter((n) => n > 0),
        max_reminders: Number(form.max_reminders), concentration_alert_pct: Number(form.concentration_alert_pct),
        ...(form.timezone && form.timezone !== state.timezone ? { timezone: form.timezone } : {}),
      });
      onClose(true);
    } catch (e) {
      setError(agentErrorMessage(e));
      setSaving(false);
    }
  }

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const field = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";
  const label = "mb-1 block text-[13px] font-semibold text-slate-700 dark:text-slate-300";

  return (
    <Modal title="Agent settings" onClose={() => onClose(false)}>
      {!form ? (error ? <LoadError what="your Agent settings" detail={error} onRetry={() => setAttempt((n) => n + 1)} className="border-0 p-2" /> : <SettingsSkeleton />) : (
        <div className="space-y-4">
          {!state.can_edit && <p className="rounded-xl bg-slate-50 px-3 py-2 text-[13px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">Only the workspace owner can change these.</p>}
          <fieldset disabled={!state.can_edit || saving} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={label}>After a quote is accepted</label>
                <select className={field} value={form.contract_route} onChange={set("contract_route")}>
                  <option value="ask">Ask me each time</option>
                  <option value="direct_invoice">Invoice directly</option>
                  <option value="contract_first">Contract first, then invoice</option>
                </select>
              </div>
              <div>
                <label className={label}>Default VAT rate (%)</label>
                <input className={field} type="number" min="0" max="100" step="0.1" value={form.vat} onChange={set("vat")} placeholder="Ask me each time" />
              </div>
              <div>
                <label className={label}>Quotations valid for (days)</label>
                <input className={field} type="number" min="1" max="365" value={form.quote_validity_days} onChange={set("quote_validity_days")} />
              </div>
              <div>
                <label className={label}>Default payment terms (days)</label>
                <input className={field} type="number" min="0" max="365" value={form.default_payment_terms_days} onChange={set("default_payment_terms_days")} />
              </div>
              <div>
                <label className={label} htmlFor="agent-timezone">Business time zone</label>
                <select id="agent-timezone" className={field} value={form.timezone} onChange={set("timezone")}>
                  {zoneOptions(form.timezone).map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
                </select>
                <p className="mt-1 text-[11px] text-slate-400">Sets the date on invoices the Agent creates, and the day in their numbers.</p>
              </div>
              <div>
                <label className={label}>Send reminders at (days overdue)</label>
                <input className={field} value={form.cadence} onChange={set("cadence")} placeholder="3, 10, 21" />
              </div>
              <div>
                <label className={label}>Maximum reminders per invoice</label>
                <input className={field} type="number" min="0" max="6" value={form.max_reminders} onChange={set("max_reminders")} />
              </div>
              <div>
                <label className={label}>Concentration alert at (% of revenue)</label>
                <input className={field} type="number" min="5" max="100" value={form.concentration_alert_pct} onChange={set("concentration_alert_pct")} />
              </div>
            </div>
            <label className="flex items-start gap-2.5 text-sm text-slate-700 dark:text-slate-300">
              <input type="checkbox" className="mt-0.5 accent-brand-600" checked={form.member_can_approve} onChange={set("member_can_approve")} />
              <span>Let team members with Business Operations access approve what the Agent sends.</span>
            </label>
            <label className={`flex items-start gap-2.5 text-sm ${state.auto_reminders_available ? "text-slate-700 dark:text-slate-300" : "text-slate-400"}`}>
              <input type="checkbox" className="mt-0.5 accent-brand-600" checked={form.reminders_auto_send} onChange={set("reminders_auto_send")} disabled={!state.auto_reminders_available} />
              <span>
                Send payment reminders automatically, within the schedule above, without asking me each time.
                {!state.auto_reminders_available && <span className="block text-[12px]">Available on the Decision Engine plan.</span>}
              </span>
            </label>
          </fieldset>
          <div>
            <label className={label} htmlFor="agent-credit-cap">Monthly budget for automatic work (AI Credits)</label>
            <input id="agent-credit-cap" className={field} type="number" min="0" max="100000" value={form.credit_cap} onChange={set("credit_cap")} disabled={!state.can_edit} />
            <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400">
              Used this month: {state.automatic_budget?.used ?? 0} of {state.automatic_budget?.cap ?? form.credit_cap}.
              {state.automatic_budget?.paused ? " Paused: automatic work that costs credits waits until you raise this or the month ends." : " When it is used up, automatic work that costs credits pauses; free work carries on."}
            </p>
          </div>
          <EventList events={state.events} items={form.items} canEdit={state.can_edit}
            onToggle={(key, on) => setForm((f) => ({ ...f, items: { ...f.items, [key]: on } }))} />
          <CapabilityTable capabilities={state.capabilities} items={form.items} />
          <Memory businessId={businessId} />
          {error && <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => onClose(false)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300">Close</button>
            {state.can_edit && <button type="button" disabled={saving} onClick={save} className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">{saving ? "Saving…" : "Save settings"}</button>}
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function AgentCentrePage() {
  const navigate = useNavigate();
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.key === params.get("tab")) ? params.get("tab") : "active";
  const [answering, setAnswering] = useState(null);            // the task whose question is being answered
  const [answerProblem, setAnswerProblem] = useState(null);
  const [runs, setRuns] = useState([]);
  const [runTotal, setRunTotal] = useState(0);
  const [counts, setCounts] = useState({});
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Tab, filters, search, order and page are all in the address, so a refresh or Back keeps your place.
  const get = (k) => params.get(k) || "";
  const filters = { capability: get("capability"), status: get("status"), from: get("from"), to: get("to") };
  const docKind = get("type"), docSearch = get("q"), docOrder = get("sort") || "newest";
  const at = pageSlice(Infinity, params.get("page"), params.get("more"));      // the total isn't known until the page arrives
  /** Change what is being looked at. Anything but the page itself starts again from page 1. */
  const look = useCallback((patch, keepPage = false) => {
    setParams((prev) => {
      const out = new URLSearchParams(prev);
      if (!keepPage) { out.delete("page"); out.delete("more"); }
      for (const [k, v] of Object.entries(patch)) { if (v === "" || v == null || v === 1 || v === "1") out.delete(k); else out.set(k, String(v)); }
      return out;
    }, { replace: !("tab" in patch) && !("page" in patch) });
  }, [setParams]);
  const setFilters = (fn) => { const next = fn(filters); look({ capability: next.capability, status: next.status, from: next.from, to: next.to }); };
  const [settings, setSettings] = useState(false);
  const [draft, setDraft] = useState(null);      // the task whose draft is open in the drawer: { runId, edit }
  const [documents, setDocuments] = useState(null);
  const setDocKind = (v) => look({ type: v });

  // The one page being looked at is asked for, with its filters; the other list is asked only for its total (the number on its tab).
  const runQuery = tab === "documents" ? queryOf({ limit: 1 })
    : queryOf({ bucket: tab, ...(tab === "history" ? { capability: filters.capability, status: filters.status, date_from: filters.from, date_to: filters.to } : {}), limit: at.limit, offset: at.offset });
  const docQuery = tab === "documents" ? { kind: docKind, q: docSearch, order: docOrder === "newest" ? "" : docOrder, limit: at.limit, offset: at.offset } : { limit: 1 };
  const docKey = JSON.stringify(docQuery);
  const load = useCallback(async () => {
    if (!workspaceId) { setLoading(false); return; }
    // Loaded independently: if the task list can't load, the Agent panel (with its
    // allowance header) still works, and vice versa.
    const [list, sum, docs] = await Promise.allSettled([listRuns(workspaceId, runQuery), getAgentSummary(workspaceId), listDocuments(workspaceId, JSON.parse(docKey))]);
    if (docs.status === "fulfilled") setDocuments(docs.value);
    if (sum.status === "fulfilled") setSummary(sum.value);
    if (list.status === "fulfilled") {
      setRuns(list.value.items || []);
      setRunTotal(list.value.total ?? (list.value.items || []).length);
      setCounts(list.value.counts || {});
    }
    const failed = list.status === "rejected" ? list.reason : sum.status === "rejected" ? sum.reason : null;
    setError(failed ? agentErrorMessage(failed, "The Agent Centre could not be loaded.") : "");
    setLoading(false);
  }, [workspaceId, runQuery, docKey]);

  // A short pause, so typing in the search box asks once, not on every letter.
  useEffect(() => { const t = setTimeout(load, docSearch ? 250 : 0); return () => clearTimeout(t); }, [load, docSearch]);

  const visible = tab === "documents" ? [] : runs;
  const total = tab === "documents" ? documents?.total || 0 : runTotal;
  // A page past the end (rows were approved or filtered away since): step back to the last page there is.
  useEffect(() => {
    if (!loading && total > 0 && at.offset >= total) look({ page: Math.ceil(total / PAGE_SIZE), more: "" }, true);
  }, [loading, total, at.offset, look]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Agent Centre"
        description="Everything the EnterprateAI Agent is doing for your business, what needs you, and what it has completed."
        actions={
          <button type="button" onClick={() => setSettings(true)}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
            Agent settings
          </button>
        }
      />

      {workspaceId && <AgentPanel businessId={workspaceId} summary={summary} onChanged={load} />}
      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700">{error}</p>}

      <div className="flex gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900" role="tablist">
        {TABS.map((t) => {
          // Totals, whatever page or filter is showing.
          const n = t.key === "documents" ? documents?.all_total ?? documents?.total ?? 0 : counts[t.key] || 0;
          return (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setParams({ tab: t.key })}
              className={`whitespace-nowrap rounded-xl px-3.5 py-2 text-sm font-semibold transition ${tab === t.key ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"}`}>
              {t.label}
              <span className={`ml-1.5 rounded-full px-1.5 text-[11px] ${tab === t.key ? "bg-white/20" : "bg-slate-100 text-slate-500 dark:bg-slate-800"}`}>{n}</span>
            </button>
          );
        })}
      </div>

      {tab === "history" && (
        <div className="flex flex-wrap items-end gap-3">
          <select aria-label="Capability" className={selectCls} value={filters.capability} onChange={(e) => setFilters((f) => ({ ...f, capability: e.target.value }))}>
            <option value="">All capabilities</option>
            {CAPABILITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select aria-label="Status" className={selectCls} value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
            <option value="">All statuses</option>
            {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <label className="text-[12px] text-slate-500">From<input type="date" className={`${selectCls} ml-1.5`} value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} /></label>
          <label className="text-[12px] text-slate-500">To<input type="date" className={`${selectCls} ml-1.5`} value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} /></label>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        {loading ? (
          <SkeletonRegion label="your Agent tasks"><SkeletonTable rows={5} widths={["minmax(0,1fr)", "7rem", "1rem"]} header={false} className="border-0" /></SkeletonRegion>
        ) : tab === "documents" ? (
          <DocumentList documents={documents} kind={docKind} onKind={setDocKind} search={docSearch} order={docOrder}
            onSearch={(v) => look({ q: v })} onOrder={(v) => look({ sort: v === "newest" ? "" : v })}
            onEdit={(d) => setDraft({ runId: d.run_id, edit: true })}
            onOpen={(d) => (d.status === "awaiting_approval" ? setDraft({ runId: d.run_id, edit: false }) : navigate(`/agent/runs/${d.run_id}`))} />
        ) : visible.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-500">{TABS.find((t) => t.key === tab).empty}</p>
        ) : (
          <ul key={`${tab}:${at.page}`} data-m="fadeIn" style={{ animationDuration: "150ms" }} className="divide-y divide-slate-100 dark:divide-slate-800">
            {visible.map((r) => (
              <li key={r.id} className="flex items-center">
                <button type="button" onClick={() => navigate(`/agent/runs/${r.id}`)}
                  className="flex min-w-0 flex-1 items-center gap-4 px-5 py-3.5 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800/60">
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{r.title}</span>
                      <Pill tone={runTone(r)}>{runStateLabel(r)}</Pill>
                      {(r.refs?.quote_reference || r.refs?.invoice_reference) && (
                        <span className="text-[12px] text-slate-400">{r.refs.invoice_reference || r.refs.quote_reference}</span>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-[13px] text-slate-500">
                      {r.question_title ? `${r.question_title}${r.question_detail ? ` (${r.question_detail})` : ""}` : r.status === "succeeded" ? r.summary : r.next_action || r.summary || r.goal}
                    </span>
                  </span>
                  <span className="hidden shrink-0 text-right text-[12px] text-slate-400 sm:block">{fmt(r.updated_at || r.created_at)}
                    {r.credits_used > 0 && <span className="block">{r.credits_used} credit{r.credits_used === 1 ? "" : "s"}</span>}
                  </span>
                  <span className="shrink-0 text-slate-300"><Icon name="chevron" className="h-4 w-4" /></span>
                </button>
                {r.status === "running" && r.pending_question && !r.pending_question.optional && (
                  // What only the owner can supply, asked here: the task carries on as soon as it is answered.
                  <div className="border-t border-slate-100 bg-slate-50/60 px-5 py-3 dark:border-slate-800 dark:bg-slate-800/40" aria-label={`Answer needed: ${r.title}`}>
                    <QuestionForm question={r.pending_question.question} fields={r.pending_question.fields} submitting={answering === r.id}
                      onSubmit={async (answers) => {
                        setAnswering(r.id);
                        setAnswerProblem(null);
                        try { await answerRun(r.id, answers); await load(); }
                        catch (e) { setAnswerProblem({ id: r.id, text: agentErrorMessage(e, "That answer couldn't be saved. Please try again.") }); }
                        finally { setAnswering(null); }
                      }} />
                    {answerProblem?.id === r.id && <p role="alert" className="mt-2 text-[12px] text-rose-600">{answerProblem.text}</p>}
                  </div>
                )}
                {r.bucket === "needs_approval" && (
                  <button type="button" onClick={() => setDraft({ runId: r.id, edit: true })} aria-label={`Edit ${r.title}${r.refs?.quote_reference ? ` ${r.refs.quote_reference}` : ""}`}
                    className="mr-4 shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-[13px] font-semibold text-slate-600 hover:border-brand-300 hover:text-brand-700 dark:border-slate-700 dark:text-slate-300">Edit</button>
                )}
              </li>
            ))}
          </ul>
        )}
        {!loading && (
          <Pagination total={total} page={at.page} more={at.more} noun={tab === "documents" ? "documents" : "tasks"} className="border-t border-slate-100 dark:border-slate-800"
            onPage={(n) => look({ page: n, more: "" }, true)} onMore={(n) => look({ more: n }, true)} />
        )}
      </div>

      {draft && <DraftDrawer key={`${draft.runId}:${draft.edit}`} runId={draft.runId} startEditing={draft.edit} onClose={() => setDraft(null)} onSaved={load} onOpenTask={(id) => { setDraft(null); navigate(`/agent/runs/${id}`); }} />}
      {settings && <Settings businessId={workspaceId} onClose={(saved) => { setSettings(false); if (saved) load(); }} />}
    </div>
  );
}
