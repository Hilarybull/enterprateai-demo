import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import TenderEvaluation from "./TenderEvaluation";
import { apiRequest } from "../../api/client";
import { useAuthStore } from "../../store/auth";
import { ensureWorkspaceId, useWorkspaceStore } from "../../store/workspace";

const stages = { open: "Open opportunities", planning: "Planning", award: "Awards", closed: "Closed", other: "Other notices", all: "All notices" };
const field = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900";
const box = "rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900";
const day = (date) => date ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" }).format(new Date(date)) + " (UK time)" : "Not published";

const industries = {"03":"Agriculture and food production","09":"Energy and fuels","15":"Food and beverages","16":"Agricultural machinery","18":"Clothing and footwear","19":"Leather and textiles","22":"Printed matter","24":"Chemicals","31":"Electrical machinery","30":"Office and computing equipment","32":"Telecommunications equipment","33":"Medical equipment","34":"Transport equipment","35":"Security and defence equipment","37":"Musical instruments and sports goods","38":"Laboratory and precision equipment","39":"Furniture and household equipment","41":"Water","42":"Industrial machinery","43":"Mining and construction machinery","44":"Construction materials","45":"Construction works","48":"Software","50":"Repair and maintenance","51":"Installation services","55":"Hotel and catering","60":"Transport services","63":"Travel and logistics","64":"Postal and telecom services","65":"Utilities","66":"Financial and insurance services","70":"Real estate","71":"Architecture and engineering","72":"IT services","73":"Research and development","75":"Public administration","76":"Oil and gas services","77":"Agriculture and landscaping","79":"Business services","80":"Education and training","85":"Health and social work","90":"Environmental and waste services","92":"Culture and recreation","98":"Other services"};
const sourceLink = (value) => { try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; } };
const readable = (value) => (value || "").replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<\/(p|div|li|h[1-6])>/gi,"\n").replace(/<[^>]*>/g, "");

// The notice is already displayed here; don't present its HTML page as a document or submission portal.
const isNoticePage = (value) => { try { const u = new URL(value); return /^(www\.)?find-tender\.service\.gov\.uk$/i.test(u.hostname) && /^\/Notice\/[^/]+\/?$/i.test(u.pathname); } catch { return false; } };

function TenderDetail({ item, children, evaluation }) {
  const documents = (item.documents || []).filter(doc => sourceLink(doc.url) && !isNoticePage(doc.url));
  const instructions = item.submission_instructions || "Submission instructions are not available. Check the buyer’s tender documents.";
  const submissionUrl = !isNoticePage(item.submission_url) && sourceLink(item.submission_url);
  return <article className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_19rem]" aria-label="Tender notice details">
    <div className="min-w-0 space-y-5">
      <header className={box + " space-y-3 sm:p-6"}>
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">{stages[item.status] || "Notice"} · {item.source || "Find a Tender"}</p>
        <h2 tabIndex={-1} className="break-words text-2xl font-semibold">{item.title}</h2>
        <p className="text-sm">{item.buyer || "Buyer not published"}</p>
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          {[["Submission deadline",day(item.deadline)],["Published value",value(item)],["Industry",item.industry || industries[item.cpv?.slice(0,2)] || "Not published"],["Location",item.region || "Not published"],["SME suitability",item.sme_suitable === true ? "Suitable for SMEs" : item.sme_suitable === false ? "Not marked suitable for SMEs" : "Not specified"],["Contract type",item.category || "Not published"],["Published",day(item.published_at)],["Contract starts",day(item.contract_start)],["Contract ends",day(item.contract_end)]].map(([label, val])=><div key={label}><dt className="text-slate-500">{label}</dt><dd className="mt-1 font-medium">{val}</dd></div>)}
        </dl>
      </header>
      {[["About this tender",item.description || "Description not published."],["How to submit",instructions],["Eligibility and participation",item.eligibility || "Check the tender documents for further details."],["Evaluation and award criteria",item.award_criteria || "Check the tender documents for further details."],["Procurement procedure",item.procedure || "Check the tender documents for further details."]].map(([label,content])=><section key={label} className={box + " space-y-3 sm:p-6"}><h3 className="font-semibold">{label}</h3><p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{readable(content)}</p></section>)}
      <section className={box + " space-y-3 sm:p-6"}><h3 className="font-semibold">Documents and supporting information</h3>
        {!documents.length && <p className="text-sm">No supporting documents are available here.</p>}
        <ul className="space-y-3">{documents.map((doc,i)=><li key={i} className="break-words text-sm"><a className="font-semibold text-brand-700 underline" href={sourceLink(doc.url)} target="_blank" rel="noopener noreferrer">{doc.title || "Tender document"} ↗</a>{doc.description && <p className="mt-1">{readable(doc.description)}</p>}</li>)}</ul>
      </section>
    </div>
    <aside className="min-w-0 space-y-3 self-start lg:sticky lg:top-24">
      {evaluation}
      <section className={box + " space-y-3 text-sm"}><h3 className="font-semibold">Submission details</h3>
        <p>Submit through the buyer’s published submission service.</p>
        {submissionUrl && <a className="block rounded-xl bg-brand-600 px-4 py-3 text-center font-semibold text-white" href={submissionUrl} target="_blank" rel="noopener noreferrer">Go to submission site ↗</a>}
        <p>Enquiry deadline: {day(item.enquiry_deadline)}</p>
        <p>Electronic submission: {({ allowed: "Yes", required: "Required", notAllowed: "No" })[item.electronic_submission] || "Not specified"}</p>
        {children}
      </section>
      <section className={box + " space-y-2 break-words text-xs text-slate-500"}><p>Notice: {item.notice_id}</p><p>CPV: {item.cpv_classifications?.length ? item.cpv_classifications.map(c=>[c.id,c.description].filter(Boolean).join(" — ")).join("; ") : item.cpv || "Not specified"}</p>{item.lot_id && <p>Lot: {item.lot_id}</p>}{item.observed_at && <p>Last checked: {day(item.observed_at)}</p>}</section>
    </aside>
  </article>;
}

function value(notice) {
  return notice.amount == null || !notice.currency ? "Not disclosed" :
    new Intl.NumberFormat("en-GB", { style: "currency", currency: notice.currency }).format(notice.amount);
}

const accents = {
  open: "from-blue-500 to-indigo-600",
  planning: "from-amber-400 to-orange-500",
  award: "from-emerald-500 to-teal-600",
  closed: "from-slate-400 to-slate-600",
};

function Listing({ item, onOpen, children }) {
  return <article className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
    <div aria-hidden="true" className={`h-1 bg-gradient-to-r ${accents[item.status] || "from-indigo-500 to-pink-500"}`} />
    <div className="flex flex-1 flex-col gap-2 break-words p-4">
      <p className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
        <span className="rounded-full bg-slate-100 px-2 py-1 font-semibold dark:bg-slate-800">{item.status === "open" ? "Open opportunity" : stages[item.status]}</span>
        {item.lot_id && <span>Lot {item.lot_id}</span>}
      </p>
      <h3 className="text-base font-semibold">{onOpen ? <button type="button" className="text-left hover:underline" onClick={onOpen}>{item.title}</button> : item.title}</h3>
      {onOpen && item.description && <p className="line-clamp-3 text-sm text-slate-600 dark:text-slate-300">{item.description}</p>}
      <p className="mt-auto pt-2 text-sm font-medium">{item.buyer || "Buyer not published"}</p>
      <dl className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 text-xs dark:border-slate-800">
        <div><dt className="font-semibold">Deadline</dt><dd>{day(item.deadline)}</dd></div>
        <div><dt className="font-semibold">{item.status === "award" ? "Award value" : "Published value"}</dt><dd>{value(item)}</dd></div>
      </dl>
      {!onOpen && <>
        <p className="text-sm">Published {day(item.published_at)}</p>
        {(item.cpv || item.category || item.region) && <p className="text-sm text-slate-600 dark:text-slate-300">
          {[item.cpv ? "CPV " + item.cpv : null, item.category, item.region].filter(Boolean).join(" · ")}
        </p>}
        <p className="whitespace-pre-wrap text-sm">{item.description || "Description not published."}</p>
      </>}
      <p className="text-xs text-slate-500 dark:text-slate-400">{item.source || "Find a Tender"} · {item.notice_id}</p>
      <div className="mt-1 grid gap-2 text-center text-sm">
        <button type="button" onClick={onOpen} className="rounded-xl border border-brand-200 bg-brand-50 px-3 py-2.5 font-semibold text-brand-700 hover:bg-brand-100 dark:border-indigo-800 dark:bg-indigo-950 dark:text-brand-300">View Official Tender</button>
        {children}
      </div>
    </div>
  </article>;
}

export default function PublicTenders({ query }) {
  const [params, setParams] = useSearchParams();
  const token = useAuthStore((state) => state.token);
  const workspaceId = useWorkspaceStore((state) => state.workspaceId);
  const detail = params.get("tender");
  const industry = params.get("industry") || "";
  const sme = ["all", "unspecified"].includes(params.get("sme")) ? params.get("sme") : "suitable";
  const [retry, setRetry] = useState(0);
  const location = params.get("location") || "";
  const category = params.get("category") || "";
  const from = params.get("deadline_from") || "";
  const to = params.get("deadline_to") || "";
  const contentTop = useRef(null);
  const stage = Object.hasOwn(stages, params.get("stage")) ? params.get("stage") : "open";
  const [page, setPage] = useState(1);
  const [results, setResults] = useState(null);
  const [problem, setProblem] = useState("");
  const [saved, setSaved] = useState([]);
  const watchVersion = useRef(0);
  const [watch, setWatch] = useState(false);
  const [busy, setBusy] = useState(false);
  const scope = workspaceId ? "?workspace_id=" + encodeURIComponent(workspaceId) : "";

  function update(key, value) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next);
  }

  useEffect(() => { setPage(1); }, [query, stage, industry, location, category, from, to, sme]);
  useEffect(() => {
    let active = true;
    const filters = new URLSearchParams({ q: query || "", stage, page: String(page), industry, location, category, sme });
    if (from) filters.set("deadline_from", from);
    if (to) filters.set("deadline_to", to);
    const path = detail ? "/" + encodeURIComponent(detail) : "?" + filters;
    setResults(null);
    setProblem("");
    const timer = setTimeout(() => {
      apiRequest("/public-tenders" + path, "GET").then((data) => { if (active) setResults(data); })
        .catch((error) => { if (active) setProblem("We couldn’t load tenders. Please try again."); });
    }, detail ? 0 : 200);
    return () => { active = false; clearTimeout(timer); };
  }, [detail, query, stage, page, industry, location, category, from, to, sme, retry]);
  useEffect(() => { if (detail && results) contentTop.current?.scrollIntoView({ block: "start", behavior: "smooth" }); }, [detail, results]);

  useEffect(() => {
    let active = true;
    const version = ++watchVersion.current;
    setSaved([]);
    if (token && scope) apiRequest("/public-tenders/watchlist" + scope, "GET")
      .then((res) => { if (active && version === watchVersion.current) setSaved(res.items); })
      .catch((error) => { if (active) setProblem(error.message); });
    return () => { active = false; };
  }, [token, scope]);

  async function toggle(item) {
    ++watchVersion.current;
    const wasSaved = saved.some((entry) => entry.id === item.id);
    setBusy(true);
    setProblem("");
    try {
      const id = workspaceId || await ensureWorkspaceId();
      if (!id) throw new Error("Select a workspace first.");
      await apiRequest("/public-tenders/" + encodeURIComponent(item.id) + "/watchlist?workspace_id=" + encodeURIComponent(id), wasSaved ? "DELETE" : "PUT");
      const list = await apiRequest("/public-tenders/watchlist?workspace_id=" + encodeURIComponent(id), "GET");
      if (useWorkspaceStore.getState().workspaceId === id) setSaved(list.items);
    } catch (error) { setProblem(error.message); }
    finally { setBusy(false); }
  }

  const saveAction = (item) => token ? <button type="button" className={field} disabled={busy} onClick={() => toggle(item)}>
    {saved.some((entry) => entry.id === item.id) ? "Remove from watchlist" : "Save to watchlist"}
  </button> : <Link className="underline" to={"/login?next=" + encodeURIComponent("/marketplace?tab=tenders&tender=" + encodeURIComponent(item.id))}>Sign in to save</Link>;

  return <section ref={contentTop} className="scroll-mt-24 mx-auto w-full max-w-7xl space-y-4 px-4 py-6 sm:px-6" aria-label="Public tenders">
    {detail ? <div className="flex flex-wrap items-center justify-between gap-3"><button type="button" className={field} onClick={() => update("tender", null)}>Back to public tenders</button>{token && <button type="button" aria-pressed={watch} className={field} onClick={() => setWatch(!watch)}>{watch ? "Hide watchlist" : "My watchlist"}</button>}</div> :
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900" aria-label="Tender filters">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-0 pt-3">
          <h2 className="text-lg font-semibold">Public tenders</h2>
          {token && <button type="button" aria-pressed={watch} className={field} onClick={() => setWatch(!watch)}>{watch ? "Hide watchlist" : "My watchlist"}</button>}
        </div>
        <div className="space-y-3 p-3 sm:px-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="grid min-w-0 gap-1.5 text-xs font-medium">Notice status<select value={stage} onChange={e=>update("stage",e.target.value)} className={field}>{Object.entries(stages).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
            <label className="grid min-w-0 gap-1.5 text-xs font-medium">Industry (CPV)<select className={field + " min-w-0 w-full"} value={industry} onChange={e=>update("industry",e.target.value)}><option value="">All industries</option>{Object.entries(industries).map(([code,label])=><option key={code} value={code}>{label}</option>)}</select></label>
            <label className="grid min-w-0 gap-1.5 text-xs font-medium">Location<input className={field + " min-w-0 w-full"} value={location} placeholder="Region or delivery location" onChange={e=>update("location",e.target.value)}/></label>
          </div>
          <details className="rounded-xl border border-slate-200 dark:border-slate-700"><summary className="cursor-pointer px-3 py-2.5 text-sm font-medium">More filters{(category || from || to) && " · Active"}</summary>
            <div className="grid gap-3 border-t border-slate-100 p-3 sm:grid-cols-2 xl:grid-cols-4 dark:border-slate-800">
              <label className="grid min-w-0 gap-1.5 text-xs font-medium">SME suitability<select value={sme} onChange={e=>update("sme",e.target.value)} className={field}><option value="suitable">Suitable for SMEs</option><option value="all">All tenders</option><option value="unspecified">Suitability not specified</option></select></label>
              <label className="grid min-w-0 gap-1.5 text-xs font-medium">Contract type<select className={field + " min-w-0 w-full"} value={category} onChange={e=>update("category",e.target.value)}><option value="">All types</option><option value="goods">Goods</option><option value="services">Services</option><option value="works">Works</option></select></label>
              <label className="grid min-w-0 gap-1.5 text-xs font-medium">Deadline from<input type="date" className={field + " min-w-0 w-full"} value={from} max={to || undefined} onChange={e=>update("deadline_from",e.target.value)}/></label>
              <label className="grid min-w-0 gap-1.5 text-xs font-medium">Deadline to<input type="date" className={field + " min-w-0 w-full"} value={to} min={from || undefined} onChange={e=>update("deadline_to",e.target.value)}/></label>
            </div>
          </details>
          {[industries[industry],location,category,from && "From " + from,to && "To " + to].some(Boolean) && <div className="flex flex-wrap gap-2">{[industries[industry],location,category,from && "From " + from,to && "To " + to].filter(Boolean).map(label=><span key={label} className="rounded-full bg-brand-50 px-2.5 py-1 text-xs text-brand-700">{label}</span>)}</div>}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2 text-xs text-slate-500 dark:border-slate-800">
            <p role="status">{results ? (results.total ?? results.items?.length ?? 0).toLocaleString() + " tenders" : problem ? "Tender count unavailable" : "Loading tenders…"}{sme === "suitable" && " · Suitable for SMEs"}</p>
            <button type="button" className="inline-flex min-h-10 items-center justify-center rounded-lg border border-brand-200 px-4 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500" onClick={()=>{const next=new URLSearchParams(params);["industry","location","category","deadline_from","deadline_to","stage","q","sme"].forEach(key=>next.delete(key));setParams(next);}}>Clear filters</button>
          </div>
        </div>
      </div>}
    {problem && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"><p>{problem}</p><button type="button" className="rounded-lg border border-rose-300 px-3 py-2 font-semibold" onClick={()=>setRetry(v=>v+1)}>Try again</button></div>}
    {watch && token && <div className="space-y-2">
      <h2 className="font-semibold">My watchlist</h2>
      {!saved.length && <p className="text-sm">No notices saved in this workspace.</p>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{saved.map((item) => <Listing key={item.id} item={item} onOpen={() => update("tender", item.id)}>{saveAction(item)}</Listing>)}</div>
    </div>}
    {!results && !problem && <p role="status">Loading notices…</p>}
    {results && (detail ? <TenderDetail item={results} evaluation={<TenderEvaluation notice={results} token={token} workspaceId={workspaceId} />}>{saveAction(results)}</TenderDetail> :
      <>
        {!results.items.length && <div className={box + " space-y-2 py-6"}>
          <h3 className="font-semibold">No tenders match your filters</h3>
          <p className="text-sm text-slate-600 dark:text-slate-300">Try another industry, location or notice status, or clear your filters to see more tenders.</p>
          <button type="button" className="inline-flex min-h-10 items-center justify-center rounded-lg border border-brand-200 px-4 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500" onClick={()=>{const next=new URLSearchParams(params);["industry","location","category","deadline_from","deadline_to","stage","q","sme"].forEach(key=>next.delete(key));setPage(1);setParams(next);}}>Clear search filters</button>
        </div>}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{results.items.map((item) =>
          <Listing key={item.id} item={item} onOpen={() => update("tender", item.id)}>{saveAction(item)}</Listing>)}</div>
        {(page > 1 || results.more) && <nav className="flex gap-3" aria-label="Tender pages">
          <button type="button" className={field} disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button>
          <button type="button" className={field} disabled={!results.more || page >= 500} onClick={() => setPage(page + 1)}>Next</button>
        </nav>}
      </>)}
    <p className="text-xs text-slate-500">Contains Find a Tender information from the Cabinet Office, licensed under the <a className="underline" href="https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/">Open Government Licence v3.0</a>, except where otherwise stated.</p>
  </section>;
}
