import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "../api/client";
import { refusalMessage } from "../lib/entitlement";
import { getCurrencySymbol } from "../lib/currencies";
import { MoneyInput } from "./readiness/Fields";
import { useApplyResearch } from "./ResultSummary";

// After a paid run, ONE result view (the owner's brief, 20 Oct): what was prepared, in plain words, each block with one
// clear action. Drafts as rows (details on request), at most three funding options with "Fits", the questions inline,
// and one free "Check my score again". Everything else (every input, the sources in full, older runs) is on Advanced.

const DRAFT_ORDER = ["use_of_funds", "forecast", "break_even", "funding_range", "cash_needed", "margin", "capacity"];
const DRAFT_NAME = { use_of_funds: "Use of funds", forecast: "12-month cash forecast", break_even: "Break-even", funding_range: "How much you need",
  cash_needed: "Cash needed to launch", margin: "Margin per sale", capacity: "What you can deliver" };
const ROUTE_WORD = { loan: "loan", grant: "grant", equity: "equity investment" };

/** ₦3m, ₦993K, £25K: an amount as a summary says it. */
export function shortMoney(n, currency) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "";
  const sign = getCurrencySymbol(currency);
  const a = Math.abs(v);
  const neg = v < 0 ? "\u2212" : "";
  const fmt = (x, unit) => `${neg}${sign}${(Math.round(Math.abs(x) * 10) / 10).toLocaleString("en-GB", { maximumFractionDigits: 1 })}${unit}`;
  if (a >= 1e9) return fmt(v / 1e9, "bn");
  if (a >= 1e6) return fmt(v / 1e6, "m");
  if (a >= 1e3) return `${neg}${sign}${Math.round(a / 1e3).toLocaleString("en-GB")}K`;      // ₦993K, never ₦993.4K
  return `${neg}${sign}${Math.round(a).toLocaleString("en-GB")}`;
}
const whole = (n, currency) => { const v = Math.round(Number(n) || 0); return `${v < 0 ? "\u2212" : ""}${getCurrencySymbol(currency)}${Math.abs(v).toLocaleString("en-GB")}`; };
const firstSentence = (t, max = 90) => { const s = String(t || "").split(/(?<=[.!?])\s/)[0]; return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s; };

function draftLine(item, currency) {
  const t = item.table || [];
  if (item.derive === "use_of_funds" && t.length) {
    const [lead, ...rest] = t;
    return `${lead.line}: ${shortMoney(lead.amount, currency)}${rest.length ? `, then ${rest.map((r) => r.line.split(":")[0].toLowerCase()).join(" and ")}` : ""}`;
  }
  if (item.derive === "forecast" && t.length) {
    const low = t.reduce((a, r) => (r.cash < a.cash ? r : a), t[0]);
    return `${shortMoney(t[0].revenue, currency)} in a month. ${low.cash >= 0 ? "Pays back: cash stays above zero" : `Cash goes below zero in month ${low.month}`}`;
  }
  return firstSentence(item.value);
}

function DraftDetails({ item, currency }) {
  const t = item.table || [];
  if (item.derive === "use_of_funds" && t.length) {
    return (
      <table className="mt-2 w-full text-[12.5px]" data-draft-table>
        <tbody>{t.map((r) => <tr key={r.line} className="border-t border-slate-100"><td className="py-1 pr-2">{r.line}</td><td className="py-1 text-right tabular-nums">{whole(r.amount, currency)}</td></tr>)}</tbody>
      </table>
    );
  }
  if (item.derive === "forecast" && t.length) {
    // At most five columns; on a phone it scrolls inside the table, the month kept in view.
    return (
      <div className="mt-2 max-w-full overflow-x-auto" data-draft-table>
        <table className="min-w-[30rem] text-right text-[12.5px] tabular-nums">
          <thead><tr className="text-slate-500"><th className="sticky left-0 bg-white pr-3 text-left font-medium">Month</th><th className="pr-3 font-medium">In</th><th className="pr-3 font-medium">Out</th><th className="pr-3 font-medium">Profit</th><th className="font-medium">Cash</th></tr></thead>
          <tbody>{t.map((r) => <tr key={r.month} className="border-t border-slate-100"><td className="sticky left-0 bg-white py-1 pr-3 text-left">{r.month}</td><td className="pr-3">{whole(r.in ?? r.revenue, currency)}</td><td className="pr-3">{whole(r.out ?? r.costs, currency)}</td><td className="pr-3">{whole(r.profit, currency)}</td><td>{whole(r.cash, currency)}</td></tr>)}</tbody>
        </table>
      </div>
    );
  }
  return <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[12.5px] text-slate-600">{(item.working || [item.value]).map((w) => <li key={w}>{w}</li>)}</ul>;
}

// Where a figure came from, said plainly and linked (the owner's brief, 20 Oct).
function sourceOf(note) {
  const t = String(note || "");
  if (/chat|your answer/i.test(t)) return { text: "From your chat" };
  if (/catalogue/i.test(t)) return { text: "From Catalogue", to: "/catalogue" };
  if (/invoices|expenses|records|received/i.test(t)) return { text: "From Business Operations", to: "/operations" };
  if (/estimate|benchmark/i.test(t)) return { text: "My estimate" };
  if (/profile/i.test(t)) return { text: "From your business profile", to: "/settings" };
  return t ? { text: t } : null;
}
const FIGURE = { price: "price", cost: "cost per sale", monthly_sales: "sales a month", fixed_costs: "fixed costs", cash_in_bank: "cash", monthly_revenue: "revenue", amount: "amount" };
function DraftSources({ item, run }) {
  const [more, setMore] = useState(false);
  const from = run?.inputs_from || {};
  const used = (item.inputs || []).filter((f) => from[f]);
  if (!used.length) return null;
  // At most two short chips ("From your chat", "From Business Operations"); the rest behind "Sources" (the owner's QA, 21 Oct).
  const chips = [...new Map(used.map((f) => { const src = sourceOf(from[f]); return [src?.text, src]; })).values()].filter(Boolean);
  const chip = (src) => (src.to
    ? <a key={src.text} href={src.to} className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200">{src.text}</a>
    : <span key={src.text} className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">{src.text}</span>);
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px]" data-draft-sources>
      {chips.slice(0, 2).map(chip)}
      {chips.length > 2 && !more && <button type="button" onClick={() => setMore(true)} className="font-semibold text-slate-500 hover:underline">Sources</button>}
      {more && chips.slice(2).map(chip)}
    </div>
  );
}

const FIT_TONE = { Likely: "bg-emerald-50 text-emerald-800", Maybe: "bg-amber-50 text-amber-800", Unlikely: "bg-slate-100 text-slate-600",
  "Different route": "bg-slate-100 text-slate-600" };
/** 7 Apr 2025, from 2025-04-07. */
const dayOf = (iso) => { const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`); return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }); };
/** Open only from an open statement on the page (the owner's QA, 21 Oct); else when it was published. */
const openLine = (fits) => fits?.confirmed ? `Last confirmed open: ${dayOf(fits.confirmed)}`
  : fits?.published ? `Status not confirmed, published ${dayOf(fits.published)}` : "Status not confirmed: check before you apply";
const btn = "rounded-lg px-3 py-1.5 text-[13px] font-semibold max-sm:w-full";
const pressed = (on) => (on ? "bg-brand-600 text-white" : "border border-slate-300 bg-white text-slate-700 hover:border-brand-300");

export default function ResearchSummary({ businessId, run, score = null, onAdopted = null, onSeeAll = null }) {
  const currency = run?.context?.currency || run?.inputs?.currency || "GBP";
  const items = useMemo(() => (run?.items || []).map((i) => ({ ...i, kind: i.kind || i.state })), [run]);
  const [decisions, setDecisions] = useState({});
  const [open, setOpen] = useState({});
  const [calc, setCalc] = useState({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [typed, setTyped] = useState({});
  const [picked, setPicked] = useState({});      // each option's own choice, applied at once
  const applier = useApplyResearch(businessId, run, null, async (out) => { onAdopted?.(out); return out?.result; });
  const set = (id, d) => setDecisions((m) => ({ ...m, [id]: d }));

  const drafts = DRAFT_ORDER.map((k) => items.find((i) => i.derive === k && (calc[i.id]?.value ?? i.value) != null))
    .filter(Boolean).slice(0, 3).map((i) => ({ ...i, ...(calc[i.id] || {}) }));
  const routes = run?.deliverables?.routes || [];
  // One scheme per card (the owner's QA, 21 Oct): from the server's options, else one per finding.
  const options = (run?.deliverables?.options || []).length
    ? run.deliverables.options.slice(0, 3).map((o) => ({ ...o, label: o.title, value: o.text, sources: [o.source] }))
    : items.filter((i) => i.kind === "researched" && /^route_/.test(String(i.topic || "")) && i.value)
      .slice(0, 3).map((i) => ({ ...i, item_id: i.id, fits: (routes.find((r) => r.local === i.value) || {}).fits }));

  const questions = items.filter((i) => i.kind === "question");
  // The figures answered here update the drafts at once (free, nothing saved).
  useEffect(() => {
    if (!run?.id || !Object.values(decisions).some((d) => d.decision === "answer")) return undefined;
    const t = setTimeout(() => {
      apiRequest(`/businesses/${businessId}/research/${run.id}/preview`, "POST", { decisions })
        .then((out) => setCalc(Object.fromEntries((out?.calculated || []).map((c) => [c.id, c])))).catch(() => {});
    }, 350);
    return () => clearTimeout(t);
  }, [decisions, businessId, run?.id]);

  if (!run) return null;
  const amount = run.answers?.amount;
  const what = `${Number(amount) > 0 ? `${shortMoney(amount, currency)} ` : ""}${ROUTE_WORD[String(run.answers?.route || "").toLowerCase()] || "funding"}`;
  // One count everywhere (the owner's QA, 21 Oct): the run's own number of new findings.
  const findings = typeof run?.findings === "number" ? run.findings
    : options.length + items.filter((x) => (x.sources || []).length && x.kind === "estimated" && !x.derive).length;
  const counted = `${findings} ${findings === 1 ? "finding" : "findings"}`;

  async function checkAgain() {
    setBusy(true);
    setProblem("");
    // Adopted: the drafts and options chosen, your own records as they are, the answers given; the rest is left out.
    const byItem = {};
    options.forEach((o) => { const c = picked[o.id]; if (c) byItem[o.item_id] = byItem[o.item_id] === "accept" || c === "accept" ? "accept" : "reject"; });
    const chosen = Object.fromEntries(items.flatMap((i) => {
      const d = byItem[i.id] ? { decision: byItem[i.id], pressed: byItem[i.id] === "accept" } : decisions[i.id];
      if (i.kind === "question") return [[i.id, d?.decision === "answer" && String(d.value || "").trim() ? d : { decision: "skip" }]];
      if (d) return [[i.id, d]];
      return i.kind === "reused" ? [[i.id, { decision: "accept" }]] : [];
    }));
    try {
      const out = await apiRequest(`/businesses/${businessId}/research/${run.id}/review`, "POST", { decisions: chosen });
      onAdopted?.(out);
    } catch (e) {
      setProblem(refusalMessage(e, "That couldn't be saved just now. Nothing was changed. Try again."));
    } finally { setBusy(false); }
  }

  return (
    <section className="rounded-2xl border border-indigo-100 bg-white p-5 shadow-sm dark:border-indigo-900 dark:bg-slate-900" aria-label="What I did for you" data-research-summary>
      <p className="text-[17px] font-semibold text-slate-900 dark:text-slate-100" data-summary-head>
        {run.updated_free && !(run.charged_now > 0)
          ? `Updated your drafts · free. ${counted} for your ${what}.`
          : findings ? `${counted.charAt(0).toUpperCase()}${counted.slice(1)} for your ${what}.` : `Nothing new found for your ${what}, so nothing was charged.`}</p>
      {score && <p className="mt-2 text-[13px] text-slate-600 dark:text-slate-300" data-summary-score>Your score now <span className="ml-1 align-middle text-[24px] font-bold tabular-nums text-slate-900 dark:text-slate-100">{score}</span></p>}
      {run.drafts?.adopted > 0 && run.drafts.open > 0 && <p className="mt-0.5 text-[12.5px] text-slate-600" data-summary-adopted>You adopted {run.drafts.adopted} of {run.drafts.total} drafts.</p>}

      {(typeof run.drafts?.open === "number" ? run.drafts.open > 0 : drafts.length > 0) && (
        // The drafts are in the step cards below, each with Adopt (the owner's QA, 21 Oct): said here in one line.
        <p className="mt-3 text-[13px] text-slate-700 dark:text-slate-200" data-summary-drafts>
          {(() => {
            // One number everywhere (the owner's QA, 21 Oct): the drafts still to adopt, as the steps count them.
            const open = typeof run.drafts?.open === "number" ? run.drafts.open : drafts.length;
            const names = open === drafts.length ? `: ${drafts.map((d) => DRAFT_NAME[d.derive] || d.label).join(", ")}` : "";
            return `${open === 1 ? "1 draft is" : `${open} drafts are`} ready in your steps below${names}.`;
          })()}</p>
      )}
      {options.length > 0 && (
        <div className="mt-5" data-summary-options>
          <h3 className="text-[14px] font-semibold text-slate-900 dark:text-slate-100">{String(run.answers?.route || "").toLowerCase() === "grant" ? "Grants" : "Loans and grants"} that may fit you</h3>
          <ul className="mt-2 grid gap-3 md:grid-cols-3">
            {options.map((i) => {
              const d = picked[i.id];
              const src = (i.sources || [])[0] || {};
              return (
                <li key={i.id} className="flex min-w-0 flex-col gap-2 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60" data-summary-option>
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 text-[13.5px] font-semibold text-slate-900 dark:text-slate-100" data-option-title>{i.label || src.title}</p>
                    {i.fits && <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${FIT_TONE[i.fits.fit] || FIT_TONE.Maybe}`} data-fits title={i.fits.why}>{i.fits.fit === "Different route" ? (i.fits.why || "Different route") : `Fits: ${i.fits.fit}`}</span>}
                  </div>
                  <p className="text-[12.5px] text-slate-600 dark:text-slate-300" data-option-text>{firstSentence(i.value, 10000)}</p>
                  {i.fits?.why && i.fits.fit !== "Different route" && <p className="text-[11.5px] text-slate-500">{i.fits.why}</p>}
                  <p className="text-[11.5px] text-slate-500" data-option-confirmed>{openLine(i.fits)}</p>
                  <div className="mt-auto flex flex-wrap items-center gap-2">
                    <button type="button" aria-pressed={d === "accept"} onClick={() => { setPicked((m) => ({ ...m, [i.id]: "accept" })); applier.apply(i.item_id || i.id, { decision: "accept", pressed: true }); }} className={`${btn} ${pressed(d === "accept")}`}>{d === "accept" ? "Saved to my case" : "Save to my case"}</button>
                    <button type="button" aria-pressed={d === "reject"} onClick={() => { setPicked((m) => ({ ...m, [i.id]: "reject" })); applier.apply(i.item_id || i.id, { decision: "reject" }); }} className={`${btn} ${d === "reject" ? "bg-slate-200 text-slate-700" : "border border-slate-300 bg-white text-slate-700"}`}>Not relevant</button>
                    <button type="button" onClick={() => setOpen((o) => ({ ...o, [i.id]: !o[i.id] }))} aria-expanded={Boolean(open[i.id])} className="ml-auto text-[12px] font-semibold text-brand-700 hover:underline">{open[i.id] ? "Hide source" : "See source"}</button>
                  </div>
                  {open[i.id] && (
                    <div className="text-[12px] text-slate-600" data-option-source>
                      {src.quote && <q className="block whitespace-normal italic">{src.quote}</q>}
                      <p className="mt-1">{src.publisher || src.site || ""}</p>
                      {src.date && <p>Dated {src.date}</p>}
                      {src.url && <a href={src.url} target="_blank" rel="noopener noreferrer nofollow" className="font-semibold text-brand-700 hover:underline">Open the page</a>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {problem && <p role="alert" className="mt-3 text-[12.5px] text-rose-700">{problem}</p>}
      {(applier.state.text || applier.state.error) && <p role="status" className={`mt-3 text-[12.5px] ${applier.state.error ? "text-rose-700" : "text-emerald-800"}`} data-summary-status>{applier.state.error || applier.state.text}</p>}
      <div className="mt-5 flex flex-wrap items-center gap-3 max-sm:flex-col max-sm:items-stretch">
        {onSeeAll && <button type="button" onClick={onSeeAll} className="text-[12.5px] font-semibold text-slate-600 hover:underline" data-see-everything>See everything I used</button>}
      </div>
    </section>
  );
}

/** After adopting: the view becomes one line (the owner's brief, 20 Oct). */
export function AdoptedBanner({ run, onOpen }) {
  if (!run || run.status !== "adopted") return null;
  const n = (run.items || []).filter((i) => i.derive && ["accepted", "edited"].includes(i.decision)).length;
  const day = String(run.adopted_at || run.created_at || "").slice(0, 10);
  const shown = day ? new Date(`${day}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "";
  return (
    <p className="rounded-xl bg-indigo-50 px-4 py-2.5 text-[13px] text-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-100" data-adopted-banner>
      {n ? `You adopted ${n} ${n === 1 ? "draft" : "drafts"}` : "You reviewed my research"}{shown ? ` on ${shown}` : ""} ·{" "}
      <button type="button" onClick={onOpen} className="font-semibold underline-offset-2 hover:underline">See what I did</button>
    </p>
  );
}
