import { dateLabel } from "../../lib/readiness";
import { READINESS_CHIP } from "../../lib/dashboardLayout";
import { Icon } from "../agent/AgentBits";
import { Pill } from "./Fields";

// One "Readiness" bar above the Business Health Report, in the same style as that bar. It has
// a half for the selected funding case and a half for the selected launch; a half with no
// data isn't shown, and with neither the bar isn't shown at all. It presents what the
// readiness service reported: no score is worked out here, and a check that hasn't run is
// shown as that, never as zero.
function Half({ label, summary, to, onOpen, children }) {
  const chip = summary.classification ? READINESS_CHIP[summary.classification]
    : { label: summary.execution_status === "failed" ? "Last check didn't finish" : "Not checked yet", tone: "slate", mark: "?" };
  return (
    <button type="button" onClick={() => onOpen(to)} aria-label={`${label}: ${summary.title}`}
      className="group grid min-w-0 flex-1 basis-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-3 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800">
      <span className="min-w-0">
        {/* The name comes first and keeps at least 16 characters; the chips follow on the same line
            and move beneath it only when there is no room at all. They never sit under the arrow. */}
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span title={summary.title} className="min-w-[16ch] max-w-full flex-1 truncate text-[15px] font-bold text-slate-900 dark:text-slate-100">{summary.title}</span>
          <Pill tone={chip.tone} mark={chip.mark} className="shrink-0 whitespace-nowrap">{chip.label}</Pill>
          {summary.freshness === "stale" && <Pill tone="amber" mark="!" className="shrink-0 whitespace-nowrap">Out of date</Pill>}
        </span>
        <span className="mt-0.5 block truncate text-[13px] text-slate-500 dark:text-slate-400">{label} · {children}</span>
      </span>
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-200 text-slate-400 group-hover:border-brand-300 group-hover:text-brand-600 dark:border-slate-700">
        <Icon name="chevron" className="h-3.5 w-3.5" />
      </span>
    </button>
  );
}

export default function ReadinessStrip({ dashboard, onOpen }) {
  const funding = dashboard?.funding_readiness;
  const launch = dashboard?.launch_check;
  if (!funding && !launch) return null;
  const score = (s) => (s.classification && s.score !== null && s.score !== undefined ? `Score ${s.score}` : s.classification ? "No overall score yet" : null);
  return (
    <section aria-label="Readiness" className="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:gap-4">
        <div className="flex items-center gap-4 xl:shrink-0">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-900/30"><Icon name="report" className="h-6 w-6" /></span>
          <span className="text-base font-bold text-slate-900 dark:text-slate-100">Readiness</span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3 xl:flex-row xl:gap-2 xl:divide-x xl:divide-slate-100 dark:xl:divide-slate-800">
          {funding && (
            <Half label="Funding" summary={funding} to={`/funding/${funding.case_id}`} onOpen={onOpen}>
              {[score(funding), funding.next_action ? `Next: ${funding.next_action.title}` : null].filter(Boolean).join(" · ") || "Not checked yet: the Agent is checking it."}
            </Half>
          )}
          {launch && (
            <Half label="Launch" summary={launch} to={`/launch/${launch.initiative_id}`} onOpen={onOpen}>
              {[launch.target_date ? `Target ${dateLabel(launch.target_date)}` : "No date set",
                launch.classification ? `${launch.blocker_count || 0} blocker${launch.blocker_count === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ")}
            </Half>
          )}
        </div>
      </div>
    </section>
  );
}
