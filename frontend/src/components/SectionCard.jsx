export default function SectionCard({ title, subtitle, headerRight, icon, children, className = "" }) {
  return (
    <div className={"ea-card ea-card-brand p-4 sm:p-5 " + className}>
      {title ? (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            {icon ? <div className="mt-0.5 shrink-0">{icon}</div> : null}
            <div className="min-w-0">
              <div className="text-base font-semibold text-brand-800 dark:text-brand-200">{title}</div>
              {subtitle ? <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{subtitle}</div> : null}
            </div>
          </div>
          {headerRight ? <div className="shrink-0">{headerRight}</div> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}
