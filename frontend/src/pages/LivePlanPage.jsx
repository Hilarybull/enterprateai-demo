import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiRequest, getApiBaseUrl } from "../api/client";
import Button from "../components/Button";
import PageHeader from "../components/PageHeader";
import SectionCard from "../components/SectionCard";
import Spinner from "../components/Spinner";
import { markdownToHtml } from "../components/DocumentEditor";
import { useWorkspaceStore } from "../store/workspace";
import { isPlatformFeatureGranted } from "../lib/permissions";
import { useAuthStore } from "../store/auth";

function StatCard({ label, value, tone = "slate", detail }) {
  const toneClass =
    tone === "emerald"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : tone === "amber"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : tone === "rose"
          ? "border-rose-200 bg-rose-50 text-rose-700"
          : "border-slate-200 bg-slate-50 text-slate-700";
  return (
    <div className={`rounded-2xl border px-4 py-3 ${toneClass}`}>
      <div className="text-[11px] font-semibold uppercase tracking-wide opacity-80">{label}</div>
      <div className="mt-1 text-2xl font-bold text-slate-900">{value}</div>
      {detail ? <div className="mt-1 text-xs text-slate-500">{detail}</div> : null}
    </div>
  );
}

function Pill({ children, tone = "slate" }) {
  const classes =
    tone === "emerald"
      ? "bg-emerald-100 text-emerald-700 ring-emerald-200"
      : tone === "amber"
        ? "bg-amber-100 text-amber-700 ring-amber-200"
        : tone === "rose"
          ? "bg-rose-100 text-rose-700 ring-rose-200"
          : "bg-slate-100 text-slate-700 ring-slate-200";
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${classes}`}>{children}</span>;
}

export default function BusinessPlanPage() {
  const [searchParams] = useSearchParams();
  const workspaceIdStored = useWorkspaceStore((s) => s.workspaceId);
  const workspaceName = useWorkspaceStore((s) => s.workspaceName);
  const platformGrants = useAuthStore((s) => s.platformGrants);
  const businessId = searchParams.get("business_id") || searchParams.get("workspace_id") || workspaceIdStored || "";
  const sourceDocumentId = searchParams.get("source_document_id") || "";
  const hasBlueprintGrant = isPlatformFeatureGranted("blueprint", "business_plan", platformGrants);

  const [plan, setPlan] = useState(null);
  const [versions, setVersions] = useState([]);
  const [performance, setPerformance] = useState(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [planMissing, setPlanMissing] = useState(false);
  const [showLivePlanWorkspace, setShowLivePlanWorkspace] = useState(false);
  const livePlanSectionRef = useRef(null);

  const normalizedVersions = useMemo(() => {
    const list = Array.isArray(versions) ? [...versions] : [];
    list.sort((a, b) => Number(a?.version_number || 0) - Number(b?.version_number || 0));
    return list;
  }, [versions]);

  const currentVersion = useMemo(() => {
    if (!plan?.current_version_id) return normalizedVersions.at(-1) || null;
    return normalizedVersions.find((item) => item.id === plan.current_version_id) || normalizedVersions.at(-1) || null;
  }, [plan?.current_version_id, normalizedVersions]);

  const narrativeHtml = useMemo(() => markdownToHtml(String(plan?.narrative_markdown || "")), [plan?.narrative_markdown]);
  const planTitle = plan?.business_name || plan?.company_name || workspaceName || "Business Plan";
  const summary = performance?.summary || {};
  const kpis = Array.isArray(performance?.kpis) ? performance.kpis : [];
  const variances = Array.isArray(performance?.variances) ? performance.variances : [];
  const alerts = Array.isArray(performance?.alerts) ? performance.alerts : [];

  async function loadLivePlan() {
    if (!businessId) return;
    setLoading(true);
    setError("");
    setPlanMissing(false);
    try {
      const planResponse = await apiRequest(`/businesses/${businessId}/live-plan`, "GET");
      const detail = planResponse?.plan || null;
      const planData = detail?.plan
        ? { ...detail.plan, ...detail, narrative_markdown: detail.source_document_markdown || detail.narrative }
        : detail;
      setPlan(planData);
      if (planData) {
        setShowLivePlanWorkspace(true);
      } else {
        setVersions([]);
        setPerformance(null);
        setPlanMissing(true);
        return;
      }
      setVersions(Array.isArray(detail?.versions) ? detail.versions : []);
      setPerformance(detail?.performance || null);
    } catch (err) {
      const message = String(err?.message || "");
      if (message.includes("HTTP 404")) {
        setPlan(null);
        setVersions([]);
        setPerformance(null);
        setPlanMissing(true);
      } else {
        if (message.includes("FEATURE_NOT_ENTITLED")) {
          if (!hasBlueprintGrant) setError("Upgrade to the Decision Engine plan to create a live business plan.");
        } else if (message.includes("NETWORK_ERROR")) {
          setError("Network error - please try again.");
        } else {
          setError(message.replace(/^HTTP \d+:\s*/, ""));
        }
      }
    } finally {
      setLoading(false);
    }
  }

  async function createLivePlan() {
    if (!businessId) return;
    setCreating(true);
    setError("");
    try {
      const createdResponse = await apiRequest(`/businesses/${businessId}/live-plan`, "POST", {
        idempotency_key: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
        source_document_id: sourceDocumentId || undefined,
        note: "Created from the live business plan page",
      });
      const createdDetail = createdResponse?.plan || null;
      const createdPlan = createdDetail?.plan
        ? { ...createdDetail.plan, ...createdDetail, narrative_markdown: createdDetail.source_document_markdown || createdDetail.narrative }
        : createdDetail;
      if (createdPlan) {
        setPlan(createdPlan);
        setPlanMissing(false);
        setShowLivePlanWorkspace(true);
      }
    } catch (err) {
      const message = String(err?.message || "");
      if (message.includes("FEATURE_NOT_ENTITLED")) {
        setError("Your account is not entitled to create a live business plan. Ask the admin to grant Blueprint access.");
      } else if (message.includes("NETWORK_ERROR")) {
        setError("Network error - please try again.");
      } else {
        setError(message.replace(/^HTTP \d+:\s*/, ""));
      }
    } finally {
      setCreating(false);
    }
  }

  async function downloadLivePlanPdf() {
    const source = String(plan?.narrative_markdown || "").trim();
    if (!source) {
      setError("Generate a business plan before downloading the PDF.");
      return;
    }
    try {
      const token = localStorage.getItem("ea_token");
      const response = await fetch(`${getApiBaseUrl()}/blueprint/documents/export-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ html: narrativeHtml, title: `${planTitle} Live Business Plan`, document_id: plan?.source_document_id || "" }),
      });
      if (!response.ok) throw new Error((await response.text().catch(() => "")) || "PDF export failed");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${planTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-live-business-plan.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(String(err?.message || "PDF export failed").replace(/^HTTP \d+:\s*/, ""));
    }
  }

  useEffect(() => {
    if (!businessId) return;
    loadLivePlan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, hasBlueprintGrant]);

  const healthTone = summary.health === "healthy" ? "emerald" : summary.health === "critical" ? "rose" : "amber";
  const statusTone = String(plan?.status || "").toUpperCase() === "ACTIVE" ? "emerald" : "slate";

  return (
    <div>
      <PageHeader
        title="Business Plan"
        description="Choose the generated business plan or the live operating plan."
      />

      <div className="mt-6 space-y-4">
        {error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        <SectionCard
          title="Choose a plan"
          subtitle="Generate the standard business plan first, or open the live business plan for ongoing tracking."
        >
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="text-sm font-semibold text-slate-900">Generate business plan</div>
              <div className="mt-1 text-xs leading-6 text-slate-600">
                Create the structured business plan from your blueprint inputs.
              </div>
              <div className="mt-4">
                <Link
                  to="/blueprint?doc=business_plan"
                  className="inline-flex items-center justify-center rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
                >
                  Generate
                </Link>
              </div>
            </div>

            <div className="rounded-2xl border border-indigo-200 bg-indigo-50/40 p-4">
              <div className="text-sm font-semibold text-slate-900">Live business plan</div>
              <div className="mt-1 text-xs leading-6 text-slate-600">
                Track assumptions, KPIs, variances, and scenarios over time.
              </div>
              <div className="mt-4">
                <button
                  type="button"
                  onClick={() => setShowLivePlanWorkspace(true)}
                  className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
                >
                  Open live plan
                </button>
              </div>
            </div>
          </div>
        </SectionCard>

        <div
          ref={livePlanSectionRef}
          role="dialog"
          aria-modal="true"
          aria-label="Live Business Plan workspace"
          className={`fixed inset-0 z-40 overflow-y-auto bg-slate-950/35 p-4 backdrop-blur-[2px] transition-all duration-200 md:p-8 ${
            showLivePlanWorkspace ? "opacity-100" : "pointer-events-none invisible opacity-0"
          }`}
        >
          <div className="mx-auto max-w-6xl pt-1">
            <SectionCard
              title="Live plan workspace"
              subtitle={workspaceName ? `Workspace: ${workspaceName}` : "Select a workspace to begin."}
            >
            <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">Live Business Plan</div>
                <div className="text-xs text-slate-500">Structured plan state, monitoring, and version history</div>
              </div>
              <button
                type="button"
                onClick={() => setShowLivePlanWorkspace(false)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
          {!businessId ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-600">
              Choose a workspace first, then create a live plan from that business context.
              <div className="mt-3">
                <Link to="/blueprint" className="font-semibold text-brand-600 hover:underline">
                  Go back to Business Blueprints
                </Link>
              </div>
            </div>
          ) : loading ? (
            <div className="flex items-center gap-3 py-6 text-sm text-slate-600">
              <Spinner size={18} />
              Loading live plan...
            </div>
          ) : planMissing || !plan ? (
            <div className="flex flex-col gap-4 rounded-2xl border border-indigo-200 bg-indigo-50/40 p-4 md:flex-row md:items-center md:justify-between">
              <div className="max-w-2xl">
                <div className="text-sm font-semibold text-slate-900">No live plan yet</div>
                <div className="mt-1 text-xs leading-6 text-slate-600">
                  Create a live business plan to seed assumptions, KPIs, and version history from your current workspace.
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  onClick={createLivePlan}
                  disabled={creating}
                >
                  {creating ? <Spinner size={16} /> : null}
                  {creating ? "Creating..." : "Create live plan"}
                </Button>
                <Button variant="secondary" onClick={loadLivePlan} disabled={creating}>
                  Refresh
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
              <div className="flex-1 space-y-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <StatCard
                    label="Plan status"
                    value={String(plan?.status || "Draft").toLowerCase()}
                    tone={statusTone}
                    detail={plan?.current_version_id ? "Current version is active in this workspace" : "No current version linked"}
                  />
                  <StatCard
                    label="Health"
                    value={String(summary.health || "pending").replaceAll("_", " ")}
                    tone={healthTone}
                    detail="Derived from KPI variance signals"
                  />
                  <StatCard
                    label="Alerts"
                    value={String(alerts.length)}
                    tone={alerts.length ? "amber" : "emerald"}
                    detail={`${summary.off_track_count || 0} KPIs off track`}
                  />
                  <StatCard
                    label="Versions"
                    value={String(normalizedVersions.length)}
                    detail={currentVersion ? `Current v${currentVersion.version_number}` : "No version history yet"}
                  />
                </div>

                <SectionCard title={planTitle} subtitle="Live Business Plan">
                  <div className="mb-4 flex justify-end">
                    <Button variant="secondary" onClick={downloadLivePlanPdf}>
                      Download PDF
                    </Button>
                  </div>
                  <div className="prose prose-slate max-w-none rounded-2xl border border-slate-200 bg-white p-4 text-sm leading-7">
                    {plan?.narrative_markdown ? (
                      <div dangerouslySetInnerHTML={{ __html: narrativeHtml }} />
                    ) : (
                      <div className="text-slate-500">
                        Create or refresh the live plan to generate a narrative summary from the current assumptions and KPI signals.
                      </div>
                    )}
                  </div>
                </SectionCard>
              </div>

              <div className="w-full space-y-4 lg:max-w-md">
                <SectionCard title="Plan details" subtitle="What this live plan is tracking right now.">
                  <div className="space-y-3 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-slate-500">Business</span>
                      <span className="font-semibold text-slate-900">{planTitle}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-slate-500">Source document</span>
                      <span className="font-semibold text-slate-900">{plan?.source_document_id || "Workspace blueprint"}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-slate-500">Current version</span>
                      <span className="font-semibold text-slate-900">{currentVersion ? `v${currentVersion.version_number}` : "Not set"}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-slate-500">Observation count</span>
                      <span className="font-semibold text-slate-900">{String(summary.observation_count || 0)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-slate-500">Variance count</span>
                      <span className="font-semibold text-slate-900">{String(summary.variance_count || variances.length || 0)}</span>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Pill tone={statusTone}>{String(plan?.status || "draft").toUpperCase()}</Pill>
                    <Pill tone={healthTone}>{String(summary.health || "pending").replaceAll("_", " ").toUpperCase()}</Pill>
                    <Pill tone={alerts.length ? "amber" : "emerald"}>{alerts.length} alerts</Pill>
                  </div>
                  <div className="mt-4 flex gap-2">
                    <Button onClick={loadLivePlan} disabled={loading}>
                      {loading ? <Spinner size={16} /> : null}
                      Refresh
                    </Button>
                    <Button variant="secondary" onClick={loadLivePlan} disabled={creating}>
                      {creating ? <Spinner size={16} /> : null}
                      Refresh plan
                    </Button>
                  </div>
                </SectionCard>

                <SectionCard title="Versions" subtitle="Versioned plan history.">
                  <div className="space-y-2">
                    {normalizedVersions.length ? (
                      normalizedVersions.slice().reverse().map((version) => (
                        <div key={version.id} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-semibold text-slate-900">Version {version.version_number}</div>
                            <Pill tone={String(version.id) === String(plan?.current_version_id) ? "emerald" : "slate"}>
                              {String(version.id) === String(plan?.current_version_id) ? "Current" : "Archived"}
                            </Pill>
                          </div>
                          <div className="mt-1 text-xs text-slate-600">
                            {version.change_summary || "No summary available."}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500">
                        Version history will appear here after the live plan is created.
                      </div>
                    )}
                  </div>
                </SectionCard>

                <SectionCard title="KPIs" subtitle="Latest KPI snapshot from the live plan.">
                  <div className="space-y-2">
                    {kpis.length ? (
                      kpis.slice(0, 6).map((kpi) => (
                        <div key={kpi.id} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-semibold text-slate-900">{kpi.name || kpi.code}</div>
                            <Pill tone={kpi.direction === "down" ? "amber" : "emerald"}>{String(kpi.domain || "").toLowerCase()}</Pill>
                          </div>
                          <div className="mt-1 text-xs text-slate-600">
                            Target: {String(kpi.target_value_json ?? "n/a")} {kpi.unit ? ` ${kpi.unit}` : ""}
                            {kpi.actual_value_json !== undefined && kpi.actual_value_json !== null ? ` · Actual: ${String(kpi.actual_value_json)}` : ""}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500">
                        KPIs will appear here after the live plan is seeded.
                      </div>
                    )}
                  </div>
                </SectionCard>

                <SectionCard title="Alerts" subtitle="Open signals that need attention.">
                  <div className="space-y-2">
                    {alerts.length ? (
                      alerts.slice(0, 6).map((alert) => (
                        <div key={alert.id} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                          <div className="text-sm font-semibold text-slate-900">{alert.title || alert.alert_type || "Alert"}</div>
                          <div className="mt-1 text-xs text-slate-600">{alert.description || "No description available."}</div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500">
                        No open alerts right now.
                      </div>
                    )}
                  </div>
                </SectionCard>
              </div>
            </div>
          )}
            </SectionCard>
          </div>
        </div>
      </div>
    </div>
  );
}
