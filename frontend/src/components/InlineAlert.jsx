export default function InlineAlert({ message, kind = "info" }) {
  const cls =
    kind === "error"
      ? "border-rose-200 bg-rose-50 text-rose-800"
      : "border-slate-200 bg-slate-50 text-slate-700";
  return <div className={"ea-alert " + cls}>{message}</div>;
}
