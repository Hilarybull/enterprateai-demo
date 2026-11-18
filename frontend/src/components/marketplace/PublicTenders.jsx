import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiRequest } from "../../api/client";
import { useAuthStore } from "../../store/auth";
import { ensureWorkspaceId, useWorkspaceStore } from "../../store/workspace";

const stages = { open: "Open opportunities", planning: "Planning", award: "Awards", closed: "Closed", other: "Other notices", all: "All notices" };
const field = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900";
const box = "rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900";
const day = (date) => date ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" }).format(new Date(date)) + " (UK time)" : "Not published";

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
        <a href={item.url} target="_blank" rel="noopener noreferrer" className="rounded-xl border border-brand-200 bg-brand-50 px-3 py-2.5 font-semibold text-brand-700 hover:bg-brand-100 focus-visible:outline focus-visible:outline-2 dark:border-indigo-800 dark:bg-indigo-950 dark:text-brand-300">View Official Tender</a>
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
  const stage = Object.hasOwn(stages, params.get("stage")) ? params.get("stage") : "open";
  const [page, setPage] = useState(1);
  const [results, setResults] = useState(null);
  const [problem, setProblem] = useState("");
  const [saved, setSaved] = useState([]);
  const [watch, setWatch] = useState(false);
  const [busy, setBusy] = useState(false);
  const scope = workspaceId ? "?workspace_id=" + encodeURIComponent(workspaceId) : "";

  function update(key, value) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next);
  }

  useEffect(() => { setPage(1); }, [query, stage]);
  useEffect(() => {
    let active = true;
    const filters = new URLSearchParams({ q: query, stage, page: String(page) });
    const path = detail ? "/" + encodeURIComponent(detail) : "?" + filters;
    setResults(null);
    setProblem("");
    const timer = setTimeout(() => {
      apiRequest("/public-tenders" + path, "GET").then((data) => { if (active) setResults(data); })
        .catch((error) => { if (active) setProblem(error.message); });
    }, detail ? 0 : 200);
    return () => { active = false; clearTimeout(timer); };
  }, [detail, query, stage, page]);

  useEffect(() => {
    let active = true;
    setSaved([]);
    if (token && scope) apiRequest("/public-tenders/watchlist" + scope, "GET")
      .then((res) => { if (active) setSaved(res.items); })
      .catch((error) => { if (active) setProblem(error.message); });
    return () => { active = false; };
  }, [token, scope]);

  async function toggle(item) {
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

  return <section className="mx-auto w-full max-w-7xl space-y-4 px-4 py-6 sm:px-6" aria-label="Public tenders">
    <div className="flex flex-wrap items-center gap-3">
      {detail && <button type="button" className={field} onClick={() => update("tender", null)}>Back to public tenders</button>}
      {!detail && <label className="flex items-center gap-2 text-sm">Notice status
        <select value={stage} onChange={(event) => update("stage", event.target.value)} className={field}>
          {Object.entries(stages).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </label>}
      {token && <button type="button" aria-pressed={watch} className={field} onClick={() => setWatch(!watch)}>{watch ? "Hide watchlist" : "My watchlist"}</button>}
      {results?.last_sync && <p className="text-xs text-slate-600 sm:ml-auto dark:text-slate-300">Last successful sync: {day(results.last_sync)}</p>}
    </div>
    <p className="text-sm text-slate-600 dark:text-slate-300">Browse UK public procurement notices. To bid, follow the official notice link and its submission instructions.</p>
    {problem && <p role="alert" className="text-sm text-rose-600">{problem}</p>}
    {watch && token && <div className="space-y-2">
      <h2 className="font-semibold">My watchlist</h2>
      {!saved.length && <p className="text-sm">No notices saved in this workspace.</p>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{saved.map((item) => <Listing key={item.id} item={item} onOpen={() => update("tender", item.id)}>{saveAction(item)}</Listing>)}</div>
    </div>}
    {results?.last_sync && results.stale && <p className="text-sm text-amber-700 dark:text-amber-300">Listings may be out of date. Check the official notice before relying on dates or status.</p>}
    {!results && !problem && <p role="status">Loading notices…</p>}
    {results && (detail ? <Listing item={results}>{saveAction(results)}</Listing> :
      <>
        {!results.items.length && <div className={box + " space-y-2 py-6"}>
          <h3 className="font-semibold">{results.last_sync ? "No notices match your search" : "Public tenders haven't synced yet"}</h3>
          <p className="text-sm text-slate-600 dark:text-slate-300">{results.last_sync
            ? "Try a broader search or choose a different notice status."
            : "Listings will appear after the first successful Find a Tender import. You can browse the official service now."}</p>
          <a className="inline-block text-sm font-semibold text-brand-700 underline dark:text-brand-300"
             href="https://www.find-tender.service.gov.uk/Search" target="_blank" rel="noopener noreferrer">Browse Find a Tender</a>
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
