// The funding case Overview's parts (the owner's brief, 22 Oct): the score hero, the funding option cards, "What to do
// next" as cards and the funding pack strip. Colour has one meaning each: indigo actions and the ring's track, green done
// and "Fits: Likely", amber to do, partly there and "Fits: Maybe", red must fix (a soft background, dark text), slate help
// text, sources and dates. Cards are 16px radius, 20px padding, 16px apart; at most 3 per section until "See N more".
import { useState } from "react";
import { useNavigate } from "react-router-dom";

export const CARD = "rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900";
const LINK = "text-[13px] font-semibold text-brand-700 underline-offset-2 hover:underline dark:text-brand-300";

const ringTone = (n) => (n >= 70 ? "stroke-emerald-500" : n >= 40 ? "stroke-amber-500" : "stroke-rose-500");

/** The score ring: red under 40, amber 40 to 69, green from 70, on an indigo track; moves when the score changes. */
export function ScoreRing({ score, size = 72 }) {
  const n = Number.isFinite(Number(score)) && score !== null ? Math.max(0, Math.min(100, Math.round(Number(score)))) : null;
  const r = (size - 10) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} data-score-ring={n ?? ""}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth="8" fill="none" className="stroke-indigo-100 dark:stroke-indigo-950" />
        {n !== null && (
          <circle cx={size / 2} cy={size / 2} r={r} strokeWidth="8" fill="none" strokeLinecap="round" className={`${ringTone(n)} transition-[stroke-dashoffset] duration-700 ease-out`}
            strokeDasharray={c} strokeDashoffset={c * (1 - n / 100)} />
        )}
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[18px] font-bold tabular-nums text-slate-900 dark:text-slate-100">{n ?? ""}</span>
    </div>
  );
}

const PILL = {
  done: { tone: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200", mark: "✓" },
  partly: { tone: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200", mark: "●" },
  fix: { tone: "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200", mark: "⚠" },
};

/** The score hero: the ring, the case's title, one status line, the six section pills and the one primary button. */
export function ScoreHero({ eyebrow, title, score, status, pills = [], onPill, info = null, actions = null, notes = null }) {
  return (
    <section className={`${CARD} flex flex-col gap-4`} data-case-hero data-case-header>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <ScoreRing score={score} />
          <div className="min-w-0">
            {eyebrow && <p className="text-[12px] text-slate-500 dark:text-slate-400" data-case-eyebrow>{eyebrow}</p>}
            <h1 className="mt-0.5 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl dark:text-slate-100" data-case-title>{title}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[14px] font-semibold text-slate-800 dark:text-slate-100" data-case-status>
              <span>{status}</span>
              {info && (
                <span className="group relative inline-flex" tabIndex={0} aria-label={info} data-general-checks>
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
                  <span role="tooltip" className="pointer-events-none absolute left-1/2 top-6 z-20 hidden w-64 -translate-x-1/2 rounded-lg bg-slate-900 px-3 py-2 text-[12px] font-normal leading-snug text-white shadow-lg group-hover:block group-focus:block">{info}</span>
                </span>
              )}
            </p>
            {notes}
          </div>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2 max-sm:w-full [&>*:first-child]:max-sm:flex-1">{actions}</div>}
      </div>
      {pills.length > 0 && (
        // Scrolls inside the card on a phone, never the page
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" data-section-counts>
          {pills.map((x) => {
            const p = PILL[x.state] || PILL.partly;
            return (
              <button key={x.key} type="button" onClick={() => onPill?.(x.key)} data-pill={x.state}
                className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-[12.5px] font-semibold ${p.tone}`}>
                <span aria-hidden="true">{p.mark}</span>{x.text}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** Up to 3, then "See N more" for the rest. */
function useMore(items, n = 3) {
  const [all, setAll] = useState(false);
  return { shown: all ? items : items.slice(0, n), more: Math.max(0, items.length - n), all, toggle: () => setAll((v) => !v) };
}

const ICONS = {
  pack: "M7 3h7l5 5v13H7z M14 3v5h5",
  plan: "M4 5h16M4 10h16M4 15h10",
  invoice: "M6 3h12v18l-3-2-3 2-3-2-3 2z M9 8h6M9 12h6",
  catalogue: "M4 7l8-4 8 4-8 4z M4 7v10l8 4 8-4V7",
  scenario: "M4 19l5-6 4 3 7-9",
  launch: "M5 19l4-1 9-9-3-3-9 9z M14 6l3 3",
  marketplace: "M4 9h16l-1 11H5z M8 9V6a4 4 0 0 1 8 0v3",
  pricing: "M3 12l9-9h8v8l-9 9z M16 8h.01",
  funding: "M12 3v18 M8 7h6a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h7",
};

/** "What to do next": cards with an icon, a title, one reason, the cost, and "Start →". */
export function RelatedCards({ items = [] }) {
  const navigate = useNavigate();
  const shown = items.slice(0, 3);
  if (!items.length) return null;
  return (
    <section className="space-y-3" data-related>
      <h2 className="text-[16px] font-bold text-slate-900 dark:text-slate-100">What to do next</h2>
      <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {shown.map((r) => (
          <li key={r.key} className={`${CARD} flex h-full flex-col gap-2`} data-related-item={r.key}>
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-950/50 dark:text-brand-300">
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={ICONS[r.key] || ICONS.plan} /></svg>
            </span>
            <p className="text-[14.5px] font-semibold text-slate-900 dark:text-slate-100">{r.title}</p>
            <p className="text-[13px] text-slate-600 dark:text-slate-300">{r.why}</p>
            <div className="mt-auto flex items-center justify-between gap-3 pt-2">
              <span className="text-[12px] text-slate-500 dark:text-slate-400" data-related-cost>{r.cost || "Free"}</span>
              <button type="button" onClick={() => navigate(r.locked ? "/pricing" : r.to)} className={LINK} data-related-cta>{r.locked ? "Upgrade →" : `${r.cta || "Start"} →`}</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

const ROUTE_HEADING = { grant: "Grants that may fit you", loan: "Loans that may fit you", equity: "Investment that may fit you" };
const NOT_A_FINDING = /\bno\b[^.]{0,80}\b(?:found|identified|available)\b|\bnot found\b|\bnothing\b[^.]{0,40}\bfound\b|\bcould(?:n't| not) find\b/i;
const MONEY = /(?:[£$€₦]|NGN\s?|GBP\s?|USD\s?)\s?\d[\d,.]*\s?(?:k|m|bn|million|billion)?(?:\s?(?:to|-|and)\s?(?:[£$€₦]|NGN\s?|GBP\s?|USD\s?)?\s?\d[\d,.]*\s?(?:k|m|bn|million|billion)?)?/i;
const FIT_TONE = { Likely: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200", Maybe: "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" };
const dayOf = (iso) => { const d = new Date(`${String(iso || "").slice(0, 10)}T00:00:00Z`); return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }); };
const firstSentence = (t, max = 140) => { const s = String(t || "").split(/(?<=[.!?])\s/)[0]; return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s; };

/** The funding options for this case's route: saved ones first, then those found (one scheme per card when the server
 *  split them), a saved one marked so. Any route when `route` isn't grant, loan or equity. */
export function fundingOptions({ route, saved = [], run = null }) {
  const want = ["grant", "loan", "equity"].includes(route) ? route : null;
  const items = run?.items || [];
  const decisionOf = (id) => items.find((x) => x.id === id)?.decision;
  const fits = Object.fromEntries((run?.deliverables?.routes || []).map((r) => [r.local, r.fits]));
  const found = (run?.deliverables?.options || []).length
    ? run.deliverables.options.map((o) => ({ ...o, item_id: o.item_id || o.id, source: o.source || {} }))
    : items.filter((i) => /^route_/.test(String(i.topic || "")) && i.value)
      .map((i) => ({ id: i.id, item_id: i.id, route: String(i.topic).replace("route_", ""), title: i.label, text: i.value, source: (i.sources || [])[0] || {}, fits: fits[i.value] || i.fits }));
  const kept = saved.map((o) => ({ ...o, saved: true }));
  const seen = new Set(kept.flatMap((o) => [String(o.id), String(o.item_id || "")]));
  return [...kept, ...found.filter((o) => !seen.has(String(o.id)) && !seen.has(String(o.item_id)) && decisionOf(o.item_id) !== "rejected")
    .map((o) => ({ ...o, saved: ["accepted", "edited"].includes(decisionOf(o.item_id)) }))]
    .filter((o) => (!want || o.route === want) && o.title && !NOT_A_FINDING.test(String(o.text || "")));
}

/** What else the research found with a source (market, demand, prices): not a funding option, not a draft. */
export function researchFindings(run) {
  return (run?.items || []).filter((i) => ["researched", "estimated"].includes(i.kind || i.state) && i.value && (i.sources || []).length
    && !/^route_/.test(String(i.topic || "")) && !i.derive && !NOT_A_FINDING.test(String(i.value)));
}

const ROUTE_WORDS = { grant: "grants", loan: "loans", equity: "investors" };
const ROUTE_NAME = { grant: "Grant", loan: "Loan", equity: "Equity" };

/** Funding option cards: name, amount, one condition, the Fits badge, source and date in grey. */
// When nothing was found for the case's route, the section still says so, with what was found for the other routes
// (the owner's QA, 22 Oct: a grant case whose grant pages couldn't be read showed no options at all).
export function FundingOptions({ route, options = [], others = [], searched = false, onSave = null, onHide = null }) {
  const list = options.length ? options : others;
  const { shown, more, all, toggle } = useMore(list);
  if (!list.length && !searched) return null;
  return (
    <section className="space-y-3" data-funding-options>
      <h2 className="text-[16px] font-bold text-slate-900 dark:text-slate-100">{ROUTE_HEADING[route] || "Funding that may fit you"}</h2>
      {!options.length && (
        <p className="text-[13px] text-slate-600 dark:text-slate-300" data-options-none>
          {`No ${ROUTE_WORDS[route] || "funding options"} were found that could be checked for this need.`}
          {others.length > 0 && " The research found these other options instead."}</p>
      )}
      {list.length > 0 && <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {shown.map((o) => {
          const amount = ((String(o.text || "").match(MONEY) || [])[0] || "").trim();
          const fit = o.fits?.fit;
          const date = dayOf(o.source?.date);
          const otherRoute = !options.length && ROUTE_NAME[o.route];
          return (
            <li key={o.id || o.title} className={`${CARD} flex h-full flex-col gap-2`} data-funding-option>
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 text-[14.5px] font-semibold text-slate-900 dark:text-slate-100">{o.title}</p>
                {otherRoute
                  ? <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11.5px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200" data-option-route>{otherRoute}</span>
                  : fit && FIT_TONE[fit] && <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11.5px] font-semibold ${FIT_TONE[fit]}`} data-fits>Fits: {fit}</span>}
              </div>
              {amount && <p className="text-[15px] font-bold tabular-nums text-slate-900 dark:text-slate-100" data-option-amount>{amount}</p>}
              <p className="text-[13px] text-slate-600 dark:text-slate-300" data-option-condition>{firstSentence(o.text)}</p>
              <p className="text-[12px] text-slate-500 dark:text-slate-400" data-option-source>
                {[o.source?.publisher || o.source?.site, date].filter(Boolean).join(" · ")}
                {o.source?.url && <> · <a href={o.source.url} target="_blank" rel="noopener noreferrer nofollow" className="font-semibold text-brand-700 hover:underline dark:text-brand-300">Open</a></>}
              </p>
              <div className="mt-auto flex items-center gap-4 pt-2">
                {o.saved
                  ? <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[12px] font-semibold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">Saved to your case</span>
                  : <>
                      {onSave && <button type="button" onClick={() => onSave(o)} className={LINK} data-option-save>Save to my case</button>}
                      {onHide && <button type="button" onClick={() => onHide(o)} className="text-[13px] font-semibold text-slate-600 hover:underline dark:text-slate-300" data-option-hide>Not relevant</button>}
                    </>}
              </div>
            </li>
          );
        })}
      </ul>}
      {more > 0 && <button type="button" onClick={toggle} className={LINK}>{all ? "Show fewer" : `See ${more} more`}</button>}
    </section>
  );
}

/** What the research found besides funding options: one card, a row each, with what became of it. */
export function ResearchFindings({ items = [], decided = {}, onSave = null, onHide = null }) {
  const { shown, more, all, toggle } = useMore(items);
  if (!items.length) return null;
  return (
    <section className={`${CARD} space-y-2`} data-research-found>
      <h2 className="text-[16px] font-bold text-slate-900 dark:text-slate-100">What the research found</h2>
      <p className="text-[12.5px] text-slate-500 dark:text-slate-400">Extra to your score. Save any that help your case.</p>
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {shown.map((f) => {
          const src = (f.sources || [])[0] || {};
          const d = decided[f.id]?.decision === "reject" ? "rejected" : decided[f.id] ? "accepted" : f.decision;
          return (
            <li key={f.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-3" data-found-row>
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-semibold text-slate-900 dark:text-slate-100">{f.label}</p>
                <p className="line-clamp-2 text-[13px] text-slate-600 dark:text-slate-300">{firstSentence(f.value, 240)}</p>
                <p className="text-[12px] text-slate-500 dark:text-slate-400">
                  {[src.publisher || src.site, dayOf(src.date)].filter(Boolean).join(" · ")}
                  {src.url && <> · <a href={src.url} target="_blank" rel="noopener noreferrer nofollow" className="font-semibold text-brand-700 hover:underline dark:text-brand-300">Open</a></>}
                </p>
              </div>
              {d === "accepted" || d === "edited"
                ? <span className="shrink-0 rounded-md bg-emerald-50 px-2 py-0.5 text-[12px] font-semibold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">Saved to your case</span>
                : d === "rejected"
                ? <span className="shrink-0 rounded-md bg-slate-100 px-2 py-0.5 text-[12px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">Not relevant</span>
                : <span className="flex shrink-0 items-center gap-4">
                    {onSave && <button type="button" onClick={() => onSave(f)} className={LINK} data-found-save>Save to my case</button>}
                    {onHide && <button type="button" onClick={() => onHide(f)} className="text-[13px] font-semibold text-slate-600 hover:underline dark:text-slate-300" data-found-reject>Not relevant</button>}
                  </span>}
            </li>
          );
        })}
      </ul>
      {more > 0 && <button type="button" onClick={toggle} className={LINK}>{all ? "Show fewer" : `See ${more} more`}</button>}
    </section>
  );
}

/** The funding pack: one slim strip, text left and the button right. "Ready" only when the case is. */
export function PackStrip({ pack, caseReady, to, locked = false }) {
  const navigate = useNavigate();
  if (!pack?.total) return null;
  const complete = (pack.ready || 0) >= pack.total;
  const left = (pack.items || []).filter((i) => !i.ready).map((i) => i.label);
  const text = complete
    ? (caseReady ? "Your funding pack is ready." : `Your pack is drafted (${pack.ready} of ${pack.total}).`)
    : `Your pack is ${Math.round((100 * (pack.ready || 0)) / pack.total)}% ready.`;
  return (
    <section className={`${CARD} flex flex-col gap-3 !py-4 sm:flex-row sm:items-center sm:justify-between`} data-pack-strip>
      <p className="text-[14px] text-slate-800 dark:text-slate-100"><span className="font-semibold">Funding pack:</span> {text}
        {!complete && left.length > 0 && <span className="block text-[12.5px] text-slate-500 dark:text-slate-400">Still to do: {left.join(", ")}.</span>}</p>
      <button type="button" onClick={() => navigate(locked ? "/pricing" : to)} data-pack-cta
        className="shrink-0 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-[13px] font-semibold text-slate-800 hover:border-brand-300 max-sm:w-full dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
        {locked ? "See plans" : complete ? "View funding pack" : "Finish the pack"}</button>
    </section>
  );
}
