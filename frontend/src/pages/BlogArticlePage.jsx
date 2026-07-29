import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiRequest } from "../api/client";
import logoUrl from "../enterprate-logo.png";

function fmt(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

export default function BlogArticlePage() {
  const { slug } = useParams();
  const [article, setArticle] = useState(null);
  const [related, setRelated] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    document.body.style.overflow = "auto";
    return () => { document.body.style.overflow = ""; };
  }, []);

  useEffect(() => {
    setLoading(true);
    setNotFound(false);
    setRelated([]);
    apiRequest(`/blog/articles/${slug}`, "GET")
      .then((data) => {
        if (!data || data.detail) { setNotFound(true); return; }
        setArticle(data);
        const params = new URLSearchParams({ limit: 4 });
        if (data.category?.slug) params.set("category", data.category.slug);
        return apiRequest(`/blog/articles?${params}`, "GET");
      })
      .then((others) => {
        if (Array.isArray(others)) setRelated(others.filter((a) => a.slug !== slug).slice(0, 3));
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [slug]);

  return (
    <div className="min-h-screen bg-white font-sans text-slate-800 antialiased">
      {/* Minimal nav */}
      <nav className="sticky top-0 z-50 border-b border-slate-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <Link to="/"><img src={logoUrl} alt="EnterprateAI" className="h-7 w-auto" /></Link>
          <div className="flex items-center gap-4">
            <Link to="/blog" className="text-sm font-medium text-slate-500 hover:text-slate-900">← Articles</Link>
            <Link to="/login" className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 transition">Get Started Free</Link>
          </div>
        </div>
      </nav>

      {loading && (
        <div className="flex justify-center py-32">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
        </div>
      )}

      {notFound && !loading && (
        <div className="py-32 text-center">
          <p className="text-5xl">🔍</p>
          <h1 className="mt-4 text-2xl font-bold text-slate-900">Article not found</h1>
          <p className="mt-2 text-sm text-slate-500">It may have been removed or the link is incorrect.</p>
          <Link to="/blog" className="mt-5 inline-block text-sm font-semibold text-brand-600 hover:underline">← Back to Articles</Link>
        </div>
      )}

      {article && !loading && (
        <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
          {/* Breadcrumb */}
          <nav className="mb-6 flex items-center gap-2 text-xs text-slate-400">
            <Link to="/blog" className="hover:text-brand-600">Articles</Link>
            {article.category && (
              <>
                <span>/</span>
                <Link to={`/blog?category=${article.category.slug}`} className="hover:text-brand-600">{article.category.name}</Link>
              </>
            )}
          </nav>

          {/* Meta */}
          {article.category && (
            <span className="mb-3 inline-block rounded-full bg-brand-50 px-3 py-1 text-xs font-bold uppercase tracking-wider text-brand-600">
              {article.category.name}
            </span>
          )}
          <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-slate-900 sm:text-4xl">{article.title}</h1>
          {article.excerpt && (
            <p className="mt-3 text-lg leading-relaxed text-slate-500">{article.excerpt}</p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-slate-400">
            <span>{article.author_name}</span>
            <span>·</span>
            <span>{fmt(article.published_at)}</span>
          </div>

          {/* Cover image */}
          {article.cover_image_url && (
            <img
              src={article.cover_image_url}
              alt={article.title}
              className="mt-8 w-full rounded-2xl object-cover shadow-sm"
              style={{ maxHeight: 420 }}
            />
          )}

          {/* Content */}
          <div
            className="mt-10 max-w-none text-slate-700 leading-relaxed [&_h1]:text-3xl [&_h1]:font-bold [&_h1]:text-slate-900 [&_h1]:mt-8 [&_h1]:mb-4 [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:text-slate-900 [&_h2]:mt-8 [&_h2]:mb-4 [&_h3]:text-xl [&_h3]:font-bold [&_h3]:text-slate-900 [&_h3]:mt-6 [&_h3]:mb-3 [&_p]:mb-5 [&_p]:text-base [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:mb-5 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:mb-5 [&_li]:mb-2 [&_a]:text-brand-600 [&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:border-brand-200 [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-slate-500 [&_blockquote]:my-6 [&_img]:rounded-xl [&_img]:max-w-full [&_img]:my-6 [&_code]:bg-slate-100 [&_code]:rounded [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-sm [&_pre]:bg-slate-900 [&_pre]:text-slate-100 [&_pre]:rounded-xl [&_pre]:p-4 [&_pre]:overflow-x-auto [&_pre]:my-6 [&_strong]:font-semibold [&_strong]:text-slate-900"
            dangerouslySetInnerHTML={{ __html: article.content || "<p>No content yet.</p>" }}
          />

          {/* Tags */}
          {article.tags && article.tags.length > 0 && (
            <div className="mt-10 flex flex-wrap gap-2 border-t border-slate-100 pt-6">
              {article.tags.map((t) => (
                <Link
                  key={t.id}
                  to={`/blog?tag=${t.slug}`}
                  className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-brand-50 hover:text-brand-600 transition"
                >
                  #{t.name}
                </Link>
              ))}
            </div>
          )}

          {/* Related articles */}
          {related.length > 0 && (
            <div className="mt-14 border-t border-slate-100 pt-10">
              <h3 className="mb-6 text-lg font-bold text-slate-900">You might also like</h3>
              <div className="grid gap-5 sm:grid-cols-3">
                {related.map((a) => (
                  <Link
                    key={a.id}
                    to={`/blog/${a.slug}`}
                    className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md"
                  >
                    {a.cover_image_url ? (
                      <img src={a.cover_image_url} alt={a.title} className="h-36 w-full object-cover" />
                    ) : (
                      <div className="flex h-36 w-full items-center justify-center bg-gradient-to-br from-brand-50 to-brand-100">
                        <span className="text-3xl text-brand-300">📄</span>
                      </div>
                    )}
                    <div className="flex flex-1 flex-col p-4">
                      {a.category_name && (
                        <span className="mb-1 text-[10px] font-bold uppercase tracking-wider text-brand-600">{a.category_name}</span>
                      )}
                      <h4 className="text-sm font-bold text-slate-900 group-hover:text-brand-600 transition line-clamp-2">{a.title}</h4>
                      <p className="mt-2 text-[11px] text-slate-400">{fmt(a.published_at)}</p>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* CTA */}
          <div className="mt-12 rounded-2xl bg-gradient-to-br from-brand-900 to-brand-700 p-8 text-center text-white">
            <h3 className="text-xl font-bold">Put this into practice</h3>
            <p className="mt-2 text-sm text-white/80">EnterprateAI gives you the tools to act on what you've just learned.</p>
            <Link to="/login" className="mt-5 inline-block rounded-xl bg-white px-8 py-3 text-sm font-semibold text-brand-700 hover:bg-brand-50 transition">
              Create My Free Business Workspace →
            </Link>
          </div>
        </article>
      )}
    </div>
  );
}
