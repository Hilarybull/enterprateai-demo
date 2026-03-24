export default function Button({
  variant = "primary",
  className = "",
  ...props
}) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium shadow-sm transition focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:cursor-not-allowed disabled:opacity-60";
  const styles =
    variant === "secondary"
      ? "border border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
      : variant === "danger"
        ? "bg-rose-600 text-white hover:bg-rose-700 focus:ring-rose-200"
        : variant === "success"
          ? "bg-emerald-600 text-white hover:bg-emerald-700 focus:ring-emerald-200"
      : variant === "ghost"
        ? "bg-transparent text-slate-700 hover:bg-slate-100"
        : "bg-gradient-to-r from-brand-600 to-accent-600 text-white hover:from-brand-700 hover:to-accent-700";

  return (
    <button
      {...props}
      className={base + " " + styles + " " + className}
    />
  );
}
