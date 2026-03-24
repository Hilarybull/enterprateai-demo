import Card from "./Card";
import InfoTip from "./InfoTip";

function badgeColor(classification) {
  if (classification === "STRONG") return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (classification === "PROMISING") return "bg-brand-50 text-brand-700 ring-brand-200";
  if (classification === "RISKY") return "bg-amber-50 text-amber-700 ring-amber-200";
  return "bg-rose-50 text-rose-700 ring-rose-200";
}

export default function ScorePanel({ score, classification, info }) {
  return (
    <Card>
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
        <div>Validation Score</div>
        {info ? <InfoTip text={info} /> : null}
      </div>
      <div className="flex items-center justify-between">
        <div className="text-4xl font-semibold tracking-tight text-slate-900">{score}</div>
        <span className={"rounded-full px-3 py-1 text-xs font-semibold ring-1 " + badgeColor(classification)}>
          {classification}
        </span>
      </div>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div className="h-full bg-brand-600" style={{ width: `${Math.min(100, Math.max(0, score))}%` }} />
      </div>
      <div className="mt-2 text-xs text-slate-500">Based on your inputs.</div>
    </Card>
  );
}
