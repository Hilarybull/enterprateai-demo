import { useEffect, useState } from "react";
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

  const [history, setHistory] = useState(null);
  const [historyProblem, setHistoryProblem] = useState("");
  const [dismissing, setDismissing] = useState(false);

  async function load() {
    let next;
    try {
      next = await apiRequest("/public-tenders/admin/health", "GET");
      setHealth(next);
    } catch (error) {
      setProblem(error.message);
      return;
    }
    if (next.history_available) {
      try {
        const result = await apiRequest("/public-tenders/admin/history", "GET");
        setHistory(result.items);
        setHistoryProblem("");
      } catch (error) { setHistoryProblem(error.message); }
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

  async function toggleSchedule() {
    setSavingSchedule(true);
    setProblem("");
    setNote("");
    try {
      const { scheduled } = await apiRequest("/public-tenders/admin/schedule", "PUT", { enabled: !health.scheduled });
      setHealth((current) => ({ ...current, scheduled }));
      setNote(scheduled ? "Automatic sync is on." : "Automatic sync is off. Any active sync will finish.");
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
          <div className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
            <div className="min-w-0">
              <p className="text-sm font-semibold" id="tender-auto-sync-label">Automatic sync</p>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Checks every five minutes while catching up, then syncs about every three hours.</p>
              {health.schedule_configurable === false && <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">Apply migration 052 to change this setting here.</p>}
            </div>
            <button type="button" role="switch" aria-checked={health.scheduled} aria-labelledby="tender-auto-sync-label"
              onClick={toggleSchedule} disabled={savingSchedule || health.schedule_configurable === false}
              className={`inline-flex min-h-11 min-w-16 shrink-0 items-center justify-center rounded-full border px-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 ${health.scheduled ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"}`}>
              {savingSchedule ? "Saving..." : health.scheduled ? "On" : "Off"}
            </button>
          </div>
          <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {metrics.map(([label, value]) => <div key={label} className="min-w-0 rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-800">
              <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</dt>
              <dd className="mt-1 break-words text-sm font-semibold tabular-nums">{value}</dd>
            </div>)}
          </dl>
          <section className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-700" aria-labelledby="tender-sync-history">
            <h3 id="tender-sync-history" className="font-semibold">Sync history</h3>
            {!health.history_available && <p className="text-sm text-slate-600 dark:text-slate-300">Apply migration 053 to enable sync history and error dismissal.</p>}
            {health.history_available && history === null && !historyProblem && <p role="status" className="text-sm">Loading sync history…</p>}
            {historyProblem && <p role="alert" className="break-words text-sm text-rose-700 dark:text-rose-300">{historyProblem}</p>}
            {history?.length === 0 && <p className="text-sm text-slate-600 dark:text-slate-300">No sync attempts recorded yet.</p>}
            {history?.length > 0 && <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
              {history.map((entry) => <li key={entry.attempted_at} className="grid min-w-0 gap-1 break-words p-3 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:gap-4">
                <div>
                  <p className="font-semibold">{attemptStatus[entry.status]}</p>
                  <time className="text-xs text-slate-500 dark:text-slate-400" dateTime={entry.attempted_at}>{when(entry.attempted_at)}</time>
                </div>
                <div className="text-slate-600 dark:text-slate-300">
                  {entry.error && <p>{entry.error}</p>}
                  {entry.summary && <p>{entry.summary.imported} new versions, {entry.summary.quarantined} rejected, {entry.summary.pages} pages</p>}
                  {entry.finished_at && <p className="text-xs">Finished {when(entry.finished_at)}</p>}
                </div>
              </li>)}
            </ul>}
          </section>
          {health.summary && <p className="text-sm text-slate-600 dark:text-slate-300">Last import: {health.summary.imported} new versions, {health.summary.quarantined} rejected, {health.summary.pages} pages.</p>}
        </>}
      </div>
    </section>
  );
}
