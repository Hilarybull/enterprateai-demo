export default function SegmentedTabs({ value, onChange, options = [], ariaLabel = "Tabs", size = "md", className = "" }) {
  const isSm = size === "sm";
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={
        "flex w-full items-center gap-1 rounded-2xl bg-slate-100 ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700 " +
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
              " " +
              (selected
                ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200 dark:bg-slate-700 dark:text-slate-100 dark:ring-slate-600"
                : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200")
            }
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
