import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiRequest } from "../api/client";
import logoUrl from "../enterprate-logo.png";

const TYPE_LABELS = {
  "Research": "Research",
  "White Paper": "White Paper",
  "Case Study": "Case Study",
  "Technical Deep-Dive": "Technical",
  "Product Update": "Product Update",
};

export default function ResearchPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.body.style.overflow = "auto";
    return () => { document.body.style.overflow = ""; };
  }, []);

  useEffect(() => {
    apiRequest("/research/items", "GET")
      .then((data) => setItems(Array.isArray(data) ? data : []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-white font-sans text-slate-800 antialiased">
      {/* Nav */}
      <nav className="sticky top-0 z-50 border-b border-slate-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <Link to="/"><img src={logoUrl} alt="EnterprateAI" className="h-7 w-auto" /></Link>
          <div className="flex items-center gap-4">
            <Link to="/" className="text-sm font-medium text-slate-500 hover:text-slate-900">← Home</Link>
            <Link to="/login" className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 transition">Get Started Free</Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <div className="bg-gradient-to-br from-brand-900 via-brand-700 to-brand-800 py-14 text-white">
        <div className="mx-auto max-w-4xl px-4 text-center sm:px-6">
          <p className="text-xs font-bold uppercase tracking-widest text-white/60">Research &amp; Development</p>
          <h1 className="mt-3 text-3xl font-extrabold sm:text-4xl">Innovation at the core of EnterprateAI</h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-white/80">
            White papers, research notes, technical deep-dives, and product development updates from the EnterprateAI team.
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
        {loading && (
          <div className="flex justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
          </div>
        )}

        {!loading && items.length === 0 && (
          <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center">
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50">
              <svg className="h-7 w-7 text-brand-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </div>
            <h2 className="text-base font-bold text-slate-900">Research coming soon</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-500">
              Our R&amp;D hub is being built. Check back soon for white papers, technical deep-dives, and updates on our AI models.
            </p>
            <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <Link to="/blog" className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 transition">Read our Articles</Link>
              <Link to="/" className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition">Back to Home</Link>
            </div>
          </div>
        )}

        {!loading && items.length > 0 && (
          <div className="grid gap-5 sm:grid-cols-2">
            {items.map((item) => (
              <div key={item.id} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="mb-3 flex items-center gap-2">
                  <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-brand-600">
                    {TYPE_LABELS[item.type] || item.type}
                  </span>
                </div>
                <h3 className="font-bold text-slate-900 leading-snug">{item.title}</h3>
                {item.description && (
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-500">{item.description}</p>
                )}
                {item.content && (
                  <details className="mt-4">
                    <summary className="cursor-pointer text-xs font-semibold text-brand-600 hover:underline select-none">Read more</summary>
                    <p className="mt-3 text-sm leading-relaxed text-slate-600 whitespace-pre-line">{item.content}</p>
                  </details>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer CTA */}
      <div className="border-t border-slate-100 bg-brand-50 py-14 text-center">
        <h2 className="text-xl font-bold text-slate-900">Ready to put intelligence to work?</h2>
        <p className="mt-2 text-sm text-slate-500">Start building a clearer, stronger business with EnterprateAI.</p>
        <Link to="/login" className="mt-6 inline-block rounded-xl bg-brand-600 px-8 py-3 text-sm font-semibold text-white hover:bg-brand-700 transition">
          Create My Free Business Workspace →
        </Link>
      </div>

      <footer className="border-t border-slate-100 bg-slate-50 py-8">
        <div className="mx-auto max-w-6xl px-4 text-center sm:px-6">
          <p className="text-xs text-slate-400">© {new Date().getFullYear()} Enterprate Limited. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
