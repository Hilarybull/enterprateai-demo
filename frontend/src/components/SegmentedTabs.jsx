export default function SegmentedTabs({ value, onChange, options = [], ariaLabel = "Tabs", size = "md", className = "" }) {
  const isSm = size === "sm";
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={
        "flex w-full items-center gap-1 rounded-2xl bg-slate-50 ring-1 ring-slate-200 " +
        (isSm ? "p-0.5" : "p-1") +
        " " +
        className
      }
    >
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(opt.value)}
            className={
              "flex-1 rounded-xl font-semibold transition " +
              (isSm ? "px-2 py-1 text-xs" : "px-3 py-2 text-sm") +
              (selected ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-600 hover:text-slate-900")
            }
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
