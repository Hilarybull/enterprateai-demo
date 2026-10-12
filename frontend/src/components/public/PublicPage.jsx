import { useEffect } from "react";
import { Link } from "react-router-dom";
import PublicHeader from "./PublicHeader";
import PublicFooter from "./PublicFooter";

/** Sets the page's title and meta description, and puts back what was there when the page is left. */
export function useMeta(title, description, noindex = false) {
  useEffect(() => {
    let robots = null;
    if (noindex) {      // kept out of search engines while a page has nothing real to show
      robots = document.createElement("meta");
      robots.setAttribute("name", "robots");
      robots.setAttribute("content", "noindex");
      document.head.appendChild(robots);
    }
    const before = document.title;
    let tag = document.head.querySelector('meta[name="description"]');
    const made = !tag;
    if (!tag) { tag = document.createElement("meta"); tag.setAttribute("name", "description"); document.head.appendChild(tag); }
    const was = tag.getAttribute("content");
    document.title = title;
    tag.setAttribute("content", description);
    return () => {
      robots?.remove();
      document.title = before;
      if (made) tag.remove(); else tag.setAttribute("content", was || "");
    };
  }, [title, description, noindex]);
}

/** Every public page (QA F): the site's header and footer, one h1, its own title and description, and no sideways scroll. */
export default function PublicPage({ title, metaTitle, description, eyebrow = null, intro = null, noindex = false, children }) {
  useMeta(metaTitle || `${title} · EnterprateAI`, description, noindex);
  return (
    <div className="min-h-screen overflow-x-clip bg-white" data-public-page>
      <PublicHeader />
      <main className="mx-auto max-w-[1200px] px-4 pb-16 pt-8 sm:px-6 sm:pt-12">
        <header className="max-w-3xl">
          {eyebrow && <p className="text-xs font-bold uppercase tracking-widest text-brand-600">{eyebrow}</p>}
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">{title}</h1>
          {intro && <p className="mt-3 text-base leading-relaxed text-slate-600 sm:text-lg">{intro}</p>}
        </header>
        <div className="mt-8">{children}</div>
      </main>
      <PublicFooter />
    </div>
  );
}

/** A clearly marked place where real content is still to come: never made-up quotes or figures. */
export function Placeholder({ children }) {
  return (
    <div role="note" data-placeholder className="rounded-2xl border-2 border-dashed border-amber-300 bg-amber-50 p-5 text-sm text-amber-900">
      <p className="text-[11px] font-bold uppercase tracking-widest text-amber-700">Placeholder: real content needed</p>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

export function CtaRow() {
  return (
    <div className="mt-10 flex flex-wrap gap-3">
      <Link to="/#hero" className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700">Try the Agent</Link>
      <Link to="/pricing" className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">See pricing</Link>
    </div>
  );
}
