import Badge from "./Badge";

export default function PageHeader({ title, description, badge, actions, leadingVisual = null }) {
  return (
    <div className="flex flex-col gap-3 pb-6 md:flex-row md:items-end md:justify-between">
      <div>
        <div className="flex items-center gap-3">
          {leadingVisual ? <div className="shrink-0">{leadingVisual}</div> : null}
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">{title}</h1>
          {badge ? <Badge tone={badge.tone}>{badge.text}</Badge> : null}
        </div>
        {description ? <p className="mt-2 text-sm text-slate-600">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
