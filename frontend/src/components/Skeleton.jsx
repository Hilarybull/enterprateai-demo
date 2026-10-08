import { useEffect, useState } from "react";

// One set of loading states for the whole app. A page that is waiting for its data shows grey
// shapes laid out like the page itself, so nothing jumps when the data arrives. The colour and
// the shimmer live in index.css (.ea-skeleton); with "reduce motion" on, the shapes are still.

export const SLOW_AFTER_MS = 8000;
export const SLOW_TEXT = "Still loading. This is taking longer than usual.";

/** One grey shape. Size and corners come from the class names given. */
export function SkeletonBlock({ className = "", style, ...rest }) {
  return <div aria-hidden="true" data-skeleton className={`ea-skeleton ${className}`} style={style} {...rest} />;
}

/** Lines of text; the last one is shorter, as a paragraph's is. */
export function SkeletonText({ lines = 3, className = "" }) {
  return (
    <div className={`space-y-2 ${className}`} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <SkeletonBlock key={i} className="h-3 rounded" style={{ width: i === lines - 1 && lines > 1 ? "60%" : "100%" }} />
      ))}
    </div>
  );
}

const CARD = "rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900";

/** A card: a title and a few lines by default, or whatever shapes are passed in. */
export function SkeletonCard({ className = "p-5", lines = 3, children, ...rest }) {
  return (
    <div aria-hidden="true" className={`${CARD} ${className}`} {...rest}>
      {children || (<><SkeletonBlock className="h-4 w-2/5 rounded" /><SkeletonText lines={lines} className="mt-4" /></>)}
    </div>
  );
}

/** A KPI tile, the height of the real ones. */
export function SkeletonKpi({ className = "" }) {
  return (
    <div aria-hidden="true" className={`${CARD} h-[124px] p-4 ${className}`}>
      <SkeletonBlock className="h-3 w-24 rounded" />
      <SkeletonBlock className="mt-3 h-6 w-32 rounded" />
      <SkeletonBlock className="mt-4 h-3 w-16 rounded" />
    </div>
  );
}

/** Rows of a list or table. `widths` are the real column widths (any CSS grid track sizes). */
export function SkeletonTable({ rows = 5, cols = 4, widths, header = true, className = "" }) {
  const tracks = (widths || Array.from({ length: cols }, () => "1fr")).join(" ");
  const line = (key, bar) => (
    <div key={key} data-skeleton-row className="grid items-center gap-4 px-5 py-3.5" style={{ gridTemplateColumns: tracks }}>
      {Array.from({ length: widths?.length || cols }, (_, c) => <SkeletonBlock key={c} className={`${bar} rounded`} style={{ width: c === 0 ? "80%" : "60%" }} />)}
    </div>
  );
  return (
    <div aria-hidden="true" className={`${CARD} divide-y divide-slate-100 overflow-hidden dark:divide-slate-800 ${className}`}>
      {header && line("head", "h-2.5")}
      {Array.from({ length: rows }, (_, r) => line(r, "h-3.5"))}
    </div>
  );
}

/** True once `ms` have passed while still mounted: the load is slow. */
export function useSlow(ms = SLOW_AFTER_MS) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), ms);
    return () => clearTimeout(t);
  }, [ms]);
  return slow;
}

/** The region that is loading: announced to screen readers, and it says so when it is slow.
 *  It is only on screen while loading, so aria-busy goes when the content arrives. */
export function SkeletonRegion({ label, className = "", children }) {
  const slow = useSlow();
  return (
    <div role="status" aria-busy="true" aria-label={`Loading ${label}`} className={className}>
      <span className="sr-only">Loading {label}</span>
      {children}
      {slow && <p data-slow className="mt-3 text-[13px] text-slate-500 dark:text-slate-400">{SLOW_TEXT}</p>}
    </div>
  );
}

/** In place of a skeleton when the load failed: what couldn't be loaded, and a way to try again. */
export function LoadError({ what, detail, onRetry, children, className = "" }) {
  return (
    <div role="alert" className={`mx-auto max-w-xl ${CARD} p-8 text-center ${className}`}>
      <p className="text-base font-bold text-slate-900 dark:text-slate-100">We couldn't load {what}.</p>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{detail || "Nothing was changed. Check your connection and try again."}</p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
        {onRetry && <button type="button" onClick={onRetry} className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">Try again</button>}
        {children}
      </div>
    </div>
  );
}

/** A thin indigo bar along the very top of the window while the app is starting. */
export function TopProgress() {
  return <div className="ea-top-progress" role="progressbar" aria-label="Loading EnterprateAI" aria-busy="true"><span /></div>;
}

/** The spinner that sits inside a button while its work is under way; the label stays beside it. */
export function ButtonSpinner({ className = "" }) {
  return <span aria-hidden="true" data-button-spinner className={`mr-1.5 inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent align-[-2px] opacity-80 ${className}`} />;
}

// ── Pages, each shaped like the real one ─────────────────────────────────────

/** Any page inside the shell while its business is being confirmed: a header and a few cards. */
export function ContentSkeleton({ label = "this page" }) {
  return (
    <SkeletonRegion label={label} className="space-y-5">
      <div className="pb-1"><SkeletonBlock className="h-8 w-64 rounded-lg" /><SkeletonBlock className="mt-3 h-3.5 w-96 max-w-full rounded" /></div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">{[0, 1, 2].map((i) => <SkeletonCard key={i} />)}</div>
      <SkeletonTable rows={5} cols={4} />
    </SkeletonRegion>
  );
}

/** A launch plan or funding case: header with two pills, the score ring, a checklist of six, three side cards. */
export function ReadinessDetailSkeleton({ label }) {
  return (
    <SkeletonRegion label={label} className="space-y-4">
      <div className="flex flex-col gap-3 pb-5 md:flex-row md:items-end md:justify-between" data-part="header">
        <div className="min-w-0">
          <SkeletonBlock className="h-8 w-72 max-w-full rounded-lg" />
          <div className="mt-3 flex gap-2"><SkeletonBlock className="h-6 w-24 rounded-full" data-pill /><SkeletonBlock className="h-6 w-32 rounded-full" /></div>
        </div>
        <div className="flex gap-2"><SkeletonBlock className="h-9 w-28 rounded-xl" /><SkeletonBlock className="h-9 w-32 rounded-xl" /></div>
      </div>
      <SkeletonBlock className="h-10 w-full rounded-lg" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <SkeletonCard className="flex items-center gap-5 p-5">
            <SkeletonBlock className="h-24 w-24 shrink-0 rounded-full" data-part="ring" />
            <div className="min-w-0 flex-1"><SkeletonBlock className="h-4 w-40 rounded" /><SkeletonText lines={2} className="mt-3" /></div>
          </SkeletonCard>
          <div className={`${CARD} divide-y divide-slate-100 dark:divide-slate-800`} aria-hidden="true" data-part="checklist">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} data-skeleton-row className="flex items-center gap-3 px-5 py-4">
                <SkeletonBlock className="h-5 w-5 shrink-0 rounded-full" /><SkeletonBlock className="h-3.5 flex-1 rounded" /><SkeletonBlock className="h-5 w-16 rounded-full" />
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-4" data-part="side">{[0, 1, 2].map((i) => <SkeletonCard key={i} lines={2} />)}</div>
      </div>
    </SkeletonRegion>
  );
}

/** The list of launch plans or funding cases: five rows. */
export function ReadinessListSkeleton({ label }) {
  return (
    <SkeletonRegion label={label} className="space-y-3">
      {[0, 1, 2, 3, 4].map((i) => (
        <SkeletonCard key={i} className="p-4">
          <div data-skeleton-row className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1"><SkeletonBlock className="h-4 w-1/2 rounded" /><SkeletonBlock className="mt-2 h-3 w-1/3 rounded" /></div>
            <SkeletonBlock className="h-5 w-28 rounded-full" />
          </div>
        </SkeletonCard>
      ))}
    </SkeletonRegion>
  );
}

/** An Agent task: header card with its two boxes, the action card, and a plan of three steps. */
export function AgentRunSkeleton() {
  return (
    <SkeletonRegion label="this task" className="mx-auto max-w-4xl space-y-5">
      <SkeletonBlock className="h-4 w-28 rounded" />
      <div className={`${CARD} p-5 shadow-sm`} aria-hidden="true" data-part="header">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1"><SkeletonBlock className="h-2.5 w-24 rounded" /><SkeletonBlock className="mt-2 h-6 w-56 max-w-full rounded" /><SkeletonBlock className="mt-2 h-3.5 w-80 max-w-full rounded" /></div>
          <SkeletonBlock className="h-5 w-24 rounded-full" />
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {[0, 1].map((i) => <div key={i} data-part="box" className="rounded-xl bg-slate-50 p-3.5 dark:bg-slate-800/60"><SkeletonBlock className="h-2.5 w-28 rounded" /><SkeletonText lines={2} className="mt-2.5" /></div>)}
        </div>
      </div>
      <SkeletonCard className="p-5 shadow-sm" data-part="action">
        <SkeletonBlock className="h-4 w-48 rounded" /><SkeletonText lines={3} className="mt-4" />
        <div className="mt-4 flex justify-end gap-2"><SkeletonBlock className="h-9 w-24 rounded-xl" /><SkeletonBlock className="h-9 w-36 rounded-xl" /></div>
      </SkeletonCard>
      <div className={`${CARD} p-5 shadow-sm`} aria-hidden="true" data-part="plan">
        <SkeletonBlock className="h-4 w-16 rounded" />
        <div className="mt-4 space-y-4">
          {[0, 1, 2].map((i) => (
            <div key={i} data-skeleton-row className="flex items-center gap-3"><SkeletonBlock className="h-6 w-6 shrink-0 rounded-full" /><SkeletonBlock className="h-3.5 flex-1 rounded" /><SkeletonBlock className="h-3 w-16 rounded" /></div>
          ))}
        </div>
      </div>
    </SkeletonRegion>
  );
}

/** The Agent settings form inside its dialog. */
export function SettingsSkeleton() {
  return (
    <SkeletonRegion label="Agent settings" className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {[0, 1, 2, 3].map((i) => <div key={i}><SkeletonBlock className="h-3 w-32 rounded" /><SkeletonBlock className="mt-2 h-9 w-full rounded-xl" /></div>)}
      </div>
      {[0, 1, 2, 3].map((i) => <div key={i} className="flex items-center justify-between gap-3"><SkeletonBlock className="h-3.5 w-2/3 rounded" /><SkeletonBlock className="h-5 w-9 rounded-full" /></div>)}
      <div className="flex justify-end gap-2 pt-2"><SkeletonBlock className="h-9 w-20 rounded-xl" /><SkeletonBlock className="h-9 w-24 rounded-xl" /></div>
    </SkeletonRegion>
  );
}

/** The dashboard: the Agent card (four tiles and the ask box) beside Needs Approval (three rows),
 *  three stage cards, five KPI cards and four insight cards. It holds the page's shape and
 *  nothing else: no stage's wording, no buttons and no links. */
export function DashboardSkeleton() {
  return (
    <SkeletonRegion label="your dashboard" className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <SkeletonBlock className="h-7 w-32 rounded-full" /><SkeletonBlock className="h-7 w-44 rounded-full" /><SkeletonBlock className="ml-auto h-7 w-40 rounded" />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)] 2xl:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)]">
        <div className={`${CARD} p-5 shadow-sm`} aria-hidden="true" data-part="agent">
          <SkeletonBlock className="h-7 w-48 rounded" /><SkeletonBlock className="mt-2.5 h-3.5 w-80 max-w-full rounded" />
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">{[0, 1, 2, 3].map((i) => <SkeletonBlock key={i} data-part="tile" className="h-[4.5rem] rounded-xl" />)}</div>
          <SkeletonBlock className="mt-3 h-12 rounded-xl" data-part="ask" />
          <div className="mt-3 flex flex-wrap gap-2">{[0, 1, 2, 3].map((i) => <SkeletonBlock key={i} className="h-8 w-28 rounded-full" />)}</div>
        </div>
        <div className={`${CARD} p-4 shadow-sm`} aria-hidden="true" data-part="approvals">
          <SkeletonBlock className="h-5 w-36 rounded" />
          <div className="mt-3 space-y-2.5">{[0, 1, 2].map((i) => <SkeletonBlock key={i} data-skeleton-row className="h-[52px] rounded-xl" />)}</div>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3" data-part="stage">{[0, 1, 2].map((i) => <SkeletonCard key={i} className="h-[168px] p-5" lines={2} />)}</div>
      <div className="grid grid-cols-1 gap-4 min-[380px]:grid-cols-2 xl:grid-cols-5" data-part="kpis">
        {[0, 1, 2, 3, 4].map((i) => <SkeletonKpi key={i} className={i === 4 ? "min-[380px]:col-span-2 xl:col-span-1" : ""} />)}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" data-part="insights">{[0, 1, 2, 3].map((i) => <SkeletonCard key={i} className="h-[188px] p-5" />)}</div>
    </SkeletonRegion>
  );
}

/** The app before the first sign-in check has finished: the shell (sidebar, top bar, workspace
 *  card) with a skeleton where the page will be, and a progress bar along the top. */
export function ShellSkeleton({ note = "", children = null }) {
  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950" data-shell-skeleton>
      {!children && <TopProgress />}
      <aside aria-hidden="true" className="hidden w-64 shrink-0 flex-col gap-3 border-r border-slate-200 bg-white p-4 lg:flex dark:border-slate-800 dark:bg-slate-900">
        <SkeletonBlock className="h-8 w-36 rounded-lg" />
        <SkeletonBlock className="mt-2 h-[72px] rounded-2xl" data-part="workspace" />
        <div className="mt-3 space-y-2.5">{Array.from({ length: 9 }, (_, i) => <SkeletonBlock key={i} className="h-9 rounded-xl" />)}</div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div aria-hidden="true" className="flex h-16 items-center gap-3 border-b border-slate-200 bg-white px-4 sm:px-6 dark:border-slate-800 dark:bg-slate-900">
          <SkeletonBlock className="h-9 w-full max-w-md rounded-xl" /><SkeletonBlock className="ml-auto h-9 w-9 rounded-full" /><SkeletonBlock className="h-9 w-9 rounded-full" />
        </div>
        <main className="min-w-0 flex-1 p-4 sm:p-6">
          {note && <p role="status" aria-live="polite" className="mb-4 text-sm text-slate-500 dark:text-slate-400">{note}</p>}
          {children || <DashboardSkeleton />}
        </main>
      </div>
    </div>
  );
}
