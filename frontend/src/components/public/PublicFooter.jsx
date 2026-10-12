import { Link } from "react-router-dom";
import logoUrl from "../../enterprate-logo.png";
import { FOOTER } from "../../lib/publicSite";

// The public site's footer (QA F), the same everywhere. Its links are the site map's routes.
export default function PublicFooter() {
  return (
    <footer className="border-t border-slate-100 bg-white py-8" data-public-footer>
      <div className="mx-auto max-w-[1600px] px-4 sm:px-6">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="grid flex-1 gap-8 sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <img src={logoUrl} alt="EnterprateAI" className="h-7 w-auto" />
              <p className="mt-3 max-w-[220px] text-sm leading-relaxed text-slate-500">AI-native Business Decision Intelligence for ambitious founders and businesses.</p>
            </div>
            {FOOTER.map((col) => (
              <div key={col.heading}>
                <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400">{col.heading}</h4>
                <ul className="mt-4 space-y-2">
                  {col.links.map((l) => (
                    <li key={l.label}>
                      {l.href ? <a href={l.href} className="text-sm text-slate-500 transition hover:text-brand-600">{l.label}</a>
                        : <Link to={l.to} className="text-sm text-slate-500 transition hover:text-brand-600">{l.label}</Link>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="shrink-0 text-xs text-slate-400 lg:pb-1">© {new Date().getFullYear()} EnterprateAI. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
