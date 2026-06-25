import React from "react";

export function useTableControls(items, pageSize = 10) {
  const [page, setPage] = React.useState(1);
  const [search, setSearch] = React.useState("");
  const filtered = items.filter((item) =>
    Object.values(item).some((v) =>
      String(v ?? "").toLowerCase().includes(search.toLowerCase())
    )
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  React.useEffect(() => { setPage(1); }, [search]);
  return { paged, filtered, search, setSearch, page: safePage, setPage, totalPages };
}

export function TableSearch({ value, onChange, placeholder = "Search…" }) {
  return (
    <div className="relative">
      <svg className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
      </svg>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-xs text-slate-700 outline-none focus:border-brand-300 focus:ring focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
      />
    </div>
  );
}

export function TablePagination({ page, totalPages, setPage, totalItems, pageSize }) {
  if (totalPages <= 1) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalItems);
  return (
    <div className="flex items-center justify-between border-t border-slate-100 px-1 pt-3 dark:border-slate-800">
      <span className="text-xs text-slate-400">{from}–{to} of {totalItems}</span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page === 1}
          className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300"
        >‹ Prev</button>
        <span className="px-2 text-xs text-slate-500">{page} / {totalPages}</span>
        <button
          type="button"
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          disabled={page === totalPages}
          className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300"
        >Next ›</button>
      </div>
    </div>
  );
}
