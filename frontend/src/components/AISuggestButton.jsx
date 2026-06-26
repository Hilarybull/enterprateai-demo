import { useState } from "react";
import { apiRequest } from "../api/client";

export default function AISuggestButton({ field, context, onFill, className = "" }) {
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  async function handleClick() {
    if (loading) return;
    setLoading(true);
    setFailed(false);
    try {
      const res = await apiRequest("/validation/suggest-field", "POST", { field, context });
      if (res?.suggestion) {
        onFill(res.suggestion);
      } else {
        console.warn("[AISuggestButton] empty suggestion for field:", field, res);
        setFailed(true);
        setTimeout(() => setFailed(false), 3000);
      }
    } catch (err) {
      console.error("[AISuggestButton] error for field:", field, err);
      setFailed(true);
      setTimeout(() => setFailed(false), 3000);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className={
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors disabled:opacity-50 " +
        (failed
          ? "border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100"
          : "border-brand-200 bg-brand-50 text-brand-600 hover:bg-brand-100") +
        " " + className
      }
      title={failed ? "AI fill failed — try again" : "Suggest with AI"}
    >
      {loading ? (
        <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-[1.5px] border-brand-200 border-t-brand-600" />
      ) : failed ? (
        <svg viewBox="0 0 16 16" className="h-3 w-3" fill="currentColor" aria-hidden="true">
          <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM7.25 4.75h1.5v4h-1.5v-4zm0 5.5h1.5v1.5h-1.5v-1.5z" />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" className="h-3 w-3" fill="currentColor" aria-hidden="true">
          <path d="M8 1.5l1.2 2.8 2.8 1.2-2.8 1.2L8 9.5 6.8 6.7 4 5.5l2.8-1.2L8 1.5z" />
          <path d="M12.5 9.5l.7 1.6 1.6.7-1.6.7-.7 1.6-.7-1.6-1.6-.7 1.6-.7.7-1.6z" opacity=".6" />
        </svg>
      )}
      {failed ? "Failed" : "AI fill"}
    </button>
  );
}
