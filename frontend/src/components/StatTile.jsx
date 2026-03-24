import InfoTip from "./InfoTip";

export default function StatTile({ label, value, info, tone = "default" }) {
  const cls =
    tone === "danger"
      ? "border-rose-200 bg-rose-50"
      : tone === "warn"
        ? "border-amber-200 bg-amber-50"
        : tone === "success"
          ? "border-emerald-200 bg-emerald-50"
          : "border-slate-200 bg-white";

  return (
    <div className={"rounded-2xl border p-4 shadow-sm " + cls}>
      <div className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-500">
        <div>{label}</div>
        {info ? <InfoTip text={info} /> : null}
      </div>
      <div className="mt-1 text-[20px] font-semibold tracking-tight text-slate-900">{value}</div>
    </div>
  );
}
