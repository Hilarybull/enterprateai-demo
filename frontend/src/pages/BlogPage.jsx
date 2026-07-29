import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiRequest } from "../api/client";
import logoUrl from "../enterprate-logo.png";

function fmt(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

export default function BlogPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeCategory = searchParams.get("category") || "";
  const activeTag = searchParams.get("tag") || "";

  const [articles, setArticles] = useState([]);
  const [categories, setCategories] = useState([]);
  const [tags, setTags] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.body.style.overflow = "auto";
    return () => { document.body.style.overflow = ""; };
  }, []);

  useEffect(() => {
    Promise.all([
      apiRequest("/blog/categories", "GET"),
      apiRequest("/blog/tags", "GET"),
    ]).then(([cats, tgs]) => {
      setCategories(cats || []);
      setTags(tgs || []);
    });
  }, []);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (activeCategory) params.set("category", activeCategory);
    if (activeTag) params.set("tag", activeTag);
    apiRequest(`/blog/articles?${params.toString()}`, "GET")
      .then((data) => setArticles(data || []))
      .finally(() => setLoading(false));
  }, [activeCategory, activeTag]);

  function setFilter(key, value) {
    const next = new URLSearchParams();
    if (value) next.set(key, value);
    setSearchParams(next);
  }

  return (
    <div className="min-h-screen bg-white font-sans text-slate-800 antialiased">
      {/* Minimal nav */}
      <nav className="sticky top-0 z-50 border-b border-slate-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <Link to="/"><img src={logoUrl} alt="EnterprateAI" className="h-7 w-auto" /></Link>
          <div className="flex items-center gap-4">
            <Link to="/" className="text-sm font-medium text-slate-500 hover:text-slate-900">← Home</Link>
            <Link to="/login" className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 transition">Get Started Free</Link>
          </div>
        </div>
      </nav>

      {/* Header */}
      <div className="bg-gradient-to-br from-brand-900 via-brand-700 to-brand-800 py-14 text-white">
        <div className="mx-auto max-w-4xl px-4 text-center sm:px-6">
          <p className="text-xs font-bold uppercase tracking-widest text-white/60">Articles & Insights</p>
          <h1 className="mt-3 text-3xl font-extrabold sm:text-4xl">Business Intelligence Hub</h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-white/80">
            Practical guides, strategies, and insights to help small businesses plan better, operate smarter, and grow with confidence.
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        {/* Filters */}
        <div className="mb-8 flex flex-wrap items-center gap-2">
          <button
            onClick={() => setSearchParams({})}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${!activeCategory && !activeTag ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
          >
            All
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setFilter("category", activeCategory === c.slug ? "" : c.slug)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${activeCategory === c.slug ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
            >
              {c.name}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
          </div>
        ) : articles.length === 0 ? (
          <div className="py-24 text-center">
            <p className="text-4xl">📝</p>
            <p className="mt-3 font-semibold text-slate-700">No articles yet</p>
            <p className="mt-1 text-sm text-slate-400">Check back soon for business insights and guides.</p>
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {articles.map((a) => (
              <Link
                key={a.id}
                to={`/blog/${a.slug}`}
                className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md"
              >
                {a.cover_image_url ? (
                  <img src={a.cover_image_url} alt={a.title} className="h-48 w-full object-cover" />
                ) : (
                  <div className="flex h-48 w-full items-center justify-center bg-gradient-to-br from-brand-50 to-brand-100">
                    <span className="text-4xl text-brand-300">📄</span>
                  </div>
                )}
                <div className="flex flex-1 flex-col p-5">
                  {a.category_name && (
                    <span className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-brand-600">{a.category_name}</span>
                  )}
                  <h3 className="font-bold text-slate-900 group-hover:text-brand-600 transition line-clamp-2 text-sm">{a.title}</h3>
                  {a.excerpt && <p className="mt-1.5 flex-1 text-xs leading-relaxed text-slate-500 line-clamp-3">{a.excerpt}</p>}
                  <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-400">
                    <span>{a.author_name}</span>
                    <span>·</span>
                    <span>{fmt(a.published_at)}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* Tags cloud */}
        {tags.length > 0 && (
          <div className="mt-12 border-t border-slate-100 pt-8">
            <p className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-400">Browse by Topic</p>
            <div className="flex flex-wrap gap-2">
              {tags.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setFilter("tag", activeTag === t.slug ? "" : t.slug)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition ${activeTag === t.slug ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-brand-50 hover:text-brand-600"}`}
                >
                  #{t.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer CTA */}
      <div className="border-t border-slate-100 bg-brand-50 py-14 text-center">
        <h2 className="text-xl font-bold text-slate-900">Ready to run your business smarter?</h2>
        <p className="mt-2 text-sm text-slate-500">Start free. No credit card required.</p>
        <Link to="/login" className="mt-5 inline-block rounded-xl bg-brand-600 px-8 py-3 text-sm font-semibold text-white hover:bg-brand-700 transition">
          Create My Free Business Workspace →
        </Link>
      </div>
    </div>
  );
}
