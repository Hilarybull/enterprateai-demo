import Badge from "./Badge";

export default function PageHeader({ title, description, badge, actions }) {
  return (
    <div className="flex flex-col gap-3 pb-4 md:flex-row md:items-end md:justify-between">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-brand-700">{title}</h1>
          {badge ? <Badge tone={badge.tone}>{badge.text}</Badge> : null}
        </div>
        {description ? <p className="mt-1 text-sm text-slate-600">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
