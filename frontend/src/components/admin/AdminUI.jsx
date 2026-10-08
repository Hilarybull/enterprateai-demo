import { useEffect, useLayoutEffect, useRef, useState } from "react";

// The admin area's shared pieces, in the same design language as the Adaptive Dashboard:
// the grouped sidebar (the app sidebar's item style), the page header, KPI tiles with a small
// trend line, insight cards, and one table used by every section.

const HIDE_SCROLLBAR = "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

// ── navigation ────────────────────────────────────────────────────────────────

const ICONS = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  building: <><path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16" /><path d="M16 9h2a2 2 0 0 1 2 2v10M3 21h18M8 7h4M8 11h4M8 15h4" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.5a6.5 6.5 0 0 1 3.5 5.5" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>,
  arrowUp: <><path d="M12 19V5M5 12l7-7 7 7" /></>,
  puzzle: <><path d="M10 3h4v3a2 2 0 1 0 4 0h3v5h-3a2 2 0 1 0 0 4h3v6h-6v-3a2 2 0 1 0-4 0v3H4v-6h3a2 2 0 1 0 0-4H4V6h6z" /></>,
  share: <><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="m8.2 10.9 7.6-3.8M8.2 13.1l7.6 3.8" /></>,
  list: <><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  shield: <><path d="M12 3 4 6v6c0 4.5 3.2 7.9 8 9 4.8-1.1 8-4.5 8-9V6z" /><path d="m9 12 2 2 4-4" /></>,
  store: <><path d="M3 9h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 9l2.4-4.9A2 2 0 0 1 7.2 3h9.6a2 2 0 0 1 1.8 1.1L21 9" /></>,
  eye: <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  upload: <><path d="M12 16V4M7 9l5-5 5 5M4 20h16" /></>,
  pen: <><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></>,
  beaker: <><path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3" /><path d="M7.5 15h9" /></>,
  chat: <><path d="M21 12a8 8 0 0 1-8 8H5l-2 2V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z" /></>,
  spark: <><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" /></>,
};

export function AdminIcon({ name, className = "h-5 w-5" }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">{ICONS[name] || ICONS.grid}</svg>;
}

/** Sections of the admin area, grouped. `marketplace: true` marks the ones a Marketplace moderator may open. */
export const ADMIN_NAV = [
  { group: null, items: [{ key: "overview", label: "Overview", subtitle: "The platform at a glance", icon: "grid" }] },
  { group: "People", items: [
    { key: "workspaces", label: "Workspaces", subtitle: "Every business on the platform", icon: "building" },
    { key: "users", label: "Users", subtitle: "Accounts and plans", icon: "user" },
    { key: "members", label: "Members", subtitle: "Who belongs to which team", icon: "users" },
    { key: "invitations", label: "Invitations", subtitle: "Team invitations sent", icon: "mail" },
  ] },
  { group: "Growth", items: [
    { key: "upgrades", label: "Upgrade clicks", subtitle: "Interest in paid plans", icon: "arrowUp" },
    { key: "module-interest", label: "Module interest", subtitle: "Tools people asked about", icon: "puzzle" },
    { key: "referrals", label: "Referrals", subtitle: "Referral links and rewards", icon: "share" },
    { key: "activation", label: "Activation emails", subtitle: "Getting-started journeys", icon: "mail" },
    { key: "contacts", label: "Contacts", subtitle: "Names, emails and consent", icon: "list" },
    { key: "mailing-list", label: "Mailing list", subtitle: "Newsletter sign-ups", icon: "list" },
    { key: "demo-requests", label: "Demo requests", subtitle: "People who asked for a demo", icon: "calendar" },
  ] },
  { group: "Marketplace", items: [
    { key: "marketplace-queue", label: "Claims & reports", subtitle: "Decisions waiting for a person", icon: "shield", marketplace: true },
    { key: "marketplace-unclaimed", label: "Unclaimed profiles", subtitle: "Indexed, not yet claimed", icon: "store", marketplace: true },
    { key: "marketplace-visibility", label: "Visibility", subtitle: "Who sees unclaimed profiles", icon: "eye", marketplace: true },
    { key: "marketplace-index", label: "Index & invites", subtitle: "Add records, make claim links", icon: "upload", marketplace: true },
  ] },
  { group: "Content", items: [
    { key: "blog", label: "Blog", subtitle: "Articles, categories and tags", icon: "pen" },
    { key: "research", label: "Research & Development", subtitle: "Research notes", icon: "beaker" },
  ] },
  { group: "Support", items: [{ key: "support", label: "Support messages", subtitle: "Messages from users", icon: "chat" }] },
  { group: null, items: [{ key: "ai-usage", label: "AI usage", subtitle: "Calls, tokens and cost", icon: "spark" }] },
];

/** The sidebar list: the app sidebar's item (icon tile, title, subtitle, brand-50 pill when current), in groups. */
export function AdminSidebar({ current, onGo, counts = {}, only = null }) {
  const groups = ADMIN_NAV.map((g) => ({ ...g, items: g.items.filter((i) => !only || only(i)) })).filter((g) => g.items.length);
  const isCurrent = (key) => current === key || (key === "marketplace-queue" && current === "marketplace-reports");
  return (
    <nav aria-label="Admin sections" className="space-y-3">
      {groups.map((g, n) => (
        <div key={g.group || `top-${n}`}>
          {g.group && <p className="mb-1 px-4 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{g.group}</p>}
          <ul className="space-y-0.5">
            {g.items.map((item) => (
              <li key={item.key}>
                <button type="button" onClick={() => onGo(item.key)} aria-current={isCurrent(item.key) ? "page" : undefined}
                  className={`group mx-1 flex w-[calc(100%-0.5rem)] items-center gap-3 rounded-2xl px-3 py-2 text-left transition ${isCurrent(item.key)
                    ? "bg-brand-50 text-brand-700 ring-1 ring-brand-100 dark:bg-slate-900 dark:text-slate-100 dark:ring-slate-800"
                    : "text-slate-700 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-slate-900"}`}>
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl ring-1 ${isCurrent(item.key) ? "bg-white text-brand-600 ring-brand-100" : "bg-white text-slate-600 ring-slate-200 group-hover:bg-slate-50"} dark:bg-slate-900 dark:ring-slate-800`}>
                    <AdminIcon name={item.icon} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold leading-snug">{item.label}</span>
                    <span className="mt-0.5 block text-[10px] leading-tight text-slate-400 dark:text-slate-500">{item.subtitle}</span>
                  </span>
                  {counts[item.key] !== undefined && (
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${isCurrent(item.key) ? "bg-white text-brand-700 ring-1 ring-brand-100" : "bg-slate-100 text-slate-600"}`}>{counts[item.key]}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** The same list in a drawer, for screens too narrow for a sidebar. */
export function AdminDrawer({ open, onClose, children }) {
  useEffect(() => {
    if (!open) return undefined;
    const esc = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <button type="button" aria-label="Close menu" onClick={onClose} className="absolute inset-0 bg-slate-900/40" />
      <div role="dialog" aria-modal="true" aria-label="Admin menu" className={`absolute inset-y-0 left-0 flex w-[min(20rem,88vw)] flex-col overflow-y-auto bg-white py-4 shadow-xl dark:bg-slate-950 ${HIDE_SCROLLBAR}`}>
        {children}
      </div>
    </div>
  );
}

// ── page header ───────────────────────────────────────────────────────────────

/** "ADMIN" eyebrow, a title with one brand-coloured word, a subtitle, and when the data was last read. */
export function AdminHeader({ lead, accent, subtitle, updatedAt, onRefresh, refreshing }) {
  const time = updatedAt ? new Date(updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">Admin</p>
        <h1 className="mt-1 break-words text-2xl font-bold tracking-tight text-slate-900 sm:text-[28px] dark:text-slate-100">{lead ? `${lead} ` : ""}<span className="text-brand-600">{accent}</span></h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
      </div>
      {onRefresh && (
        <p className="flex shrink-0 items-center gap-2 text-[13px] text-slate-500">
          {time && <span>Updated {time}</span>}
          {time && <span aria-hidden="true">·</span>}
          <button type="button" onClick={onRefresh} disabled={refreshing} className="font-semibold text-brand-600 hover:underline disabled:text-slate-400">{refreshing ? "Refreshing…" : "Refresh"}</button>
        </p>
      )}
    </div>
  );
}

// ── KPI tile ──────────────────────────────────────────────────────────────────

function Sparkline({ series }) {
  if (!series || series.length < 2 || !series.some((v) => v > 0)) return null;
  const max = Math.max(...series, 1);
  const w = 72, h = 24;
  const points = series.map((v, i) => `${(i / (series.length - 1)) * w},${h - 2 - (v / max) * (h - 4)}`).join(" ");
  return <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className="shrink-0 text-brand-500" aria-hidden="true"><polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

/** Label above the number, as on the dashboard's Key Figures. `series`: recent values, oldest first, for the trend line. */
export function KpiTile({ label, value, hint, series, onClick, className = "" }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag type={onClick ? "button" : undefined} onClick={onClick}
      className={`flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-4 text-left dark:border-slate-800 dark:bg-slate-900 ${onClick ? "transition hover:border-brand-200 hover:shadow-sm" : ""} ${className}`}>
      <span className="text-[13px] font-medium leading-snug text-slate-500 dark:text-slate-400">{label}</span>
      <span className="mt-1.5 flex items-end justify-between gap-2">
        <span className="text-2xl font-bold tabular-nums leading-none text-slate-900 dark:text-slate-100">{value ?? "—"}</span>
        <Sparkline series={series} />
      </span>
      {hint && <span className="mt-1.5 text-[11px] leading-snug text-slate-400">{hint}</span>}
    </Tag>
  );
}

/** New records per week over the last `weeks` weeks, oldest first, from each record's date. */
export function weeklySeries(records, weeks = 8, fields = ["created_at", "joined_at", "invited_at"]) {
  const now = Date.now();
  const out = new Array(weeks).fill(0);
  for (const r of records || []) {
    const raw = fields.map((f) => r?.[f]).find(Boolean);
    const t = raw ? new Date(raw).getTime() : NaN;
    if (Number.isNaN(t)) continue;
    const ago = Math.floor((now - t) / (7 * 24 * 3600 * 1000));
    if (ago >= 0 && ago < weeks) out[weeks - 1 - ago] += 1;
  }
  return out;
}

// ── insight card ──────────────────────────────────────────────────────────────

const INSIGHT_TONE = {
  amber: { card: "border-amber-100 bg-amber-50/70", icon: "bg-amber-100 text-amber-700", title: "text-amber-800", name: "user" },
  sky: { card: "border-sky-100 bg-sky-50/70", icon: "bg-sky-100 text-sky-700", title: "text-sky-800", name: "mail" },
  violet: { card: "border-violet-100 bg-violet-50/70", icon: "bg-violet-100 text-violet-700", title: "text-violet-800", name: "building" },
  emerald: { card: "border-emerald-100 bg-emerald-50/70", icon: "bg-emerald-100 text-emerald-700", title: "text-emerald-800", name: "arrowUp" },
};

/** The dashboard's insight card: tinted background, icon chip, coloured title, body, and a small button at the bottom. */
export function AdminInsight({ label, count, description, color = "amber", onAction, actionLabel, primary = false }) {
  const t = INSIGHT_TONE[color] || INSIGHT_TONE.amber;
  return (
    <article aria-label={label} className={`flex min-w-0 flex-col rounded-2xl border p-4 shadow-sm ${t.card}`}>
      <div className="flex items-center gap-2.5">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] ${t.icon}`}><AdminIcon name={t.name} /></span>
        <h3 className={`text-base font-semibold leading-tight tracking-tight ${t.title}`}>{label}</h3>
      </div>
      <p className="mt-2.5 text-2xl font-bold tabular-nums text-slate-900">{count}</p>
      <p className="mt-1 flex-1 text-[13px] leading-relaxed text-slate-600">{description}</p>
      {onAction && (
        <div className="mt-3">
          <button type="button" onClick={onAction}
            className={`inline-flex items-center gap-1 whitespace-nowrap px-3.5 py-1.5 text-[13px] font-semibold transition ${primary
              ? "rounded-full bg-brand-600 text-white hover:bg-brand-700" : "rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}>
            {String(actionLabel || "View").replace(/\s*→\s*$/, "")}
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
          </button>
        </div>
      )}
    </article>
  );
}

// ── table ─────────────────────────────────────────────────────────────────────

const CHIP = {
  amber: "bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200",
  slate: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  rose: "bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-200",
  sky: "bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-200",
  emerald: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200",
};
export const Chip = ({ tone = "slate", children }) => <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] font-semibold ${CHIP[tone] || CHIP.slate}`}>{children}</span>;

/** The ⋯ menu at the end of a row. It is placed against the viewport, so a scrolling table never clips it. */
export function RowMenu({ label, items }) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(null);
  const button = useRef(null);
  const menu = useRef(null);
  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const r = button.current.getBoundingClientRect();
    const width = 220;
    setAt({ top: Math.min(r.bottom + 4, window.innerHeight - 8 - 44 * items.length), left: Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8)), width });
  }, [open, items.length]);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (!menu.current?.contains(e.target) && !button.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") { setOpen(false); button.current?.focus(); } };
    const moved = () => setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    window.addEventListener("scroll", moved, true);
    window.addEventListener("resize", moved);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); window.removeEventListener("scroll", moved, true); window.removeEventListener("resize", moved); };
  }, [open]);
  if (!items?.length) return null;
  return (
    <>
      <button ref={button} type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
      </button>
      {open && (
        <div ref={menu} role="menu" style={{ position: "fixed", ...(at || { top: -9999, left: -9999 }) }} className="z-[60] rounded-2xl border border-slate-200 bg-white p-1.5 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          {items.map((item) => (
            <button key={item.label} type="button" role="menuitem" disabled={item.disabled} onClick={() => { setOpen(false); item.onClick(); }}
              className={`block w-full rounded-xl px-3 py-2 text-left text-[13px] font-semibold disabled:opacity-50 ${item.danger ? "text-rose-700 hover:bg-rose-50" : "text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"}`}>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/** One table for every admin section: a white rounded card, a header that stays put, status chips
 *  (use <Chip>), a row actions menu, an empty state and pages.
 *  columns: [{ key, label, render?(row), className?, tdClass? }] · rowActions?(row) -> [{ label, onClick, danger?, disabled? }]
 *  expanded?(row) -> content shown under that row, or null. */
export function AdminTable({ columns, rows, emptyText = "Nothing here yet.", rowKey = (r, i) => r.id ?? i, rowActions, rowLabel = (r) => r.name || r.email || "this row", expanded, pageSize = 25, minWidth = 640, caption,
  selection = null }) {      // selection: { selected: Set of row keys, onChange(Set) } for an action on many rows
  const [page, setPage] = useState(1);
  const total = rows?.length || 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  useEffect(() => { if (page > pages) setPage(pages); }, [page, pages]);
  if (!total) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center dark:border-slate-800 dark:bg-slate-900">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800"><AdminIcon name="list" className="h-5 w-5" /></span>
        <p className="mt-3 text-sm text-slate-500">{emptyText}</p>
      </div>
    );
  }
  const shown = rows.slice((page - 1) * pageSize, page * pageSize);
  const span = columns.length + (rowActions ? 1 : 0) + (selection ? 1 : 0);
  const keys = shown.map((r, i) => rowKey(r, i));
  const allTicked = Boolean(selection) && keys.length > 0 && keys.every((k) => selection.selected.has(k));
  const tick = (key, on) => { const next = new Set(selection.selected); if (on) next.add(key); else next.delete(key); selection.onChange(next); };
  const tickAll = (on) => { const next = new Set(selection.selected); keys.forEach((k) => (on ? next.add(k) : next.delete(k))); selection.onChange(next); };
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className={`max-h-[70vh] overflow-auto ${HIDE_SCROLLBAR}`}>
        <table className="w-full border-collapse text-sm" style={{ minWidth }}>
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-800">
            <tr>
              {selection && <th scope="col" className="w-10 border-b border-slate-200 px-3 py-2.5 dark:border-slate-700"><input type="checkbox" aria-label="Select all on this page" checked={allTicked} onChange={(e) => tickAll(e.target.checked)} /></th>}
              {columns.map((c) => <th key={c.key} scope="col" className={`whitespace-nowrap border-b border-slate-200 px-4 py-2.5 text-left text-[12px] font-semibold text-slate-500 dark:border-slate-700 ${c.className || ""}`}>{c.label}</th>)}
              {rowActions && <th scope="col" className="border-b border-slate-200 px-2 py-2.5 dark:border-slate-700"><span className="sr-only">Actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, i) => {
              const under = expanded ? expanded(row) : null;
              return [
                <tr key={rowKey(row, i)} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/60 dark:border-slate-800 dark:hover:bg-slate-800/40">
                  {selection && <td className="w-10 px-3 py-3 align-top"><input type="checkbox" aria-label={`Select ${rowLabel(row)}`} checked={selection.selected.has(rowKey(row, i))} onChange={(e) => tick(rowKey(row, i), e.target.checked)} /></td>}
                  {columns.map((c) => <td key={c.key} className={`px-4 py-3 align-top text-[13px] text-slate-700 dark:text-slate-200 ${c.tdClass || ""}`}>{c.render ? c.render(row) : (row[c.key] ?? "—")}</td>)}
                  {rowActions && <td className="w-10 px-2 py-2 align-top"><RowMenu label={`Actions for ${rowLabel(row)}`} items={rowActions(row) || []} /></td>}
                </tr>,
                under ? <tr key={`${rowKey(row, i)}-more`} className="border-b border-slate-100 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/40"><td colSpan={span} className="px-4 py-3">{under}</td></tr> : null,
              ];
            })}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-4 py-2.5 text-[13px] text-slate-500 dark:border-slate-700">
          <span>{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}</span>
          <span className="flex gap-2">
            <button type="button" disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="rounded-lg border border-slate-200 px-2.5 py-1 font-semibold text-slate-700 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200">Previous</button>
            <button type="button" disabled={page === pages} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-slate-200 px-2.5 py-1 font-semibold text-slate-700 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200">Next</button>
          </span>
        </div>
      )}
    </div>
  );
}
