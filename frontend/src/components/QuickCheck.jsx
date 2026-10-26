import { useEffect, useRef, useState } from "react";
import { toast } from "../lib/toast";
import { useNavigate } from "react-router-dom";
import { resultHome } from "../lib/resultHome";
import { apiRequest } from "../api/client";
import FirstValueCard from "./FirstValueCard";
import UkDateInput from "./UkDateInput";
import { trackGoal } from "./GoalLauncher";
import SaidLine from "./SaidLine";
import { premiumFlow } from "./ResearchReview";

// The free first value inside the app (QA P1-7, First-Value PRD 8): a short conversation, one question
// at a time, with what the business already holds filled in (and said where it came from), then the
// provisional result from the server's deterministic check. No credits; the premium step comes after
// the value, and its gate (plan before credits) only when it is chosen.

// The free checks whose result is the page itself (no score, no Dismiss): the risk check and winning more customers
const FREE_PAGES = new Set(["business_risks", "more_customers"]);

export const QUICK_CHECKS = {
  launch: { title: "Launch Readiness quick check", intro: "A few questions, about two minutes." },
  need_funding: { title: "Funding quick check", intro: "A few questions, about two minutes." },
  price_offer: { title: "Pricing health check", intro: "A few questions about your price." },
  more_customers: { title: "Win more customers", intro: "Who buys from you now, how new customers find you, and the first things to do, from your records. I only ask what they don't show." },
  test_idea: { title: "Idea check", intro: "A few questions about your idea and its numbers." },
  business_risks: { title: "Business risk check", intro: "Your risks, worked out from your records. I only ask what your records can't tell." },
};

const ukDay = (iso) => { const [y, m, d] = String(iso).split("-"); return d && m && y ? `${d}/${m}/${y}` : iso; };
const fieldCls = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";
const chipCls = (on) => `rounded-full border px-3 py-1.5 text-[13px] font-semibold transition ${on ? "border-brand-500 bg-brand-50 text-brand-800" : "border-slate-200 bg-white text-slate-700 hover:border-brand-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"}`;

export default function QuickCheck({ businessId, goalKey, open: startOpen = false, said = "" }) {
  const [open, setOpen] = useState(startOpen);
  const [questions, setQuestions] = useState(null);
  const [values, setValues] = useState({});
  const [at, setAt] = useState(0);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [saved, setSaved] = useState(() => new Set());
  const [editingSaid, setEditingSaid] = useState(false);      // "Edit" on what was read from their sentence: asked like the rest
  const [linked, setLinked] = useState(null);      // the launch plan these answers went onto      // proposals the owner chose to put on the profile
  const field = useRef(null);
  const navigate = useNavigate();
  // A funding or launch result opens on its case page, as everywhere else
  const home = resultHome(result);
  useEffect(() => { if (home) navigate(home); }, [home]);      // eslint-disable-line react-hooks/exhaustive-deps
  const meta = QUICK_CHECKS[goalKey];

  useEffect(() => {
    if (!open || questions || !businessId) return;
    apiRequest(`/businesses/${businessId}/quick-check/${goalKey}${said ? `?said=${encodeURIComponent(said)}` : ""}`, "GET")
      .then((r) => {
        setQuestions(r.questions || []);
        setValues(Object.fromEntries((r.questions || []).filter((q) => q.default != null && q.default !== "").map((q) => [q.key, q.default])));
        // QA R8-8: the last result for this check, on return: never the questions again just to reach its next step.
        if (r.last?.result) {
          setValues((had) => ({ ...had, ...(r.last.answers || {}) }));
          setResult(r.last.result);
        }
      })
      .catch(() => setError("The quick check couldn't load just now. Please try again."));
  }, [open, questions, businessId, goalKey, said]);

  // What their own sentence already answered is shown once and not asked (QA P5-1); "Edit" asks it like the rest.
  const asked = (questions || []).filter((x) => editingSaid || !x.said);
  // Each answer named ("Payments: customers pay on time"), never a bare chip's words (the owner, 24 Oct)
  const saidItems = (questions || []).filter((x) => x.said && x.source !== "From your funding case")
    .map((x) => ({ key: x.key, text: goalKey === "business_risks" && x.noun ? `${x.noun[0].toUpperCase()}${x.noun.slice(1)}: ${x.said_text}` : x.said_text }));
  // What the funding case already holds: shown once, not asked (the owner's QA, 22 Oct: "use the current data")
  const caseItems = (questions || []).filter((x) => x.said && x.source === "From your funding case").map((x) => ({ key: x.key, text: x.said_text }));
  const q = asked[at];
  useEffect(() => { setDraft(q ? String(values[q.key] ?? "") : ""); field.current?.focus({ preventScroll: true }); }, [q?.key]);      // eslint-disable-line react-hooks/exhaustive-deps

  async function finish(all) {
    setBusy(true);
    setError("");
    try {
      const r = await apiRequest(`/businesses/${businessId}/quick-check/${goalKey}`, "POST", { answers: all });
      setResult(r.result);
      if (goalKey === "business_risks") toast({ kind: "success", title: "Done. Your risk check is up to date." });
      if (goalKey === "more_customers") toast({ kind: "success", title: "Done. Your customer plan is up to date." });
      trackGoal("first_value_shown", { key: goalKey, where: "app" });
    } catch {
      setError("I couldn't work that out just now. Your answers are kept: try again.");
      toast({ kind: "error", title: "That didn't go through.", detail: "Your answers are kept. Try again." });
    } finally { setBusy(false); }
  }

  function answer(value) {
    if (!q) return;
    const v = typeof value === "string" ? value.trim() : value;
    if (q.required && (v === "" || v == null)) { setError("Please answer, or choose Not sure."); return; }
    setError("");
    const next = { ...values, [q.key]: v };
    setValues(next);
    if (at < asked.length - 1) setAt(at + 1);
    else finish(next);
  }

  if (!meta) return null;
  if (result && home) return <p className="text-[13px] text-slate-500" role="status" data-opening-case>Opening your case…</p>;
  if (result) {
    const attach = () => apiRequest(`/businesses/${businessId}/quick-check/launch/attach`, "POST", { answers: values });
    // QA PF1/PF3: the premium step, here on the page. The plan first, then the cost (shown before it starts), then
    // research of what is missing, reviewed item by item. Nothing else is started.
    // R9-4: once adopted, the card shows the new result (never the old score left on screen).
    // The result loaded again from the records, after findings are accepted on this page
    const reload = () => apiRequest(`/businesses/${businessId}/quick-check/${goalKey}`, "GET").then((r) => { if (r?.last?.result) setResult(r.last.result); }).catch(() => {});
    const premium = premiumFlow({ base: `/businesses/${businessId}/quick-check/${goalKey}/premium`, body: { answers: values }, businessId, onError: setError,
      onAdopted: (out) => { if (out?.result) setResult({ ...out.result, premium_gate: result.premium_gate }); else reload(); } });
    // QA E4: the answers belong on the launch plan, which otherwise still shows 0% evidence.
    const extra = goalKey === "launch" ? (
      <div className="mt-3 text-[13px]" data-launch-link>
        {linked ? (
          <div data-launch-linked>
            <p className="text-emerald-700">{linked.created ? "Launch plan started" : "Added to your launch plan"}: <a className="font-semibold underline" href={linked.to}>{linked.title}</a>. It is being checked again.</p>
            {/* QA PF5: what went on it, and what its own checks still need (never filled in for you). */}
            <p className="mt-1 text-[12px] text-slate-600">{[linked.target_date && `Launch date set: ${ukDay(linked.target_date)}`, linked.evidence_id && "your demand evidence is attached"].filter(Boolean).join("; ")}{linked.target_date || linked.evidence_id ? "." : ""}</p>
            {linked.still_needed?.length > 0 && <p className="mt-1 text-[12px] text-amber-800" data-still-needed>For it to count, add: {linked.still_needed.join("; ")}.</p>}
          </div>)
          : <button type="button" className="font-semibold text-brand-700 underline-offset-2 hover:underline" onClick={async () => { try { setLinked(await attach()); } catch { setError("Your launch plan couldn't be updated just now. Nothing was changed."); } }}>
            Add these answers to your launch plan</button>}
      </div>) : null;
    // On the risk check's own page the result is the page: no Dismiss; an answer given on it is checked again here
    return <FirstValueCard result={result} onPremium={premium} extra={extra} onReload={reload} onDismiss={FREE_PAGES.has(goalKey) ? null : () => { setResult(null); setAt(0); setOpen(false); }}
      onAnswer={(key, value) => finish({ ...values, [key]: value })}
      onContinue={() => { setResult(null); setAt(0); setOpen(true); }} continueLabel="Start again" />;
  }

  return (
    <section aria-label={meta.title} data-quick-check={goalKey} className="rounded-2xl border border-brand-200 bg-brand-50/50 p-4 dark:border-brand-900 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{meta.title}</p>
          <p className="text-[13px] text-slate-600 dark:text-slate-400">{meta.intro}{FREE_PAGES.has(goalKey) ? "" : " You get a score, what looks ready and what is missing."}</p>
        </div>
        {!open && <button type="button" onClick={() => setOpen(true)} className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">Start the quick check</button>}
      </div>

      {open && !questions && !error && <p role="status" className="mt-3 text-[13px] text-slate-500">Loading…</p>}
      {open && questions && caseItems.length > 0 && (
        <div className="mt-3" data-from-case><SaidLine title="From your funding case" items={caseItems} editing={editingSaid} onEdit={() => { setEditingSaid(true); setAt(0); }} /></div>
      )}
      {open && questions && saidItems.length > 0 && (
        <div className="mt-3"><SaidLine items={saidItems} editing={editingSaid} onEdit={() => { setEditingSaid(true); setAt(0); }}
          {...(FREE_PAGES.has(goalKey) ? { title: "From your records" } : {})} /></div>
      )}
      {open && questions && !q && !result && asked.length === 0 && (
        // Everything was in their sentence: one tap to see the result.
        <button type="button" disabled={busy} onClick={() => finish(values)} className="mt-3 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
          {busy ? "Working it out…" : "See my result"}</button>
      )}
      {open && q && (
        <form className="mt-3 space-y-2" onSubmit={(e) => { e.preventDefault(); answer(draft); }}>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400" data-progress>Question {at + 1} of {asked.length}</p>
          <label htmlFor={`qc-${q.key}`} className="block text-sm font-medium text-slate-800 dark:text-slate-100">{q.label}</label>
          {q.prefilled && String(values[q.key] ?? "") === draft && (
            // Where the value came from, said truthfully (QA R1): the profile, or an earlier answer that is not on it.
            <p className={`text-[12px] ${q.proposal_id ? "text-amber-700" : "text-emerald-700"}`} data-prefilled>
              {q.source}. Keep it, or change it.
              {q.proposal_id && !saved.has(q.proposal_id) && (
                <button type="button" className="ml-2 font-semibold underline-offset-2 hover:underline" data-save-proposal
                  onClick={() => apiRequest(`/businesses/${businessId}/profile-proposals/${q.proposal_id}`, "POST", { confirm: true })
                    .then(() => setSaved((had) => new Set([...had, q.proposal_id]))).catch(() => setError("That couldn't be saved to your profile just now."))}>
                  Save it to my profile
                </button>
              )}
              {q.proposal_id && saved.has(q.proposal_id) && <span className="ml-2 font-semibold text-emerald-700">Saved to your profile.</span>}
            </p>
          )}
          {q.type === "choice" ? (
            <div className="flex flex-wrap gap-2" role="group" aria-label={q.label}>
              {q.options.map((o) => (
                <button key={o.value} type="button" disabled={busy} onClick={() => answer(o.value)} className={chipCls(String(values[q.key]) === String(o.value))}>{o.label}</button>
              ))}
            </div>
          ) : (
            <>
              {q.type === "textarea"
                ? <textarea id={`qc-${q.key}`} ref={field} rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} className={fieldCls} />
                : q.type === "date" ? <UkDateInput id={`qc-${q.key}`} aria-label={q.label} value={draft} onChange={setDraft} className={fieldCls} />
                : <input id={`qc-${q.key}`} ref={field} type="text" inputMode={q.type === "number" ? "decimal" : undefined} value={draft} onChange={(e) => setDraft(e.target.value)} className={fieldCls} />}
              {(q.chips?.length > 0 || q.unsure) && (
                <div className="flex flex-wrap gap-1.5">
                  {[...(q.chips || []), ...(q.unsure ? [{ value: q.unsure_value ?? "unknown", label: q.unsure }] : [])].map((c) => (
                    <button key={String(c.value)} type="button" disabled={busy} onClick={() => answer(c.value)} className={chipCls(false)}>{c.label}</button>
                  ))}
                </div>
              )}
            </>
          )}
          <div className="flex items-center gap-3 pt-1">
            {at > 0 && <button type="button" onClick={() => setAt(at - 1)} className="text-[13px] font-semibold text-slate-500 hover:underline">Back</button>}
            {q.type !== "choice" && (
              <button type="submit" disabled={busy} className="ml-auto rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
                {busy ? "Working it out…" : at === asked.length - 1 ? "See my result" : "Next"}
              </button>
            )}
            {!q.required && q.type !== "choice" && <button type="button" onClick={() => answer("")} className="text-[13px] font-semibold text-slate-500 hover:underline">Skip</button>}
          </div>
        </form>
      )}
      {error && <p role="alert" className="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>}
    </section>
  );
}
