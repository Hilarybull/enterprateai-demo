import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

// One pager for every long list: 10 rows a page, "Showing 1–10 of 21", Previous / Next and page
// numbers. On a phone the numbers give way to "Load more", which adds the next 10 below.
// Where the page is kept in the address (?page=2), refresh and Back keep your place.

export const PAGE_SIZE = 10;

/** The rows a page covers. `more` is how many pages are showing at once (phone: "Load more"). */
export function pageSlice(total, page = 1, more = 1, size = PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil((total || 0) / size));
  const current = Math.min(Math.max(1, Number(page) || 1), pages);
  const span = Math.max(1, Number(more) || 1);
  const offset = (current - 1) * size;
  return { pages, page: current, more: span, offset, limit: size * span, from: total ? offset + 1 : 0, to: Math.min(total || 0, offset + size * span) };
}

/** Which page numbers to show: the ends, the current page and its neighbours, with gaps marked. */
export function pageNumbers(pages, page) {
  const wanted = new Set([1, 2, pages - 1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages));
  const list = [...wanted].sort((a, b) => a - b);
  return list.flatMap((n, i) => (i && n - list[i - 1] > 1 ? ["…", n] : [n]));
}

/** A value kept in the address bar under `key` (removed when it is the default), with the rest left alone. */
export function useUrlValue(key, fallback = "") {
  const [params, setParams] = useSearchParams();
  const value = params.get(key) ?? fallback;
  const set = useCallback((next, also = {}) => {
    setParams((prev) => {
      const out = new URLSearchParams(prev);
      for (const [k, v] of Object.entries({ [key]: next, ...also })) {
        if (v === "" || v == null || v === false) out.delete(k); else out.set(k, String(v));
      }
      return out;
    }, { replace: true });
  }, [key, setParams]);
  return [value, set];
}

const btn = "rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[13px] font-semibold text-slate-600 transition hover:border-brand-300 hover:text-brand-700 disabled:cursor-default disabled:opacity-40 disabled:hover:border-slate-200 disabled:hover:text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300";

export default function Pagination({ total, page = 1, more = 1, size = PAGE_SIZE, onPage, onMore, noun = "rows", className = "" }) {
  if (!total || total <= size) return null;
  const at = pageSlice(total, page, more, size);
  const last = Math.min(at.pages, at.page + at.more - 1);      // the last page now showing
  return (
    <nav aria-label={`Pages of ${noun}`} data-pagination className={`flex flex-wrap items-center justify-between gap-3 px-5 py-3 ${className}`}>
      <p className="text-[13px] text-slate-500" aria-live="polite" data-showing>Showing {at.from.toLocaleString()}–{at.to.toLocaleString()} of {total.toLocaleString()}</p>
      {/* From 768px: Previous, the page numbers, Next. */}
      <div className="hidden items-center gap-1.5 md:flex" data-pages>
        <button type="button" className={btn} disabled={at.page <= 1} onClick={() => onPage(at.page - 1)}>Previous</button>
        {pageNumbers(at.pages, at.page).map((n, i) => (n === "…"
          ? <span key={`gap-${i}`} aria-hidden="true" className="px-1 text-slate-400">…</span>
          : (
            <button key={n} type="button" onClick={() => onPage(n)} aria-label={`Page ${n}`} aria-current={n === at.page ? "page" : undefined}
              className={n === at.page ? "rounded-lg bg-brand-600 px-3 py-1.5 text-[13px] font-semibold text-white" : btn}>{n}</button>
          )))}
        <button type="button" className={btn} disabled={last >= at.pages} onClick={() => onPage(last + 1)}>Next</button>
      </div>
      {/* Phone: one button that adds the next page underneath. */}
      {at.to < total && (
        <button type="button" data-load-more onClick={() => (onMore ? onMore(at.more + 1) : onPage(at.page + 1))} className={`${btn} min-h-[44px] w-full py-2 md:hidden`}>
          Load more
        </button>
      )}
    </nav>
  );
}
