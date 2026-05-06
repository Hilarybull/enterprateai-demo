import Badge from "./Badge";

export default function PageHeader({ title, description, badge, actions, leadingVisual = null }) {
  return (
    <div className="flex flex-col gap-3 pb-5 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {leadingVisual ? <div className="shrink-0">{leadingVisual}</div> : null}
          <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100 sm:text-2xl md:text-3xl">{title}</h1>
          {badge ? <Badge tone={badge.tone}>{badge.text}</Badge> : null}
        </div>
        {description ? <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
