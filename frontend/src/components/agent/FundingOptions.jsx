export default function FundingOptions({ item }) {
  const routes = { loan: "Loans", grant: "Grants", equity: "Equity investment" };
  return <section aria-label="Funding options" className="w-full max-w-2xl space-y-3">
    <h3 className="text-base font-semibold text-slate-900">{item.title || "Funding options for your business"}</h3>
    {!!item.routes?.length && <p className="text-sm text-slate-500">{item.routes.map(route => routes[route] || route).join(" · ")}</p>}
    {!item.options?.length && <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">{item.message || "No funding options with a checked source were found for this case. Ask me to search again."}</p>}
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">{(item.options || []).map((option, i) => <article key={i} className="flex min-w-0 flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4">
      <span className="text-xs font-semibold text-brand-600">{routes[option.route] || "Funding option"}</span>
      <h4 className="break-words font-semibold text-slate-900">{option.title}</h4>
      {option.fit && <p className="text-xs font-medium text-slate-500">{option.fit} fit</p>}
      {option.text && <p className="break-words text-sm leading-6 text-slate-700">{option.text}</p>}
      {option.why && <p className="text-sm text-slate-500">{option.why}</p>}
      {/^https?:\/\//i.test(option.url || "") && <a href={option.url} target="_blank" rel="noopener noreferrer" className="mt-auto inline-flex min-h-11 items-center justify-center rounded-lg bg-brand-600 px-3 py-2 text-center text-sm font-semibold text-white">View funding source ↗</a>}
    </article>)}</div>
  </section>;
}
