/** Indeterminate activity: stays active until the request or saved job finishes. */
export default function ThinkingProgress({ label = "Thinking…", detail }) {
  return <div role="status" className="min-w-0 w-full max-w-xl space-y-2" data-agent-progress>
    <div className="flex items-center gap-2 text-[14px] text-slate-500 dark:text-slate-400">
      <span aria-hidden="true" className="h-4 w-4 shrink-0 rounded-full border-2 border-brand-500 border-r-transparent motion-safe:animate-spin" />
      <span>{label}</span>
    </div>
    <div role="progressbar" aria-label={label} aria-valuetext="In progress" className="ea-agent-progress h-1.5 w-full overflow-hidden rounded-full bg-brand-100 dark:bg-brand-950">
      <span aria-hidden="true" className="block h-full w-2/5 rounded-full bg-brand-500" />
    </div>
    {detail && <p className="text-sm text-slate-500 dark:text-slate-400">{detail}</p>}
  </div>;
}
