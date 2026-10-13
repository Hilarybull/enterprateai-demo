// What the Agent cost to run (its model and web search calls) beside the credits it charged, for the superadmin.
const usd = (n, places = 4) => `$${Number(n || 0).toFixed(places)}`;
const num = (n) => Number(n || 0).toLocaleString();

export default function AgentSpend({ usage, compact = false }) {
  const agent = usage?.agent;
  if (!agent) return null;
  const days = usage.window_days;
  const tiles = [
    { label: "Agent cost (USD)", value: usd(agent.estimated_cost_usd) },
    { label: "Model calls", value: num(agent.calls), sub: usd(agent.model_cost_usd) },
    { label: "Web searches", value: num(agent.searches), sub: usd(agent.search_cost_usd) },
    { label: "Credits charged", value: num(agent.credits_charged), sub: `${num(agent.charges)} charges` },
  ];
  const empty = !agent.calls && !agent.searches && !agent.charges;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5" data-testid="agent-spend">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-800">Agent spending</h2>
        {days ? <span className="text-[11px] text-slate-400">Last {days} days{usage.complete === false ? ", partial" : ""}</span> : null}
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-3">
            <div className="text-xl font-bold tabular-nums text-slate-900">{t.value}</div>
            <div className="mt-0.5 text-[11px] font-semibold text-slate-500">{t.label}</div>
            {t.sub ? <div className="mt-0.5 text-[10px] tabular-nums text-slate-400">{t.sub}</div> : null}
          </div>
        ))}
      </div>
      {empty ? (
        <p className="text-xs text-slate-400">No Agent activity recorded in this window.</p>
      ) : !compact ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Table title="By Agent feature" first="Feature" rows={agent.by_feature} mono />
          <Table title="By person" first="Person" rows={(agent.by_user || []).map((u) => ({ ...u, label: u.email }))} />
        </div>
      ) : null}
      {!compact && (
        <p className="mt-3 text-[11px] text-slate-400">
          Cost is estimated from published model rates and the per search price set for the search provider. Credits are what customers were charged.
        </p>
      )}
    </section>
  );
}

function Table({ title, first, rows, mono }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold text-slate-700">{title}</h3>
      {(rows || []).length ? (
        <div className="divide-y divide-slate-50">
          <div className="flex items-center justify-between pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            <span>{first}</span>
            <span className="flex gap-5 pr-1">
              <span className="w-10 text-right">Calls</span>
              <span className="w-16 text-right">Cost</span>
              <span className="w-12 text-right">Credits</span>
            </span>
          </div>
          {rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-2 py-1.5 text-[12px]">
              <span className={`truncate text-slate-700 ${mono ? "font-mono text-[11px]" : ""}`}>{row.label}</span>
              <span className="flex shrink-0 gap-5 tabular-nums text-slate-500">
                <span className="w-10 text-right">{num(row.calls)}</span>
                <span className="w-16 text-right">{usd(row.estimated_cost_usd, 5)}</span>
                <span className="w-12 text-right">{num(row.credits)}</span>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-slate-400">Nothing yet.</p>
      )}
    </div>
  );
}
