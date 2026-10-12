import { shownTestimonials, TESTIMONIALS } from "../../content/testimonials";

// Customer testimonials, from the one content file. Only entries with consent recorded and still active are shown.
// Quote, name, company and location (when given) only: no addresses, photos, ratings or logos.
export default function TestimonialCards({ list = TESTIMONIALS, compact = false, className = "" }) {
  const shown = shownTestimonials(list);
  if (!shown.length) return null;
  return (
    <ul className={`grid gap-4 md:grid-cols-2 ${className}`} data-testimonials>
      {shown.map((t) => (
        <li key={t.id} className="flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6" data-testimonial={t.id}>
          <figure className="flex h-full flex-col">
            <span aria-hidden="true" className="text-3xl font-black leading-none text-brand-300">&ldquo;</span>
            <blockquote className={`mt-1 flex-1 break-words leading-relaxed text-slate-700 ${compact ? "text-sm" : "text-base"}`}>{t.quote}</blockquote>
            <figcaption className="mt-4 border-t border-slate-100 pt-3">
              <span className="block text-sm font-bold text-slate-900">{t.name}</span>
              <span className="block break-words text-[13px] text-slate-500">
                {t.company}{t.location ? <span data-location>{` · ${t.location}`}</span> : null}
              </span>
            </figcaption>
          </figure>
        </li>
      ))}
    </ul>
  );
}
