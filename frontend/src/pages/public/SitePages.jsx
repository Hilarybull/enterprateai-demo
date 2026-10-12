import { Link, Navigate, useParams } from "react-router-dom";
import PublicPage, { CtaRow } from "../../components/public/PublicPage";
import TestimonialCards from "../../components/public/TestimonialCards";
import { shownTestimonials } from "../../content/testimonials";
import { AGENT_FEATURE, FEATURE_GROUPS, featureBySlug, groupBySlug } from "../../lib/publicSite";
import { featureDetail } from "../../content/featureDetails";

// The public pages behind the top navigation (QA F). Their words come from what the product does today and the
// homepage's own sections, expanded. Nothing public is a placeholder: a section with nothing real to show is left out.

function FeatureCard({ f }) {
  return (
    <Link to={`/features/${f.slug}`} className="block rounded-2xl border border-slate-200 p-5 transition hover:border-brand-300 hover:shadow-sm" data-feature-card>
      <h3 className="text-base font-bold text-slate-900">{f.label}</h3>
      <p className="mt-1 text-sm leading-relaxed text-slate-600">{f.summary}</p>
    </Link>
  );
}

export function FeaturesPage() {
  return (
    <PublicPage title="Features" eyebrow="EnterprateAI" description="Every EnterprateAI feature: the Agent, planning and documents, everyday operations, the Marketplace and decision intelligence."
      intro="One workspace to plan, operate, sell and grow, with an Agent that does the work and waits for your approval.">
      <section aria-labelledby="agent" className="rounded-2xl bg-gradient-to-br from-[#1e1b4b] to-[#4c1d95] p-6 text-white">
        <h2 id="agent" className="text-xl font-bold">{AGENT_FEATURE.label}</h2>
        <p className="mt-1 text-white/80">{AGENT_FEATURE.summary}</p>
        <Link to="/features/agent" className="mt-3 inline-block text-sm font-semibold underline">How the Agent works</Link>
      </section>
      {FEATURE_GROUPS.map((g) => (
        <section key={g.slug} aria-labelledby={g.slug} className="mt-10">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id={g.slug} className="text-xl font-bold text-slate-900">{g.heading}</h2>
            <Link to={`/features/${g.slug}`} className="text-sm font-semibold text-brand-700 hover:underline">About {g.heading}</Link>
          </div>
          <p className="mt-1 text-sm text-slate-600">{g.desc}</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{g.items.map((f) => <FeatureCard key={f.slug} f={f} />)}</div>
        </section>
      ))}
      <CtaRow />
    </PublicPage>
  );
}

/** /features/:slug: one feature, or one group of features. */
export function FeaturePage() {
  const { slug } = useParams();
  const group = groupBySlug(slug);
  if (group) {
    return (
      <PublicPage title={group.heading} eyebrow="Features" description={group.desc} intro={group.desc}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{group.items.map((f) => <FeatureCard key={f.slug} f={f} />)}</div>
        <CtaRow />
      </PublicPage>
    );
  }
  const f = featureBySlug(slug);
  if (!f) return <NotFound />;
  const d = featureDetail(f);
  return (
    <PublicPage title={f.label} eyebrow={f.group ? f.group.heading : "Features"} description={f.summary} intro={f.summary}>
      {/* QA U6: what it does, who it is for, how it works, what is free and what is paid, a picture, and the way in. */}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start">
        <div className="min-w-0 space-y-8">
          <section aria-labelledby="what" data-feature-what>
            <h2 id="what" className="text-xl font-bold text-slate-900">What it does</h2>
            <ul className="mt-3 max-w-2xl space-y-2">
              {f.points.map((p) => <li key={p} className="flex gap-2 text-slate-700"><span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />{p}</li>)}
            </ul>
          </section>
          {d.who && (
            <section aria-labelledby="who" data-feature-who>
              <h2 id="who" className="text-xl font-bold text-slate-900">Who it's for</h2>
              <p className="mt-2 max-w-2xl text-slate-700">{d.who}</p>
            </section>
          )}
        </div>
        <FeaturePicture image={d.image} steps={d.steps} label={f.label} />
      </div>
      {d.steps.length > 0 && (
        <section aria-labelledby="how" className="mt-10" data-feature-how>
          <h2 id="how" className="text-xl font-bold text-slate-900">How it works</h2>
          <ol className="mt-4 grid gap-4 md:grid-cols-3">
            {d.steps.map((s, i) => (
              <li key={s.title} className="rounded-2xl border border-slate-200 p-5">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">{i + 1}</span>
                <h3 className="mt-3 text-base font-bold text-slate-900">{s.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-slate-600">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>
      )}
      {d.access.rows.length > 0 && (
        <section aria-labelledby="plans" className="mt-10 max-w-3xl" data-feature-access>
          <h2 id="plans" className="text-xl font-bold text-slate-900">Free and paid</h2>
          <dl className="mt-3 divide-y divide-slate-100 rounded-2xl border border-slate-200">
            {d.access.rows.map((r) => (
              <div key={r.plan + r.text} className="grid gap-1 px-4 py-3 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
                <dt className="text-sm font-semibold text-slate-900">{r.plan}</dt>
                <dd className="text-sm text-slate-700">{r.text}</dd>
              </div>
            ))}
          </dl>
          {d.access.notes.map((n) => <p key={n} className="mt-2 text-sm text-slate-500">{n}</p>)}
        </section>
      )}
      <div className="mt-10 flex flex-wrap gap-3" data-feature-cta>
        <Link to={f.app} className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700">Open {f.label}</Link>
        <Link to="/pricing" className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">See pricing</Link>
        {f.group && <Link to={`/features/${f.group.slug}`} className="rounded-xl px-5 py-2.5 text-sm font-semibold text-brand-700 hover:underline">More in {f.group.heading}</Link>}
        <Link to="/features" className="rounded-xl px-5 py-2.5 text-sm font-semibold text-brand-700 hover:underline">All features</Link>
      </div>
    </PublicPage>
  );
}

/** The feature's picture: one the homepage already uses for its group, or the three steps drawn as a card. Never an empty frame. */
function FeaturePicture({ image, steps, label }) {
  if (image) {
    return (
      <figure className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50" data-feature-picture>
        <img src={image.src} alt={image.alt} loading="lazy" className="aspect-[4/3] h-auto w-full max-w-full object-cover" />
      </figure>
    );
  }
  return (
    <figure aria-label={`${label}, in three steps`} className="rounded-2xl bg-gradient-to-br from-[#1e1b4b] to-[#4c1d95] p-5 text-white" data-feature-picture>
      <ol className="space-y-3">
        {steps.map((s, i) => (
          <li key={s.title} className="flex items-center gap-3 rounded-xl bg-white/10 px-3 py-2.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-xs font-bold text-[#4c1d95]">{i + 1}</span>
            <span className="text-sm font-semibold">{s.title}</span>
          </li>
        ))}
      </ol>
    </figure>
  );
}

const STEPS = [
  { title: "Tell it the job", body: "Say what you need in your own words: an invoice, a quotation, a plan, or a question about your business." },
  { title: "It does the work", body: "It reads your records, asks only for what is missing, and prepares the document or the answer." },
  { title: "You approve", body: "It waits for your say-so. Nothing is sent, and nothing leaves your business, until you approve it." },
];

export function HowItWorksPage() {
  return (
    <PublicPage title="How it works" eyebrow="Three simple steps" description="How EnterprateAI works: tell the Agent the job, it prepares the work from your records, and nothing is sent until you approve it."
      intro="The Agent works from what your workspace already holds, so it asks only for what is missing.">
      <ol className="grid gap-4 md:grid-cols-3">
        {STEPS.map((s, i) => (
          <li key={s.title} className="rounded-2xl border border-slate-200 p-5">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">{i + 1}</span>
            <h2 className="mt-3 text-lg font-bold text-slate-900">{s.title}</h2>
            <p className="mt-1 text-sm leading-relaxed text-slate-600">{s.body}</p>
          </li>
        ))}
      </ol>
      <section className="mt-10 max-w-3xl">
        <h2 className="text-xl font-bold text-slate-900">What stays in your hands</h2>
        <ul className="mt-3 space-y-2 text-slate-700">
          <li>Every document the Agent prepares waits in Needs Approval until you approve it.</li>
          <li>Prices come from your catalogue or from what you type: the Agent never invents one.</li>
          <li>AI Credits are used only for work the Agent does, and the cost is shown before it starts.</li>
        </ul>
      </section>
      <CtaRow />
    </PublicPage>
  );
}

export function UseCasesPage() {
  return (
    <PublicPage title="Use cases" eyebrow="Built for ambitious founders and business owners" description="How startups and small businesses use EnterprateAI to plan, operate, sell and grow."
      intro="From the first idea to a growing business, the same workspace follows you.">
      <div className="grid gap-6 md:grid-cols-2">
        <section id="startups" className="scroll-mt-24 rounded-2xl border border-slate-200 p-6">
          <h2 className="text-xl font-bold text-slate-900">For startups</h2>
          <p className="mt-2 text-slate-600">Validate your idea, create your business plan, prepare for funding and start building with confidence.</p>
          <ul className="mt-3 space-y-1 text-sm">
            {["idea-validation", "business-plan"].map((s) => <li key={s}><Link to={`/features/${s}`} className="font-semibold text-brand-700 hover:underline">{featureBySlug(s).label}</Link></li>)}
          </ul>
        </section>
        <section id="small-businesses" className="scroll-mt-24 rounded-2xl border border-slate-200 p-6">
          <h2 className="text-xl font-bold text-slate-900">For small businesses</h2>
          <p className="mt-2 text-slate-600">Manage your business while using your data to understand risks, test decisions and identify opportunities for growth.</p>
          <ul className="mt-3 space-y-1 text-sm">
            {["business-essentials", "scenario-simulation", "marketplace"].map((s) => <li key={s}><Link to={`/features/${s}`} className="font-semibold text-brand-700 hover:underline">{featureBySlug(s).label}</Link></li>)}
          </ul>
        </section>
      </div>
      <TestimonialCards className="mt-8" compact />
      <CtaRow />
    </PublicPage>
  );
}

export function TestimonialsPage() {
  const any = shownTestimonials().length > 0;
  return (
    <PublicPage title="Testimonials" eyebrow="Customer stories" description="What small businesses say about running their business with EnterprateAI."
      intro="In their own words, published with their permission." noindex={!any}>
      {any ? <TestimonialCards /> : <p className="text-slate-600">Customer stories will appear here once customers have agreed to share them.</p>}
      <CtaRow />
    </PublicPage>
  );
}

/** /articles is the Business Intelligence Hub (the blog); /articles/:slug is a topic, or an article. */
export function ArticlesRedirect() {
  const { slug } = useParams();
  if (!slug) return <Navigate to="/blog" replace />;
  return <Navigate to={`/blog?category=${encodeURIComponent(slug)}`} replace />;
}

export function NotFound() {
  return (
    <PublicPage title="Page not found" description="The page you're looking for doesn't exist." intro="The page you're looking for doesn't exist, or it has moved.">
      <nav aria-label="Where to go instead" className="flex flex-wrap gap-3" data-not-found>
        <Link to="/" className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700">Back to the homepage</Link>
        <Link to="/features" className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Features</Link>
        <Link to="/pricing" className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Pricing</Link>
        <Link to="/articles" className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Articles</Link>
      </nav>
    </PublicPage>
  );
}
