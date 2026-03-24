export default function SectionCard({ title, subtitle, headerRight, children, className = "" }) {
  return (
    <div className={"ea-card p-5 " + className}>
      {title ? (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-900">{title}</div>
            {subtitle ? <div className="mt-1 text-xs text-slate-500">{subtitle}</div> : null}
          </div>
          {headerRight ? <div className="shrink-0">{headerRight}</div> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}
