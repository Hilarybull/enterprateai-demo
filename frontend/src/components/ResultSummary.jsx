// One page pattern for every Agent result (the owner's brief, 17 Oct; PRD 12.1): one score and one plain sentence, at most
// three next steps, at most three findings, the funding pack's count, then the secondary links. The dashboard card, the
// result page and the panel all use these, so they say the same thing. Engine detail lives on the full page's Advanced tab.
import { useEffect, useRef, useState } from "react";
import { getCurrencySymbol } from "../lib/currencies";
import { MoneyInput } from "./readiness/Fields";
import { useNavigate } from "react-router-dom";
import { apiRequest } from "../api/client";
import { WORDS, foundWord, gapWord, kindOf, statusWords } from "../lib/vocab";

const money = (sign, n) => (Number.isFinite(Number(n)) && Number(n) > 0 ? `${sign || ""}${Number(n).toLocaleString("en-GB", { maximumFractionDigits: 0 })}` : "");

// Each gap as a step: a plain title, one sentence of why, and how it is done. `answer`: one fact, typed here (re-checked
// free). `doIt`: the Agent does it (its research, the price shown first). `mine`: the screen to do it yourself.
const STEPS = {
  funding: {
    purpose: { title: () => "Settle how much you need", why: "Funders start with the amount and what it pays for.", answer: "amount", mine: "setup:goal" },
    use_of_funds: { title: (a, s) => (a.amount ? `Split your ${money(s, a.amount)} into what it pays for` : "Split the amount into what it pays for"), why: "A funder wants each line of spending and what it changes.", doIt: true, mine: "setup:finances" },
    financial: { title: () => "Make a 12-month cash forecast", why: "It shows the money lasts until the plan pays back.", doIt: true, mine: "setup:finances" },
    demand: { title: () => "Show who is already buying", why: "Paying customers or signed interest is the first thing funders look for.", answer: "traction", mine: "evidence" },
    economics: { title: () => "Record your price and cost per sale", why: "Your margin shows each sale pays its way.", mine: "catalogue" },
    market: { title: () => "Say who your customers are and how you will reach them", why: "It shows there is a market you can win.", doIt: true, mine: "setup:market" },
    team: { title: () => "Name who will deliver the plan", why: "Funders back the people as much as the plan.", mine: "setup:team" },
    materials: { title: () => "Prepare your funding pack", why: "A summary and a plan are what you send to a funder.", mine: "documents" },
  },
  launch: {
    cash: { title: () => "Work out the cash the launch needs", why: "So you know the launch can be paid for.", doIt: true, mine: "setup" },
    demand: { title: () => "Show people want it", why: "Early buyers or signed interest lower the risk.", answer: "evidence", mine: "evidence" },
    offer: { title: () => "Check your price covers your costs", why: "Each sale has to leave a margin.", doIt: true, mine: "catalogue" },
    delivery: { title: () => "Check you can deliver the volume", why: "So orders don't outrun what you can do.", mine: "setup" },
    process: { title: () => "Test an order end to end", why: "From order to delivery to payment, once, before launch.", mine: "setup" },
    prerequisites: { title: () => "Check licences and registrations", why: "Some launches need these first.", doIt: true, mine: "setup" },
    route: { title: () => "Choose how you will reach customers", why: "A launch needs a channel.", doIt: true, mine: "setup" },
    control: { title: () => "Set a launch date and an owner", why: "Someone owns it, by a date.", answer: "target_date", mine: "setup" },
  },
  idea: {
    idea: { title: () => "Describe the idea", why: "What it is, in a line.", answer: "description" },
    customer: { title: () => "Say who it is for", why: "The customer shapes the price and the volume.", answer: "customer" },
    margin: { title: () => "Add your price, cost and expected sales", why: "They show whether it can make money.", doIt: true },
    break_even: { title: () => "Add your monthly fixed costs", why: "To see how many sales you need to break even.", doIt: true },
    capacity: { title: () => "Check how much you can deliver", why: "So the sales you plan are possible.", doIt: false },
    demand: { title: () => "Find signs people will buy", why: "Proof beats assumptions.", doIt: true },
    competitors: { title: () => "Look at competitor prices", why: "So your price is in the right range.", doIt: true },
  },
  pricing: {
    offer: { title: () => "Say what you are pricing", why: "The price follows the offer.", answer: "sell" },
    margin: { title: () => "Add your price and cost per sale", why: "Your margin is the first check.", mine: "catalogue" },
    volume: { title: () => "Add your expected monthly sales", why: "Volume decides whether the margin is enough.", doIt: false },
    comparables: { title: () => "Compare with similar prices", why: "So you know where you sit.", doIt: true },
    sensitivity: { title: () => "Test how customers react to a price change", why: "To find room to move.", doIt: true },
    positioning: { title: () => "Check how competitors position themselves", why: "Budget, mid-range or premium.", doIt: true },
  },
  customers: {
    marketplace: { title: () => "List your business on the Marketplace", why: "So buyers can find you.", mine: "marketplace" },
    offer: { title: () => "Add an offer", why: "Something to sell first.", mine: "catalogue" },
    clarity: { title: () => "Describe your offer clearly", why: "Clear offers sell.", mine: "catalogue" },
    target: { title: () => "Define your ideal customer", why: "So effort goes where it pays.", answer: "customer" },
    price: { title: () => "Set a price", why: "Buyers need to know the price.", mine: "catalogue" },
    channel: { title: () => "Choose how you will reach customers", why: "One channel, done well, first.", doIt: true },
    traction: { title: () => "Gather proof of demand", why: "It makes the next sale easier.", doIt: true },
    goal: { title: () => "Set a three-month customer goal", why: "A number to aim for.", answer: "growth_goal" },
  },
};

function screenOf(result, mine) {
  const a = result?.assessment || {};
  const kind = kindOf(result);
  const base = kind === "funding" ? (a.case_id ? `/funding/${a.case_id}` : "/funding") : kind === "launch" ? (a.initiative_id ? `/launch/${a.initiative_id}` : "/launch") : null;
  if (mine === "catalogue") return "/catalogue";
  if (mine === "marketplace") return "/marketplace";
  if (mine === "documents" && base) return `${base}?tab=documents`;
  if (mine === "evidence" && base) return `${base}?tab=evidence`;
  // The section the step is about (the owner's QA, 21 Oct: "I'll do it" on the forecast opened the funding goal).
  if (base && String(mine || "").startsWith("setup:")) return `${base}?tab=answers&section=${String(mine).slice(6)}`;
  if (base) return `${base}?tab=setup`;
  return kind === "idea" ? "/validation" : kind === "pricing" ? "/catalogue" : null;
}

/** At most three steps, by impact: what must be fixed first, then what is needed most. */
export function stepsOf(result) {
  // On a case page: the steps worked out from the case itself (lib/caseSteps), never a step whose data is filled.
  if (Array.isArray(result?.case_steps)) return result.case_steps;
  const kind = kindOf(result);
  const table = STEPS[kind] || {};
  const answers = result?._edit?.answers || {};
  const asked = new Set((result?._edit?.questions || []).map((q) => q.key));
  const sign = result?.currency_sign || "";
  return (result?.blockers || []).map((b) => {
    const s = table[b.key] || { title: () => b.label, why: "" };
    return { key: b.key, kind: b.prefill ? "partial" : b.kind, badge: b.prefill ? "Partly there" : gapWord(b.kind), title: s.title(answers, sign), why: s.why || b.label, gap: b.label,
      prefill: b.prefill || null,
      answer: s.answer && asked.has(s.answer) ? (result._edit.questions.find((q) => q.key === s.answer)) : null,
      // Every step can be done by the Agent (the owner, 20 Oct 2026): it drafts it, and the owner edits before anything counts.
      doIt: true, to: screenOf(result, s.mine) };
  });
}

// Inside the result's one card, steps and findings are tiles (no border or shadow): never a card inside a card.
const card = "rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60";

/** One score and one plain sentence, and how much is known, in small grey text. No second score, no bar. */
export function StatusLine({ result, latest }) {
  const s = statusWords(result, latest);
  return (
    <div data-result-status>
      <p className="text-[20px] font-semibold leading-7 text-slate-900 dark:text-slate-100">
        <span className="tabular-nums" data-fv-score>{s.score}</span> <span className="text-slate-400">·</span> <span data-status-sentence>{s.sentence}</span>
      </p>

    </div>
  );
}

/** One step: a plain title, why, one primary action (an answer box or "Do it for me"), and "I'll do it". */
const MONEY_KEYS = new Set(["price", "cost", "fixed_costs", "amount", "cash_in_bank", "monthly_revenue"]);
const isMoney = (q) => Boolean(q?.money) || MONEY_KEYS.has(q?.field);

/** Adopt applies at once (the owner's QA, 21 Oct): each Adopt, Save or answer goes straight to the case, and the check is
 *  run again for free, a moment later (several presses together are one check). Never a staged batch, never blocked by a
 *  question left open, and never silent: what happened is said, by the button that did it. */
// The last "Saved. Your score is now…", kept for a few seconds wherever the view goes next (the owner's QA, 21 Oct).
const SAVED_FOR = 6000;
const savedNote = { text: "", at: 0, subs: new Set() };
export function announceSaved(text) {
  savedNote.text = text;
  savedNote.at = Date.now();
  savedNote.subs.forEach((f) => f());
}
export function SavedNotice({ className = "mt-3" }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick((n) => n + 1);
    savedNote.subs.add(f);
    const age = Date.now() - savedNote.at;
    const t = savedNote.text && age < SAVED_FOR ? setTimeout(f, SAVED_FOR - age + 50) : null;
    return () => { savedNote.subs.delete(f); clearTimeout(t); };
  });
  if (!savedNote.text || Date.now() - savedNote.at > SAVED_FOR) return null;
  return <p role="status" className={`${className} text-[13px] font-semibold text-emerald-800`} data-saved-notice>{savedNote.text}</p>;
}

const scoreLine = (after, before) => {
  const now = typeof after?.score === "number" ? Math.round(after.score) : null;
  const pausedFor = (after?.blockers || []).find((b) => b.kind !== "failed");
  return now == null
    ? `Saved. Score paused: ${pausedFor ? `it still needs ${String(pausedFor.label || "a figure").toLowerCase()}` : "a few figures are still missing"}.`
    : `Saved. Your score is now ${now}/100${before != null && now !== before ? `, ${now > before ? "up" : "down"} from ${before}` : ""}.`;
};

export function useApplyResearch(businessId, run, result, onApplied) {
  const chosen = useRef({});
  const timer = useRef(null);
  const [decided, setDecided] = useState({});
  const [state, setState] = useState({ busy: false, text: "", error: "", failedId: null });
  useEffect(() => () => clearTimeout(timer.current), []);
  const before = typeof result?.score === "number" ? Math.round(result.score) : null;
  const send = async (lastId) => {
    if (!run?.id || !businessId) { setState({ busy: false, text: "", error: "That can't be saved from here. Open the full page to adopt it.", failedId: lastId }); return; }
    setState((s0) => ({ ...s0, busy: true, error: "", text: "Saving and checking your score…" }));
    try {
      const out = await apiRequest(`/businesses/${businessId}/research/${run.id}/review`, "POST", { decisions: chosen.current }, { timeoutMs: 30000 });
      const after = await onApplied?.(out);
      if (out?.checking) {
        // Saved; the case is still being checked (the owner's QA, 21 Oct): said so, and the new score fetched in a moment.
        setState({ busy: false, error: "", failedId: null, text: "Saved. Checking your score…" });
        announceSaved("Saved. Checking your score…");
        [2000, 4500, 9000].forEach((ms) => setTimeout(async () => {
          const later = await onApplied?.(null);
          if (later) { const text = scoreLine(later, before); setState((s0) => ({ ...s0, text })); announceSaved(text); }
        }, ms));
        return;
      }
      const text = scoreLine(after, before);
      setState({ busy: false, error: "", failedId: null, text });
      announceSaved(text);
    } catch (e) {
      setState({ busy: false, text: "", error: e?.message && !/^HTTP/.test(e.message) ? e.message : "That couldn't be saved just now. Nothing was changed. Try again.", failedId: lastId });
    }
  };
  const apply = (id, decision) => {
    chosen.current = { ...chosen.current, [id]: decision };
    setDecided((d) => ({ ...d, [id]: decision }));
    // Said at once (the owner's QA, 21 Oct: "Saved" took 10 s); the new score follows when the check is done.
    setState((s0) => ({ ...s0, error: "", text: "Saved. Checking your score…" }));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => send(id), 150);
  };
  return { apply, decided, state };
}

/** One step: a plain title and why; after the Agent's run, its draft right here with Adopt (or its one question with Save). */
const MONEY_INPUTS = new Set(["price", "cost", "fixed_costs", "monthly_revenue", "cash_in_bank", "amount"]);

/** Edit, in the card (the owner's QA, 21 Oct: Edit opened the spending modal): the figures a worked-out draft is built
 *  from, or the draft's own words. Save applies them at once; nothing is researched and nothing is charged. */
// A calculation that is a table (the use of funds): each line said, and changed where the case keeps them (the owner's
// QA, 21 Oct: "how can I change marketing now?").
const TABLE_FIELD = { use_of_funds: { section: "finances", field: "use_of_funds", label: "Change the lines" } };

function DraftEditor({ draft, figures, currency, applier, onDone, result = null }) {
  const navigate = useNavigate();
  const table = TABLE_FIELD[draft.derive];
  const lines = Array.isArray(draft.table) ? draft.table : Array.isArray(draft.raw) ? draft.raw : [];
  const tableTo = table ? `${screenOf(result, `setup:${table.section}`) || "/funding"}${String(screenOf(result, `setup:${table.section}`) || "").includes("?") ? "&" : "?"}field=${table.field}` : null;
  const calc = Boolean(draft.derive);
  const [values, setValues] = useState(() => Object.fromEntries(figures.map((f) => [f.id, f.edited_value ?? f.value ?? ""])));
  const [text, setText] = useState(String(draft.edited_value ?? draft.value ?? ""));
  const field = "w-full min-w-0 rounded-lg border border-slate-200 px-3 py-2 text-[14px] outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-950";
  const save = () => {
    if (calc) {
      figures.forEach((f) => {
        const v = String(values[f.id] ?? "").replace(/,/g, "").trim();
        if (v !== "" && v !== String(f.value ?? "").replace(/,/g, "")) applier.apply(f.id, { decision: "edit", value: v });
      });
      applier.apply(draft.id, { decision: "accept", pressed: true });
    } else if (text.trim()) {
      applier.apply(draft.id, { decision: "edit", value: text.trim() });
    }
    onDone();
  };
  return (
    <div className="mt-2 space-y-2" data-step-editor>
      {table && (
        <div className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/60" data-step-editor-lines>
          {lines.length > 0 && (
            <ul className="space-y-0.5 text-[12.5px] text-slate-700 dark:text-slate-200">
              {lines.map((l) => <li key={l.line} className="flex justify-between gap-3"><span>{l.line}</span><span className="tabular-nums">{shortMoney(l.amount, currency)}</span></li>)}
            </ul>
          )}
          {tableTo && <a href={tableTo} onClick={(e) => { e.preventDefault(); navigate(tableTo); }} className="mt-1 inline-block text-[12.5px] font-semibold text-brand-700 hover:underline" data-step-editor-lines-link>
            {table.label}</a>}
          <p className="mt-0.5 text-[11.5px] text-slate-500">Or change the figures below to work it out again.</p>
        </div>
      )}
      {calc ? (figures.length ? figures.map((f) => (
        <label key={f.id} className="block text-[12px] text-slate-600">{f.label}
          {MONEY_INPUTS.has(f.field)
            ? <MoneyInput value={values[f.id]} currency={currency} onChange={(v) => setValues((m) => ({ ...m, [f.id]: v }))} className={field} aria-label={f.label} />
            : <input value={values[f.id]} onChange={(e) => setValues((m) => ({ ...m, [f.id]: e.target.value }))} inputMode="decimal" className={field} aria-label={f.label} />}
        </label>
      )) : <p className="text-[12px] text-slate-500">This one is worked out from your answers. Change them in Your answers.</p>)
        : <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} className={field} aria-label="Your version" />}
      <div className="flex gap-2">
        <button type="button" onClick={save} disabled={!applier || applier.state.busy} data-step-editor-save
          className="rounded-lg bg-brand-600 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-brand-700 disabled:opacity-70">Save</button>
        <button type="button" onClick={onDone} data-step-editor-cancel
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[12.5px] font-semibold text-slate-700">Cancel</button>
      </div>
    </div>
  );
}

function Step({ result, step, onAnswered, draft = null, researched = false, onReview = null, price, onDoIt = null, done = false, applier = null, currency = null, figures = [] }) {
  const [editing, setEditing] = useState(false);
  const [moreText, setMoreText] = useState(false);
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [answer, setAnswer] = useState(draft?.prefill != null ? String(draft.prefill) : "");
  const field = useRef(null);
  const send = async () => {
    if (!value.trim() || busy || !result?._session) return;
    setBusy(true);
    setProblem("");
    try {
      const res = await apiRequest(`/task-sessions/${result._session}/answers`, "POST", { answers: { [step.answer.key]: value.trim() } }, { timeoutMs: 30000 });
      onAnswered?.(res);      // checked again, free: the next step slides in
    } catch { setProblem("That didn't go through. Nothing was changed. Try again."); }
    finally { setBusy(false); }
  };
  const mine = draft && applier ? applier.decided[draft.id] : null;
  const adopted = mine ? (mine.decision === "accept" || mine.decision === "answer") : ["accepted", "edited", "answered"].includes(draft?.decision);
  const dismissed = mine ? mine.decision === "reject" : draft?.decision === "rejected";
  const failed = applier && draft && applier.state.failedId === draft.id ? applier.state.error : "";
  const saveAnswer = () => {
    if (!String(answer).trim()) { field.current?.focus?.(); setProblem("Type your answer first."); return; }
    setProblem("");
    applier?.apply(draft.id, { decision: "answer", value: String(answer).trim() });
  };
  const ready = draft && draft.kind !== "question";
  // The owner's own answer, or a figure from their records, is said as that (the owner's QA, 21 Oct: "Draft ready: 381.5",
  // "Draft ready: No traction yet"): never as the Agent's draft.
  const theirs = ready && draft.kind === "reused";
  const fromRecords = theirs && /record|invoice|expense|catalogue/i.test(String(draft.source_note || ""));
  const saysNone = theirs && /^(no|none|nothing|not yet|zero|0)\b/i.test(String(draft.value ?? "").trim());
  const lead = theirs ? (fromRecords ? "From your records:" : "You said:") : "Draft ready:";
  return (
    <li className={`${card} flex h-full flex-col gap-2`} data-next-step={step.key}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[14px] font-semibold text-slate-900 dark:text-slate-100" data-step-title>{step.title}</p>
        <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${adopted && ready ? "bg-emerald-50 text-emerald-800" : ready ? "bg-indigo-50 text-indigo-800" : step.kind === "failed" ? "bg-rose-50 text-rose-700" : step.kind === "partial" ? "bg-sky-50 text-sky-800" : "bg-amber-50 text-amber-800"}`} data-step-badge>
          {saysNone ? step.badge : adopted && ready ? "Done" : dismissed ? "Dismissed" : theirs ? "Your answer" : ready ? (draft.new ? "New" : "Draft ready") : step.badge}</span>
      </div>
      <p className="text-[12.5px] leading-5 text-slate-600 dark:text-slate-300">{step.why}</p>
      {step.prefill && !draft && <p className="text-[12.5px] leading-5 text-slate-800 dark:text-slate-100" data-step-prefill>{step.prefill.text}</p>}
      {ready && (
        // The draft in the card (the owner's QA, 21 Oct), with one Adopt: applied at once, then checked again.
        <div className="flex flex-1 flex-col rounded-lg border border-indigo-100 bg-white px-3 py-2 dark:border-indigo-900 dark:bg-slate-900" data-step-draft>
          {/* Every card's buttons on one line at the bottom (the owner, 21 Oct: "align and arrange these buttons"). */}
          <p className={`text-[12.5px] leading-5 text-slate-800 dark:text-slate-100 ${moreText ? "" : "line-clamp-4"}`} title={draftSummary(draft, currency)} data-step-draft-line><span className="font-semibold">{lead}</span> {draftSummary(draft, currency)}</p>
          {saysNone && <p className="text-[12px] font-medium text-amber-800" data-step-none>Add your first sale or signed interest to fix this.</p>}
          {draft.new && draft.changed?.length > 0 && <p className="text-[12px] text-slate-600" data-step-changed>{draft.changed.join(". ")}.</p>}
          {String(draftSummary(draft, currency)).length > 180 && (
            <button type="button" onClick={() => setMoreText((v) => !v)} className="self-start text-[12px] font-semibold text-brand-700 hover:underline" data-step-more>{moreText ? "Show less" : "Show more"}</button>
          )}
          {draft.warning && <p className="mt-0.5 text-[12px] font-medium text-amber-800">{draft.warning === "cost_above_price" ? "Each sale costs more than you charge." : draft.warning === "cash_below_zero" ? "Cash goes below zero in this forecast." : "Check this: it looks too low to be right."}</p>}
          <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
            {!saysNone && <button type="button" aria-pressed={Boolean(adopted)} disabled={!applier || applier.state.busy} onClick={() => applier.apply(draft.id, { decision: "accept", pressed: true })} data-step-adopt
              className={`rounded-lg px-3 py-1.5 text-[12.5px] font-semibold ${adopted ? "bg-emerald-600 text-white" : "bg-brand-600 text-white hover:bg-brand-700"} disabled:opacity-70`}>{adopted ? (theirs ? "Used" : "Adopted") : (theirs ? "Use it" : "Adopt")}</button>}
            {applier && !editing && <button type="button" onClick={() => setEditing(true)} aria-expanded={editing} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[12.5px] font-semibold text-slate-700 hover:border-brand-300" data-step-edit>Edit</button>}
            {applier && !adopted && <button type="button" disabled={applier.state.busy} onClick={() => applier.apply(draft.id, { decision: "reject" })} aria-pressed={Boolean(dismissed)}
              className="text-[12.5px] font-semibold text-slate-500 underline-offset-2 hover:underline disabled:opacity-70" data-step-dismiss>{dismissed ? "Dismissed" : "Dismiss"}</button>}
          </div>
          {editing && <DraftEditor draft={draft} figures={figures} currency={currency} applier={applier} onDone={() => setEditing(false)} result={result} />}
          {failed && <p role="alert" className="mt-1 text-[12px] text-rose-700">{failed}</p>}
        </div>
      )}
      {draft && draft.kind === "question" && (
        // The one question only the owner can answer, in the card, saved at once (never blocking the rest).
        <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); saveAnswer(); }} data-step-question>
          <label className="text-[12.5px] text-slate-700 dark:text-slate-200" htmlFor={`sq-${draft.id}`}>{draft.question || draft.label}</label>
          {draft.conflict && (draft.options || []).length === 2 && !isMoney(draft) ? (
            // "Earlier you said …; today you said …": one press for the right one (the owner's QA, 21 Oct).
            <div className="flex flex-wrap gap-2" data-step-choices>
              {draft.options.map((o) => {
                const on = adopted && mine?.value === String(o);
                return <button key={o} type="button" disabled={!applier || applier.state.busy} aria-pressed={on} onClick={() => applier?.apply(draft.id, { decision: "answer", value: String(o) })}
                  className={`rounded-lg px-3 py-1.5 text-[12.5px] font-semibold ${on ? "bg-emerald-600 text-white" : "border border-slate-300 bg-white text-slate-700 hover:border-brand-300"}`}>{String(o)}</button>;
              })}
            </div>
          ) : (
          <div className="flex flex-col gap-2 sm:flex-row">
            {isMoney(draft)
              ? <span className="min-w-0 flex-1"><MoneyInput id={`sq-${draft.id}`} value={answer} currency={currency} onChange={setAnswer} className="w-full min-w-0 rounded-lg border border-slate-200 px-3 py-2 text-[14px] outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-950" /></span>
              : <input id={`sq-${draft.id}`} ref={field} value={answer} onChange={(e) => setAnswer(e.target.value)}
                  className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-[14px] outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-950" />}
            <button type="submit" disabled={!applier || applier.state.busy} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-[13px] font-semibold text-slate-700 disabled:text-slate-400" data-step-save>
              {adopted ? "Saved" : "Save"}</button>
          </div>
          )}
          {(failed || problem) && <p role="alert" className="text-[12px] text-rose-700">{failed || problem}</p>}
        </form>
      )}
      {researched && !draft && <p className="text-[12px] text-slate-500" data-step-not-drafted>I couldn't draft this one from what I found.</p>}
      {step.answer && !draft && !onDoIt && (
        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); send(); }} data-step-answer>
          <input value={value} onChange={(e) => setValue(e.target.value)} aria-label={step.answer.label} placeholder={`Or tell me: ${String(step.answer.label || "").replace(/\?$/, "")}`}
            inputMode={step.answer.type === "number" ? "decimal" : undefined}
            className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-[14px] outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-950" />
          <button type="submit" disabled={busy || !value.trim()} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-[13px] font-semibold text-slate-700 disabled:border-slate-200 disabled:text-slate-400">{busy ? "Checking…" : "Save"}</button>
        </form>
      )}
      {problem && !(draft && draft.kind === "question") && <p role="alert" className="text-[12px] text-rose-700">{problem}</p>}
      {/* While the Agent's drafts wait, no "I'll do it": the draft is the way (the owner's QA, 21 Oct). */}
      <div className="mt-auto flex flex-wrap items-center gap-3 pt-1" data-step-actions>
        {step.run && <StepRun run={step.run} />}
        {step.to && !draft && !researched && <a href={step.to} onClick={(e) => { e.preventDefault(); navigate(step.to); }} className="self-start text-[12.5px] font-semibold text-brand-700 underline-offset-2 hover:underline" data-step-mine data-step-focus={step.focus || undefined}>{step.run ? "See it" : (step.cta || "Fill it in")}</a>}
        {!draft && !researched && (step.more || []).map((m) => (
          <a key={m.label} href={m.to} onClick={(e) => { e.preventDefault(); navigate(m.to); }} className="self-start text-[12.5px] font-semibold text-brand-700 underline-offset-2 hover:underline" data-step-more data-step-focus={m.focus || undefined}>{m.label}</a>
        ))}
      </div>
    </li>
  );
}

/** A step done with one press on its card ("Confirm forecast"), then the case is read again. */
function StepRun({ run }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  return (
    <span className="flex flex-wrap items-center gap-2">
      <button type="button" disabled={busy} onClick={async () => { setBusy(true); setProblem(""); try { await run.go(); } catch { setProblem("That didn't go through. Try again."); } finally { setBusy(false); } }}
        className="rounded-lg bg-brand-600 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-brand-700 disabled:opacity-70" data-step-run>{busy ? "Saving…" : run.label}</button>
      {problem && <span role="alert" className="text-[12px] text-rose-700">{problem}</span>}
    </span>
  );
}

const shortMoney = (n, currency) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return "";
  const sign = currency ? getCurrencySymbol(currency) : "";
  const a = Math.abs(v);
  const neg = v < 0 ? "\u2212" : "";
  if (a >= 1e6) return `${neg}${sign}${(Math.round((a / 1e6) * 10) / 10).toLocaleString("en-GB")}m`;
  if (a >= 1e3) return `${neg}${sign}${Math.round(a / 1e3).toLocaleString("en-GB")}K`;
  return `${neg}${sign}${Math.round(a).toLocaleString("en-GB")}`;
};

/** A draft in one line, in plain words: "₦1.2m in a month. Pays back: cash stays above zero". */
export function draftSummary(item, currency) {
  const t = item?.table || [];
  if (item?.derive === "use_of_funds" && t.length) {
    const [lead, ...rest] = t;
    return `${lead.line}: ${shortMoney(lead.amount, currency)}${rest.length ? `, then ${rest.map((r) => String(r.line).split(":")[0].toLowerCase()).join(" and ")}` : ""}`;
  }
  if (item?.derive === "forecast" && t.length) {
    const low = t.reduce((a, r) => (r.cash < a.cash ? r : a), t[0]);
    return `${shortMoney(t[0].revenue, currency)} in a month. ${low.cash >= 0 ? "Pays back: cash stays above zero" : `Cash goes below zero in month ${low.month}`}`;
  }
  if (item?.kind === "reused") {
    const n = Number(String(item.value ?? "").replace(/,/g, ""));
    const money = ["price", "cost", "fixed_costs", "monthly_revenue", "cash_in_bank", "amount"].includes(item.field);
    const shown = money && Number.isFinite(n) ? `${currency ? getCurrencySymbol(currency) : ""}${Math.round(n).toLocaleString("en-GB")}` : String(item.value ?? "");
    return item.label && !/preparation|evidence|readiness/i.test(item.label) ? `${item.label}: ${shown}` : shown;
  }
  return String(item?.value ?? "");
}

/** Each step's own price, before anything starts: { steps: { gap: credits }, all: up to }. Asking it holds nothing. */
export function useStepPrices(sessionId, result) {
  const [prices, setPrices] = useState(null);
  const n = (result?.blockers || []).length;
  useEffect(() => {
    if (!sessionId || !n) { setPrices(null); return undefined; }
    let live = true;
    apiRequest(`/task-sessions/${sessionId}/premium/steps`, "GET").then((r) => { if (live && r?.steps) setPrices(r); }).catch(() => {});
    return () => { live = false; };
  }, [sessionId, n]);
  return prices;
}

/** The research this result has (waiting for review or adopted), fetched once for the steps and the findings. */
export function useResearchRun(businessId, result) {
  const rs = result?.research;
  const [run, setRun] = useState(null);
  useEffect(() => {
    if (!businessId || !rs?.run_id || !["review", "adopted"].includes(rs.state)) { setRun(null); return undefined; }
    let live = true;
    apiRequest(`/businesses/${businessId}/research/${rs.run_id}`, "GET").then((r) => { if (live) setRun(r?.research || null); }).catch(() => {});
    return () => { live = false; };
  }, [businessId, rs?.run_id, rs?.state]);
  return run;
}

const DRAFT_WORD = { financial: "Forecast", use_of_funds: "Use of funds", market: "Customers", demand: "Paying customers", team: "Team",
  economics: "Price and cost", purpose: "Amount", materials: "Funding pack" };

/** The figures a worked-out draft is built from, as the run holds them (each one editable). */
function figuresFor(run, draft) {
  if (!draft?.derive) return [];
  const used = new Set(draft.inputs || []);
  return (run?.items || []).filter((x) => x.kind === "reused" && used.has(x.field) && x.value != null && x.value !== "" && !Number.isNaN(Number(String(x.value).replace(/,/g, ""))));
}

// The research's draft for a step: what it worked out or found for that gap (a calculation first, then a finding),
// or the one question only the owner can answer.
function draftFor(run, key) {
  // A funding option found is an option, never the step's draft (the owner's QA, 21 Oct: "Prepare your funding pack: Draft
  // ready: two equity schemes").
  const items = (run?.items || []).filter((i) => i.criterion === key && !String(i.topic || "").startsWith("route_"));
  // Its calculation; else the owner's own answer, or the question only they can answer; else what was looked up (the owner's
  // QA, 21 Oct: a market report stood in for "Say who your customers are").
  const own = items.find((i) => i.kind === "reused" && i.private && i.value) || items.find((i) => i.kind === "question" && !i.for_derive && !i.conflict);
  const asksFirst = items.find((i) => i.kind === "question" && i.conflict);      // "Which is right?" before anything is drafted
  return items.find((i) => i.derive || i.basis === "calculated") || asksFirst || own || items.find((i) => i.kind !== "question" && i.value)
    || items.find((i) => i.kind === "question") || null;
}

/** The one question only the owner can answer ("Who will deliver the plan?"): answered here, kept for the review. */
function DraftQuestion({ runId, item }) {
  const key = `ea_review_draft:${runId}`;
  const read = () => { try { return JSON.parse(sessionStorage.getItem(key) || "{}") || {}; } catch { return {}; } };
  const [value, setValue] = useState(() => read()[item.id]?.value || "");
  const [saved, setSaved] = useState(Boolean(read()[item.id]?.value));
  const save = () => {
    try { sessionStorage.setItem(key, JSON.stringify({ ...read(), [item.id]: { decision: "answer", value: value.trim() } })); } catch { /* kept for this view */ }
    setSaved(true);
  };
  return (
    <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (value.trim()) save(); }} data-step-question>
      <label className="text-[12.5px] text-slate-700 dark:text-slate-200" htmlFor={`sq-${item.id}`}>{item.question || item.label}</label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input id={`sq-${item.id}`} value={value} onChange={(e) => { setValue(e.target.value); setSaved(false); }}
          className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-[14px] outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-950" />
        <button type="submit" disabled={!value.trim() || saved} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-[13px] font-semibold text-slate-700 disabled:text-slate-400">{saved ? "Saved" : "Save"}</button>
      </div>
      {saved && <p className="text-[11.5px] text-emerald-700">Saved for your review. It counts once you use what you adopted.</p>}
    </form>
  );
}

/** "Your next steps": three at most, then "3 of 8 ready", which opens what looks ready and what is missing. The Agent's
 *  research drafts each step; the owner reviews and edits it (the owner, 20 Oct 2026: "it's an agent"). */
export function NextSteps({ result, onDoIt, onAnswered, run = null, onReview = null, prices = null, readyToggle = false, working = false, businessId = null, onApplied = null }) {
  const applier = useApplyResearch(businessId, run, result, onApplied);
  const currency = run?.context?.currency || null;
  const [all, setAll] = useState(false);
  const [every, setEvery] = useState(false);      // the other steps too, as cards with their drafts (the owner, 20 Oct)
  const steps = stepsOf(result);
  const researched = Boolean(run);
  const price = prices?.all ?? result?.research?.max;
  const total = (result?.criteria || []).length || steps.length + (result?.strengths || []).length;
  const ready = Math.max(0, total - steps.length);
  if (!steps.length) return null;
  return (
    <section className="mt-6" aria-label={WORDS.nextSteps} data-next-steps>
      <h3 className="text-[16px] font-semibold text-slate-900 dark:text-slate-100">{WORDS.nextSteps}</h3>
      {run?.drafts?.adopted > 0 && run.drafts.open > 0 && !Array.isArray(result?.case_steps) && (() => {
        // "You adopted 2 of 4 drafts. 1 draft left: Customers" (the owner's QA, 21 Oct): one count, and what is left by name.
        const left = steps.filter((s) => { const d = draftFor(run, s.key); return d && d.kind !== "question" && !d.decision && !applier.decided[d.id]; })
          .map((s) => DRAFT_WORD[s.key] || s.title);
        return (
          <p className="mt-1 text-[12.5px] text-slate-600" data-drafts-tally>
            You adopted {run.drafts.adopted} of {run.drafts.total} drafts.{left.length ? ` ${left.length} draft${left.length === 1 ? "" : "s"} left: ${left.join(", ")}.` : ""}</p>
        );
      })()}
      {(applier.state.text || applier.state.error) && (
        <p role="status" className={`mt-1 text-[13px] ${applier.state.error ? "text-rose-700" : "text-emerald-800"}`} data-apply-status>{applier.state.error || applier.state.text}</p>
      )}
      <ol className="mt-3 grid gap-3 xl:grid-cols-3">
        {steps.slice(0, every ? steps.length : 3).map((s) => <Step key={s.key} result={result} step={s} onAnswered={onAnswered} draft={researched && !s.field ? draftFor(run, s.key) : null}
          researched={researched && !s.field} onReview={onReview} onDoIt={onDoIt} price={prices?.steps?.[s.key]} done={(prices?.done || []).includes(s.key)}
          applier={businessId && run ? applier : null} currency={currency} figures={figuresFor(run, draftFor(run, s.key))} />)}
      </ol>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        {/* Not on the case's own steps (the owner's QA, 22 Oct: "I already ran do all for me"): each step has its own button */}
        {!researched && onDoIt && !Array.isArray(result?.case_steps) && (
          // The one research button for every step: its price first, in the spending modal (focus on "Not now").
          <button type="button" onClick={() => onDoIt(null)} disabled={working} aria-busy={working}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-brand-700 disabled:opacity-80 max-sm:w-full" data-do-all>
            {/* A spinner at once, while the price is fetched (the owner's brief, 20 Oct). */}
            {working && <span aria-hidden="true" className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
            {working ? "Getting the price…" : `Do all for me${price ? ` · up to ${price} credits` : " · Free"}`}</button>
        )}
        {/* Said plainly why it costs less than the check's price (the owner, 20 Oct: "what's do the rest for me?"). */}
        {!researched && onDoIt && prices?.spent > 0 && !Array.isArray(result?.case_steps) && (
          <span className="text-[12px] text-slate-500" data-research-reused>What I already researched for these answers is reused, free. Only the rest is charged.</span>
        )}
        {steps.length > 3 && (
          <button type="button" onClick={() => setEvery((v) => !v)} aria-expanded={every} className="text-[12.5px] font-semibold text-brand-700 underline-offset-2 hover:underline" data-more-steps>
            {every ? "Show fewer steps" : `See all ${steps.length} steps`}
          </button>
        )}
        {readyToggle && <button type="button" onClick={() => setAll((v) => !v)} aria-expanded={all} className="text-[12.5px] font-semibold text-slate-600 underline-offset-2 hover:underline" data-ready-count>
          {ready} of {total} ready{all ? "" : ". See what is ready and missing"}
        </button>}
      </div>
      {all && readyToggle && (
        <div className="mt-3 grid gap-6 xl:grid-cols-2" data-fv-lists>
          <div data-fv-strengths>
            <h4 className="text-[14px] font-semibold text-slate-900 dark:text-slate-100">{WORDS.ready}</h4>
            {(result.strengths || []).length ? (
              <ul className="mt-2 space-y-1">{result.strengths.map((t) => <li key={t} className="flex gap-2 text-[14px] text-slate-700 dark:text-slate-200"><span aria-hidden="true" className="text-emerald-600">✓</span>{t}</li>)}</ul>
            ) : <p className="mt-1 text-[14px] text-slate-500">Nothing can be confirmed yet.</p>}
          </div>
          <div data-fv-blockers>
            <h4 className="text-[14px] font-semibold text-slate-900 dark:text-slate-100">{WORDS.missing}</h4>
            <ul className="mt-2 space-y-1">{steps.map((s) => (
              <li key={s.key} className="flex items-baseline gap-2 text-[14px] text-slate-700 dark:text-slate-200" data-blocker={s.kind === "failed" ? "failed" : s.kind === "partial" ? "partial" : "unknown"}>
                <span className="shrink-0 text-[11px] font-semibold text-slate-500">{s.badge}</span>{s.gap}</li>))}</ul>
          </div>
        </div>
      )}
    </section>
  );
}

/** "What I found for you": three findings at most, each Adopt or Not relevant, with its source; the rest behind "See all". */
export function FoundForYou({ businessId, result, onSeeAll, run: given }) {
  const rs = result?.research;
  const [fetched, setRun] = useState(null);
  const run = given !== undefined ? given : fetched;      // given by the card (one fetch for the steps and the findings)
  const key = rs?.run_id ? `ea_review_draft:${rs.run_id}` : null;
  const [picked, setPicked] = useState(() => { try { return key ? JSON.parse(sessionStorage.getItem(key) || "{}") || {} : {}; } catch { return {}; } });
  useEffect(() => {
    if (given !== undefined || !businessId || !rs?.run_id || !["review", "adopted"].includes(rs.state)) return undefined;
    let live = true;
    apiRequest(`/businesses/${businessId}/research/${rs.run_id}`, "GET").then((r) => { if (live) setRun(r?.research || null); }).catch(() => {});
    return () => { live = false; };
  }, [businessId, rs?.run_id, rs?.state, given]);
  if (!run) return null;
  const found = (run.items || []).filter((i) => (i.sources || []).length && !(i.derive || i.basis === "calculated") && i.kind !== "question");
  if (!found.length) return null;
  const choose = (id, decision) => {
    const next = { ...picked, [id]: { decision } };
    setPicked(next);
    try { sessionStorage.setItem(key, JSON.stringify(next)); } catch { /* kept for this view only */ }      // the full review reads the same choices
  };
  const adopted = run.status === "adopted";
  return (
    <section className="mt-6" aria-label={WORDS.found} data-found-for-you>
      <h3 className="text-[16px] font-semibold text-slate-900 dark:text-slate-100">{WORDS.found}</h3>
      <ul className="mt-3 grid gap-3 xl:grid-cols-3">
        {found.slice(0, 3).map((i) => {
          const d = adopted ? { decision: i.decision === "accepted" || i.decision === "edited" ? "accept" : i.decision ? "reject" : null } : picked[i.id] || {};
          return (
            <li key={i.id} className={`${card} flex flex-col gap-2`} data-finding={i.id}>
              <div className="flex items-start justify-between gap-2">
                <p className="text-[14px] font-semibold text-slate-900 dark:text-slate-100">{i.label}</p>
                <span className="shrink-0 rounded-md bg-indigo-50 px-1.5 py-0.5 text-[11px] font-semibold text-indigo-800">{foundWord(i)}</span>
              </div>
              <p className="line-clamp-3 flex-1 text-[12.5px] leading-5 text-slate-600 dark:text-slate-300" title={i.value}>{i.value}</p>
              <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 pt-1" data-finding-actions>
              {!adopted && (
                <div className="flex flex-wrap gap-2">
                  <button type="button" aria-pressed={d.decision === "accept"} onClick={() => choose(i.id, "accept")}
                    className={`rounded-lg px-3 py-1.5 text-[12.5px] font-semibold ${d.decision === "accept" ? "bg-brand-600 text-white" : "border border-slate-300 text-slate-700 hover:border-brand-300"}`}>{d.decision === "accept" ? "Adopted" : WORDS.adopt}</button>
                  <button type="button" aria-pressed={d.decision === "reject"} onClick={() => choose(i.id, "reject")}
                    className={`rounded-lg px-3 py-1.5 text-[12.5px] font-semibold ${d.decision === "reject" ? "bg-slate-200 text-slate-700" : "border border-slate-300 text-slate-700 hover:border-slate-400"}`}>Not relevant</button>
                </div>
              )}
              {adopted && <p className="text-[12px] font-semibold text-emerald-700">{d.decision === "accept" ? "Adopted" : "Not used"}</p>}
              <a href={i.sources[0].url} target="_blank" rel="noopener noreferrer nofollow" className="ml-auto text-[12.5px] font-semibold text-brand-700 underline-offset-2 hover:underline">See source</a>
              </div>
            </li>
          );
        })}
      </ul>
      {onSeeAll && (
        <button type="button" onClick={onSeeAll} className="mt-3 text-[12.5px] font-semibold text-brand-700 underline-offset-2 hover:underline" data-see-all-findings>
          {adopted ? `See all findings (${found.length})` : `See all findings (${found.length}) and ${WORDS.adoptAll.toLowerCase()}`}
        </button>
      )}
    </section>
  );
}

/** Funding only: "Funding pack: 4 of 6 ready", with where to create the rest. */
export function PackLine({ result, locked = false, businessId = null, onCreate = null }) {
  const navigate = useNavigate();
  const [cost, setCost] = useState(null);
  const pack = result?.assessment?.pack;
  // One button (the owner's brief, 20 Oct): "Prepare my funding pack · N credits" when nothing exists, "View funding pack" after.
  const started = Boolean(pack?.ready);
  const creating = !locked && !started && kindOf(result) === "funding";
  useEffect(() => {
    if (!creating || !businessId) return undefined;
    let live = true;
    apiRequest(`/businesses/${businessId}/agent/price/funding_pack_draft`, "GET").then((p) => { if (live && p) setCost(p.credits ?? null); }).catch(() => {});
    return () => { live = false; };
  }, [creating, businessId]);
  if (kindOf(result) !== "funding") return null;
  const to = locked ? "/pricing" : result?.assessment?.case_id ? `/funding/${result.assessment.case_id}?tab=documents` : "/funding";
  const create = creating && onCreate && result?.assessment?.case_id;
  return (
    <section className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4 dark:border-slate-800" data-pack-line>
      <p className="text-[14px] text-slate-800 dark:text-slate-100"><span className="font-semibold">Funding pack</span>{pack?.total ? `: ${pack.ready || 0} of ${pack.total} ready` : ": not started"}
        {(pack?.items || []).some((i) => !i.ready) && <span className="block text-[12.5px] text-slate-500" data-pack-left>Still to do: {pack.items.filter((i) => !i.ready).map((i) => i.label).join(", ")}</span>}</p>
      <a href={to} onClick={(e) => { e.preventDefault(); if (create) onCreate({ capability: "funding_pack_draft", label: "Create what is missing", params: { case_id: result.assessment.case_id } }); else navigate(to); }}
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-[13px] font-semibold text-slate-700 hover:border-brand-300 max-sm:w-full max-sm:text-center" data-pack-create>
        {locked ? "Funding pack (Decision Engine plan)" : started ? "View funding pack" : `Prepare my funding pack${cost === 0 ? " · Free" : cost ? ` · ${cost} credits` : ""}`}</a>
    </section>
  );
}
