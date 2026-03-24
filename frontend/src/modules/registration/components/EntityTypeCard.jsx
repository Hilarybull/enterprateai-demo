import { classNames, formatGbp } from "../utils";

export default function EntityTypeCard({ item, selected, onSelect }) {
  const fee = item?.fee || {};
  const feeText =
    fee?.note ||
    `Registration: ${formatGbp(fee?.online_gbp)} (online) / ${formatGbp(fee?.paper_gbp)} (paper)${
      fee?.same_day_gbp ? ` • Same-day: ${formatGbp(fee.same_day_gbp)}` : ""
    }`;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={classNames(
        "group w-full rounded-2xl border bg-white p-5 text-left shadow-sm transition",
        selected ? "border-brand-300 ring-2 ring-brand-100" : "border-slate-200 hover:border-slate-300"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-semibold text-slate-900">{item.name}</div>
            {item.recommended ? (
              <span className="inline-flex items-center rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700 ring-1 ring-brand-200">
                Recommended
              </span>
            ) : null}
          </div>
          <div className="mt-1 text-sm text-slate-600">{item.description}</div>
        </div>
        <span className="rounded-full bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">{item.authority}</span>
      </div>

      <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div className="text-xs font-semibold text-slate-900">{feeText}</div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Ideal for</div>
          <ul className="mt-2 space-y-1 text-sm text-slate-700">
            {(item.ideal_for || []).slice(0, 4).map((x) => (
              <li key={x} className="flex gap-2">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
                <span className="min-w-0">{x}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Benefits</div>
          <ul className="mt-2 space-y-1 text-sm text-slate-700">
            {(item.benefits || []).slice(0, 4).map((x) => (
              <li key={x} className="flex gap-2">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
                <span className="min-w-0">{x}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </button>
  );
}

