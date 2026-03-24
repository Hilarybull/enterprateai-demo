export default function InlineAlert({ message, kind = "info" }) {
  const cls =
    kind === "error"
      ? "border-rose-200 bg-rose-50 text-rose-800 ring-rose-100"
      : "border-slate-200 bg-slate-50 text-slate-700 ring-slate-100";
  return <div className={"rounded-xl border px-3 py-2 text-sm ring-1 " + cls}>{message}</div>;
}
