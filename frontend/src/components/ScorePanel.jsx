import Card from "./Card";
import InfoTip from "./InfoTip";

function badgeColor(classification) {
  if (classification === "STRONG") return "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800";
  if (classification === "PROMISING") return "bg-brand-50 text-brand-700 ring-brand-200 dark:bg-slate-800 dark:text-brand-400 dark:ring-brand-800";
  if (classification === "RISKY") return "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-800";
  return "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-800";
}

export default function ScorePanel({ score, classification, info }) {
  return (
    <Card>
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
        <div>Validation Score</div>
        {info ? <InfoTip text={info} /> : null}
      </div>
      <div className="flex items-center justify-between">
        <div className="text-4xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">{score}</div>
        <span className={"rounded-full px-3 py-1 text-xs font-semibold ring-1 " + badgeColor(classification)}>
          {classification}
        </span>
      </div>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div className="h-full bg-brand-600" style={{ width: `${Math.min(100, Math.max(0, score))}%` }} />
      </div>
      <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">Based on your inputs.</div>
    </Card>
  );
}
