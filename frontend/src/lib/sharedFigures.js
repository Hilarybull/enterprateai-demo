// The one set of figures (R-4, the owner's brief, 24 Oct): Simulation starts from what the risk check and the dashboard
// show (GET /businesses/:id/figures, agent/figures.py on the server): the biggest customer and their share, the cash, the
// monthly revenue, and the owner's own monthly costs when they gave them. Anything those figures don't hold stays as
// Simulation worked it out.

/** Simulation's snapshot and largest client, with the shared figures in place. `wanted`: the customer a what-if was opened for. */
export function withSharedFigures(insights, shared, wanted = "") {
  const snapshot = insights?.stateSnapshot || null;
  const own = insights?.largestClient || null;
  if (!shared || !snapshot) return { stateSnapshot: snapshot, largestClient: own };
  const next = { ...snapshot };
  if (typeof shared.revenue_monthly === "number") next.revenue_monthly = shared.revenue_monthly;
  if (typeof shared.cash === "number") next.starting_cash = shared.cash;
  if (typeof shared.top_share === "number") next.top_client_share_pct = shared.top_share;
  if (shared.clients) next.clients_count = shared.clients;
  // Monthly costs as the risk check reads them (the owner's own, else recorded expenses); cost of sales stays its own
  if (typeof shared.costs_monthly === "number" && shared.costs_monthly > 0) {
    next.expenses_monthly = shared.costs_monthly;
    next.costs_monthly = Number((shared.costs_monthly + (snapshot.cost_of_sales_monthly || 0)).toFixed(2));
  }
  const customers = Array.isArray(shared.customers) ? shared.customers : [];
  const name = String(wanted || "").trim().toLowerCase();
  const pick = (name && customers.find((c) => String(c.name).toLowerCase() === name)) || customers[0] || null;
  const largestClient = pick ? { ...(own || {}), id: own?.name === pick.name ? own.id : pick.name, name: pick.name, share: pick.share } : own;
  return { stateSnapshot: next, largestClient };
}
