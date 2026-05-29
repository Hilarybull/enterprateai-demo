export function StatusBadge({ status }) {
  const s = String(status || "").toLowerCase();
  const cls =
    s === "paid" || s === "accepted" || s === "signed"
      ? "bg-emerald-50 text-emerald-700"
      : s === "overdue" || s === "rejected"
        ? "bg-rose-50 text-rose-700"
        : s === "pending" || s === "sent"
          ? "bg-amber-50 text-amber-700"
          : "bg-slate-100 text-slate-600";
  return (
    <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}>
      {status || "—"}
    </span>
  );
}

export default function ReportTable({ columns, rows, emptyText = "No data." }) {
  if (!rows.length)
    return <div className="rounded-xl border border-dashed border-slate-200 p-3 text-xs text-slate-500">{emptyText}</div>;
  return (
    <div className="overflow-auto rounded-xl border border-slate-200">
      <table className="min-w-full text-xs">
        <thead className="bg-slate-50">
          <tr>
            {columns.map((col) => (
              <th key={col.key} className={`px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 ${col.right ? "text-right" : "text-left"}`}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-slate-100 hover:bg-slate-50/50">
              {columns.map((col) => (
                <td key={col.key} className={`px-3 py-2 ${col.right ? "text-right" : ""} ${col.bold ? "font-semibold text-slate-900" : "text-slate-700"}`}>
                  {row[col.key] ?? "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
