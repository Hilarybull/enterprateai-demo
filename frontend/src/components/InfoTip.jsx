export default function InfoTip({ text, className = "" }) {
  if (!text) return null;

  return (
    <span className={"relative inline-flex " + className}>
      <button
        type="button"
        className="group inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
        aria-label="Info"
      >
        <span className="text-[9px] font-extrabold leading-none">i</span>

        <span className="pointer-events-none absolute left-1/2 top-full z-[9999] mt-2 w-64 max-w-[85vw] -translate-x-1/2 rounded-xl bg-slate-900 px-3 py-2 text-left text-xs leading-snug text-white opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-all whitespace-normal break-words shadow-xl">
          <span className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-slate-900" />
          {text}
        </span>
      </button>
    </span>
  );
}
