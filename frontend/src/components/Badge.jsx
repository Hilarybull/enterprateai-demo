export default function Badge({ children, tone = "slate" }) {
  const cls =
    tone === "success"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : tone === "warn"
        ? "bg-amber-50 text-amber-700 ring-amber-200"
        : tone === "danger"
          ? "bg-rose-50 text-rose-700 ring-rose-200"
          : "bg-slate-50 text-slate-700 ring-slate-200";

  return <span className={"inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 " + cls}>{children}</span>;
}

