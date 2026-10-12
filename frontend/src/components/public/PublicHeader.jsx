import { useEffect, useId, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import logoUrl from "../../enterprate-logo.png";
import { apiRequest } from "../../api/client";
import { useAuthStore } from "../../store/auth";
import { FEATURE_GROUPS, visibleNav } from "../../lib/publicSite";

// The public site's header (QA F), the same on the homepage and every public page. Every item is a page;
// Features and Articles also open a menu: on hover and on keyboard focus, and a click pins it open (QA U5: a click
// on a menu that hovering has just opened keeps it open; a second click closes it). Closed by Escape, by a click
// outside, or by leaving a menu that only hovering opened. Inside the menu the arrow keys move between links.

const linkCls = "whitespace-nowrap text-sm font-medium text-slate-600 transition hover:text-brand-600";

/**
 * What the Articles menu lists (QA U5): the categories that have a published article, and the latest articles.
 * A category with nothing in it is not shown; with nothing published at all, the menu is the Articles Hub alone.
 */
export function articlesMenu(categories, articles) {
  const posts = Array.isArray(articles) ? articles.filter((a) => a?.slug && a?.title) : [];
  const used = new Set(posts.map((a) => a.category_id).filter(Boolean));
  return { cats: (Array.isArray(categories) ? categories : []).filter((c) => used.has(c.id)), latest: posts.slice(0, 3) };
}

function useArticles() {
  const [menu, setMenu] = useState({ cats: [], latest: [] });
  useEffect(() => {
    let live = true;
    Promise.all([apiRequest("/blog/categories", "GET").catch(() => []), apiRequest("/blog/articles", "GET").catch(() => [])])
      .then(([cats, posts]) => { if (live) setMenu(articlesMenu(cats, posts)); });
    return () => { live = false; };
  }, []);
  return menu;
}

/** One navigation menu: a link to its page plus a button that opens the panel. */
export function NavMenu({ label, to, children, wide = false }) {
  const [mode, setMode] = useState(null);      // why it is open: "hover", "focus" or "pinned" (a click); null when closed
  const open = mode !== null;
  const setOpen = (on) => { if (on) setMode((m) => m || "focus"); else setMode(null); };
  const box = useRef(null);
  const panel = useRef(null);
  const hover = useRef(null);
  const quiet = useRef(false);
  const id = `menu-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = (e) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      quiet.current = true;      // the focus going back to the button must not open it again
      box.current?.querySelector("[data-menu-button]")?.focus();
      setTimeout(() => { quiet.current = false; }, 0);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  const items = () => [...(panel.current?.querySelectorAll("a[href]") || [])];
  function onPanelKey(e) {
    const list = items();
    const at = list.indexOf(document.activeElement);
    if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); list[(at + 1) % list.length]?.focus(); }
    if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); list[(at - 1 + list.length) % list.length]?.focus(); }
    if (e.key === "Home") { e.preventDefault(); list[0]?.focus(); }
    if (e.key === "End") { e.preventDefault(); list[list.length - 1]?.focus(); }
  }
  function onButtonKey(e) {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setTimeout(() => items()[0]?.focus(), 0); }
  }

  return (
    <li ref={box} className="relative flex items-center gap-0.5" data-menu-mode={mode || "closed"}
      onPointerEnter={(e) => { if (e.pointerType === "touch") return; clearTimeout(hover.current); setMode((m) => m || "hover"); }}
      onPointerLeave={(e) => { if (e.pointerType === "touch") return; hover.current = setTimeout(() => setMode((m) => (m === "pinned" ? m : null)), 150); }}
      onBlur={(e) => { if (box.current && !box.current.contains(e.relatedTarget)) setOpen(false); }}>
      <Link to={to} className={linkCls} data-nav-page>{label}</Link>
      <button type="button" data-menu-button aria-label={`${label} menu`} aria-expanded={open} aria-controls={id} aria-haspopup="true"
        onClick={() => setMode((m) => (m === "pinned" ? null : "pinned"))} onFocus={() => { if (!quiet.current) setOpen(true); }} onKeyDown={onButtonKey}
        className="flex h-6 w-6 items-center justify-center rounded text-slate-500 hover:text-brand-600">
        <svg className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <div id={id} ref={panel} role="menu" aria-label={label} onKeyDown={onPanelKey} data-menu-panel
          className={`absolute left-1/2 top-full z-50 mt-3 -translate-x-1/2 rounded-2xl border border-slate-200 bg-white shadow-xl ring-1 ring-black/5 ${wide ? "w-[min(680px,calc(100vw-2rem))]" : "w-[min(480px,calc(100vw-2rem))]"}`}>
          {children(() => setOpen(false))}
        </div>
      )}
    </li>
  );
}

function FeaturesPanel({ close }) {
  return (
    <div className="grid grid-cols-2 gap-0 p-5 lg:grid-cols-4">
      {FEATURE_GROUPS.map((g) => (
        <div key={g.slug} className="px-2 py-1">
          <Link to={`/features/${g.slug}`} role="menuitem" onClick={close} className="text-[12px] font-bold uppercase tracking-wide text-slate-900 hover:text-brand-600">{g.heading}</Link>
          <p className="mt-1 text-[11px] leading-snug text-slate-500">{g.desc}</p>
          <ul className="mt-2 space-y-1">
            {g.items.map((i) => (
              <li key={i.slug}><Link to={`/features/${i.slug}`} role="menuitem" onClick={close} className="block text-[12.5px] text-slate-600 hover:text-brand-600">{i.label}</Link></li>
            ))}
          </ul>
        </div>
      ))}
      <div className="col-span-full mt-2 border-t border-slate-100 px-2 pt-3">
        <Link to="/features" role="menuitem" onClick={close} className="text-[13px] font-semibold text-brand-700 hover:underline">All features →</Link>
        <Link to="/features/agent" role="menuitem" onClick={close} className="ml-5 text-[13px] font-semibold text-brand-700 hover:underline">The Agent →</Link>
      </div>
    </div>
  );
}

function ArticlesPanel({ close, cats, latest }) {
  return (
    <div className="p-5">
      <Link to="/articles" role="menuitem" onClick={close} className="mb-4 flex w-full items-start justify-between rounded-xl bg-brand-50 px-4 py-3 text-left transition hover:bg-brand-100">
        <span><span className="block text-sm font-bold text-brand-700">Articles Hub</span>
          <span className="mt-0.5 block max-w-[300px] text-[11px] leading-snug text-slate-500">Insights to help small businesses plan, operate, sell, reduce risk, and grow with intelligence.</span></span>
        <span aria-hidden="true" className="text-lg text-brand-500">→</span>
      </Link>
      {latest.length > 0 && (
        <div data-articles-latest>
          <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Latest</p>
          <ul className="mt-1.5 space-y-1.5">
            {latest.map((a) => <li key={a.id || a.slug}><Link to={`/blog/${a.slug}`} role="menuitem" onClick={close} className="block text-[12.5px] font-medium leading-snug text-slate-700 transition hover:text-brand-600">{a.title}</Link></li>)}
          </ul>
        </div>
      )}
      {cats.length > 0 && (
        <div className={latest.length ? "mt-4" : ""} data-articles-topics>
          <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Topics</p>
          <div className="mt-1.5 grid grid-cols-2 gap-x-6 gap-y-2">
            {cats.map((c) => <Link key={c.id || c.slug} to={`/articles/${c.slug}`} role="menuitem" onClick={close} className="py-0.5 text-[12.5px] text-slate-600 transition hover:text-brand-600">{c.name}</Link>)}
          </div>
        </div>
      )}
    </div>
  );
}

export default function PublicHeader({ onTryIt = null }) {
  const navigate = useNavigate();
  const authToken = useAuthStore((s) => s.token);
  const [menu, setMenu] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { cats, latest } = useArticles();
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  const tryIt = () => (onTryIt ? onTryIt() : navigate("/#hero"));

  return (
    <>
      <nav aria-label="Main" data-public-header data-scrolled={scrolled}
        className={`fixed left-0 right-0 top-0 z-50 border-b transition-colors duration-200 ${scrolled ? "border-slate-200 bg-white/85 shadow-sm backdrop-blur-md" : "border-transparent bg-white/95 backdrop-blur"}`}>
        <div className={`m-nav-inner mx-auto flex max-w-[1600px] items-center px-4 sm:px-6 ${scrolled ? "py-2" : "py-3"}`}>
          <Link to="/" className="mr-6 shrink-0" aria-label="EnterprateAI home"><img src={logoUrl} alt="EnterprateAI" className="h-7 w-auto sm:h-8" /></Link>
          <ul className="hidden flex-1 items-center justify-center gap-3 xl:flex xl:gap-4">
            {visibleNav().map((item) => (item.menu === "features"
              ? <NavMenu key={item.key} label={item.label} to={item.to} wide>{(close) => <FeaturesPanel close={close} />}</NavMenu>
              : item.menu === "articles"
                ? <NavMenu key={item.key} label={item.label} to={item.to}>{(close) => <ArticlesPanel close={close} cats={cats} latest={latest} />}</NavMenu>
                : <li key={item.key}><Link to={item.to} className={linkCls} {...(item.key === "marketplace" ? { "data-nav-marketplace": true } : {})}>{item.label}</Link></li>))}
          </ul>
          <div className="ml-auto flex shrink-0 items-center gap-3 xl:ml-6" data-nav-right>
            <Link to={authToken ? "/dashboard" : "/login"} data-nav-account className="hidden whitespace-nowrap text-sm font-medium text-slate-600 hover:text-slate-900 xl:block">{authToken ? "Dashboard" : "Sign in"}</Link>
            <Link to="/book-demo" className="hidden whitespace-nowrap rounded-xl border border-brand-600 px-4 py-2 text-sm font-semibold text-brand-600 transition hover:bg-brand-50 xl:block">Book a Demo</Link>
            <button type="button" onClick={tryIt} data-try-agent className="hidden whitespace-nowrap rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 xl:block">Try it</button>
            <button type="button" onClick={() => setMenu((v) => !v)} aria-expanded={menu} aria-controls="public-menu" aria-label="Menu" className="ml-1 flex h-9 w-9 flex-col items-center justify-center gap-1.5 xl:hidden">
              <span className={`block h-0.5 w-5 bg-slate-700 transition-all ${menu ? "translate-y-2 rotate-45" : ""}`} />
              <span className={`block h-0.5 w-5 bg-slate-700 transition-all ${menu ? "opacity-0" : ""}`} />
              <span className={`block h-0.5 w-5 bg-slate-700 transition-all ${menu ? "-translate-y-2 -rotate-45" : ""}`} />
            </button>
          </div>
        </div>
        {menu && (
          // On a phone and a tablet: every page, and the Features and Articles menus as sections inside the menu.
          <div id="public-menu" className="max-h-[calc(100dvh-60px)] overflow-y-auto border-t border-slate-100 bg-white px-4 pb-4 xl:hidden" data-mobile-menu>
            <ul className="mt-3 flex flex-col gap-3">
              {visibleNav().map((item) => (
                <li key={item.key}>
                  {item.menu && (item.menu === "features" || cats.length > 0 || latest.length > 0) ? (
                    <details>
                      <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium text-slate-700">
                        <Link to={item.to} onClick={() => setMenu(false)}>{item.label}</Link>
                        <span aria-hidden="true" className="text-slate-400">▾</span>
                      </summary>
                      <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 pl-2">
                        {item.menu === "features"
                          ? FEATURE_GROUPS.flatMap((g) => g.items).map((f) => <li key={f.slug}><Link to={`/features/${f.slug}`} onClick={() => setMenu(false)} className="block py-0.5 text-xs text-slate-600">{f.label}</Link></li>)
                          : [...latest.map((a) => <li key={"a:" + (a.id || a.slug)} className="col-span-2"><Link to={`/blog/${a.slug}`} onClick={() => setMenu(false)} className="block py-0.5 text-xs font-medium text-slate-700">{a.title}</Link></li>),
                            ...cats.map((c) => <li key={c.id || c.slug}><Link to={`/articles/${c.slug}`} onClick={() => setMenu(false)} className="block py-0.5 text-xs text-slate-600">{c.name}</Link></li>)]}
                      </ul>
                    </details>
                  ) : <Link to={item.to} onClick={() => setMenu(false)} className="block text-sm font-medium text-slate-700">{item.label}</Link>}
                </li>
              ))}
              <li><Link to={authToken ? "/dashboard" : "/login"} className="block text-sm font-medium text-slate-700">{authToken ? "Dashboard" : "Sign in"}</Link></li>
              <li><Link to="/book-demo" onClick={() => setMenu(false)} className="block rounded-lg bg-brand-600 px-3 py-2 text-center text-sm font-semibold text-white">Book a Demo</Link></li>
            </ul>
          </div>
        )}
      </nav>
      <div className="h-[61px]" aria-hidden="true" />
    </>
  );
}
