import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import logoUrl from "../../enterprate-logo.png";
import { useAuthStore } from "../../store/auth";
import { useWorkspaceStore } from "../../store/workspace";
import { getMarketplaceProfile } from "../../lib/directory";

// The one header for the public Marketplace: the directory and listings, a business's public
// profile and the claim journey. Signed in: "List My Business" and "Dashboard". Otherwise
// "Sign in". Below 640px the links fold into a menu so nothing wraps.

const PRIMARY = "rounded-xl bg-brand-600 px-3.5 py-2 text-[13px] font-semibold text-white transition hover:bg-brand-700";
const OUTLINE = "rounded-xl border border-slate-200 px-3.5 py-2 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800";

export default function MarketplaceHeader({ onList, managing = false }) {
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.token);
  const [open, setOpen] = useState(false);
  const menu = useRef(null);
  // A business that is already on the Marketplace isn't asked to list itself again: the button manages the listing instead.
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const [listed, setListed] = useState(false);
  useEffect(() => {
    let live = true;
    setListed(false);
    if (token && workspaceId && !managing) getMarketplaceProfile(workspaceId).then((p) => { if (live) setListed(Boolean(p?.is_published)); }).catch(() => {});
    return () => { live = false; };
  }, [token, workspaceId, managing]);

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (menu.current && !menu.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  const list = () => { setOpen(false); if (onList) onList(); else navigate("/marketplace/profile"); };
  const go = (to) => () => { setOpen(false); navigate(to); };
  // On the business's own profile page there is nothing to list: the way back to the Marketplace takes that place.
  const links = token && managing
    ? [{ key: "browse", label: "Browse Marketplace", style: OUTLINE, onClick: go("/marketplace") }, { key: "dashboard", label: "Dashboard →", style: OUTLINE, onClick: go("/dashboard") }]
    : token
    ? [{ key: "list", label: listed ? "Manage My Listing" : "List My Business", style: PRIMARY, onClick: list, tour: "marketplace-list-btn" }, { key: "dashboard", label: "Dashboard →", style: OUTLINE, onClick: go("/dashboard") }]
    : [{ key: "signin", label: "Sign in", style: OUTLINE, onClick: go("/login") }];

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-950/95">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link to="/marketplace" aria-label="EnterprateAI Marketplace" className="flex min-w-0 items-center gap-2.5">
          <img src={logoUrl} alt="EnterprateAI" className="h-7 w-auto shrink-0" />
          <span className="whitespace-nowrap rounded-lg bg-brand-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-brand-600 dark:bg-brand-900/30 dark:text-brand-300">Marketplace</span>
        </Link>
        <nav aria-label="Marketplace" className="hidden items-center gap-2 sm:flex">
          {links.map((l) => <button key={l.key} type="button" data-tour={l.tour} onClick={l.onClick} className={`whitespace-nowrap ${l.style}`}>{l.label}</button>)}
        </nav>
        <div className="relative sm:hidden" ref={menu}>
          <button type="button" aria-label="Menu" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-700 dark:border-slate-700 dark:text-slate-200">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
          {open && (
            <div role="menu" className="absolute right-0 top-11 z-40 w-52 rounded-2xl border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900">
              {links.map((l) => (
                <button key={l.key} type="button" role="menuitem" onClick={l.onClick}
                  className={`block w-full rounded-xl px-3 py-2.5 text-left text-sm font-semibold ${l.key === "list" ? "text-brand-700 dark:text-brand-300" : "text-slate-700 dark:text-slate-200"} hover:bg-slate-50 dark:hover:bg-slate-800`}>
                  {l.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

/** The Marketplace's frame for a business's own pages there: the same header, with the page beneath it. */
export function MarketplaceShell({ children }) {
  return (
    <div className="min-h-screen overflow-x-hidden bg-slate-50 dark:bg-slate-950">
      <MarketplaceHeader managing />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}

/** The business's initials in a circle: the same mark on cards, the profile and the claim bar. */
export function Initials({ name, size = 56, className = "" }) {
  const letters = String(name || "").replace(/\b(ltd|limited|llp|plc|inc)\b\.?/gi, " ").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
  return (
    <span aria-hidden="true" style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-brand-50 font-bold text-brand-700 dark:bg-brand-900/40 dark:text-brand-200 ${className}`}>
      {letters}
    </span>
  );
}
