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
  const refreshGrants = useAuthStore((s) => s.refreshGrants);
  const businessId = searchParams.get("business_id") || searchParams.get("workspace_id") || workspaceIdStored || "";
  const sourceDocumentId = searchParams.get("source_document_id") || "";
  const openImmediately = searchParams.get("open") === "1";
  const initialTab = searchParams.get("tab") === "upload" ? "upload" : "generated";
  const hasBlueprintGrant = isPlatformFeatureGranted("blueprint", "business_plan", platformGrants);

  const [plan, setPlan] = useState(null);
  const [versions, setVersions] = useState([]);
  const [performance, setPerformance] = useState(null);
  const [assumptions, setAssumptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [planMissing, setPlanMissing] = useState(false);
  // Always open workspace immediately — show loading spinner inside rather than blank page
  const [showLivePlanWorkspace, setShowLivePlanWorkspace] = useState(true);
  const livePlanSectionRef = useRef(null);

  // Adoption flow
  const [blueprints, setBlueprints] = useState([]);
  const [blueprintsLoading, setBlueprintsLoading] = useState(false);
  const [adopting, setAdopting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [adoptResult, setAdoptResult] = useState(null);   // post-confirm success state
  const [previewData, setPreviewData] = useState(null);   // dry-run preview (confirm pending)
  const [showNarrative, setShowNarrative] = useState(false);
  const [uploadText, setUploadText] = useState("");
  const [uploadFile, setUploadFile] = useState(null);
  const [adoptTab, setAdoptTab] = useState(initialTab); // "generated" | "upload"
  const [showAdoptPanel, setShowAdoptPanel] = useState(false);

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

  const aMap = useMemo(() => {
    const map = {};
    for (const a of assumptions) {
      try { map[a.metric_code] = JSON.parse(a.assumption_value_json); }
      catch { map[a.metric_code] = a.assumption_value_json; }
    }
    return map;
  }, [assumptions]);
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
        setAssumptions([]);
        setPlanMissing(true);
        return;
      }
      setVersions(Array.isArray(detail?.versions) ? detail.versions : []);
      setPerformance(detail?.performance || null);
      setAssumptions(Array.isArray(detail?.assumptions) ? detail.assumptions : []);
    } catch (err) {
      const message = String(err?.message || "");
      if (message.includes("HTTP 404")) {
        setPlan(null);
        setVersions([]);
        setPerformance(null);
        setAssumptions([]);
        setPlanMissing(true);
      } else {
        if (message.includes("FEATURE_NOT_ENTITLED")) {
          if (!hasBlueprintGrant) setError("Upgrade to the Decision Engine plan to create a live business plan.");
        } else if (message.includes("NETWORK_ERROR")) {
          setError("Network error - please try again.");
          setShowLivePlanWorkspace(true);
        } else {
          setError(message.replace(/^HTTP \d+:\s*/, ""));
          setShowLivePlanWorkspace(true);
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
    const hasRealContent = source && !source.startsWith("Live Business Plan —") && source.length > 200;
    if (!hasRealContent) {
      setError("Adopt a business plan first to generate meaningful PDF content.");
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

  async function loadBlueprints() {
    setBlueprintsLoading(true);
    try {
      const res = await apiRequest("/blueprint/documents?type=business_plan&limit=10", "GET");
      setBlueprints(Array.isArray(res) ? res : []);
    } catch {
      setBlueprints([]);
    } finally {
      setBlueprintsLoading(false);
    }
  }

  function getScanCacheKey(documentId) {
    return `lp_scan_${businessId}_${documentId}`;
  }

  function loadScanCache(documentId) {
    if (!documentId) return null;
    try {
      const raw = localStorage.getItem(getScanCacheKey(documentId));
      if (!raw) return null;
      const { data, ts } = JSON.parse(raw);
      if (Date.now() - ts > 4 * 60 * 60 * 1000) { localStorage.removeItem(getScanCacheKey(documentId)); return null; }
      return data;
    } catch { return null; }
  }

  function saveScanCache(documentId, data) {
    if (!documentId) return;
    try { localStorage.setItem(getScanCacheKey(documentId), JSON.stringify({ data, ts: Date.now() })); } catch {}
  }

  function clearScanCache(documentId) {
    if (!documentId) return;
    try { localStorage.removeItem(getScanCacheKey(documentId)); } catch {}
  }

  async function adoptPlan({ documentId, rawContent } = {}) {
    if (!businessId) return;
    // Return cached dry-run result if available (skips re-scan)
    if (documentId) {
      const cached = loadScanCache(documentId);
      if (cached) { setPreviewData(cached); return; }
    }
    setAdopting(true);
    setError("");
    setPreviewData(null);
    try {
      const res = await apiRequest(`/businesses/${businessId}/live-plan/import-extract?dry_run=true`, "POST", {
        document_id: documentId || undefined,
        raw_content: rawContent || undefined,
      }, { timeoutMs: 180000 });
      setPreviewData(res);
      if (documentId) saveScanCache(documentId, res);
    } catch (err) {
      const msg = String(err?.message || "");
      setError(
        msg.includes("NETWORK_ERROR") ? "Could not reach the server — the backend may be starting up. Please wait a moment and try again."
        : msg.includes("timed out") ? "Extraction is taking too long. Please try again."
        : msg.replace(/^HTTP \d+:\s*/, "") || "Extraction failed. Please try again."
      );
    } finally {
      setAdopting(false);
    }
  }

  async function adoptFile(file) {
    if (!businessId || !file) return;
    setAdopting(true);
    setError("");
    setPreviewData(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const baseUrl = getApiBaseUrl();
      const token = localStorage.getItem("ea_token");
      const resp = await fetch(`${baseUrl}/businesses/${businessId}/live-plan/import-file?dry_run=true`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData?.detail || `HTTP ${resp.status}`);
      }
      const res = await resp.json();
      setPreviewData(res);
    } catch (err) {
      setError(String(err?.message || "File extraction failed."));
    } finally {
      setAdopting(false);
    }
  }

  async function confirmAdopt() {
    if (!businessId || !previewData) return;
    setConfirming(true);
    setError("");
    try {
      const res = await apiRequest(`/businesses/${businessId}/live-plan/confirm-adopt`, "POST", {
        idempotency_key: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`,
        extracted: previewData.extracted,
        markdown: previewData.markdown || undefined,
        source_title: previewData.source_title || undefined,
      }, { timeoutMs: 60000 });
      const planData = res?.plan?.plan ? { ...res.plan.plan, ...res.plan, narrative_markdown: res.plan.source_document_markdown || res.plan.narrative } : res?.plan;
      if (planData) {
        setPlan(planData);
        setPlanMissing(false);
      }
      // Clear the scan cache for the adopted document
      if (previewData?.document_id) clearScanCache(previewData.document_id);
      setPreviewData(null);
      setAdoptResult(res);
      setAssumptions(Array.isArray(res?.plan?.assumptions) ? res.plan.assumptions : assumptions);
    } catch (err) {
      setError(String(err?.message || "").replace(/^HTTP \d+:\s*/, "") || "Adoption failed. Please try again.");
    } finally {
      setConfirming(false);
    }
  }

  useEffect(() => { refreshGrants(); }, []);

  useEffect(() => {
    if (!businessId) return;
    loadLivePlan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, hasBlueprintGrant]);

  useEffect(() => {
    if (showLivePlanWorkspace && businessId) loadBlueprints();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLivePlanWorkspace, businessId]);

  // If arriving via "Adopt as live plan" link, auto-load cached scan or trigger scan
  useEffect(() => {
    if (!sourceDocumentId || !businessId) return;
    setShowLivePlanWorkspace(true);
    const cached = loadScanCache(sourceDocumentId);
    if (cached) { setPreviewData(cached); return; }
    adoptPlan({ documentId: sourceDocumentId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceDocumentId, businessId]);

  const healthTone = summary.health === "healthy" ? "emerald" : summary.health === "critical" ? "rose" : "amber";
  const statusTone = String(plan?.status || "").toUpperCase() === "ACTIVE" ? "emerald" : "slate";

  return (
    <div>
      <div className="mb-2">
        <Link to="/blueprint" className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-indigo-600">
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/></svg>
          Business Blueprints
        </Link>
      </div>
      <PageHeader
        title="Live Business Plan"
        description={workspaceName || "Track assumptions, KPIs, and performance over time."}
      />

      <div className="mt-6 space-y-4" ref={livePlanSectionRef}>
          {!businessId ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-600">
              Choose a workspace first.
              <div className="mt-3">
                <Link to="/blueprint" className="font-semibold text-indigo-600 hover:underline">
                  Go to Business Blueprints
                </Link>
              </div>
            </div>
          ) : loading ? (
            <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-6 py-8 text-sm text-slate-600">
              <Spinner size={18} />
              Loading live plan...
            </div>
          ) : (
            <div className="space-y-4">
              {/* Error banner with retry */}
              {error && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 flex items-center justify-between gap-3">
                  <span className="text-sm text-rose-700">{error}</span>
                  <button type="button" onClick={() => { setError(""); loadLivePlan(); }}
                    className="shrink-0 rounded-lg border border-rose-200 px-3 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100">
                    Retry
                  </button>
                </div>
              )}
              {/* No plan confirmed via 404 */}
              {planMissing && !error && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center">
                  <div className="text-sm font-semibold text-slate-900">No live plan yet</div>
                  <div className="mt-1 text-xs text-slate-500">Generate a business plan first, then adopt it here to start tracking KPIs and performance.</div>
                  <Link to="/blueprint" className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700">
                    Go to Business Blueprints
                  </Link>
                </div>
              )}
              {/* Post-confirm success banner */}
              {adoptResult && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
                    <div className="text-xs text-emerald-700 font-medium">
                      Plan adopted — {(adoptResult.fields_populated || []).length} field{(adoptResult.fields_populated || []).length !== 1 ? "s" : ""} populated.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAdoptResult(null)}
                    className="text-[11px] text-slate-400 hover:text-slate-600"
                  >
                    Dismiss
                  </button>
                </div>
              )}

              {/* Dry-run preview — awaiting user confirmation */}
              {previewData && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50/60 flex flex-col" style={{ maxHeight: "calc(100vh - 220px)" }}>
                  {/* Fixed header */}
                  <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-amber-200 shrink-0">
                    <div>
                      <div className="text-sm font-semibold text-amber-900">Review before adopting</div>
                      <div className="text-xs text-amber-700 mt-0.5">From: <span className="font-medium">{previewData.source_title || "your plan"}</span></div>
                    </div>
                    <button type="button" onClick={() => setPreviewData(null)} className="text-[11px] text-slate-400 hover:text-slate-600 shrink-0">Cancel</button>
                  </div>

                  {/* Scrollable content */}
                  <div className="overflow-y-auto flex-1 px-5 py-3 space-y-3">
                  {/* Business identity */}
                  {(previewData.extracted?.business_name || previewData.extracted?.industry) && (
                    <div className="rounded-xl border border-amber-100 bg-white p-3 space-y-1">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-600 mb-2">Business</div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                        {[
                          ["Business name", previewData.extracted?.business_name],
                          ["Industry", previewData.extracted?.industry],
                          ["Location", previewData.extracted?.location || previewData.extracted?.geography || previewData.extracted?.market_geography],
                        ].filter(([, v]) => v).map(([label, val]) => (
                          <div key={label} className="text-xs"><span className="font-semibold text-slate-700">{label}</span><span className="text-slate-400 mx-0.5">:</span> <span className="text-slate-600">{String(val)}</span></div>
                        ))}
                      </div>
                      {(previewData.extracted?.unique_value_proposition || previewData.extracted?.description || previewData.extracted?.business_description) && (
                        <div
                          className="mt-1.5 text-xs text-slate-600 line-clamp-3"
                          dangerouslySetInnerHTML={{ __html: markdownToHtml(previewData.extracted.unique_value_proposition || previewData.extracted.description || previewData.extracted.business_description) }}
                        />
                      )}
                    </div>
                  )}

                  {/* Financials */}
                  {(previewData.extracted?.monthly_revenue_target || previewData.extracted?.monthly_costs || previewData.extracted?.gross_margin_pct) && (
                    <div className="rounded-xl border border-amber-100 bg-white p-3">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-600 mb-2">Financials</div>
                      <div className="grid grid-cols-3 gap-2">
                        {previewData.extracted?.monthly_revenue_target != null && (
                          <div className="rounded-lg bg-emerald-50 border border-emerald-100 px-2 py-2 text-center">
                            <div className="text-[10px] text-emerald-600 font-semibold">Revenue / mo</div>
                            <div className="text-xs font-bold text-emerald-800 mt-0.5">£{Number(previewData.extracted.monthly_revenue_target).toLocaleString()}</div>
                          </div>
                        )}
                        {previewData.extracted?.monthly_costs != null && (
                          <div className="rounded-lg bg-rose-50 border border-rose-100 px-2 py-2 text-center">
                            <div className="text-[10px] text-rose-600 font-semibold">Costs / mo</div>
                            <div className="text-xs font-bold text-rose-800 mt-0.5">£{Number(previewData.extracted.monthly_costs).toLocaleString()}</div>
                          </div>
                        )}
                        {previewData.extracted?.gross_margin_pct != null && (
                          <div className="rounded-lg bg-indigo-50 border border-indigo-100 px-2 py-2 text-center">
                            <div className="text-[10px] text-indigo-600 font-semibold">Margin</div>
                            <div className="text-xs font-bold text-indigo-800 mt-0.5">{previewData.extracted.gross_margin_pct}%</div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Products / services */}
                  {/* Key assumptions + Main risks side by side */}
                  <div className="grid grid-cols-2 gap-3">
                  {Array.isArray(previewData.extracted?.key_assumptions) && previewData.extracted.key_assumptions.length > 0 && (
                    <div className="rounded-xl border border-amber-100 bg-white p-3">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-600 mb-1.5">Key Assumptions</div>
                      <ul className="space-y-0.5 pl-3 list-disc text-xs text-slate-700 marker:text-amber-400">
                        {previewData.extracted.key_assumptions.slice(0, 3).map((a, i) => (
                          <li key={i} className="leading-snug line-clamp-2">{String(a)}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {Array.isArray(previewData.extracted?.main_risks) && previewData.extracted.main_risks.length > 0 && (
                    <div className="rounded-xl border border-amber-100 bg-white p-3">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-rose-600 mb-1.5">Main Risks</div>
                      <ul className="space-y-0.5 pl-3 list-disc text-xs text-slate-700 marker:text-rose-400">
                        {previewData.extracted.main_risks.slice(0, 3).map((r, i) => (
                          <li key={i} className="leading-snug line-clamp-2">{String(r)}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  </div>
                  </div>{/* end scrollable content */}

                  {/* Fixed footer */}
                  <div className="px-5 py-3 border-t border-amber-200 bg-amber-50/80 shrink-0 rounded-b-2xl">
                    <div className="mb-2 text-[11px] text-amber-700">
                      Will populate: Blueprint profile · Financials · Catalogue · Live plan assumptions
                    </div>
                    <button
                      type="button"
                      onClick={confirmAdopt}
                      disabled={confirming}
                      className="w-full rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
                    >
                      {confirming ? "Adopting…" : "Confirm & Adopt"}
                    </button>
                  </div>
                </div>
              )}

              {/* Live plan dashboard — shown when assumptions exist */}
              {plan && !previewData && assumptions.length > 0 && (
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {/* LEFT COLUMN: profile + financials + products */}
                  <div className="space-y-3">
                  {/* Business Identity */}
                  {(aMap.business_name || aMap.industry || aMap.location || aMap.target_market) && (
                    <div className="rounded-2xl border border-slate-200 bg-white p-4">
                      <div className="mb-2 flex items-center justify-between">
                        <div className="text-xs font-semibold uppercase tracking-wide text-indigo-600">Business Profile</div>
                        <Pill tone="emerald">Active</Pill>
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                        {[
                          ["Name", aMap.business_name],
                          ["Industry", aMap.industry],
                          ["Location", aMap.location],
                        ].filter(([, v]) => v).map(([label, val]) => (
                          <div key={label} className="text-xs">
                            <span className="font-semibold text-slate-500">{label}: </span>
                            <span className="text-slate-800">{String(val)}</span>
                          </div>
                        ))}
                      </div>
                      {aMap.target_market && (
                        <div className="mt-2 text-xs text-slate-600">
                          <span className="font-semibold text-slate-500">Target market: </span>{aMap.target_market}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Products & Services */}
                  {Array.isArray(aMap.products_services) && aMap.products_services.length > 0 && (
                    <div className="rounded-2xl border border-slate-200 bg-white p-3">
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-indigo-600">Products &amp; Services</div>
                      <div className="space-y-1">
                        {aMap.products_services.map((p, i) => {
                          const name = typeof p === "string" ? p : (p?.name || "");
                          const price = typeof p === "object"
                            ? (p?.price_label || (p?.unit_price != null ? `£${Number(p.unit_price).toLocaleString()}` : null) || (p?.base_price != null ? `£${Number(p.base_price).toLocaleString()}` : null))
                            : null;
                          return (
                            <div key={i} className="flex items-center justify-between gap-2 text-xs">
                              <span className="font-medium text-slate-800">{String(name)}</span>
                              {price && <span className="shrink-0 rounded bg-slate-100 border border-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">{String(price)}</span>}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Financial Plan */}
                  {(aMap.monthly_revenue_target != null || aMap.monthly_costs != null || aMap.gross_margin_pct != null) && (
                    <div className="rounded-2xl border border-slate-200 bg-white p-3">
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-indigo-600">Financial Plan</div>
                      <div className="grid grid-cols-3 gap-2">
                        {aMap.monthly_revenue_target != null && (
                          <div className="rounded-xl bg-emerald-50 border border-emerald-100 px-2 py-2 text-center">
                            <div className="text-[9px] font-semibold text-emerald-600">Revenue / mo</div>
                            <div className="mt-0.5 text-sm font-bold text-emerald-800">£{Number(aMap.monthly_revenue_target).toLocaleString()}</div>
                          </div>
                        )}
                        {aMap.monthly_costs != null && (
                          <div className="rounded-xl bg-rose-50 border border-rose-100 px-2 py-2 text-center">
                            <div className="text-[9px] font-semibold text-rose-600">Costs / mo</div>
                            <div className="mt-0.5 text-sm font-bold text-rose-800">£{Number(aMap.monthly_costs).toLocaleString()}</div>
                          </div>
                        )}
                        {aMap.gross_margin_pct != null && (
                          <div className="rounded-xl bg-indigo-50 border border-indigo-100 px-2 py-2 text-center">
                            <div className="text-[9px] font-semibold text-indigo-600">Gross margin</div>
                            <div className="mt-0.5 text-sm font-bold text-indigo-800">{aMap.gross_margin_pct}%</div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  </div>{/* end left column */}

                  {/* RIGHT COLUMN: assumptions + risks + adopt */}
                  <div className="space-y-3">
                  {/* Key Assumptions */}
                  {Array.isArray(aMap.key_assumptions) && aMap.key_assumptions.length > 0 && (
                    <div className="rounded-2xl border border-slate-200 bg-white p-3">
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-600">Key Assumptions</div>
                      <ul className="space-y-0.5 pl-3 list-disc text-xs text-slate-700 marker:text-amber-400">
                        {aMap.key_assumptions.slice(0, 4).map((a, i) => (
                          <li key={i} className="leading-snug" dangerouslySetInnerHTML={{ __html: markdownToHtml(String(a)) }} />
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Main Risks */}
                  {Array.isArray(aMap.main_risks) && aMap.main_risks.length > 0 && (
                    <div className="rounded-2xl border border-slate-200 bg-white p-3">
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-rose-600">Main Risks</div>
                      <ul className="space-y-0.5 pl-3 list-disc text-xs text-slate-700 marker:text-rose-400">
                        {aMap.main_risks.slice(0, 3).map((r, i) => (
                          <li key={i} className="leading-snug" dangerouslySetInnerHTML={{ __html: markdownToHtml(String(r)) }} />
                        ))}
                      </ul>
                    </div>
                  )}
                  </div>{/* end right column */}
                </div>
              )}

              {plan && !previewData && !adoptResult && !(assumptions.length > 0) && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 flex items-center gap-3">
                  <div className="h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
                  <div className="text-xs text-slate-600">A plan is active for this workspace. Adopt below to update with a new plan.</div>
                </div>
              )}
              {!previewData && (<div className="rounded-2xl border border-indigo-200 bg-white p-5">
                <div className="mb-1 text-sm font-semibold text-slate-900">{plan ? "Update plan" : "Adopt a Business Plan"}</div>
                <p className="text-xs text-slate-500 mb-4">{plan ? "Re-scan a plan to update your modules with new data." : "Select a generated plan to scan, extract and populate your modules — or upload your own."}</p>

                {/* Tabs */}
                <div className="mb-4 flex gap-1 rounded-xl border border-slate-200 bg-white p-1 w-fit">
                  {[["generated", "From generated plans"], ["upload", "Paste / upload text"]].map(([key, label]) => (
                    <button key={key} type="button"
                      onClick={() => setAdoptTab(key)}
                      className={`rounded-lg px-4 py-1.5 text-xs font-semibold transition ${adoptTab === key ? "bg-indigo-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-50"}`}>
                      {label}
                    </button>
                  ))}
                </div>

                {adoptTab === "generated" && (
                  <div className="space-y-2">
                    {blueprintsLoading ? (
                      <div className="flex items-center gap-2 py-4 text-xs text-slate-400"><Spinner size={14} /> Loading your generated plans…</div>
                    ) : blueprints.length === 0 ? (
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-5 text-center text-xs text-slate-500">
                        No generated business plans found.{" "}
                        <Link to="/blueprint?doc=business_plan" className="font-semibold text-indigo-600 hover:underline">Generate one first →</Link>
                      </div>
                    ) : (
                      blueprints.map((doc) => (
                        <div key={doc.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3">
                          <div>
                            <div className="text-sm font-semibold text-slate-800">{doc.title || "Business Plan"}</div>
                            <div className="text-xs text-slate-400">{doc.company_name || ""}{doc.created_at ? ` · ${new Date(doc.created_at).toLocaleDateString()}` : ""}</div>
                          </div>
                          <button type="button" disabled={adopting}
                            onClick={() => adoptPlan({ documentId: doc.id })}
                            className="ml-4 shrink-0 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-40">
                            {adopting ? <span className="flex items-center gap-1.5"><Spinner size={12} />Scanning…</span> : "Adopt Plan"}
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {adoptTab === "upload" && (
                  <div className="space-y-3">
                    {/* File upload */}
                    <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-4 hover:border-indigo-400 hover:bg-indigo-50/40 transition">
                      <svg className="h-5 w-5 shrink-0 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1M12 12V4m0 0L8 8m4-4l4 4"/></svg>
                      <div className="min-w-0">
                        {uploadFile ? (
                          <span className="block truncate text-xs font-semibold text-indigo-700">{uploadFile.name}</span>
                        ) : (
                          <span className="text-xs text-slate-500">Upload PDF, Word (.docx), image or text file</span>
                        )}
                        <span className="text-[10px] text-slate-400">PDF · DOCX · JPG · PNG · WEBP · TXT</span>
                      </div>
                      <input type="file" className="hidden"
                        accept=".pdf,.docx,.doc,.txt,.md,.jpg,.jpeg,.png,.webp,.gif"
                        onChange={(e) => { setUploadFile(e.target.files?.[0] || null); setUploadText(""); }}
                      />
                    </label>

                    <div className="flex items-center gap-2 text-[10px] text-slate-400">
                      <div className="h-px flex-1 bg-slate-200" />or paste text below<div className="h-px flex-1 bg-slate-200" />
                    </div>

                    <textarea
                      rows={6}
                      placeholder="Paste your business plan text here…"
                      value={uploadText}
                      onChange={(e) => { setUploadText(e.target.value); setUploadFile(null); }}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                    />
                    <button type="button"
                      disabled={adopting || (!uploadText.trim() && !uploadFile)}
                      onClick={() => uploadFile ? adoptFile(uploadFile) : adoptPlan({ rawContent: uploadText })}
                      className="rounded-xl bg-indigo-600 px-5 py-2 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-40">
                      {adopting ? <span className="flex items-center gap-1.5"><Spinner size={12} />Scanning…</span> : "Scan & Adopt"}
                    </button>
                  </div>
                )}

              </div>)}
            </div>
          )}
      </div>
    </div>
  );
}
