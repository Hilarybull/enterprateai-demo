export default function ConfirmDialog({ message, confirmLabel = "Confirm", cancelLabel = "Cancel", onConfirm, onCancel, danger = false }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel?.(); }}
    >
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        <div className="px-6 py-5">
          <p className="text-sm text-slate-700 dark:text-slate-300">{message}</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4 dark:border-slate-800">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`rounded-xl px-4 py-2 text-sm font-semibold text-white ${
              danger
                ? "bg-rose-600 hover:bg-rose-700"
                : "bg-brand-600 hover:bg-brand-700"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
