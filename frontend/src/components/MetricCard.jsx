import Card from "./Card";
import InfoTip from "./InfoTip";

export default function MetricCard({
  label,
  value,
  hint,
  info
}) {
  return (
    <Card>
      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
        <div>{label}</div>
        {info ? <InfoTip text={info} /> : null}
      </div>
      <div className="mt-1 text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">{value}</div>
      {hint ? <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</div> : null}
    </Card>
  );
}
