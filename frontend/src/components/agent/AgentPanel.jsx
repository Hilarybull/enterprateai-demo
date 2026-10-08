import { useWorkspaceStore } from "../../store/workspace";
import { useAuthStore } from "../../store/auth";
import { briefingOf, firstNameOf, getGreeting, workspaceNameOf } from "../../lib/greeting";
import AgentShell, { AgentIdentity } from "./AgentShell";
import { Collapse, WorkingSteps } from "../Motion";
import { useListChanges } from "../../lib/motion";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest } from "../../api/client";
import { agentErrorMessage, cancelRun, clearConversation, getConversation, replyText, submitAgentRequest } from "../../lib/agent";
import { Icon, OUT_OF_CREDITS_TIP, OutOfCreditsNote } from "./AgentBits";
import { WORKING_TEXT, useTaskFlow } from "./TaskFlow";
import { DraftDrawer } from "./DraftEditor";

// A button elsewhere on the dashboard (an insight card) hands its task to the Agent box, so its
// question or result shows here and the owner stays on the page.
export const AGENT_FOLLOW_EVENT = "ea:agent:follow";
/** The task a link points at ("/agent/runs/<id>"), if it is a link to a task. */
export const taskIn = (to) => (typeof to === "string" ? (to.match(/^\/agent\/runs\/([^/?#]+)/) || [])[1] || null : null);
export function followInAgentBox(detail) {
  window.dispatchEvent(new CustomEvent(AGENT_FOLLOW_EVENT, { detail }));
}

// Quick actions are prompts into the one Agent, not separate tools or a fixed workflow graphic.
const CHIPS = [
  { key: "enquiry_to_quote", label: "Enquiry to Quote", icon: "doc" },
  { key: "quote_to_cash", label: "Quote to Invoice", icon: "doc" },
  { key: "payment_followup", label: "Payment Follow-up", icon: "card" },
  { key: "receipt_send", label: "Receipt Sending", icon: "mail" },
  { key: "risk_concentration", label: "Risk & Concentration", icon: "alert", tone: "rose" },
  { key: "scenario_help", label: "Scenario Help", icon: "bars", prompt: "What happens if my costs rise by 10%?" },
];

// Shown when there is less live work than card slots, so the panel always offers a next step.
const STARTERS = [
  { key: "s_enquiry", icon: "doc", text: "Paste a customer enquiry and I'll draft the quotation.", action: { capability: "enquiry_to_quote" } },
  // No "shall I check…?" fillers for things the Agent can see for itself: overdue invoices and
  // customer concentration appear as findings (with the figures) when the records show them.
];

// A tile's colour follows what it means: good news green, the Agent working indigo, needs the
// owner amber, a problem red, nothing happening grey.
// The tiles' icons keep their accent colour, lightened to read on the dark panel (each sits on a white/15 chip).
const TILE_TONE = {
  emerald: "text-emerald-300",
  indigo: "text-indigo-200",
  amber: "text-amber-300",
  rose: "text-rose-300",
  slate: "text-slate-200",
};

export const PAUSED_TIP = "Updating your dashboard. This will be available in a moment.";

const LockMark = () => (
  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
);

/**
 * A task the server would not start, as a reply. Outside the plan: a card in the brand colour with
 * the plan's name, what happened (nothing ran, nothing was charged), Upgrade and, where there is
 * one, something the plan does include. It is information, not an error. Out of credits: the
 * balance, the price and a way to top up.
 */
export function blockedReply(res) {
  if (res.reason === "plan") {
    return { tone: "plan", card: "plan", text: res.message, actions: res.actions || [{ label: "Upgrade", to: "/pricing", upgrade: true }],
      detail: `${res.plan_required_label ? `It is included from the ${res.plan_required_label} plan. ` : ""}Nothing was started and no credits were used.` };
  }
  if (res.reason === "credits") {
    return { tone: "amber", card: "credits", text: res.message, actions: res.actions || [{ label: "Top up", to: "/pricing", upgrade: true }],
      detail: `You have ${res.balance ?? 0} credit${res.balance === 1 ? "" : "s"}${res.cost ? `. This costs ${res.cost}` : ""}. Nothing was started.` };
  }
  return { tone: "amber", text: res.message, upgrade: res.upgrade };
}

export default function AgentPanel({ businessId, summary, onChanged, paused = false }) {
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState(null);      // { tone, text, runId, upgrade }
  // A task started here stays here: its questions open in a dialog on this page, what it prepares
  // is confirmed in the line under the box, and its own page opens only from "See details".
  const flow = useTaskFlow({ say: (r) => setReply(r), onChanged: () => onChanged?.(), onDetails: (runId) => navigate(`/agent/runs/${runId}`) });
  const ent = summary?.entitlement;
  const runsLeft = ent ? Math.max(0, (ent.monthly_runs || 0) - (ent.monthly_runs_used || 0)) : null;
  const credits = typeof ent?.credits === "number" ? ent.credits : null;
  const freePlan = ent && !ent.is_paid;
  // Free plan: show what's left; offer an upgrade only once a limit is reached.
  const counted = ent?.allowance_counts !== false;      // false: tasks in the plan are limited by AI Credits, not by a monthly count
  const freeLimitReached = freePlan && ((counted && runsLeft === 0) || credits === 0);
  const outOfCredits = credits === 0;
  const [creditNote, setCreditNote] = useState(false);
  const promptBox = useRef(null);
  const [spent, setSpent] = useState(null);      // what the last task used, and what is left
  // What the Agent did since the owner was last here, for the line under the greeting. It belongs to the active workspace: switching
  // workspace clears it at once and asks again, so nothing from the last workspace is ever shown. Leaving the dashboard, or a minute
  // on it, is what "last here" means: a refresh does not reset it.
  const workspace = workspaceNameOf(useWorkspaceStore((st) => st.workspaceName));
  const [briefing, setBriefing] = useState(summary?.briefing || null);
  useEffect(() => {
    setBriefing(summary?.briefing || null);
    if (summary?.briefing || !businessId) return undefined;
    let live = true;
    apiRequest(`/businesses/${businessId}/agent/briefing`, "GET").then((b) => { if (live && b && typeof b === "object" && "done_since_last_visit" in b) setBriefing(b); }).catch(() => {});
    return () => { live = false; };
  }, [businessId, summary?.briefing]);
  useEffect(() => {
    if (!businessId) return undefined;
    const seen = () => { apiRequest("/agent/seen", "POST", {}).catch(() => {}); };
    const timer = setTimeout(seen, 60000);
    window.addEventListener("pagehide", seen);
    return () => { clearTimeout(timer); window.removeEventListener("pagehide", seen); };
  }, [businessId]);
  const told = briefingOf(briefing);
  // "By the way, what should I call you?": asked once, only when no name is known, and only after a first result has been
  // shown, so it never stands between someone and their task. Skipping it, or answering it, means it is not asked again.
  const accountName = useAuthStore((st) => st.name);
  const accountEmail = useAuthStore((st) => st.email);
  const askedKey = `ea_name_asked:${accountEmail || ""}`;
  const [nameAsked, setNameAsked] = useState(() => { try { return Boolean(localStorage.getItem(askedKey)); } catch { return false; } });
  const [calling, setCalling] = useState("");
  const [nameProblem, setNameProblem] = useState("");
  const knownName = firstNameOf(accountName) || firstNameOf(briefing?.first_name);
  const askName = Boolean(spent) && !knownName && !nameAsked && !reply?.working;
  const doneAsking = () => { setNameAsked(true); try { localStorage.setItem(askedKey, "1"); } catch { /* asked again next time at worst */ } };
  async function saveName(e) {
    e.preventDefault();
    const said = calling.replace(/\s+/g, " ").trim();
    if (!/^[A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F' -]{0,39}$/.test(said)) { setNameProblem("Use letters only (spaces, hyphens and apostrophes are fine)."); return; }
    try {
      const res = await submitAgentRequest({ businessId, text: `call me ${said}`, sourceChannel: "text" });
      if (res?.first_name) {
        useAuthStore.setState({ name: res.full_name || res.first_name });
        setReply({ tone: "emerald", text: res.message });
      }
      doneAsking();
    } catch { setNameProblem("That couldn't be saved just now. Please try again."); }
  }
  const startsTask = (action) => Boolean(action?.capability) && !action.to && !action.run_id;
  // From the plan map, by way of the summary: the plan a task is on when this one doesn't include it, and what a task costs to start.
  const lockedFor = (action) => (startsTask(action) && ent?.locked?.[action.capability]) || null;
  const priceOf = (action) => (startsTask(action) && ent?.prices?.[action.capability]) || null;

  // Shortcuts and the prompt hint follow the business stage when the dashboard composes them
  // (summary.shortcuts / summary.placeholder); otherwise the standard set is used.
  const chips = summary?.shortcuts?.length
    ? summary.shortcuts
    : CHIPS.map((c) => ({ ...c, action: { capability: c.key, ...(c.prompt ? { prompt: c.prompt } : {}) } }));
  const placeholder = summary?.placeholder || "Ask EnterprateAI to help with quotes, payments, risks or scenarios…";

  const cards = [...(summary?.suggestions || [])];
  // Shortcuts that make no sense yet at this stage (e.g. payment follow-up before any invoice) are left out.
  const hiddenCaps = new Set(summary?.hidden_capabilities || []);
  for (const s of STARTERS) {
    if (cards.length >= 4) break;
    if (hiddenCaps.has(s.action.capability)) continue;
    if (!cards.some((c) => c.action?.capability && c.action.capability === s.action.capability)) cards.push(s);
  }

  const flowRef = useRef(flow);
  flowRef.current = flow;
  useEffect(() => {
    const take = (e) => {
      const d = e.detail || {};
      if (d.run) flowRef.current.follow(d.run);
      else if (d.runId) flowRef.current.followId(d.runId);
    };
    window.addEventListener(AGENT_FOLLOW_EVENT, take);
    return () => window.removeEventListener(AGENT_FOLLOW_EVENT, take);
  }, []);

  async function send(req) {
    if (!businessId || busy || paused) return;
    setBusy(true);
    setReply({ tone: "indigo", text: WORKING_TEXT, working: true });      // said at once, not only a spinner in the button
    try {
      const res = await submitAgentRequest({ businessId, background: true, ...req });
      handle(res, req);
    } catch (e) {
      setReply({ tone: "rose", text: agentErrorMessage(e, "The Agent couldn't start that. Please try again.") });
    } finally {
      setBusy(false);
    }
  }

  async function handle(res, req) {
    if (res.kind === "workflow") {
      const run = res.run;
      onChanged?.();
      window.dispatchEvent(new CustomEvent("ea:credits:refresh"));
      if (res.credits_used > 0 && typeof res.credits_left === "number") setSpent({ used: res.credits_used, left: res.credits_left });
      if (res.runs?.length > 1) {
        setReply({ tone: "indigo", text: `I started ${res.runs.length} tasks. Each one needs your review before anything is sent.`, to: "/agent" });
      } else {
        flow.follow(run);      // a question, an approval, still working or a problem: all handled on this page
      }
      setPrompt("");
    } else if (res.kind === "needs_input") {
      const base = req || {};
      flow.ask({ title: CHIPS.find((c) => c.key === res.capability)?.label, message: res.message, fields: res.fields,
        onSubmit: (answers) => send({ ...base, capability: res.capability, text: null, params: { ...(base.params || {}), ...(res.params || {}), ...answers }, sourceChannel: "ui_action" }) });
    } else if (res.kind === "answer" && res.first_name) {
      useAuthStore.setState({ name: res.full_name || res.first_name });      // "call me Hilary": used from now on
      setReply({ tone: "emerald", text: res.message });
      setPrompt("");
    } else if (res.kind === "answer") {
      setReply({ tone: "slate", text: res.message, evidence: res.evidence, actions: res.actions, source: res.source });
      if (res.conversational) window.dispatchEvent(new CustomEvent("ea:credits:refresh"));      // a written answer uses credits
      setPrompt("");
    } else if (res.kind === "unavailable") {
      setReply({ tone: "amber", text: res.message, offers: res.offers });
    } else if (res.kind === "blocked") {
      setReply(blockedReply(res));
    } else if (res.kind === "multi") {
      // Several requests in one message: each result, in order.
      onChanged?.();
      window.dispatchEvent(new CustomEvent("ea:credits:refresh"));
      setReply({ tone: "indigo", text: replyText(res), to: "/agent" });
      setPrompt("");
    } else {
      setReply({ tone: "slate", text: res.message || "I can't run that yet." });
    }
  }

  /** Cancel a task that is held for its plan: it is closed, nothing was charged, and the tile goes. */
  async function cancelHeld(runId) {
    setBusy(true);
    try {
      await cancelRun(runId);
      setReply({ tone: "slate", text: "That task is cancelled. Nothing was sent and no credits were used." });
      onChanged?.();
    } catch (e) {
      setReply({ tone: "rose", text: agentErrorMessage(e, "That couldn't be cancelled just now. Please try again.") });
    } finally { setBusy(false); }
  }

  // "Explain how to do it": answered conversationally by the Business Assistant.
  // "Explain how to do it": asked of the same Agent, like anything typed in the box.
  function explain(question) {
    return send({ text: question });
  }

  function act(action, sourceChannel = "ui_action") {
    if (!action) return;
    const task = action.run_id || taskIn(action.to);
    if (task) return flow.followId(task);      // its question, problem or result shows here
    if (action.to) return navigate(action.to);
    // A shortcut with a question writes it into the box for the user to read, change and send.
    // Nothing runs, and no AI Credits are used, until they press send.
    if (action.prompt) {
      setPrompt(action.prompt);
      setReply({ tone: "slate", text: "Your question is in the box below. Press send to run it: it uses AI Credits." });
      promptBox.current?.focus();
      return;
    }
    // Starting a task needs credits. With none left, say so here; nothing is started.
    if (outOfCredits) return setCreditNote(true);
    send({ capability: action.capability, params: action.params, sourceChannel, sourceReference: action.source_reference });
  }

  return (
    // The same Agent as on the homepage: one shell (AgentShell) for both, so they never drift apart.
    <AgentShell as="section" data-agent-card aria-label="EnterprateAI Agent" bodyClassName="p-5" className="h-full">
      {/* The title row is the mark and the name. While a task runs the mark gets a soft ring. What the plan allows sits on its own line below. */}
      <div data-agent-title>
        <AgentIdentity as="h2" working={Boolean(busy || reply?.working || briefing?.working_on)} />
      </div>
      {/* The greeting addresses the active workspace, by the time of day: one line, cut short with the full name in its tooltip.
          Under it, one line on what the Agent did or is doing. Both follow the workspace the moment it is switched. */}
      <p data-m="fadeUp" data-agent-greeting title={getGreeting({ subject: workspace, tz: briefing?.timezone })}
        className="mt-3 flex min-w-0 items-baseline gap-2 text-lg font-semibold text-white sm:text-xl">
        <span className="min-w-0 truncate">{getGreeting({ subject: workspace, tz: briefing?.timezone })}</span>
        {!workspace && <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("ea:workspace:profile"))} data-name-business className="shrink-0 text-[12px] font-semibold text-indigo-100 underline underline-offset-2 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">Name your business</button>}
      </p>
      <p data-m="fadeUp" style={{ "--m-delay": "60ms" }} data-agent-briefing data-briefing-kind={told.kind} title={told.text}
        className="mt-0.5 line-clamp-2 min-h-[1.25rem] text-sm text-white/75 lg:line-clamp-1">{told.text}</p>
      {ent && (
        <div className="mt-2 flex min-w-0 flex-wrap gap-2 empty:hidden" data-agent-notices>
          {counted && ent.is_paid && ent.agent_tasks !== false && (
            <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium text-white/80 2xl:text-[12px]"
              title={`Your access includes ${ent.monthly_runs} Agent tasks a month (${ent.monthly_runs_used} used).`}>
              {runsLeft} of {ent.monthly_runs} tasks left this month{credits != null ? ` · ${credits} credits` : ""}
            </span>
          )}
          {freePlan && ent.agent_tasks === false && (
            <button type="button" onClick={() => navigate("/pricing")}
              className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-amber-400/15 px-2.5 py-1 text-left text-[11px] font-semibold text-amber-200 hover:bg-amber-400/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white 2xl:text-[12px]">
              <Icon name="crown" className="h-3 w-3 shrink-0" /> Agent tasks are on the {ent.agent_tasks_from || "Starter"} plan · Upgrade
            </button>
          )}
          {counted && freePlan && ent.agent_tasks !== false && !freeLimitReached && (
            <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium text-white/80 2xl:text-[12px]"
              title="Free plan allowance for the Agent this month">
              {runsLeft} of {ent.monthly_runs} tasks left{credits != null ? ` · ${credits} credits` : ""}
            </span>
          )}
          {freeLimitReached && ent.agent_tasks !== false && (
            <button type="button" onClick={() => navigate("/pricing")}
              className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-amber-400/15 px-2.5 py-1 text-left text-[11px] font-semibold text-amber-200 hover:bg-amber-400/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white 2xl:text-[12px]">
              <Icon name="crown" className="h-3 w-3 shrink-0" /> {runsLeft === 0 ? "Monthly Agent tasks used" : "Out of AI Credits"} · Upgrade
            </button>
          )}
        </div>
      )}

      {/* Below 1280px: auto-fit with a 260px minimum (never more than two per row), so the tiles drop
          to one column when two won't fit. From 1280px the desktop layout keeps its two columns. */}
      <div className="mt-4 grid gap-3 grid-cols-[repeat(auto-fit,minmax(min(100%,max(260px,calc(50%_-_0.375rem))),1fr))] xl:grid-cols-2">
        {cards.slice(0, 4).map((c) => (
          <button key={c.key} type="button" disabled={busy || (paused && startsTask(c.action))} title={paused && startsTask(c.action) ? PAUSED_TIP : c.text}
            data-mood={c.mood || undefined}
            onClick={() => (c.held ? setReply(blockedReply({ reason: "plan", message: c.text.replace(/\s*Upgrade or cancel\.?$/, ""), plan_required_label: c.held.plan_required_label,
              actions: [{ label: "Upgrade", to: "/pricing", upgrade: true }, { label: "Cancel this task", cancel: c.held.run_id }] })) : lockedFor(c.action) ? setReply(blockedReply({ reason: "plan", message: `${c.label || "This"} is on the ${lockedFor(c.action)} plan.`, plan_required_label: lockedFor(c.action),
              actions: [{ label: "Upgrade", to: "/pricing", upgrade: true }] })) : c.question ? flow.openQuestion(c.question) : act(c.action))}
            data-locked={c.held?.plan_required_label || lockedFor(c.action) || undefined}
            className="group flex h-[4.5rem] items-center gap-3 rounded-xl border border-white/15 bg-white/10 px-3.5 text-left transition hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:opacity-60">
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 ${TILE_TONE[c.tone] || TILE_TONE.indigo}`}>
              <Icon name={c.icon} />
            </span>
            <span className="min-w-0 flex-1">
              <span className={`block break-normal text-sm leading-snug text-white ${c.detail ? "line-clamp-1" : "line-clamp-2"}`}>{c.text}</span>
              {c.detail && <span data-tile-detail className="block truncate text-[12px] text-white/60" title={c.detail}>{c.detail}</span>}
              {/* What it costs to start, or the plan it is on: said before anything is pressed. */}
              {lockedFor(c.action) ? <span data-tile-plan className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold text-amber-200"><LockMark />{lockedFor(c.action)} plan</span>
                : priceOf(c.action) ? <span data-tile-price className="mt-0.5 block text-[11px] font-medium text-white/70">{priceOf(c.action)} credits</span> : null}
            </span>
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/25 text-white/70 transition group-hover:border-white/60 group-hover:text-white">
              <Icon name="chevron" className="h-3.5 w-3.5" />
            </span>
          </button>
        ))}
      </div>
      {cards.length > 4 && (
        <div className="mt-1.5 text-right">
          <button type="button" onClick={() => navigate("/agent")} className="text-[12px] font-semibold text-indigo-100 hover:underline">+{cards.length - 4} more</button>
        </div>
      )}

      {/* The send button sits flush at the right end of the box at every width. */}
      <form data-agent-field className="mt-3 flex items-center gap-2 rounded-xl border-2 border-white bg-white py-1.5 pl-3.5 pr-1.5 shadow-lg shadow-indigo-950/30 focus-within:ring-4 focus-within:ring-white/40"
        onSubmit={(e) => { e.preventDefault(); if (prompt.trim()) send({ text: prompt.trim(), sourceChannel: "text" }); }}>
        <span className="text-brand-500"><Icon name="sparkle" className="h-4 w-4" /></span>
        <input ref={promptBox} value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={2000} disabled={busy}
          aria-label="Ask the EnterprateAI Agent"
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent py-1.5 text-sm text-slate-900 outline-none placeholder:text-slate-500" />
        {/* Space reserved here for a future microphone control (voice uses the same request). */}
        {/* Always solid indigo; dimmed only while a request is in progress. An empty prompt is ignored on submit. */}
        <button type="submit" disabled={busy || paused} aria-label="Send" title={paused ? PAUSED_TIP : undefined}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white transition hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-60">
          {busy ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <Icon name="send" className="h-4 w-4" />}
        </button>
      </form>

      {spent && !reply?.working && (
        <p role="status" data-credits-used className="mt-2 text-[12px] font-medium text-indigo-100">Used {spent.used} credit{spent.used === 1 ? "" : "s"} · {spent.left} left</p>
      )}
      {askName && (
        <form onSubmit={saveName} data-ask-name className="mt-3 rounded-xl border border-white/15 bg-white/10 p-3">
          <label htmlFor="agent-call-me" className="block text-[13px] font-semibold text-white">By the way, what should I call you?</label>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input id="agent-call-me" value={calling} onChange={(e) => { setCalling(e.target.value); setNameProblem(""); }} maxLength={40} autoComplete="given-name" placeholder="Your first name"
              className="min-w-0 flex-1 rounded-lg border border-white bg-white px-3 py-1.5 text-sm text-slate-900 outline-none focus:ring-4 focus:ring-white/40" />
            <button type="submit" className="rounded-lg bg-brand-600 px-3.5 py-1.5 text-[13px] font-semibold text-white hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">Save</button>
            <button type="button" onClick={doneAsking} className="text-[13px] font-semibold text-indigo-100 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">Skip</button>
          </div>
          {nameProblem && <p role="alert" className="mt-1.5 text-[12px] font-medium text-amber-200">{nameProblem}</p>}
        </form>
      )}

      {creditNote && outOfCredits && (
        <OutOfCreditsNote className="mt-3" onPlans={() => navigate("/pricing")} onClose={() => setCreditNote(false)} />
      )}

      {reply && (
        <div role="status" className={`mt-3 rounded-xl border px-3.5 py-3 text-sm ${
          reply.tone === "emerald" ? "border-emerald-200 bg-emerald-50 text-emerald-900"
            : reply.tone === "rose" ? "border-rose-200 bg-rose-50 text-rose-800"
            : reply.tone === "amber" ? "border-amber-200 bg-amber-50 text-amber-900"
            : reply.tone === "plan" ? "border-brand-200 bg-brand-50 text-slate-800 dark:border-brand-800 dark:bg-brand-900/20 dark:text-slate-100"
            : reply.tone === "indigo" ? "border-indigo-200 bg-indigo-50 text-indigo-900"
            : "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"}`}>
          <p className={`whitespace-pre-wrap ${reply.card ? "flex items-start gap-2 font-semibold" : ""}`}>
            {reply.working && <span className="mr-2 inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-indigo-300 border-t-indigo-600 align-[-2px]" aria-hidden="true" />}
            {reply.card === "plan" && <span className="mt-0.5 text-brand-600"><LockMark /></span>}
            {reply.text}
          </p>
          {reply.detail && <p className="mt-1 text-[13px]" data-blocked-detail>{reply.detail}</p>}
          {reply.working && <div className="mt-2"><WorkingSteps /></div>}
          {reply.next && <p className="mt-1 text-[13px] opacity-80">{reply.next}</p>}
          {reply.evidence?.length > 0 && (
            <dl className="mt-2 space-y-1 rounded-lg bg-white/70 px-3 py-2 text-[13px] dark:bg-slate-900/50">
              {reply.evidence.map((ev) => (
                <div key={ev.label} className="flex flex-wrap gap-x-2">
                  <dt className="font-semibold">{ev.label}:</dt>
                  <dd>{ev.value}</dd>
                </div>
              ))}
              {reply.source && <p className="pt-1 text-[12px] opacity-70">{reply.source}</p>}
            </dl>
          )}
          {(reply.actions?.length > 0 || reply.offers?.length > 0) && (
            <div className="mt-2 flex flex-wrap gap-2">
              {[...(reply.actions || []), ...(reply.offers || [])].map((o) => (
                <button key={o.label} type="button" disabled={busy}
                  onClick={() => (o.cancel ? cancelHeld(o.cancel) : o.kind === "explain" ? explain(o.prompt) : o.to ? navigate(o.to) : act({ capability: o.capability, params: o.params }))}
                  className={o.upgrade ? "rounded-lg bg-brand-600 px-3.5 py-1.5 text-[13px] font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
                    : "rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[13px] font-semibold hover:bg-slate-50 disabled:opacity-60 dark:bg-slate-900"}>
                  {o.label}
                </button>
              ))}
            </div>
          )}
          <div className="mt-2 flex flex-wrap gap-3 text-[13px] font-semibold">
            {reply.runId && <button type="button" className="underline" onClick={() => navigate(`/agent/runs/${reply.runId}`)}>See details</button>}
            {reply.to && <button type="button" className="underline" onClick={() => navigate(reply.to)}>Open Agent Centre</button>}
            {getConversation(businessId).length > 0 && (
              <button type="button" className="underline" onClick={() => { clearConversation(businessId); setReply(null); }}>New conversation</button>
            )}
            {reply.upgrade && <button type="button" className="underline" onClick={() => navigate("/pricing")}>See plans</button>}
            <button type="button" className="font-normal opacity-70 hover:opacity-100" onClick={() => setReply(null)}>Dismiss</button>
          </div>
        </div>
      )}

      {/* No shortcut chips under the field (the owner's decision, 8 Oct 2026): the chat field is the one way in. */}

      {flow.element}
    </AgentShell>
  );
}

/** One line in place of the panel when there is nothing to approve. */
export function NeedsApprovalLine() {
  const navigate = useNavigate();
  return (
    <div aria-label="Needs approval" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-[13px] dark:border-slate-800 dark:bg-slate-900">
      <span className="font-semibold text-slate-700 dark:text-slate-200">Needs Approval</span>
      <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-slate-100 px-1.5 text-[11px] font-bold text-slate-500 dark:bg-slate-800">0</span>
      <span className="text-slate-500 dark:text-slate-400">Nothing is waiting for you. Anything the Agent prepares to send will appear here.</span>
      <button type="button" onClick={() => navigate("/agent")} className="ml-auto font-semibold text-brand-600 underline-offset-2 hover:underline">Agent Centre</button>
    </div>
  );
}

export function NeedsApprovalPanel({ businessId, summary, onChanged, paused = false }) {
  const navigate = useNavigate();
  const items = summary?.needs_approval || [];
  const [editing, setEditing] = useState(null);      // the task whose approval is open in the drawer
  const rows = useListChanges(items, (item) => item.approval_id || item.run_id || item.title);
  const count = summary?.needs_approval_count ?? 0;
  // Something new is waiting: say so, top right, once the Agent has finished preparing it.
  const counted = useRef(null);
  useEffect(() => {
    if (!summary) return;
    const before = counted.current;
    counted.current = count;
    if (before === null || count <= before || paused) return;
    const added = count - before;
    try {
      window.dispatchEvent(new CustomEvent("ea:toast", { detail: { kind: "success", title: "Done", message: `Done. ${added} item${added === 1 ? "" : "s"} waiting for your approval` } }));
    } catch { /* the list itself already shows it */ }
  }, [count, summary, paused]);

  // Only real pending approvals are listed (risk alerts live under suggestions and risks). A row
  // opens its approval in the drawer: the owner reviews, edits, approves or declines without leaving.
  const amountOf = (p) => {
    const value = p?.total ?? p?.amount ?? p?.total_amount ?? p?.outstanding;
    if (typeof value !== "number") return "";
    try {
      return new Intl.NumberFormat("en-GB", { style: "currency", currency: p.currency || "GBP" }).format(value);
    } catch {
      return String(value);
    }
  };

  return (
    <section className="flex min-h-0 flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm xl:h-0 xl:min-h-full dark:border-slate-800 dark:bg-slate-900" aria-label="Needs approval">
      <div className="flex items-center gap-2">
        <h2 className="text-[17px] font-bold text-slate-900 dark:text-slate-100">Needs Approval</h2>
        <span key={count} data-approval-count className="m-bump inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-brand-50 px-1.5 text-[12px] font-bold text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
          {count}
        </span>
        <button type="button" onClick={() => navigate("/agent?tab=needs_approval")} aria-label="Open Agent Centre"
          className="ml-auto flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 text-slate-400 hover:border-brand-300 hover:text-brand-600 dark:border-slate-700">
          <Icon name="chevron" className="h-3.5 w-3.5" />
        </button>
      </div>
      {/* On a wide screen the list takes the Agent card's height and scrolls inside it; it never makes the row taller. */}
      <div className="mt-3 min-h-0 flex-1 space-y-2.5 overflow-y-auto max-xl:max-h-[22rem]" data-testid="needs-approval-list">
        {rows.length === 0 ? (
          <div data-m="fadeIn" className="flex h-full min-h-[120px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 px-4 text-center dark:border-slate-700">
            <p className="text-sm font-medium text-slate-600 dark:text-slate-300">Nothing needs your approval.</p>
            <p className="mt-1 text-[12px] text-slate-400">Anything the Agent prepares to send will wait here for you.</p>
          </div>
        ) : rows.map(({ key, item, entering, leaving }) => (
          <Collapse key={key} leaving={leaving}>
          <button type="button" data-approval-row disabled={paused || leaving} title={paused ? PAUSED_TIP : undefined} onClick={() => setEditing(item.run_id)}
            {...(entering ? { "data-m": "slideDown" } : {})}
            className={`flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-2.5 py-2.5 text-left transition hover:border-brand-300 hover:shadow-sm dark:border-slate-700 dark:bg-slate-900 ${entering ? "m-flash" : ""}`}>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-slate-800">
              <Icon name={item.kind === "payment" ? "card" : item.kind === "receipt" ? "mail" : "doc"} className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 text-[13px] font-semibold leading-tight text-slate-900 dark:text-slate-100" title={item.title}>{item.title}</span>
              <span className="mt-0.5 block truncate text-[11px] leading-tight text-slate-500" title={item.subtitle}>
                {item.subtitle}{amountOf(item.payload) ? ` · ${amountOf(item.payload)}` : ""}
              </span>
            </span>
            <span className="shrink-0 whitespace-nowrap text-[10px] text-slate-400">{item.age}</span>
            <span className="shrink-0 text-slate-400"><Icon name="chevron" className="h-3 w-3" /></span>
          </button>
          </Collapse>
        ))}
      </div>
      {editing && (
        <DraftDrawer runId={editing} startEditing={false} onClose={() => setEditing(null)} onSaved={() => onChanged?.()} onOpenTask={(id) => { setEditing(null); navigate(`/agent/runs/${id}`); }} />
      )}
    </section>
  );
}
