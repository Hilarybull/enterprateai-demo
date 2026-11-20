import { useEffect, useRef, useState } from "react";
import { apiRequest } from "../../api/client";

const attemptStatus = { running: "Running", succeeded: "Succeeded", failed: "Failed", interrupted: "Interrupted" };
const control = "shrink-0 rounded-lg border border-current px-3 py-2 text-sm font-medium hover:underline disabled:opacity-50";
const when = (value) => value ? new Date(value).toLocaleString("en-GB") : "Not recorded";

export default function TenderSyncAdmin() {
  const [health, setHealth] = useState(null);
  const [problem, setProblem] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [schedule, setSchedule] = useState(null);
  const scheduleDirty = useRef(false);

  const [history, setHistory] = useState(null);
  const [historyProblem, setHistoryProblem] = useState("");
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyMore, setHistoryMore] = useState(false);
  const historyCursors = useRef([null]);
  const historyCursor = useRef(null);
  const nextBefore = useRef(null);
  const historyRequest = useRef(0);
  const [dismissing, setDismissing] = useState(false);

  async function loadHistory(cursor = historyCursor.current) {
    const request = ++historyRequest.current;
    setHistoryBusy(true);
    try {
      const params = new URLSearchParams({ page_size: "10" });
      if (cursor) params.set("before", cursor);
      const result = await apiRequest(`/public-tenders/admin/history?${params}`, "GET");
      if (request !== historyRequest.current) return;
      setHistory(result.items);
      setHistoryMore(Boolean(result.more));
      nextBefore.current = result.next_before;
      setHistoryProblem("");
    } catch (error) {
      if (request === historyRequest.current) setHistoryProblem("We couldn’t load sync history. Please try again.");
    } finally {
      if (request === historyRequest.current) setHistoryBusy(false);
    }
  }

  function changeHistoryPage(page) {
    if (page > historyPage) historyCursors.current[page - 1] = nextBefore.current;
    historyCursor.current = historyCursors.current[page - 1];
    setHistoryPage(page);
    setHistory(null);
    setHistoryProblem("");
    loadHistory();
  }

  async function load() {
    let next;
    try {
      next = await apiRequest("/public-tenders/admin/health", "GET");
      setHealth(next);
      if (!scheduleDirty.current) setSchedule({ enabled: next.scheduled, interval_minutes: next.interval_minutes ?? 180, import_scope: next.import_scope ?? "suitable" });
    } catch (error) {
      setProblem(error.message);
      return;
    }
    if (next.history_available) {
      await loadHistory();
    }
  }

  useEffect(() => {
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, []);

  async function start() {
    setBusy(true);
    setProblem("");
    try {
      await apiRequest("/public-tenders/admin/sync", "POST");
      setNote("Sync requested. The status refreshes automatically.");
      await load();
    } catch (error) { setProblem(error.message); }
    finally { setBusy(false); }
  }

  function editSchedule(values) {
    scheduleDirty.current = true;
    setSchedule((current) => ({ ...current, ...values }));
  }

  async function saveSchedule(event) {
    event.preventDefault();
    setSavingSchedule(true);
    setProblem("");
    setNote("");
    try {
      const result = await apiRequest("/public-tenders/admin/schedule", "PUT", { ...schedule, interval_minutes: Number(schedule.interval_minutes) });
      scheduleDirty.current = false;
      setHealth((current) => ({ ...current, ...result }));
      setNote("Sync settings saved. Changes apply to the next sync; any active sync will finish.");
    } catch (error) { setProblem(error.message); }
    finally { setSavingSchedule(false); }
  }

  async function dismissError() {
    setDismissing(true);
    setProblem("");
    try {
      await apiRequest("/public-tenders/admin/dismiss-error", "POST", { attempt: health.last_attempt });
      await load();
    } catch (error) { setProblem(error.message); }
    finally { setDismissing(false); }
  }

  const showError = health?.error && !health.error_dismissed && !health.running;
  const retryPending = Date.parse(health?.retry_at || "") > Date.now();
  const state = !health ? "Checking status" : health.running ? "Import running" : health.error ? "Last import failed" : !health.last_sync ? "First import pending" : health.stale ? "Listings may be out of date" : "Listings up to date";
  const tone = health?.running ? "bg-brand-50 text-brand-700 dark:bg-indigo-950 dark:text-indigo-200"
    : health?.error ? "bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-200"
    : health && !health.stale ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200"
    : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200";
  const metrics = health ? [
    ["Last attempt", when(health.last_attempt)],
    ["Last successful sync", when(health.last_sync)],
    ["Source processed through", health.last_sync ? when(health.checkpoint) : "Not yet imported"],
  ] : [];

  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900" aria-label="Find a Tender sync">
      <header className="flex flex-col gap-4 border-b border-slate-200 bg-slate-50 px-4 py-5 sm:flex-row sm:items-start sm:justify-between sm:px-6 dark:border-slate-700 dark:bg-slate-900">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">Find a Tender sync</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Import UK public tender notices into Marketplace.</p>
          <span role="status" className={`mt-3 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}>{state}</span>
        </div>
        <button type="button" onClick={start} disabled={busy || !health || health.running || retryPending}
          className="w-full shrink-0 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 sm:w-auto">
          {busy ? "Requesting sync..." : "Sync now"}
        </button>
      </header>
      <div className="space-y-4 p-4 sm:p-6">
        {problem && <div className="flex flex-wrap items-center justify-between gap-2 break-words rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:bg-rose-950 dark:text-rose-200">
          <p role="alert" className="min-w-0">{problem}</p>
          <button type="button" className={control} onClick={() => setProblem("")}>Clear message</button>
        </div>}
        {showError && <div className="flex flex-wrap items-center justify-between gap-2 break-words rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200">
          <p role="alert" className="min-w-0 font-semibold">{health.error}</p>
          {health.history_available && <button type="button" className={control} disabled={dismissing} onClick={dismissError}>Dismiss error</button>}
        </div>}
        {retryPending && <p className="text-sm text-slate-600 dark:text-slate-300">Retry available {when(health.retry_at)}.</p>}
        {note && !showError && !problem && <p role="status" className="text-sm text-slate-600 dark:text-slate-300">{note}</p>}
        {health && <>
          <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {metrics.map(([label, value]) => <div key={label} className="min-w-0 rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-800">
              <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</dt>
              <dd className="mt-1 break-words text-sm font-semibold tabular-nums">{value}</dd>
            </div>)}
          </dl>
          <form onSubmit={saveSchedule} className="space-y-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold" id="tender-auto-sync-label">Automatic sync</p>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{schedule?.enabled ? "Keep Marketplace tenders updated on your schedule." : "Automatic sync is off. You can still sync manually."}</p>
              {!health.preferences_configurable && <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">Apply migration 057 to configure the sync interval and import scope.</p>}
            </div>
            <button type="button" role="switch" aria-checked={schedule?.enabled ?? false} aria-controls="tender-automatic-settings" aria-labelledby="tender-auto-sync-label"
              onClick={() => editSchedule({ enabled: !schedule.enabled })} disabled={savingSchedule || !health.preferences_configurable}
              className={`inline-flex min-h-11 min-w-16 shrink-0 items-center justify-center rounded-full border px-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 ${schedule?.enabled ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"}`}>
              {schedule?.enabled ? "On" : "Off"}
            </button>
          </div>
          {schedule?.enabled && <div id="tender-automatic-settings" className="space-y-4 border-t border-slate-200 pt-4 dark:border-slate-700"><fieldset disabled={savingSchedule || !health.preferences_configurable} className="grid min-w-0 gap-4 sm:grid-cols-2 disabled:opacity-50">
            <label className="min-w-0 text-sm font-medium">Sync interval (minutes)
              <input type="number" min="5" max="1440" step="1" required value={schedule.interval_minutes}
                onChange={(event) => editSchedule({ interval_minutes: event.target.value })}
                className="mt-1 block min-h-11 w-full rounded-lg border border-slate-300 bg-transparent px-3 dark:border-slate-600" />
              <span className="mt-1 block text-xs font-normal text-slate-500">5 minutes to 24 hours. Scheduled runs may start up to five minutes later.</span>
            </label>
            <label className="min-w-0 text-sm font-medium">New tenders to include
              <select value={schedule.import_scope} onChange={(event) => editSchedule({ import_scope: event.target.value })}
                className="mt-1 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-600 dark:bg-slate-900">
                <option value="suitable">Suitable for SMEs</option><option value="all">All tenders</option>
              </select>
            </label>
          </fieldset>
          <p className="text-xs text-slate-500 dark:text-slate-400">SME suitability uses the buyer’s published information. Existing tenders keep receiving updates, including deadline changes and closures. Changing scope does not remove saved listings.</p>
          </div>}
          {(schedule?.enabled || scheduleDirty.current) && <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-slate-500 dark:text-slate-400">{scheduleDirty.current ? "You have unsaved changes." : "Changes apply to the next sync."}</p>
            <button type="submit" disabled={savingSchedule || !health.preferences_configurable} className="min-h-11 w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 sm:w-auto">{savingSchedule ? "Saving..." : "Save sync settings"}</button>
          </div>}
          </form>
          <section className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-700" aria-labelledby="tender-sync-history">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><h3 id="tender-sync-history" className="font-semibold">Sync history</h3>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Latest first · 10 attempts per page</p></div>
              {historyBusy && history !== null && <span role="status" className="text-xs text-slate-500">Updating…</span>}
            </div>
            {!health.history_available && <p className="text-sm text-slate-600 dark:text-slate-300">Apply migration 053 to enable sync history and error dismissal.</p>}
            {health.history_available && history === null && !historyProblem && <p role="status" className="text-sm">Loading sync history…</p>}
            {historyProblem && <div className="flex flex-wrap items-center gap-3"><p role="alert" className="break-words text-sm text-rose-700 dark:text-rose-300">{historyProblem}</p><button type="button" onClick={() => loadHistory()} disabled={historyBusy} className={control}>Try again</button></div>}
            {history?.length === 0 && <p className="text-sm text-slate-600 dark:text-slate-300">No sync attempts recorded yet.</p>}
            {history?.length > 0 && <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
              {history.map((entry) => <li key={entry.attempted_at} className="grid min-w-0 gap-1 break-words p-3 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:gap-4">
                <div>
                  <p className={`mb-1 inline-flex rounded-full px-2 py-1 text-xs font-semibold ${entry.status === "succeeded" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200" : entry.status === "failed" ? "bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-200" : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"}`}>{attemptStatus[entry.status] || "Unknown"}</p>
                  <time className="text-xs text-slate-500 dark:text-slate-400" dateTime={entry.attempted_at}>{when(entry.attempted_at)}</time>
                </div>
                <div className="text-slate-600 dark:text-slate-300">
                  {entry.error && <p>{entry.error}</p>}
                  {entry.summary && <p>{entry.summary.imported} new versions, {entry.summary.quarantined} rejected, {entry.summary.pages} pages</p>}
                  {entry.finished_at && <p className="text-xs">Finished {when(entry.finished_at)}</p>}
                </div>
              </li>)}
            </ul>}
            {health.history_available && (historyPage > 1 || historyMore) && <nav aria-label="Sync history pages" className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <p className="text-sm text-slate-500 dark:text-slate-400">Page {historyPage}</p>
              <div className="flex w-full gap-2 sm:w-auto">
                <button type="button" disabled={historyBusy || historyPage === 1} onClick={() => changeHistoryPage(historyPage - 1)} className={`${control} min-h-11 flex-1 sm:flex-none`}>Previous</button>
                <button type="button" disabled={historyBusy || !historyMore || Boolean(historyProblem)} onClick={() => changeHistoryPage(historyPage + 1)} className={`${control} min-h-11 flex-1 sm:flex-none`}>Next</button>
              </div>
            </nav>}
          </section>
          {health.summary && <p className="text-sm text-slate-600 dark:text-slate-300">Last import: {health.summary.imported} new versions, {health.summary.quarantined} rejected, {health.summary.pages} pages.</p>}
        </>}
      </div>
    </section>
  );
}
