import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest } from "../api/client";
import Badge from "../components/Badge";
import Button from "../components/Button";
import InlineAlert from "../components/InlineAlert";
import SectionCard from "../components/SectionCard";
import SegmentedTabs from "../components/SegmentedTabs";
import StatTile from "../components/StatTile";
import InfoTip from "../components/InfoTip";
import { useWorkspaceStore } from "../store/workspace";
import { formatCurrency, formatNumber, formatPercent } from "../lib/format";
import { buildActionPlan, dedupeText } from "../lib/insights";
import { pctWidth, shortExplanation, toneForScore } from "../lib/score";

function decisionBadge(status) {
  if (status === "accepted") return { text: "ACCEPTED", tone: "success" };
  if (status === "rejected") return { text: "REJECTED", tone: "danger" };
  return { text: "PENDING", tone: "slate" };
}

function riskCopy(classification) {
  if (classification === "STRONG") return { title: "Low Risk", subtitle: "Good baseline unit economics at current assumptions.", tone: "success" };
  if (classification === "PROMISING") return { title: "Moderate Risk", subtitle: "There are clear levers to improve viability.", tone: "warn" };
  if (classification === "RISKY") return { title: "High Risk", subtitle: "Address major risks before launch.", tone: "warn" };
  return { title: "High Failure Risk", subtitle: "Tighten assumptions and reduce costs before investing further.", tone: "danger" };
}

export default function ResultsPage() {
  const navigate = useNavigate();
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const setWorkspaceName = useWorkspaceStore((s) => s.setWorkspaceName);
  const setDecisionStatusStore = useWorkspaceStore((s) => s.setDecisionStatus);
  const validation = useWorkspaceStore((s) => s.validation);
  const currency = useWorkspaceStore((s) => s.currency);
  const ideaValidation = useWorkspaceStore((s) => s.ideaValidation);

  const [error, setError] = useState(null);
  const [decision, setDecision] = useState(null); // accepted | rejected | null
  const [decisionSaving, setDecisionSaving] = useState(false);
  const [decisionNotice, setDecisionNotice] = useState(null);
  const [sideTab, setSideTab] = useState("breakdown"); // breakdown | reasons | recommendations
  const [viewMode, setViewMode] = useState("simple"); // simple | detailed
  const [signalsTab, setSignalsTab] = useState("trend"); // trend | community
  const [marketFit, setMarketFit] = useState(null);
  const [mfLoading, setMfLoading] = useState(false);
  const [mfError, setMfError] = useState(null);

  useEffect(() => {
    async function loadDecision() {
      if (!workspaceId) return;
      try {
        const ws = await apiRequest(`/validation/${workspaceId}`, "GET");
        setWorkspaceName(ws?.name || null);
        const status = ws?.data?.decision?.status;
        if (status === "accepted" || status === "rejected") {
          setDecision(status);
          setDecisionStatusStore(status);
        } else {
          setDecision(null);
          setDecisionStatusStore(null);
        }
      } catch {
        // ignore
      }
    }
    loadDecision();
  }, [workspaceId, setDecisionStatusStore, setWorkspaceName]);

  const mfBusinessName = String(ideaValidation?.context?.business_name || "").trim();
  const mfPrimaryIndustry = String(ideaValidation?.context?.primary_industry || "").trim();
  const mfBusinessType = String(ideaValidation?.context?.business_type || "").trim();
  const mfOfferName = String(ideaValidation?.offer?.service_type || "").trim();

  const mfKeyword = useMemo(() => {
    const parts = [mfBusinessName, mfPrimaryIndustry || mfOfferName || mfBusinessType].filter(Boolean);
    return parts.join(" ").trim();
  }, [mfBusinessName, mfBusinessType, mfOfferName, mfPrimaryIndustry]);

  const fetchMarketFit = useCallback(async () => {
    if (!mfKeyword) return;
    setMfLoading(true);
    setMfError(null);
    try {
      const params = new URLSearchParams({
        keyword: mfKeyword,
        industry: mfPrimaryIndustry || mfBusinessType || mfOfferName || "general",
        location: String(ideaValidation?.context?.location || "London"),
        uk_region: String(ideaValidation?.context?.uk_region || "GB-ENG")
      });
      const data = await apiRequest(`/validation/market-fit?${params.toString()}`, "GET", null, { timeoutMs: 12000 });
      setMarketFit(data);
    } catch (e) {
      setMfError(e instanceof Error ? e.message : "Could not load market fit.");
    } finally {
      setMfLoading(false);
    }
  }, [ideaValidation, mfBusinessType, mfKeyword, mfOfferName, mfPrimaryIndustry]);

  useEffect(() => {
    if (!marketFit && !mfLoading && mfKeyword) fetchMarketFit();
  }, [fetchMarketFit, marketFit, mfKeyword, mfLoading]);

  async function setDecisionStatus(status) {
    if (!workspaceId) return;
    setDecisionSaving(true);
    setError(null);
    setDecisionNotice(null);
    try {
      await apiRequest(`/validation/${workspaceId}`, "PATCH", {
        data: { decision: { status, decided_at: new Date().toISOString() } }
      });
      setDecision(status);
      setDecisionStatusStore(status);
      setDecisionNotice(status === "accepted" ? "Validation accepted." : "Validation rejected.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save decision");
    } finally {
      setDecisionSaving(false);
    }
  }

  if (!validation) {
    return (
      <SectionCard title="No results yet" subtitle="Run Idea Validation to see results here.">
        <p className="text-sm text-slate-700">Go to Idea Validation and click "Create & Evaluate".</p>
      </SectionCard>
    );
  }

  const score = typeof validation.score === "number" ? validation.score : 0;
  const classification = String(validation.classification || "RISKY").toUpperCase();
  const risk = riskCopy(classification);

  const pathwayLabel =
    validation.pathway === "product_service_idea" ? "Product / service idea" : validation.pathway === "business_idea" ? "Business idea" : null;

  const m = validation.metrics ?? {};
  const revenue = typeof m.revenue_monthly === "number" ? m.revenue_monthly : null;
  const costs = typeof m.costs_monthly === "number" ? m.costs_monthly : null;
  const margin = typeof m.margin === "number" ? m.margin : null;
  const be = typeof m.break_even_months === "number" ? m.break_even_months : null;
  const runway = typeof m.runway_months === "number" ? m.runway_months : null;
  const net = typeof m.net_monthly === "number" ? m.net_monthly : null;
  const capacity = typeof m.capacity === "object" && m.capacity ? m.capacity : null;
  const utilization = typeof capacity?.utilization === "number" ? capacity.utilization : null;
  const burn = typeof revenue === "number" && typeof costs === "number" ? Math.max(0, costs - revenue) : null;
  const demandUnits = typeof capacity?.demand_units_per_month === "number" ? capacity.demand_units_per_month : null;
  const capacityUnits = typeof capacity?.capacity_units_per_month === "number" ? capacity.capacity_units_per_month : null;
  const shortfall = typeof capacity?.shortfall_units === "number" ? capacity.shortfall_units : null;

  const flags = Array.isArray(validation.flags) ? validation.flags : [];
  const dimensionScores = validation.dimension_scores && typeof validation.dimension_scores === "object" ? validation.dimension_scores : null;
  const businessName = String(ideaValidation?.context?.business_name || "").trim() || null;
  const primaryIndustry = String(ideaValidation?.context?.primary_industry || "").trim() || null;
  const businessType = String(ideaValidation?.context?.business_type || "").trim() || null;
  const offerName = String(ideaValidation?.offer?.service_type || "").trim() || null;

  const reasons = useMemo(() => dedupeText(validation.reasons), [validation.reasons]);
  const actionPlan = useMemo(() => buildActionPlan({ validation, ideaValidation, maxItems: 10 }), [ideaValidation, validation]);

  const keywordsToTrack = useMemo(() => {
    const out = [];
    if (businessName) out.push(businessName);
    if (primaryIndustry) out.push(primaryIndustry);
    if (offerName) out.push(offerName);
    if (!primaryIndustry && businessType) out.push(businessType);
    return dedupeText(out).slice(0, 6);
  }, [businessName, businessType, offerName, primaryIndustry]);

  const orderedDimensions = useMemo(() => {
    if (!dimensionScores) return [];
    const preferred = ["unit_economics", "break_even", "runway", "capacity", "market_fit", "cash_timing", "proof", "sales_cycle", "concentration"];
    const present = new Set(Object.keys(dimensionScores || {}));
    const base = preferred.filter((k) => present.has(k));
    const rest = Object.keys(dimensionScores || {}).filter((k) => !base.includes(k));
    return [...base, ...rest].slice(0, 6);
  }, [dimensionScores]);

  const validationExplanation =
    String(validation?.validation_explanation || "").trim() ||
    "Validation score is a weighted average of dimension scores (0-100): 30% Unit economics + 20% Break-even + 20% Runway + 20% Capacity + 10% Cash timing.";

  const DIMENSION_META = useMemo(
    () => ({
      runway: { label: "Runway", help: "How long your cash buffer can sustain the plan at current assumptions." },
      cash_timing: { label: "Cash timing", help: "Payment terms and timing of inflows/outflows. Shorter cycles reduce risk." },
      capacity: { label: "Capacity", help: "Whether your delivery capacity can meet the expected demand." },
      unit_economics: { label: "Unit economics", help: "Margin strength and profitability per unit of delivery." },
      break_even: { label: "Break-even", help: "Time to cover fixed costs based on price, costs, and expected volume." },
      market_fit: { label: "Market fit", help: "External signals (demand trend, sector survival, local competition) combined deterministically." },
      proof: { label: "Market proof", help: "Strength of market validation evidence collected so far." },
      sales_cycle: { label: "Sales cycle", help: "Risk introduced by a long sales cycle relative to your cash runway." },
      concentration: { label: "Concentration", help: "Client concentration risk — dependency on a single customer." }
    }),
    []
  );

  function dimLabel(key) {
    const k = String(key || "").trim();
    const meta = DIMENSION_META[k];
    if (meta?.label) return meta.label;
    return k.replaceAll("_", " ");
  }

  function dimHelp(key) {
    const k = String(key || "").trim();
    const fromBackend = validation?.dimension_explanations && typeof validation.dimension_explanations === "object" ? validation.dimension_explanations[k] : null;
    return fromBackend || DIMENSION_META[k]?.help || "Dimension score (0-100).";
  }

  const decisionMeta = decisionBadge(decision);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-2xl font-semibold tracking-tight text-slate-900">{businessName || "Validation"}</div>
            <Badge tone={decisionMeta.tone}>{decisionMeta.text}</Badge>
            {pathwayLabel ? <Badge>{pathwayLabel}</Badge> : null}
          </div>
          <div className="mt-1 text-sm text-slate-600">Validation report and recommended next steps.</div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <SegmentedTabs
            ariaLabel="View mode"
            value={viewMode}
            onChange={setViewMode}
            options={[
              { value: "simple", label: "Simple" },
              { value: "detailed", label: "Detailed" }
            ]}
          />
          <Button variant="secondary" disabled={!workspaceId} onClick={() => navigate(`/validation?workspace_id=${workspaceId}`)}>
            Modify
          </Button>
          <Button variant="danger" disabled={decisionSaving || !workspaceId} onClick={() => setDecisionStatus("rejected")}>
            Reject
          </Button>
          <Button disabled={decisionSaving || !workspaceId} onClick={() => setDecisionStatus("accepted")}>
            Accept
          </Button>
        </div>
      </div>

      {error ? <InlineAlert kind="error" message={error} /> : null}
      {decisionNotice ? <InlineAlert message={decisionNotice} /> : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-8">
          <SectionCard
            title="Deterministic baseline model"
            subtitle="Unit economics and feasibility from your structured inputs."
            className="bg-white"
          >
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <StatTile
                label="Monthly revenue"
                value={formatCurrency(revenue, currency)}
                info="Estimated revenue per month based on price and expected volume."
              />
              <StatTile
                label="Monthly net"
                value={formatCurrency(net, currency)}
                info="Monthly surplus (positive) or deficit (negative)."
              />
              <StatTile label="Contribution margin" value={formatPercent(margin)} info="(Revenue - costs) / revenue." />

              <StatTile
                label="Break-even"
                value={be === null ? "—" : `${formatNumber(be)} months`}
                info="How long it takes to cover fixed costs given your current plan."
              />
              <StatTile
                label="Capacity feasible"
                value={capacity?.feasible === true ? "Yes" : capacity?.feasible === false ? "No" : "Unknown"}
                info="Whether your delivery capacity can meet expected demand."
                tone={capacity?.feasible === true ? "success" : capacity?.feasible === false ? "danger" : "default"}
              />
              <StatTile
                label="Runway"
                value={runway === null ? "Infinity" : `${formatNumber(runway)} months`}
                info="How many months your cash can cover your burn. Infinity means cashflow-positive."
              />
            </div>

            {viewMode === "detailed" ? (
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                <StatTile label="Monthly costs" value={formatCurrency(costs, currency)} info="Fixed + variable costs per month." />
                <StatTile label="Burn / month" value={burn === null ? "—" : formatCurrency(burn, currency)} info="If costs exceed revenue, burn is the gap you fund with cash." tone={burn && burn > 0 ? "warn" : "default"} />
                <StatTile
                  label="Capacity utilization"
                  value={utilization === null ? "—" : formatPercent(utilization)}
                  info="Demand divided by delivery capacity."
                  tone={utilization !== null && utilization > 1 ? "danger" : utilization !== null && utilization > 0.8 ? "warn" : "default"}
                />
                <StatTile label="Demand units / month" value={formatNumber(demandUnits)} info="Units you expect to deliver per month." />
                <StatTile label="Capacity units / month" value={formatNumber(capacityUnits)} info="Max units your team can deliver per month." />
                <StatTile label="Shortfall units" value={formatNumber(shortfall)} info="How many units exceed capacity (if any)." tone={shortfall && shortfall > 0 ? "danger" : "default"} />
              </div>
            ) : null}

          </SectionCard>

          {viewMode === "simple" ? (
            <SectionCard title="Insights" subtitle="Key risks and what to do next.">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Key risks</div>
                  <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-slate-700">
                    {reasons.length ? reasons.slice(0, 8).map((r) => <li key={r}>{r}</li>) : <li>Run a validation to generate risks.</li>}
                  </ul>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Action plan</div>
                  <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-slate-700">
                    {actionPlan.length ? actionPlan.slice(0, 8).map((r) => <li key={r}>{r}</li>) : <li>Update inputs to generate actions.</li>}
                  </ul>
                </div>
              </div>
            </SectionCard>
          ) : null}

          {viewMode === "simple" ? (
            <SectionCard
              title="Keyword trend"
              subtitle="Deterministic keyword set from your inputs."
              headerRight={<InfoTip text="Keywords are derived from Business name + Industry + Offer. Trend data appears when connected." />}
            >
              <div className="flex flex-wrap gap-2">
                {(keywordsToTrack.length ? keywordsToTrack : ["Add business name and industry to generate keywords."]).slice(0, 6).map((k) => (
                  <span key={k} className="rounded-full bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">
                    {k}
                  </span>
                ))}
              </div>
              <div className="mt-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">No trend data yet.</div>
            </SectionCard>
          ) : null}

          {flags?.length && viewMode === "detailed" ? (
            <SectionCard title="Flags" subtitle="Issues worth addressing early.">
              <ul className="list-disc space-y-2 pl-5 text-sm text-slate-700">
                {flags.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </SectionCard>
          ) : null}

          {viewMode === "detailed" ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <SectionCard
                title="Market signals"
                subtitle="Keyword trend and community signals."
                headerRight={
                  <div className="w-full max-w-[260px]">
                    <SegmentedTabs
                      ariaLabel="Market signals tabs"
                      value={signalsTab}
                      onChange={setSignalsTab}
                      size="sm"
                      options={[
                        { value: "trend", label: "Keyword trend" },
                        { value: "community", label: "Community" }
                      ]}
                    />
                  </div>
                }
              >
                {signalsTab === "trend" ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Keyword trend</div>
                      <InfoTip text="We build the keyword set from your Business name + Industry + Offer. Trend data appears when connected." />
                    </div>

                    <div className="grid grid-cols-1 gap-3">
                      <div className="rounded-2xl border border-slate-200 bg-white p-4">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Keywords to track</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {(keywordsToTrack.length ? keywordsToTrack : ["Add business name and industry to generate keywords."]).map((k) => (
                            <span key={k} className="rounded-full bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">
                              {k}
                            </span>
                          ))}
                        </div>
                        <div className="mt-3 text-xs text-slate-500">We will track demand signals and query growth for these terms.</div>
                      </div>

                      <div className="rounded-2xl border border-dashed border-slate-300 bg-gradient-to-br from-brand-50 via-white to-accent-50 p-4">
                        <div className="flex items-center justify-between">
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Trend preview</div>
                          <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">Coming soon</span>
                        </div>
                        <div className="mt-3 rounded-xl bg-white/70 p-3 text-sm text-slate-600 ring-1 ring-slate-200">
                          No trend data yet. Connect your market data source to display search interest over time.
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Community signals</div>
                      <InfoTip text="Mentions and discussions related to your space. Signals appear when connected." />
                    </div>

                    <div className="grid grid-cols-1 gap-3">
                      <div className="rounded-2xl border border-slate-200 bg-white p-4">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Mentions</div>
                        <div className="mt-1 text-lg font-semibold text-slate-900">-</div>
                        <div className="mt-1 text-xs text-slate-500">Across tracked communities</div>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-white p-4">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Momentum</div>
                        <div className="mt-1 text-lg font-semibold text-slate-900">-</div>
                        <div className="mt-1 text-xs text-slate-500">Week-over-week change</div>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-white p-4">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Top spaces</div>
                        <div className="mt-1 text-lg font-semibold text-slate-900">-</div>
                        <div className="mt-1 text-xs text-slate-500">Where people discuss it</div>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
                      No community signals yet.
                    </div>
                  </div>
                )}
              </SectionCard>

              <SectionCard title="Insights" subtitle="Breakdown, reasons, and recommendations.">
                <SegmentedTabs
                  ariaLabel="Insights tabs"
                  value={sideTab}
                  onChange={setSideTab}
                  options={[
                    { value: "breakdown", label: "Score" },
                    { value: "reasons", label: "Reasons" },
                    { value: "recommendations", label: "Actions" }
                  ]}
                />

                <div className="mt-4 max-h-[45vh] overflow-auto pr-1">
                  {sideTab === "breakdown" ? (
                    <div className="space-y-2 text-sm text-slate-700">
                      <div className="flex items-center justify-between">
                        <div className="text-slate-600">Monthly revenue</div>
                        <div className="font-semibold text-slate-900">{formatCurrency(revenue, currency)}</div>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="text-slate-600">Monthly costs</div>
                        <div className="font-semibold text-slate-900">{formatCurrency(costs, currency)}</div>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="text-slate-600">Monthly net</div>
                        <div className="font-semibold text-slate-900">{formatCurrency(net, currency)}</div>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="text-slate-600">Break-even</div>
                        <div className="font-semibold text-slate-900">{be === null ? "—" : `${formatNumber(be)} months`}</div>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="text-slate-600">Runway</div>
                        <div className="font-semibold text-slate-900">{runway === null ? "Infinity" : `${formatNumber(runway)} months`}</div>
                      </div>
                    </div>
                  ) : sideTab === "reasons" ? (
                    <ul className="list-disc space-y-2 pl-5 text-sm text-slate-700">
                      {reasons.slice(0, 999).map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  ) : (
                    <ul className="list-disc space-y-2 pl-5 text-sm text-slate-700">
                      {actionPlan.length ? actionPlan.slice(0, 999).map((r) => <li key={r}>{r}</li>) : <li>Update inputs to generate actions.</li>}
                    </ul>
                  )}
                </div>
              </SectionCard>
            </div>
          ) : null}
        </div>

        <aside className="space-y-4 lg:col-span-4 lg:sticky lg:top-24">
          <div className={"ea-card p-5 " + (risk.tone === "danger" ? "border-rose-200 bg-rose-50" : risk.tone === "warn" ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50")}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">Outcome</div>
                <div className={"mt-2 text-2xl font-semibold tracking-tight " + (risk.tone === "danger" ? "text-rose-700" : risk.tone === "warn" ? "text-amber-800" : "text-emerald-800")}>
                  {risk.title}
                </div>
                <div className="mt-1 text-sm text-slate-700">{risk.subtitle}</div>
              </div>
              <div className="flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">
                <span>Score {formatNumber(score)}/100</span>
                <InfoTip text={validationExplanation} />
              </div>
            </div>
          </div>

          <SectionCard title="Validation scores" subtitle="Quick view by dimension." headerRight={<InfoTip text={validationExplanation} />}>
            {dimensionScores ? (
              <div className="grid grid-cols-2 gap-3">
                {orderedDimensions.map((k) => {
                  const v = typeof dimensionScores?.[k] === "number" ? dimensionScores[k] : 0;
                  return (
                  <div key={k} className={"rounded-2xl border bg-white p-3 " + toneForScore(v).borderClass}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-semibold text-slate-500">{dimLabel(k)}</div>
                      <InfoTip text={dimHelp(k)} />
                    </div>
                    <div className="mt-1 text-lg font-semibold text-slate-900">{formatNumber(v)}/100</div>
                    <div className={"mt-2 h-2 w-full overflow-hidden rounded-full " + toneForScore(v).trackClass}>
                      <div className={"h-full " + toneForScore(v).barClass} style={{ width: pctWidth(v) }} />
                    </div>
                    <div className="mt-2 text-xs text-slate-600">{shortExplanation(dimHelp(k), 120)}</div>
                  </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-sm text-slate-600">No score breakdown available yet.</div>
            )}
          </SectionCard>

          <SectionCard
            title="Market fit"
            subtitle="Demand trend, sector survival, and local competition."
            headerRight={mfKeyword ? <InfoTip text={`Signals for: ${mfKeyword}`} /> : null}
          >
            {!mfKeyword ? (
              <div className="text-sm text-slate-600">Add a business name and industry to load market fit.</div>
            ) : mfLoading ? (
              <div className="flex items-center gap-2 text-sm text-slate-700">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
                Fetching signals…
              </div>
            ) : mfError ? (
              <div className="space-y-2">
                <InlineAlert tone="danger" title="Market fit unavailable" message={mfError} />
                <Button variant="secondary" onClick={fetchMarketFit}>
                  Retry
                </Button>
              </div>
            ) : marketFit?.market_fit_score == null ? (
              <div className="text-sm text-slate-600">No market fit data yet.</div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Market fit score</div>
                    <div className="mt-1 text-2xl font-semibold text-slate-900">{formatNumber(marketFit.market_fit_score)}/100</div>
                    <div className="mt-1 text-sm font-semibold text-slate-700">{String(marketFit.market_fit_classification || "—")}</div>
                  </div>
                  <div className="max-w-[55%] text-right text-xs text-slate-600">
                    {shortExplanation(String(marketFit.market_fit_explanation || ""), 160)}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3">
                  {[
                    ["market_demand", "Demand trend"],
                    ["sector_survival", "Sector survival"],
                    ["local_competition", "Local competition"]
                  ].map(([key, label]) => {
                    const v = typeof marketFit?.dimension_scores?.[key] === "number" ? marketFit.dimension_scores[key] : 0;
                    const help = String(marketFit?.dimension_explanations?.[key] || "");
                    return (
                      <div key={key} className="rounded-2xl border border-slate-200 bg-white p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-xs font-semibold text-slate-500">{label}</div>
                          <InfoTip text={help || "—"} />
                        </div>
                        <div className="mt-1 text-lg font-semibold text-slate-900">{formatNumber(v)}/100</div>
                        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full bg-indigo-500" style={{ width: pctWidth(v) }} />
                        </div>
                        {help ? <div className="mt-2 text-xs text-slate-600">{shortExplanation(help, 120)}</div> : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </SectionCard>
        </aside>
      </div>
    </div>
  );
}
