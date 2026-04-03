import InfoTip from "./InfoTip";

export default function StatTile({ label, value, info, tone = "default" }) {
  const cls =
    tone === "danger"
      ? "border-rose-200 bg-rose-50 dark:border-rose-900/60 dark:bg-rose-950/30"
      : tone === "warn"
        ? "border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/30"
        : tone === "success"
          ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/30"
          : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/70";

  return (
    <div className={"rounded-2xl border p-4 shadow-sm " + cls}>
      <div className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-500 dark:text-slate-300">
        <div>{label}</div>
        {info ? <InfoTip text={info} /> : null}
      </div>
      <div className="mt-1 text-[20px] font-semibold tracking-tight text-slate-900 dark:text-slate-100">{value}</div>
    </div>
  );
}
