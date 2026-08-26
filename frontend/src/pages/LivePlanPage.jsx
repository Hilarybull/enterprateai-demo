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

  // Adoption flow
  const [blueprints, setBlueprints] = useState([]);
  const [blueprintsLoading, setBlueprintsLoading] = useState(false);
  const [adopting, setAdopting] = useState(false);
  const [adoptResult, setAdoptResult] = useState(null);
  const [uploadText, setUploadText] = useState("");
  const [uploadFile, setUploadFile] = useState(null);
  const [adoptTab, setAdoptTab] = useState("generated"); // "generated" | "upload"
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

  async function adoptPlan({ documentId, rawContent } = {}) {
    if (!businessId) return;
    setAdopting(true);
    setError("");
    setAdoptResult(null);
    try {
      const res = await apiRequest(`/businesses/${businessId}/live-plan/import-extract`, "POST", {
        idempotency_key: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`,
        document_id: documentId || undefined,
        raw_content: rawContent || undefined,
      });
      setAdoptResult(res);
      setShowAdoptPanel(false);
      const planData = res?.plan?.plan ? { ...res.plan.plan, ...res.plan, narrative_markdown: res.plan.source_document_markdown || res.plan.narrative } : res?.plan;
      if (planData) {
        setPlan(planData);
        setPlanMissing(false);
        setShowLivePlanWorkspace(true);
      }
    } catch (err) {
      const msg = String(err?.message || "");
      setError(msg.replace(/^HTTP \d+:\s*/, "") || "Adoption failed. Please try again.");
    } finally {
      setAdopting(false);
    }
  }

  async function adoptFile(file) {
    if (!businessId || !file) return;
    setAdopting(true);
    setError("");
    setAdoptResult(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const baseUrl = getApiBaseUrl();
      const token = localStorage.getItem("ea_token");
      const resp = await fetch(`${baseUrl}/businesses/${businessId}/live-plan/import-file`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData?.detail || `HTTP ${resp.status}`);
      }
      const res = await resp.json();
      setAdoptResult(res);
      setShowAdoptPanel(false);
      const planData = res?.plan?.plan ? { ...res.plan.plan, ...res.plan } : res?.plan;
      if (planData) {
        setPlan(planData);
        setPlanMissing(false);
        setShowLivePlanWorkspace(true);
      }
    } catch (err) {
      setError(String(err?.message || "File adoption failed."));
    } finally {
      setAdopting(false);
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
          ) : (
            <div className="space-y-4">
              {adoptResult && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                  <div className="mb-0.5 text-xs font-semibold text-emerald-700">Modules updated from: {adoptResult.source_title || "your plan"}</div>
                  <div className="text-xs text-emerald-600">Populated: {(adoptResult.fields_populated || []).join(", ") || "plan seeded successfully"}</div>
                </div>
              )}
              {plan && !adoptResult && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 flex items-center gap-3">
                  <div className="h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
                  <div className="text-xs text-slate-600">A plan is already active for this workspace. Adopt below to update your modules with a new plan.</div>
                </div>
              )}
              <div className="rounded-2xl border border-indigo-200 bg-indigo-50/30 p-5">
                <div className="mb-1 text-sm font-semibold text-slate-900">Adopt a Business Plan</div>
                <p className="text-xs text-slate-500 mb-4">Select a generated plan to scan, extract and populate your modules — or upload your own.</p>

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
