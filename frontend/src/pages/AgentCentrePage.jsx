import UkDateInput from "../components/UkDateInput";
import AgentRows, { TYPE_OF, TYPES } from "../components/agent/AgentRows";
import AgentChat from "../components/BusinessAssistant";
import { DraftDrawer } from "../components/agent/DraftEditor";
import ResultsList, { useResultsCount } from "../components/agent/ResultsList";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { LoadError, SettingsSkeleton, SkeletonRegion, SkeletonTable } from "../components/Skeleton";
import AgentPanel from "../components/agent/AgentPanel";
import { ActivitySheet, ProfileSheet } from "../components/agent/Sheets";
import TaskList, { openInChat } from "../components/agent/TaskList";
import { Icon, Modal, Pill, QuestionForm } from "../components/agent/AgentBits";
import { agentErrorMessage, answerRun, forgetAgentFact, getAgentMemory, getAgentPolicy, getAgentSummary, listDocuments, listRuns, queryOf, runStateLabel, runTone, saveAgentFact, saveAgentPolicy } from "../lib/agent";
import { useWorkspaceStore } from "../store/workspace";
import { apiRequest, apiRequestCached } from "../api/client";
import Pagination, { PAGE_SIZE, pageSlice } from "../components/Pagination";

const TABS = [
  { key: "active", label: "Active", empty: "No tasks in progress." },
  { key: "needs_approval", label: "Needs Approval", empty: "Nothing is waiting for approval." },
  { key: "needs_attention", label: "Needs You", empty: "Nothing needs you right now. The Agent is handling the rest." },
  { key: "completed", label: "Recently Completed", empty: "No completed tasks yet." },
  { key: "history", label: "History", empty: "No tasks match these filters." },
  { key: "documents", label: "Documents", empty: "No documents yet. Ask for a quotation, an invoice or a proposal and it will appear here." },
  // Each check's first result, kept after it is dismissed or saved for later on the dashboard.
  { key: "results", label: "Results", empty: "No results yet. A check you run from the homepage or the dashboard leaves its result here." },
];
const DOC_TONE = { awaiting_approval: "amber", draft: "slate", sent: "indigo", viewed: "indigo", pending: "indigo", accepted: "emerald", won: "emerald", paid: "emerald",
  signed: "emerald", overdue: "rose", declined: "rose", lost: "rose", disputed: "rose", credited: "slate", void: "slate", voided: "slate", cancelled: "slate", expired: "slate" };
const docMoney = (d) => {
  if (d.total == null) return "";      // B9: a prepared document (a funding pack, a plan) has no amount
  try { return new Intl.NumberFormat("en-GB", { style: "currency", currencyDisplay: "narrowSymbol", currency: d.currency || "GBP" }).format(Number(d.total || 0)); } catch { return String(d.total ?? ""); }
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
        <p className="w-full text-[12px] text-slate-500">Quotations, invoices, contracts, proposals, purchase orders, credit notes and receipts, and what the Agent prepares for you to review (funding packs, business plans, sales letters). A draft can be edited while it waits for your approval.</p>
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
/** C1: the History filter lists every task in the registry, by its own title (never a list kept by hand). */
export function useCapabilityOptions() {
  const [options, setOptions] = useState([]);
  useEffect(() => {
    let live = true;
    apiRequestCached("/agent/capabilities")
      .then((res) => {
        if (!live) return;
        const rows = (res?.workflows || []).map((w) => [w.workflow_key, w.title]).filter(([k, t]) => k && t);
        setOptions(rows.sort((a, b) => a[1].localeCompare(b[1])));
      })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  return options;
}
const STATUSES = [["running", "In progress"], ["awaiting_approval", "Needs approval"], ["succeeded", "Completed"], ["nothing_to_do", "Nothing to do"], ["failed", "Needs attention"], ["cancelled", "Cancelled"]];
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
  automatic: ["Starts by itself", "emerald"], suggested: ["Suggests it", "slate"],
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
        credit_cap: res.automatic_budget?.cap ?? 50, auto_start: p.automation?.auto_start !== false,
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
        automation_items: form.items, automation_credit_cap: Math.max(0, Number(form.credit_cap) || 0), auto_start: Boolean(form.auto_start),
        reminder_cadence_days: String(form.cadence).split(",").map((s) => Number(s.trim())).filter((n) => n > 0),
        max_reminders: Number(form.max_reminders), concentration_alert_pct: Number(form.concentration_alert_pct),
        ...(form.timezone && form.timezone !== state.timezone ? { timezone: form.timezone, timezone_source: "owner" } : {}),
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
          <label className="flex items-start gap-2.5 text-sm text-slate-700 dark:text-slate-300">
            <input type="checkbox" className="mt-0.5 accent-brand-600" checked={Boolean(form.auto_start)} onChange={set("auto_start")} disabled={!state.can_edit} data-auto-start />
            <span>Let the Agent run checks on its own (uses credits). It never goes past the monthly budget below.</span>
          </label>
          <div>
            <label className={label} htmlFor="agent-credit-cap">Monthly budget for automatic work (credits)</label>
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
  const capabilityOptions = useCapabilityOptions();
  const navigate = useNavigate();
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const [params, setParams] = useSearchParams();
  // Short links from the dashboard and notifications: ?tab=approval, ?tab=needs-you.
  const asked = { approval: "needs_approval", approvals: "needs_approval", "needs-approval": "needs_approval", "needs-you": "needs_attention", "needs_you": "needs_attention" }[params.get("tab")] || params.get("tab");
  const tab = TABS.some((t) => t.key === asked) ? asked : "active";
  const [answering, setAnswering] = useState(null);            // the task whose question is being answered
  const [viewing, setViewing] = useState(null);      // "View profile" or Recent activity's "View all", opened beside the chat
  const closeView = useCallback(() => setViewing(null), []);
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
  // "Show more" instead of numbered pages (the owner, 27 Oct): the first ten, then ten more each time
  const [shownN, setShownN] = useState(10);
  useEffect(() => { setShownN(10); }, [params.get("tab")]);      // eslint-disable-line react-hooks/exhaustive-deps
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
  const resultsCount = useResultsCount(workspaceId);
  const setDocKind = (v) => look({ type: v });

  // The one page being looked at is asked for, with its filters; the other list is asked only for its total (the number on its tab).
  const runQuery = tab === "documents" || tab === "results" ? queryOf({ limit: 1 }) : queryOf({ bucket: tab, limit: shownN, offset: 0 });
  const docQuery = tab === "documents" ? { kind: docKind, q: docSearch, order: docOrder === "newest" ? "" : docOrder, limit: shownN, offset: 0 } : { limit: 1 };
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

  // The task tabs beside the chat, as the owner's mockup (27 Oct): the tabs and their counts, the list of the one picked;
  // on a phone the chat alone, the tasks in a sheet from "Tasks"
  const [kind, setKind] = useState("");
  const [sheet, setSheet] = useState(false);
  const [listOpen, setListOpen] = useState(params.has("tab"));
  const pick = (key) => { setParams({ tab: key }); setListOpen(true); };
  // The business, its risk and activity, and where each case and check stands: for the chat and the column beside it
  const [ctx, setCtx] = useState(null);
  const [work, setWork] = useState([]);
  const [workTick, setWorkTick] = useState(0);      // read again after each reply, so the cards show the case as it is now
  useEffect(() => {
    if (!workspaceId) return;
    let live = true;
    const read = (path) => apiRequest(path, "GET").catch(() => null);
    Promise.all([read(`/businesses/${workspaceId}/agent/assistant-context?kind=funding`), read(`/businesses/${workspaceId}/funding-cases`),
      read(`/businesses/${workspaceId}/launch-initiatives`), read(`/businesses/${workspaceId}/agent/assistant-context?kind=idea&case_id=idea`)]).then(([c, f, l, i]) => {
      if (!live) return;
      setCtx(c || {});      // read, even when it couldn't be: never a skeleton for ever
      // The newest open case first, never an older one the list happens to start with (the owner, 30 Oct: the van case's
      // 95/100 shown while the equipment case was the one being worked on)
      const at = (x) => String(x.updated_at || x.created_at || "");
      const open = (list) => (list?.items || []).filter((x) => !["archived", "cancelled"].includes(x.status)).sort((a, b) => (at(a) < at(b) ? 1 : at(a) > at(b) ? -1 : 0));
      const things = (n) => (n ? ` ${n} thing${n === 1 ? "" : "s"} to do.` : "");
      const out = [];
      const fc = open(f)[0];
      if (fc) out.push({ key: "funding", id: fc.id, kind: "funding", title: "Funding readiness", score: fc.summary?.score ?? null,
        detail: `${fc.title || "Your funding case"}.${fc.summary?.next_action?.title ? ` Next: ${fc.summary.next_action.title}.` : things(fc.summary?.open_actions)}`, to: `/funding/${fc.id}?tab=assistant` });
      const idea = i?.idea;
      if (idea && Object.keys(idea.answers || {}).length) {
        const sc = typeof idea.score_out_of_100 === "number" ? idea.score_out_of_100 : idea.partial_score;
        out.push({ key: "idea", kind: "idea", title: "Idea validation", score: sc ?? null, detail: `${idea.answers.description || "Your idea"}.${idea.weaknesses?.[0] ? ` ${idea.weaknesses[0]}.` : ""}`, to: "/check/idea?tab=assistant" });
      }
      const lp = open(l)[0];
      if (lp) out.push({ key: "launch", id: lp.id, kind: "launch", title: "Launch readiness", score: lp.summary?.score ?? null, detail: `${lp.title || "Your launch"}.${lp.summary?.next_action?.title ? ` Next: ${lp.summary.next_action.title}.` : things(lp.summary?.open_actions)}`, to: `/launch/${lp.id}?tab=assistant` });
      setWork(out.map((w) => ({ ...w, score: typeof w.score === "number" ? Math.round(w.score) : null })));
    });
    return () => { live = false; };
  }, [workspaceId, workTick]);
  // One number for what is waiting (the owner, 27 Oct: "Five things", "5 waiting" and a tab saying 6): the summary's, as the
  // dashboard's Needs Approval reads it, for the greeting, the card and the tab
  const waiting = summary ? { count: summary.needs_approval_count || 0, items: summary.needs_approval || [] } : null;
  const waitingCount = waiting ? waiting.count : counts.needs_approval || 0;
  const ORDER = ["needs_approval", "needs_attention", "active", "completed", "documents", "results", "history"];
  const COUNT_TONE = { needs_approval: "bg-blue-600 text-white", needs_attention: "bg-amber-100 text-amber-800", completed: "bg-emerald-100 text-emerald-700" };
  const shownTab = listOpen ? tab : (TABS.some((t) => t.key === asked) ? asked : "needs_approval");
  // Each tab's number, the one its list shows (the owner's QA, 27 Oct: "Needs Approval says 5 but the list shows 1-10 of 48")
  const countOf = (key) => (key === "documents" ? documents?.all_total ?? documents?.total ?? 0 : key === "results" ? resultsCount
    : key === "needs_approval" ? waitingCount : counts[key] || 0);
  const CARD = "rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900";
  const LINK = "text-[13.5px] font-medium text-blue-600 hover:underline";
  const TITLE = "text-[18px] font-bold text-slate-900 dark:text-slate-50";
  const panel = (
    <div className={`${CARD} flex min-h-0 flex-col ${listOpen ? "h-full" : ""}`} data-task-panel>
      <div className="flex items-center justify-between"><p className={TITLE}>Tasks</p>
        {!listOpen && <button type="button" onClick={() => pick(shownTab)} className={LINK}>View all →</button>}</div>
      {/* One line (the owner, 28 Oct): smaller chips, never wrapped; when they don't fit, the row scrolls sideways with no
          scrollbar shown and a soft fade at the right edge saying there is more */}
      {/* All six fit on one line, so none is cut (the owner, 28 Oct: "Launc"): short words, small chips */}
      <div className="mt-3 flex shrink-0 flex-nowrap justify-between gap-1" data-task-chips>
        {["", ...TYPES.filter((t) => t !== "Other")].map((t) => (
          <button key={t || "all"} type="button" aria-pressed={kind === t} onClick={() => setKind(t)} aria-label={t || "All"}
            className={`shrink-0 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[11.5px] ${kind === t ? "bg-blue-600 font-medium text-white" : "border border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"}`}>{t === "Quotations" ? "Quotes" : t || "All"}</button>
        ))}
      </div>
      {listOpen ? (
        <TaskList tab={tab} label={TABS.find((t) => t.key === tab)?.label} count={countOf(tab)} onBack={() => { setListOpen(false); look({ tab: "" }); }}
          loading={loading} empty={TABS.find((t) => t.key === tab)?.empty} total={total} onMore={() => setShownN((n) => n + 10)}
          waiting={(waiting?.items || []).filter((a) => !kind || TYPE_OF(a.kind) === kind)} runs={visible.filter((r) => !kind || TYPE_OF(r.workflow_key || r.capability) === kind)}
          documents={documents} docKind={docKind} onDocKind={setDocKind} docSearch={docSearch} onDocSearch={(v) => look({ q: v })} docOrder={docOrder}
          onDocOrder={(v) => look({ sort: v === "newest" ? "" : v })}
          onOpenRun={(r) => (r.bucket === "needs_approval" || r.display_status === "awaiting_approval" ? setDraft({ runId: r.id, edit: false }) : navigate(r.to || `/agent/runs/${r.id}`))}
          onOpenDoc={(d) => { setSheet(false); if (d.draft_id || d.approval_id) openInChat({ title: d.reference || d.kind_label, draft_id: d.draft_id, approval_id: d.approval_id, run_id: d.run_id, to: d.to }); else navigate(d.to || `/agent/runs/${d.run_id}`); }}
          results={<ResultsList businessId={workspaceId} empty={TABS.find((t) => t.key === "results").empty} />} />
      ) : (
      <ul role="tablist" aria-orientation="vertical" aria-label="Your tasks" className="mt-3 divide-y divide-slate-100 dark:divide-slate-800" data-agent-tabs>
        {ORDER.map((key) => TABS.find((t) => t.key === key)).map((t) => {
          const n = countOf(t.key);
          const on = shownTab === t.key;
          return (
            <li key={t.key} className={on ? "border-0" : ""}>
              <button type="button" role="tab" aria-selected={on} onClick={() => pick(t.key)}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[14px] transition ${on ? "bg-blue-50 text-blue-700 dark:bg-brand-950/40 dark:text-blue-200" : "text-slate-800 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"}`}>
                {t.label}
                {loading ? <span className="h-5 w-7 animate-pulse rounded-full bg-slate-100 dark:bg-slate-800" aria-hidden="true" />
                  : <span className={`min-w-6 rounded-full px-1.5 py-0.5 text-center text-[12px] ${COUNT_TONE[t.key] || "border border-slate-200 text-slate-600 dark:border-slate-700"}`}>{n}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      )}
    </div>
  );
  const money = (v, c) => { try { return new Intl.NumberFormat(undefined, { style: "currency", currency: c || "GBP", currencyDisplay: "narrowSymbol", maximumFractionDigits: 0 }).format(Number(v) || 0); } catch { return String(v); } };
  const since = (at) => { const h = (Date.now() - new Date(at).getTime()) / 3600000; return !Number.isFinite(h) ? "" : h < 1 ? `${Math.max(1, Math.round(h * 60))}m ago` : h < 24 ? `${Math.round(h)}h ago` : `${Math.round(h / 24)}d ago`; };
  const DOT = { invoice_paid: "bg-emerald-500", customer_added: "bg-blue-500", research: "bg-violet-500" };
  const b = ctx?.business;
  const Bone = ({ className }) => <span className={`block animate-pulse rounded bg-slate-100 dark:bg-slate-800 ${className}`} aria-hidden="true" />;
  const side = (
    <>
      <div className={CARD} data-side="workspace">
        <div className="flex items-center justify-between gap-2"><p className={`${TITLE} whitespace-nowrap`}>Business Workspace</p><button type="button" onClick={() => setViewing("profile")} className={`${LINK} whitespace-nowrap`}>View profile →</button></div>
        {!ctx ? (
          <div className="mt-3 space-y-3" aria-busy="true" aria-label="Loading your business">
            <div className="flex items-center gap-3"><Bone className="h-12 w-12 rounded-xl" /><span className="flex-1 space-y-2"><Bone className="h-4 w-40" /><Bone className="h-3 w-24" /></span></div>
            <div className="grid grid-cols-2 gap-3"><Bone className="h-9" /><Bone className="h-9" /></div>
          </div>
        ) : <>
        <div className="mt-3 flex items-center gap-3">
          {b?.logo ? <img src={b.logo} alt="" className="h-12 w-12 rounded-xl object-cover" /> : <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-[18px] font-semibold text-blue-700">{(b?.name || "?").slice(0, 1)}</span>}
          <span className="min-w-0"><span className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-slate-900 dark:text-slate-50">{b?.name || "Your business"}<span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[12px] font-medium text-emerald-700">Active</span></span>
            {b?.stage && <span className="text-[13.5px] text-slate-500">{b.stage} stage</span>}</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div><p className="text-[13px] text-slate-500">Location</p><p className="text-[14px] font-medium text-slate-900 dark:text-slate-100">{b?.location || "Not set"}</p></div>
          {/* What the figure is, said with it (the owner's QA, 27 Oct: ₦994,276 was labelled "a month") */}
          <div><p className="text-[13px] text-slate-500">Revenue, all time</p><p className="text-[14px] font-medium text-slate-900 dark:text-slate-100" data-revenue-all-time>{ctx?.revenue ? money(ctx.revenue.all_time ?? ctx.revenue.total, ctx.revenue.currency) : "Not known"}</p></div>
        </div>
        </>}
      </div>
      <div className={CARD} data-side="activity">
        <div className="flex items-center justify-between"><p className={TITLE}>Recent activity</p><button type="button" onClick={() => setViewing("activity")} className={LINK}>View all →</button></div>
        {!ctx ? (
          <div className="mt-3 space-y-3" aria-busy="true" aria-label="Loading recent activity">{[0, 1, 2].map((k) => <span key={k} className="flex gap-3"><Bone className="mt-1 h-2 w-2 rounded-full" /><span className="flex-1 space-y-1.5"><Bone className="h-3.5 w-3/4" /><Bone className="h-3 w-1/2" /></span></span>)}</div>
        ) : (ctx?.activity || []).length ? (
          <ul className="mt-3 space-y-3">{ctx.activity.slice(0, 4).map((a, i) => (
            <li key={`${a.kind}${i}`} className="flex items-start gap-3">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[a.kind] || "bg-violet-500"}`} aria-hidden="true" />
              <span className="min-w-0 flex-1"><span className="block text-[15px] font-semibold text-slate-900 dark:text-slate-100">{a.title}</span>{a.detail && <span className="block truncate text-[13.5px] text-slate-500">{a.detail}</span>}</span>
              <span className="shrink-0 text-[12px] text-slate-500">{since(a.at)}</span>
            </li>
          ))}</ul>
        ) : <p className="mt-2 text-[13.5px] text-slate-500">Nothing yet. Invoices, customers and research show here as they happen.</p>}
      </div>
      <div className={CARD} data-side="quick">
        <p className={TITLE}>Quick actions</p>
        <div className="mt-3 flex flex-wrap gap-2.5">
          <button type="button" onClick={() => pick("documents")} className="flex-1 whitespace-nowrap rounded-xl border border-slate-200 px-3 py-2.5 text-[14px] font-medium text-slate-900 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100">Upload documents</button>
          <button type="button" onClick={() => navigate("/integrations")} className="flex-1 whitespace-nowrap rounded-xl border border-slate-200 px-3 py-2.5 text-[14px] font-medium text-slate-900 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100">Connect data</button>
        </div>
      </div>
    </>
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-4" data-agent-page>
      <header className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-3" data-agent-header>
        <div className="min-w-0">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Agent Centre</p>
          <h1 className="mt-1 text-[28px] font-extrabold leading-tight text-slate-950 dark:text-slate-50 sm:text-[34px]">Your EnterprateAI Agent</h1>
          <p className="mt-1 text-[16px] text-slate-600 dark:text-slate-400 max-sm:hidden">Tell it the job. It works on your business data and asks before anything is sent or saved.</p>
        </div>
        {/* On a phone Tasks and Agent settings share the row (the owner, 28 Oct) */}
        <div className="flex shrink-0 gap-2 max-sm:w-full">
          <button type="button" onClick={() => setSheet(true)} data-tasks-button
            className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-[14px] font-medium text-slate-800 hover:bg-slate-50 max-sm:flex-1 xl:hidden dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
            Tasks{waitingCount ? ` · ${waitingCount}` : ""}</button>
          <button type="button" onClick={() => setSettings(true)} data-agent-settings
            className="whitespace-nowrap rounded-xl border border-slate-200 bg-white px-4 py-2 text-[14px] font-medium text-slate-900 hover:bg-slate-50 max-sm:px-3 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">Agent settings</button>
        </div>
      </header>
      {error && <p role="alert" className="shrink-0 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-[13.5px] text-rose-700">{error}</p>}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(19rem,1fr)]" data-agent-centre>
        {workspaceId && <AgentChat ctx={ctx} work={work} waiting={waiting} onWaitingChanged={() => { load(); setWorkTick((t) => t + 1); }} />}
        {/* one tab open: its list takes the column's height and scrolls inside it */}
        <aside className={`hidden min-h-0 min-w-0 xl:block ${listOpen ? "xl:flex xl:flex-col" : "space-y-4 overflow-y-auto pr-0.5"}`} aria-label="Tasks">{panel}{listOpen ? null : side}</aside>
        {viewing === "profile" && <ProfileSheet business={ctx?.business} businessId={workspaceId} onClose={closeView} />}
        {viewing === "activity" && <ActivitySheet businessId={workspaceId} first={ctx?.activity || []} onClose={closeView} />}
      </div>
      {sheet && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-slate-900/40 xl:hidden" role="dialog" aria-modal="true" aria-label="Tasks" onClick={(e) => { if (e.target === e.currentTarget) setSheet(false); }} data-tasks-sheet>
          <div className="flex max-h-[85dvh] flex-col rounded-t-2xl bg-white p-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] dark:bg-slate-900">
            <div className="mb-2 flex items-center justify-between px-1">
              <p className="text-[16px] font-bold text-slate-900 dark:text-slate-50">Your tasks</p>
              <button type="button" onClick={() => setSheet(false)} aria-label="Close tasks" className="rounded-lg p-2 text-slate-500 hover:bg-slate-50">✕</button>
            </div>
            <div className={`min-h-0 flex-1 ${listOpen ? "flex flex-col" : "space-y-4 overflow-y-auto"}`}>{panel}{listOpen ? null : side}</div>
          </div>
        </div>
      )}

      {draft && <DraftDrawer key={`${draft.runId}:${draft.edit}`} runId={draft.runId} startEditing={draft.edit} onClose={() => setDraft(null)} onSaved={load} onOpenTask={(id) => { setDraft(null); navigate(`/agent/runs/${id}`); }} />}
      {settings && <Settings businessId={workspaceId} onClose={(saved) => { setSettings(false); if (saved) load(); }} />}
    </div>
  );
}
