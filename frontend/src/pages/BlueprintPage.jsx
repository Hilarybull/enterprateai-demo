import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import DocumentEditor from "../components/DocumentEditor";
import DocumentShareModal from "../components/DocumentShareModal";
import Input from "../components/Input";
import PageHeader from "../components/PageHeader";
import SectionCard from "../components/SectionCard";
import Spinner from "../components/Spinner";
import { apiRequest, getApiBaseUrl } from "../api/client";
import Button from "../components/Button";
import { useWorkspaceStore } from "../store/workspace";
import { useAuthStore } from "../store/auth";
import WorkspacePrompt from "../components/WorkspacePrompt";
import { BlueprintIllustration, IllustrationCard } from "../components/Illustrations";
import SegmentedTabs from "../components/SegmentedTabs";
import { imageFileToDataUrl } from "../lib/files";
import { hasFeatureAccess, isPlatformFeatureRestricted } from "../lib/permissions";
import ConfirmDialog from "../components/ConfirmDialog";
import CreditConfirmModal from "../components/CreditConfirmModal";

const DOCUMENTS = [
  {
    id: "business_plan",
    title: "Business Plan",
    desc: "Strategy + structured narrative sections",
    needsWorkspace: false
  },
  {
    id: "client_proposal",
    title: "Business Proposals",
    desc: "Sales proposal with scope, approach, and terms",
    needsWorkspace: false
  },
  {
    id: "sales_letter",
    title: "Sales Letter",
    desc: "Outreach copy from your offer and value prop",
    needsWorkspace: false
  }
];

const BUSINESS_PLAN_SECTIONS = [
  { id: "cover_page", label: "Cover page" },
  { id: "executive_summary", label: "Executive summary" },
  { id: "business_overview", label: "Business overview" },
  { id: "products_services", label: "Products & services" },
  { id: "market_analysis", label: "Market analysis" },
  { id: "competitive_analysis", label: "Competitive analysis" },
  { id: "business_model", label: "Business model" },
  { id: "marketing_sales_strategy", label: "Marketing & sales strategy" },
  { id: "operations_plan", label: "Operations plan" },
  { id: "management_organisation", label: "Management & organisation" },
  { id: "financial_snapshot", label: "Financial snapshot" },
  { id: "funding_requirements", label: "Funding requirements" },
  { id: "risk_analysis_mitigation", label: "Risk analysis & mitigation" },
  { id: "conclusion", label: "Conclusion" }
];

const CLIENT_PROPOSAL_SECTIONS = [
  { id: "cover_page", label: "Cover page" },
  { id: "executive_summary", label: "Executive summary" },
  { id: "client_needs", label: "Client needs / problem" },
  { id: "proposed_solution", label: "Proposed solution" },
  { id: "scope_of_work", label: "Scope of work" },
  { id: "methodology", label: "Methodology / approach" },
  { id: "timeline", label: "Timeline / delivery schedule" },
  { id: "pricing_terms", label: "Pricing & payment terms" },
  { id: "value_benefits", label: "Value proposition / benefits" },
  { id: "company_profile", label: "Company profile" },
  { id: "terms_conditions", label: "Terms & conditions" },
  { id: "acceptance", label: "Acceptance / next steps" }
];

const SALES_LETTER_SECTIONS = [
  { id: "headline", label: "Headline" },
  { id: "hook", label: "Opening / hook" },
  { id: "problem", label: "Problem statement" },
  { id: "solution", label: "Solution introduction" },
  { id: "benefits", label: "Benefits" },
  { id: "proof", label: "Proof / credibility" },
  { id: "offer", label: "Offer" },
  { id: "cta", label: "Call to action" },
  { id: "urgency", label: "Urgency / scarcity" },
  { id: "closing", label: "Closing" },
  { id: "followup", label: "Follow-up summary" }
];

function AiFillButton({ context, onFill }) {
  const [loading, setLoading] = useState(false);
  const [tip, setTip] = useState("");
  async function handle() {
    setLoading(true);
    setTip("");
    try {
      const res = await apiRequest("/blueprint/suggest-field", "POST", context);
      if (res?.value) {
        onFill(res.value);
      } else {
        setTip("Couldn't generate a suggestion. Try again.");
      }
    } catch {
      setTip("Couldn't generate a suggestion. Try again.");
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="relative inline-flex flex-col items-end gap-0.5">
      <button type="button" onClick={handle} disabled={loading}
        className={`inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-semibold border disabled:opacity-50 transition-colors ${tip ? "text-amber-600 border-amber-200 hover:bg-amber-50" : "text-brand-600 border-brand-200 hover:bg-brand-50"}`}>
        {loading ? "Thinking..." : tip ? "Try again" : "✦ AI Fill"}
      </button>
      {tip ? <span className="text-[10px] text-amber-600 whitespace-nowrap">{tip}</span> : null}
    </div>
  );
}

const BUSINESS_PLAN_OBJECTIVES = [
  "Standard",
  "Investor-ready (seeking funding)",
  "Internal strategy document",
  "Bank / lender submission",
  "Grant application",
  "Partnership proposal",
  "Other"
];

const CLIENT_PROPOSAL_OBJECTIVES = ["Sales Proposal"];

const SALES_LETTER_OBJECTIVES = [
  "Generate new leads",
  "Convert warm prospects",
  "Re-engage dormant customers",
  "Promote a new offer or service",
  "Invite to event or webinar",
  "Win back lost clients",
  "Other"
];

const DID_YOU_KNOW_FACTS = [
  "Clear sections make long documents easier to edit and review.",
  "Executive summaries work best when they reflect only confirmed inputs.",
  "Consistent headings make PDF exports cleaner and easier to scan.",
  "Using real workspace data keeps proposals accurate and credible.",
  "Focused objectives help the generator keep tone and intent aligned.",
  "Shorter sentences improve readability in long-form plans."
];

function pct(n) {
  const v = Math.max(0, Math.min(100, Math.round(n)));
  return `${v}%`;
}

// FIX 2: Multi-select dropdown component for services
function ServicesDropdown({ workspaceServices, selectedServices, setSelectedServices, setDirtyFields, customServiceName, setCustomServiceName, customServiceDescription, setCustomServiceDescription }) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const toggleService = (name) => {
    setDirtyFields((p) => ({ ...p, selectedServices: true }));
    setSelectedServices((prev) =>
      prev.includes(name) ? prev.filter((s) => s !== name) : [...prev, name]
    );
  };

  const visibleServices = Array.isArray(workspaceServices) ? workspaceServices : [];
  const selectedCount = selectedServices.filter(s => s !== "__other__").length;
  const hasOther = selectedServices.includes("__other__");

  const summaryText = () => {
    if (!selectedServices.length) return "Select services…";
    const named = selectedServices.filter(s => s !== "__other__").join(", ");
    const parts = [];
    if (named) parts.push(named);
    if (hasOther) parts.push("Other");
    return parts.join(", ") || "Select services…";
  };

  return (
    <div ref={dropdownRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="ea-input w-full flex items-center justify-between text-left"
      >
        <span className="truncate text-sm text-slate-700">{summaryText()}</span>
        <svg
          className={`ml-2 h-4 w-4 shrink-0 text-slate-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
          viewBox="0 0 20 20" fill="currentColor"
        >
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute z-30 mt-1 w-full rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="max-h-56 overflow-y-auto p-2 space-y-1">
            {visibleServices.length === 0 && (
              <div className="px-3 py-2 text-xs text-slate-400">No workspace services found.</div>
            )}
            {visibleServices.map((service) => (
              <label
                key={service.id || service.service_name}
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selectedServices.includes(service.service_name)}
                  onChange={() => toggleService(service.service_name)}
                  className="accent-brand-600"
                />
                <span>{service.service_name}</span>
              </label>
            ))}
            <label className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 cursor-pointer border-t border-slate-100">
              <input
                type="checkbox"
                checked={hasOther}
                onChange={() => toggleService("__other__")}
                className="accent-brand-600"
              />
              <span>Other (add a new service)</span>
            </label>
          </div>

          {hasOther && (
            <div className="border-t border-slate-100 p-3 space-y-2">
              <input
                type="text"
                value={customServiceName}
                onChange={(e) => {
                  setDirtyFields((p) => ({ ...p, selectedServices: true }));
                  setCustomServiceName(e.target.value);
                }}
                placeholder="Service name"
                className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-brand-400"
              />
              <input
                type="text"
                value={customServiceDescription}
                onChange={(e) => {
                  setDirtyFields((p) => ({ ...p, selectedServices: true }));
                  setCustomServiceDescription(e.target.value);
                }}
                placeholder="Service description (optional)"
                className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-brand-400"
              />
            </div>
          )}

          <div className="border-t border-slate-100 px-3 py-2 flex justify-end">
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="rounded-lg bg-slate-900 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-700"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Map document id to blueprint feature key
const DOC_FEATURE_KEY = {
  business_plan: "business_plan",
  client_proposal: "business_proposal",
  sales_letter: "sales_letter",
};

const BLUEPRINT_CACHE_KEY = "ea_blueprint_docs";

function readBlueprintCache(ownerKey) {
  if (!ownerKey || typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(`${BLUEPRINT_CACHE_KEY}:${ownerKey}`);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeBlueprintCache(ownerKey, docs) {
  if (!ownerKey || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${BLUEPRINT_CACHE_KEY}:${ownerKey}`, JSON.stringify(docs));
  } catch {
    // ignore local cache failures
  }
}

export default function BlueprintPage() {
  const workspaceIdStored = useWorkspaceStore((s) => s.workspaceId);
  const workspaceLogoStored = useWorkspaceStore((s) => s.workspaceLogo);
  const setWorkspaceIdStored = useWorkspaceStore((s) => s.setWorkspaceId);
  const setWorkspaceNameStored = useWorkspaceStore((s) => s.setWorkspaceName);
  const setWorkspaceLogoStored = useWorkspaceStore((s) => s.setWorkspaceLogo);
  const ideaValidation = useWorkspaceStore((s) => s.ideaValidation);
  const v4Validation = useWorkspaceStore((s) => s.validation);
  const decisionStatus = useWorkspaceStore((s) => s.decisionStatus);
  const serviceDecisionStatus = useWorkspaceStore((s) => s.serviceDecisionStatus);
  const draftServiceIdea = useWorkspaceStore((s) => s.draftServiceIdea);
  const isMemberMode = useWorkspaceStore((s) => s.isMemberMode);
  const memberPermissionType = useWorkspaceStore((s) => s.memberPermissionType);
  const memberPermissions = useWorkspaceStore((s) => s.memberPermissions);
  const platformRestrictions = useAuthStore((s) => s.platformRestrictions);
  const authEmail = useAuthStore((s) => s.email);
  const subscription = useAuthStore((s) => s.subscription);

  const isFreeOrTrial = !subscription ||
    ["free_trial", "explorer", "expired"].includes(subscription?.plan_key) ||
    subscription?.status === "trial" ||
    subscription?.status === "expired";

  function canBlueprintDoc(docId) {
    const featureKey = DOC_FEATURE_KEY[docId];
    if (!featureKey) return true;
    if ((docId === "client_proposal" || docId === "sales_letter") && isFreeOrTrial) return false;
    if (isPlatformFeatureRestricted("blueprint", featureKey, platformRestrictions)) return false;
    return !isMemberMode || hasFeatureAccess("blueprint", featureKey, memberPermissionType, memberPermissions);
  }
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showInputs, setShowInputs] = useState(true);
  const [inputsTab, setInputsTab] = useState("inputs");
  const [companyName, setCompanyName] = useState("");
  const [industry, setIndustry] = useState("");
  const [pricingModel, setPricingModel] = useState("Subscription");
  const [workspaceId, setWorkspaceId] = useState("");
  const [tone, setTone] = useState("professional");

  const [problem, setProblem] = useState("");
  const [solution, setSolution] = useState("");
  const [targetMarket, setTargetMarket] = useState("");
  const [valueProp, setValueProp] = useState("");
  const [billTo, setBillTo] = useState("");
  const [items, setItems] = useState("");
  const [terms, setTerms] = useState("");
  const [extraNotes, setExtraNotes] = useState("");
  const [proposalLength, setProposalLength] = useState("full");
  const itemsRef = useRef(null);

  // Document-specific (optional) inputs
  const [proposalTitle, setProposalTitle] = useState("");
  const [contactDetails, setContactDetails] = useState("");
  const [timeline, setTimeline] = useState("");
  const [scopeExclusions, setScopeExclusions] = useState("");
  const [assumptions, setAssumptions] = useState("");

  const [headline, setHeadline] = useState("");
  const [proof, setProof] = useState("");
  const [offer, setOffer] = useState("");
  const [cta, setCta] = useState("");
  const [urgency, setUrgency] = useState("");
  const [senderName, setSenderName] = useState("");
  const [senderPosition, setSenderPosition] = useState("");
  const [senderPhone, setSenderPhone] = useState("");
  const [senderEmail, setSenderEmail] = useState("");
  const [senderWebsite, setSenderWebsite] = useState("");
  const [contactName, setContactName] = useState("");
  const [selectedServices, setSelectedServices] = useState([]);
  const [customServiceName, setCustomServiceName] = useState("");
  const [customServiceDescription, setCustomServiceDescription] = useState("");
  const [workspaceProfile, setWorkspaceProfile] = useState(null);
  const [documentLogo, setDocumentLogo] = useState("");
  const [dirtyFields, setDirtyFields] = useState({
    companyName: false,
    industry: false,
    valueProp: false,
    targetMarket: false,
    problem: false,
    solution: false,
    contactDetails: false,
    senderEmail: false,
    senderPhone: false,
    senderWebsite: false,
    selectedServices: false,
  });
  const [objectiveChoiceByDoc, setObjectiveChoiceByDoc] = useState({
    business_plan: BUSINESS_PLAN_OBJECTIVES[0],
    client_proposal: CLIENT_PROPOSAL_OBJECTIVES[0],
    sales_letter: SALES_LETTER_OBJECTIVES[0]
  });
  const [objectiveCustomByDoc, setObjectiveCustomByDoc] = useState({});
  const [followupChoice, setFollowupChoice] = useState("Quick reminder and recap of the main benefit, inviting a short call");
  const [followupCustom, setFollowupCustom] = useState("");

  const [isLoading, setIsLoading] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [didYouKnowIndex, setDidYouKnowIndex] = useState(0);
  const [error, setError] = useState(null);
  const [docByType, setDocByType] = useState({});
  const [docIdByType, setDocIdByType] = useState({});
  const [editedHtmlByType, setEditedHtmlByType] = useState({});
  const [savedDocs, setSavedDocs] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [catalogueServices, setCatalogueServices] = useState([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [customClientName, setCustomClientName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [creditModal, setCreditModal] = useState(null);
  const [savedNotice, setSavedNotice] = useState(null);
  const [shareNotice, setShareNotice] = useState(null);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [sectionsByDoc, setSectionsByDoc] = useState({
    business_plan: [],
    client_proposal: [],
    sales_letter: []
  });
  const [draftSectionsByDoc, setDraftSectionsByDoc] = useState({
    business_plan: [],
    client_proposal: [],
    sales_letter: []
  });
  const [sectionDraftsByDoc, setSectionDraftsByDoc] = useState({});
  const [sectionTabByDoc, setSectionTabByDoc] = useState({});
  const [wordCount, setWordCount] = useState("700");
  const sectionDraftsRef = useRef(null);
  const showSectionDrafts = Boolean(selectedDoc && sectionsForDoc(selectedDoc).length);
  const showSidePanel = isDesktop ? showInputs : true;
  const effectiveInputsTab = !isDesktop && !showInputs ? "sections" : inputsTab;
  const mobileSideTabs = showInputs
    ? [
        { value: "inputs", label: "Inputs" },
        { value: "sections", label: "Section drafts" },
      ]
    : [{ value: "sections", label: "Section drafts" }];

  function SectionTile({ label, selected, snippet, onClick }) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={
          "w-full rounded-2xl border p-4 text-left transition " +
          (selected
            ? "border-brand-300 bg-brand-50 text-brand-800"
            : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50")
        }
      >
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
        {snippet ? (
          <div className="mt-2 text-xs text-slate-600 line-clamp-3">{snippet}</div>
        ) : (
          <div className="mt-2 text-xs text-slate-400">Not generated yet.</div>
        )}
      </button>
    );
  }

  const selectedMeta = useMemo(() => DOCUMENTS.find((d) => d.id === selectedDoc), [selectedDoc]);
  const selectedDocResult = selectedDoc ? docByType[selectedDoc] : null;
  const hasGenerated = Boolean(selectedDocResult?.document_markdown);
  const needsWorkspace = Boolean(selectedMeta?.needsWorkspace);
  const showWorkspaceId = needsWorkspace && !workspaceId.trim();
  const showCoreNarrative =
    selectedDoc === "business_plan" || selectedDoc === "client_proposal" || selectedDoc === "sales_letter";
  const showQuoteFields = selectedDoc === "invoice_template";
  const showSalesLetterExtras = selectedDoc === "sales_letter";
  const showProposalExtras = selectedDoc === "client_proposal";
  const activeCustomers = useMemo(() => customers.filter((c) => !c.archived), [customers]);
  const activeVendors = useMemo(() => vendors.filter((v) => !v.archived), [vendors]);
  const acceptedIdeaValidation = decisionStatus === "accepted" ? ideaValidation : null;
  const OTHER_CUSTOMER_ID = "__other__";
  const draftSectionMap = useMemo(() => {
    if (!selectedDoc) return {};
    const markdown = sectionDraftsByDoc[selectedDoc] || "";
    const base = extractSections(markdown);
    if (selectedDoc === "client_proposal" || selectedDoc === "business_plan") {
      const cover = extractCoverPage(selectedDocResult?.document_markdown || "") || extractCoverPage(markdown);
      if (cover) base["Cover Page"] = cover;
    }
    return base;
  }, [selectedDoc, sectionDraftsByDoc, selectedDocResult?.document_markdown]);
  // Only enter "section preview" mode when the user explicitly selects a section tile.
  // Do not auto-preview the first section on desktop after generating, otherwise the main
  // document preview appears to show just one section.
  const activeDraftSectionId = selectedDoc ? sectionTabByDoc[selectedDoc] || null : null;
  const activeDraftHeading = selectedDoc && activeDraftSectionId
    ? sectionHeadingMap(selectedDoc)[activeDraftSectionId]
    : null;
  const activeDraftBody = activeDraftHeading ? draftSectionMap?.[activeDraftHeading] : "";
  const sectionPreviewHtml =
    activeDraftHeading && activeDraftBody ? buildSectionPreviewHtml(activeDraftHeading, activeDraftBody) : "";
  const showSectionPreview = Boolean(activeDraftSectionId);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(Boolean(mq.matches));
    update();
    if (mq.addEventListener) {
      mq.addEventListener("change", update);
      return () => mq.removeEventListener("change", update);
    }
    mq.addListener(update);
    return () => mq.removeListener(update);
  }, []);

  async function refreshSavedDocs() {
    try {
      const res = await apiRequest("/blueprint/documents?limit=100", "GET");
      const allowedTypes = new Set(DOCUMENTS.map((doc) => doc.id));
      const docs = (Array.isArray(res) ? res : []).filter((doc) => allowedTypes.has(doc?.type));
      setSavedDocs(docs);
      writeBlueprintCache(authEmail, docs);
      return docs;
    } catch {
      const cached = readBlueprintCache(authEmail);
      setSavedDocs(cached);
      return cached;
    }
  }

  const visibleSavedDocs = useMemo(() => {
    const list = [...savedDocs];
    for (const doc of DOCUMENTS) {
      const local = docByType[doc.id];
      if (!local?.document_markdown) continue;
      const localId = docIdByType[doc.id] || null;
      const alreadyListed = list.some((item) => item.id === localId || item.type === doc.id);
      if (alreadyListed) continue;
      list.push({
        id: localId || `local:${doc.id}`,
        type: doc.id,
        title: expectedDocumentTitle(doc.id, companyName || workspaceProfile?.company_name || ""),
        company_name: companyName || workspaceProfile?.company_name || "",
        updated_at: new Date().toISOString(),
      });
    }
    return list.sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime());
  }, [savedDocs, docByType, docIdByType, companyName, workspaceProfile]);

  function expectedDocumentTitle(docId, company) {
    const name = String(company || "").trim() || "Untitled";
    if (docId === "business_plan") return `Business Plan — ${name}`;
    if (docId === "client_proposal") return `Business Proposal — ${name}`;
    if (docId === "sales_letter") return `Sales Letter — ${name}`;
    return `Document — ${name}`;
  }

  function buildCachedDocEntry(docId, docState, documentId = null) {
    return {
      id: documentId || `local:${docId}`,
      type: docId,
      title: expectedDocumentTitle(docId, companyName || workspaceProfile?.company_name || ""),
      company_name: companyName || workspaceProfile?.company_name || "",
      updated_at: new Date().toISOString(),
      document_markdown: docState?.document_markdown || "",
      document_html: docState?.document_html || "",
      provider: docState?.provider || "local",
      model: docState?.model || "local",
    };
  }

  useEffect(() => {
    refreshSavedDocs();
  }, [authEmail]);

  useEffect(() => {
    if (selectedDoc !== "client_proposal" && selectedDoc !== "sales_letter") {
      setSelectedCustomerId("");
      setCustomClientName("");
    }
    setInputsTab("inputs");
    if (selectedDoc) {
      setSectionTabByDoc((prev) => ({ ...prev, [selectedDoc]: null }));
    }
  }, [selectedDoc]);

  useEffect(() => {
    if (!isLoading) return;
    setDidYouKnowIndex(0);
    const id = setInterval(() => {
      setDidYouKnowIndex((prev) => (prev + 1) % DID_YOU_KNOW_FACTS.length);
    }, 10000);
    return () => clearInterval(id);
  }, [isLoading]);

  useEffect(() => {
    if (workspaceIdStored && !workspaceId) setWorkspaceId(workspaceIdStored);
  }, [workspaceIdStored, workspaceId]);

  useEffect(() => {
    if (!acceptedIdeaValidation) return;
    const ctx = acceptedIdeaValidation.context || {};
    const offer = acceptedIdeaValidation.offer || {};
    const prob = acceptedIdeaValidation.problem || {};

    if (!dirtyFields.companyName && !companyName && ctx.business_name) setCompanyName(ctx.business_name);
    if (!dirtyFields.industry && !industry) setIndustry(ctx.primary_industry || ctx.business_type || "");
    if (!dirtyFields.targetMarket && !targetMarket && prob.customer_segment) setTargetMarket(prob.customer_segment);
    if (!dirtyFields.problem && !problem && prob.problem_type) setProblem(prob.problem_type);
    if (!dirtyFields.solution && !solution && offer.service_type) setSolution(offer.service_type);
    if (!dirtyFields.valueProp && !valueProp) {
      const vp = String(ctx.business_offering || ctx.description || offer.service_type || "").trim();
      if (vp) setValueProp(vp);
    }

    const pm = String(offer.pricing_model || "").toLowerCase();
    if (pm && (pricingModel === "Subscription" || !pricingModel)) {
      if (pm === "hourly") setPricingModel("Hourly");
      else if (pm === "retainer") setPricingModel("Retainer");
      else if (pm === "fixed_job") setPricingModel("One-time");
    }
  }, [acceptedIdeaValidation, companyName, dirtyFields, industry, pricingModel, problem, solution, targetMarket, valueProp]);

  useEffect(() => {
    if (serviceDecisionStatus !== "accepted" || !draftServiceIdea) return;
    const svc = draftServiceIdea;
    if (!dirtyFields.industry && !industry) {
      const ind = String(svc.industry || svc.sector || "").trim();
      if (ind) setIndustry(ind);
    }
    if (!dirtyFields.targetMarket && !targetMarket) {
      const tm = String(svc.target_customer_type || "").trim();
      if (tm) setTargetMarket(tm);
    }
    if (!dirtyFields.problem && !problem) {
      const pr = String(svc.problem_to_solve || "").trim();
      if (pr) setProblem(pr);
    }
    if (!dirtyFields.solution && !solution) {
      const sl = String(svc.service_name || svc.service_description || "").trim();
      if (sl) setSolution(sl);
    }
    if (!dirtyFields.valueProp && !valueProp) {
      const vp = String(svc.differentiator || svc.service_description || "").trim();
      if (vp) setValueProp(vp);
    }
    if (!dirtyFields.selectedServices && !selectedServices.length && svc.service_name) {
      setSelectedServices([svc.service_name]);
    }
  }, [serviceDecisionStatus, draftServiceIdea, dirtyFields, industry, targetMarket, problem, solution, valueProp, selectedServices]);

  // V4 universal validation — auto-populate when accepted
  useEffect(() => {
    if (decisionStatus !== "accepted") return;
    if (!v4Validation || v4Validation.engine_version !== "4.0") return;
    const v = v4Validation;
    if (!dirtyFields.companyName && !companyName && v.idea_name) setCompanyName(v.idea_name);
    if (!dirtyFields.industry && !industry) {
      const ind = String(v.idea_sector || v.idea_type || "").trim();
      if (ind) setIndustry(ind);
    }
    if (!dirtyFields.targetMarket && !targetMarket && v.primary_segment) setTargetMarket(v.primary_segment);
    if (!dirtyFields.problem && !problem && v.problem_description) setProblem(v.problem_description);
    if (!dirtyFields.solution && !solution && (v.solution_description || v.idea_name)) setSolution(v.solution_description || v.idea_name);
    if (!dirtyFields.valueProp && !valueProp) {
      const vp = String(v.idea_tagline || v.idea_description || v.solution_description || "").trim();
      if (vp) setValueProp(vp);
    }
    if (!dirtyFields.selectedServices && !selectedServices.length && v.idea_name) {
      setSelectedServices([v.idea_name]);
    }
  }, [decisionStatus, v4Validation, companyName, dirtyFields, industry, targetMarket, problem, solution, valueProp, selectedServices]);

  // When a validated product is selected from the catalogue, populate blueprint fields from its snapshot
  const prevSelectedRef = useRef([]);
  useEffect(() => {
    const prev = prevSelectedRef.current;
    const added = selectedServices.filter((s) => !prev.includes(s));
    prevSelectedRef.current = selectedServices;
    if (!added.length || !catalogueServices.length) return;
    for (const name of added) {
      const product = catalogueServices.find((s) => s.service_name === name);
      const snap = product?.validation_snapshot;
      if (!snap) continue;
      if (!dirtyFields.industry && !industry && snap.industry) setIndustry(snap.industry);
      if (!dirtyFields.targetMarket && !targetMarket && snap.target_customer) setTargetMarket(snap.target_customer);
      if (!dirtyFields.problem && !problem && snap.problem) setProblem(snap.problem);
      if (!dirtyFields.solution && !solution && snap.solution) setSolution(snap.solution);
      if (!dirtyFields.valueProp && !valueProp && snap.value_prop) setValueProp(snap.value_prop);
      break;
    }
  }, [selectedServices, catalogueServices, dirtyFields, industry, targetMarket, problem, solution, valueProp]);

  useEffect(() => {
    let alive = true;
    async function prefillFromWorkspace() {
    if (acceptedIdeaValidation || !workspaceIdStored) return;
      try {
        const ws = await apiRequest(`/validation/${workspaceIdStored}`, "GET");
        if (!alive) return;
        const profile = ws?.data?.business_profile || {};
        const workspaceProfile = ws?.data?.workspace_profile || {};
        const persistedDrafts = ws?.data?.blueprint_section_drafts || {};
        const wpServices = Array.isArray(workspaceProfile.services) ? workspaceProfile.services : [];
        setWorkspaceProfile(workspaceProfile || null);
        if (persistedDrafts && typeof persistedDrafts === "object") {
          setSectionDraftsByDoc((prev) => ({ ...prev, ...persistedDrafts }));
        }
        if (!documentLogo && (workspaceProfile?.logo_data_url || workspaceLogoStored)) {
          setDocumentLogo(String(workspaceProfile?.logo_data_url || workspaceLogoStored || ""));
        }
        if (!dirtyFields.companyName && !companyName && (workspaceProfile.company_name || profile.business_name)) {
          setCompanyName(workspaceProfile.company_name || profile.business_name);
        }
        if (
          !dirtyFields.industry &&
          !industry &&
          (workspaceProfile.primary_industry || profile.primary_industry || profile.business_type)
        ) {
          setIndustry(workspaceProfile.primary_industry || profile.primary_industry || profile.business_type);
        }
        if (
          !dirtyFields.valueProp &&
          !valueProp &&
          (workspaceProfile.key_offering_focus || workspaceProfile.tagline || profile.value_proposition)
        ) {
          setValueProp(workspaceProfile.key_offering_focus || workspaceProfile.tagline || profile.value_proposition);
        }
        if (!dirtyFields.targetMarket && !targetMarket && workspaceProfile.target_customer_type) {
          setTargetMarket(workspaceProfile.target_customer_type);
        }
        if (!dirtyFields.solution && !solution && wpServices.length) {
          const joined = wpServices
            .map((s) => String(s?.service_name || "").trim())
            .filter(Boolean)
            .join(" / ");
          if (joined) setSolution(joined);
          // Also prefill selected services if empty
          if (!dirtyFields.selectedServices && !selectedServices.length) {
            setSelectedServices(wpServices.map((s) => String(s?.service_name || "").trim()).filter(Boolean));
          }
        }
        if (workspaceProfile.primary_revenue_model && pricingModel === "Subscription") {
          const rm = String(workspaceProfile.primary_revenue_model).toLowerCase();
          if (rm.includes("hourly")) setPricingModel("Hourly");
          else if (rm.includes("retainer")) setPricingModel("Retainer");
          else if (rm.includes("subscription")) setPricingModel("Subscription");
          else if (rm.includes("fixed") || rm.includes("one")) setPricingModel("One-time");
          else if (rm.includes("usage")) setPricingModel("Usage-based");
        }
      } catch {
        // ignore
      }
    }
    prefillFromWorkspace();
    return () => {
      alive = false;
    };
  }, [
    acceptedIdeaValidation,
    companyName,
    dirtyFields,
    industry,
    pricingModel,
    selectedServices.length,
    solution,
    targetMarket,
    valueProp,
    workspaceIdStored,
    documentLogo,
    workspaceLogoStored,
  ]);

  useEffect(() => {
    let alive = true;
    async function loadCatalogue() {
      if (!workspaceIdStored) return;
      try {
        const ws = await apiRequest("/validation/me", "GET");
        if (!alive || !ws) return;
        const cat = ws?.data?.catalogue || {};
        setCustomers(Array.isArray(cat.customers) ? cat.customers : []);
        setVendors(Array.isArray(cat.vendors) ? cat.vendors : []);
        const svcProducts = (Array.isArray(cat.products) ? cat.products : [])
          .filter((p) => !p.archived)
          .map((p) => ({
            service_name: String(p.name || "").trim(),
            service_category: p.type || "product",
            service_description: p.description || "",
            validation_snapshot: p.validation_snapshot || null,
          }))
          .filter((s) => s.service_name);
        setCatalogueServices(svcProducts);
      } catch {
        // ignore
      }
    }
    loadCatalogue();
    return () => {
      alive = false;
    };
  }, [workspaceIdStored]);

  useEffect(() => {
    if (!workspaceProfile) return;
    const defaultContact = getWorkspaceContactDetails();
    if (!dirtyFields.contactDetails && !contactDetails && defaultContact && workspaceCompanyMatches()) setContactDetails(defaultContact);
    if (!dirtyFields.senderEmail && !senderEmail && workspaceProfile.email) setSenderEmail(String(workspaceProfile.email));
    if (!dirtyFields.senderPhone && !senderPhone && workspaceProfile.phone_number) setSenderPhone(String(workspaceProfile.phone_number));
    if (!dirtyFields.senderWebsite && !senderWebsite && workspaceProfile.website) setSenderWebsite(String(workspaceProfile.website));
  }, [workspaceProfile, dirtyFields, contactDetails, senderEmail, senderPhone, senderWebsite]);

  async function persistWorkspaceLogo(nextLogo) {
    if (!workspaceProfile || !String(workspaceProfile.company_name || "").trim()) {
      setDocumentLogo(nextLogo || "");
      setWorkspaceLogoStored(nextLogo || null);
      setSavedNotice("Logo applied to this document. Save a full workspace profile to make it permanent.");
      return;
    }
    const nextProfile = { ...(workspaceProfile || {}), logo_data_url: nextLogo || null };
    setWorkspaceProfile(nextProfile);
    setDocumentLogo(nextLogo || "");
    setWorkspaceLogoStored(nextLogo || null);
    try {
      const ws = await apiRequest("/validation/me", "PATCH", { data: { workspace_profile: nextProfile } });
      if (ws?.id) setWorkspaceIdStored(ws.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save workspace logo.");
    }
  }

  async function handleDocumentLogoChange(file) {
    if (!file) return;
    try {
      const dataUrl = await imageFileToDataUrl(file);
      await persistWorkspaceLogo(dataUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load logo.");
    }
  }

  async function syncWorkspaceProfile() {
    const businessProfile = {};
    if (String(companyName || "").trim()) businessProfile.business_name = String(companyName || "").trim();
    if (String(industry || "").trim()) {
      businessProfile.primary_industry = String(industry || "").trim();
      businessProfile.business_type = String(industry || "").trim();
    }
    if (String(valueProp || "").trim()) businessProfile.value_proposition = String(valueProp || "").trim();
    const workspaceProfilePatch =
      workspaceProfile && typeof workspaceProfile === "object"
        ? { ...workspaceProfile, logo_data_url: documentLogo || workspaceProfile.logo_data_url || null }
        : null;
    const hasAny = Object.keys(businessProfile).length > 0 || Boolean(workspaceProfilePatch);
    if (!hasAny) return;
    try {
      const ws = await apiRequest("/validation/me", "PATCH", {
        data: {
          ...(Object.keys(businessProfile).length ? { business_profile: businessProfile } : {}),
          ...(workspaceProfilePatch ? { workspace_profile: workspaceProfilePatch } : {})
        }
      });
      if (ws?.id) {
        setWorkspaceIdStored(ws.id);
        if (ws?.name) setWorkspaceNameStored(ws.name);
      }
    } catch {
      // ignore
    }
  }

  async function openSavedDocument(docItem) {
    setIsLoading(true);
    setError(null);
    if (docItem?.type) {
      setSelectedDoc(docItem.type);
      setIsModalOpen(true);
      setShowInputs(false);
    }
    try {
      const docId = docItem?.id || docItem;
      const doc = await apiRequest(`/blueprint/documents/${docId}`, "GET");
      const type = doc?.type;
      if (!type) throw new Error("Invalid document");
      const id = doc?._id || doc?.id || docId;
      setSelectedDoc(type);
      setDocIdByType((prev) => ({ ...prev, [type]: id }));
      setDocByType((prev) => ({
        ...prev,
        [type]: {
          document_markdown: doc.document_markdown || "",
          document_html: doc.document_html || null,
          provider: doc.provider || "saved",
          model: doc.model || "saved",
          warnings: []
        }
      }));
      setEditedHtmlByType((prev) => ({ ...prev, [type]: doc.document_html || "" }));
      setSectionDraftsByDoc((prev) => ({ ...prev, [type]: doc.document_markdown || "" }));
      setDraftSectionsByDoc((prev) => ({
        ...prev,
        [type]: sectionsForDoc(type).map((s) => s.id)
      }));
      setSectionTabByDoc((prev) => ({ ...prev, [type]: null }));
    } catch (e) {
      // If 404, the document was deleted server-side — purge it from local state and cache
      const is404 = String(e?.message || "").includes("404") || String(e?.message || "").toLowerCase().includes("not found");
      if (is404) {
        const missingType = docItem?.type;
        const missingId = docItem?.id;
        setSavedDocs((prev) => prev.filter((d) => d.id !== missingId && d.type !== missingType));
        if (missingType) setDocByType((prev) => ({ ...prev, [missingType]: null }));
        if (authEmail) {
          writeBlueprintCache(authEmail, readBlueprintCache(authEmail).filter(
            (d) => d.id !== missingId && d.type !== missingType
          ));
        }
        setError(null);
        setIsLoading(false);
        return;
      }
      const cached = readBlueprintCache(authEmail).find((item) => item.id === docItem?.id || item.type === docItem?.type);
      if (cached?.type && cached?.document_markdown) {
        const type = cached.type;
        setSelectedDoc(type);
        setDocIdByType((prev) => ({ ...prev, [type]: String(cached.id || "").startsWith("local:") ? null : cached.id }));
        setDocByType((prev) => ({
          ...prev,
          [type]: {
            document_markdown: cached.document_markdown || "",
            document_html: cached.document_html || null,
            provider: cached.provider || "cached",
            model: cached.model || "cached",
            warnings: [],
          }
        }));
        setEditedHtmlByType((prev) => ({ ...prev, [type]: cached.document_html || "" }));
        setSectionDraftsByDoc((prev) => ({ ...prev, [type]: cached.document_markdown || "" }));
        setDraftSectionsByDoc((prev) => ({
          ...prev,
          [type]: sectionsForDoc(type).map((s) => s.id)
        }));
        setSectionTabByDoc((prev) => ({ ...prev, [type]: null }));
      } else {
        setError(e instanceof Error ? e.message : "Failed to open saved document");
      }
      setIsModalOpen(true);
    } finally {
      setIsLoading(false);
    }
  }

  function completionFor(docId) {
    const hasCompany = companyName.trim().length >= 2;
    const coreCount = [
      problem.trim().length > 0,
      solution.trim().length > 0,
      targetMarket.trim().length > 0,
      valueProp.trim().length > 0
    ].filter(Boolean).length;

    const needsWs = DOCUMENTS.find((d) => d.id === docId)?.needsWorkspace;
    if (needsWs) return hasCompany && workspaceId.trim() ? 100 : hasCompany ? 60 : 20;

    if (docId === "invoice_template") {
      const extra = [billTo.trim().length > 0, items.trim().length > 0].filter(Boolean).length;
      return hasCompany ? 40 + coreCount * 10 + extra * 20 : 15;
    }

    return hasCompany ? 35 + coreCount * 15 : 15;
  }

  function openDoc(docId) {
    const saved = visibleSavedDocs.find((d) => d.type === docId && !String(d.id || "").startsWith("local:"));
    if (saved) {
      openSavedDocument(saved);
      return;
    }
    const localDoc = visibleSavedDocs.find((d) => d.type === docId && String(d.id || "").startsWith("local:"));
    if (localDoc) {
      setSelectedDoc(docId);
      setError(null);
      setShowInputs(false);
      setIsModalOpen(true);
      return;
    }
    setSelectedDoc(docId);
    setError(null);
    setShowInputs(!Boolean(docByType[docId]?.document_markdown));
    setIsModalOpen(true);
  }

  function closeModal() {
    setIsModalOpen(false);
    setIsLoading(false);
    setError(null);
  }

  function addItemLine() {
    setItems((prev) => (prev ? `${prev.trimEnd()}\n` : "") + "Item description");
    requestAnimationFrame(() => {
      if (itemsRef.current) {
        itemsRef.current.focus();
        itemsRef.current.selectionStart = itemsRef.current.selectionEnd = itemsRef.current.value.length;
      }
    });
  }

  function toggleSection(docId, sectionId) {
    setSectionsByDoc((prev) => {
      const current = prev[docId] || [];
      const exists = current.includes(sectionId);
      const next = exists ? current.filter((s) => s !== sectionId) : [...current, sectionId];
      return { ...prev, [docId]: next };
    });
  }

  function sectionsForDoc(docId) {
    if (docId === "business_plan") return BUSINESS_PLAN_SECTIONS;
    if (docId === "client_proposal") return CLIENT_PROPOSAL_SECTIONS;
    if (docId === "sales_letter") return SALES_LETTER_SECTIONS;
    return [];
  }

  function generationSectionsForDoc(docId) {
    const allSections = sectionsForDoc(docId);
    if (docId === "business_plan" || docId === "client_proposal") {
      return allSections.filter((section) => section.id !== "cover_page");
    }
    return allSections;
  }

  function toggleDraftSection(docId, sectionId) {
    setDraftSectionsByDoc((prev) => {
      const current = prev[docId] || [];
      const exists = current.includes(sectionId);
      const next = exists ? current.filter((s) => s !== sectionId) : [...current, sectionId];
      return { ...prev, [docId]: next };
    });
  }

  async function handleDraftTileClick(sectionId) {
    if (!selectedDoc) return;
    const heading = sectionHeadingMap(selectedDoc)[sectionId];
    const existing = heading ? draftSectionMap[heading] : "";
    if (!isDesktop) setInputsTab("sections");
    setSectionTabByDoc((prev) => ({ ...prev, [selectedDoc]: sectionId }));
    if ((selectedDoc === "business_plan" || selectedDoc === "client_proposal") && sectionId === "cover_page") return;
    if (existing) return;
    setDraftSectionsByDoc((prev) => {
      const current = prev[selectedDoc] || [];
      if (current.includes(sectionId)) return prev;
      return { ...prev, [selectedDoc]: [...current, sectionId] };
    });
    await generateSectionDrafts([sectionId]);
  }

  function objectivesForDoc(docId) {
    if (docId === "business_plan") return BUSINESS_PLAN_OBJECTIVES;
    if (docId === "client_proposal") return CLIENT_PROPOSAL_OBJECTIVES;
    return [];
  }

  function sectionHeadingMap(docId) {
    if (docId === "business_plan") {
      return {
        cover_page: "Cover Page",
        executive_summary: "Executive Summary",
        business_overview: "Business Overview",
        products_services: "Products and Services",
        market_analysis: "Market Analysis",
        competitive_analysis: "Competitive Analysis",
        business_model: "Business Model",
        marketing_sales_strategy: "Marketing and Sales Strategy",
        operations_plan: "Operations Plan",
        management_organisation: "Management and Organisation",
        financial_snapshot: "Financial Snapshot",
        funding_requirements: "Funding Requirements",
        risk_analysis_mitigation: "Risk Analysis and Mitigation",
        conclusion: "Conclusion"
      };
    }
    if (docId === "client_proposal") {
      return {
        cover_page: "Cover Page",
        executive_summary: "Executive Summary",
        client_needs: "Client Needs / Problem Statement",
        proposed_solution: "Proposed Solution",
        scope_of_work: "Scope of Work",
        methodology: "Methodology / Approach",
        timeline: "Timeline / Delivery Schedule",
        pricing_terms: "Pricing and Payment Terms",
        value_benefits: "Value Proposition / Benefits",
        company_profile: "Company Profile",
        terms_conditions: "Terms and Conditions",
        acceptance: "Acceptance / Next Steps"
      };
    }
    if (docId === "sales_letter") {
      return {
        headline: "Headline",
        hook: "Opening / Hook",
        problem: "Problem Statement",
        solution: "Solution Introduction",
        benefits: "Benefits",
        proof: "Proof / Credibility",
        offer: "Offer",
        cta: "Call to Action",
        urgency: "Urgency / Scarcity",
        closing: "Closing",
        followup: "Follow-up Summary"
      };
    }
    return {};
  }

  function extractSections(markdown) {
    const lines = String(markdown || "").split("\n");
    const sections = {};
    let current = null;
    let buffer = [];
    for (const line of lines) {
      if (line.startsWith("## ") || line.startsWith("### ")) {
        if (current) sections[current] = buffer.join("\n").trim();
        current = line.replace(/^###?\s+/, "").trim();
        buffer = [];
      } else {
        if (current) buffer.push(line);
      }
    }
    if (current) sections[current] = buffer.join("\n").trim();
    return sections;
  }

  function extractCoverPage(markdown) {
    const s = String(markdown || "");
    const start = s.indexOf('<div class="cover-page">');
    if (start === -1) return "";
    const tail = s.slice(start);
    const pageBreakIdx = tail.indexOf('<div class="page-break"></div>');
    if (pageBreakIdx !== -1) return tail.slice(0, pageBreakIdx).trim();
    const altBreakIdx = tail.indexOf("<div class='page-break'></div>");
    if (altBreakIdx !== -1) return tail.slice(0, altBreakIdx).trim();
    const headingMatch = tail.match(/\n##\s+/);
    if (headingMatch && typeof headingMatch.index === "number" && headingMatch.index > 0) {
      return tail.slice(0, headingMatch.index).trim();
    }
    return tail.trim();
  }

  function htmlToPseudoMarkdown(html) {
    const source = String(html || "").trim();
    if (!source) return "";
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(source, "text/html");
      const parts = [];
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT);
      let node = walker.currentNode;
      while (node) {
        const tag = String(node.tagName || "").toLowerCase();
        if (tag === "h2" || tag === "h3") {
          const level = tag === "h2" ? "##" : "###";
          const text = String(node.textContent || "").trim();
          if (text) parts.push(`${level} ${text}`);
        } else if (tag === "p") {
          const text = String(node.textContent || "").trim();
          if (text) parts.push(text);
        } else if (tag === "li") {
          const text = String(node.textContent || "").trim();
          if (text) parts.push(`- ${text}`);
        }
        node = walker.nextNode();
      }
      return parts.join("\n\n").trim();
    } catch {
      return "";
    }
  }

  function stripMarkdown(text) {
    const raw = String(text || "");
    if (!raw) return "";
    return raw
      .replace(/<[^>]+>/g, " ")
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/^>\s?/gm, "")
      .replace(/^\s*\|.*\|\s*$/gm, " ")
      .replace(/^\s*\|?[-:\s|]+\|?\s*$/gm, " ")
      .replace(/\|/g, " ")
      .replace(/^\s*[-*+]\s+/gm, "")
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/__(.+?)__/g, "$1")
      .replace(/\[(.+?)\]\(.+?\)/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
  }

  function buildSectionPreviewHtml(title, body) {
    const isSalesLetter = selectedDoc === "sales_letter";
    const heading = isSalesLetter ? "" : stripMarkdown(title || "");
    const cleaned = String(body || "")
      .replaceAll("\r\n", "\n")
      .replace(/^##\s*cover page\s*$/gim, "")
      .replace(/^###\s*cover page\s*$/gim, "")
      .replace(/^cover_page\s*$/gim, "")
      .trim();
    if (!heading && !cleaned) return "";
    if (cleaned.includes('<div class="cover-page">')) return cleaned;
    const paragraphs = cleaned.split(/\n{2,}/g).map((p) => p.trim()).filter(Boolean);
    const parts = [];
    if (heading) {
      parts.push(`<h2 style="text-align:center;">${heading}</h2>`);
    }
    paragraphs.forEach((para) => {
      const lines = para.split("\n");
      const bullets = lines.filter((l) => l.trim().startsWith("- "));
      if (bullets.length === lines.length && bullets.length) {
        parts.push("<ul>");
        bullets.forEach((b) => {
          parts.push(`<li>${stripMarkdown(b.replace(/^\s*-\s+/, ""))}</li>`);
        });
        parts.push("</ul>");
      } else {
        parts.push(`<p>${stripMarkdown(para)}</p>`);
      }
    });
    return parts.join("");
  }

  function getObjectiveValue(docId) {
    const choice = objectiveChoiceByDoc[docId] || "";
    if (docId === "sales_letter") {
      if (choice === "Other") {
        return String(objectiveCustomByDoc[docId] || "").trim();
      }
      return String(choice || "").trim();
    }
    if (choice === "Other") {
      return String(objectiveCustomByDoc[docId] || "").trim();
    }
    return String(choice || "").trim();
  }

  function workspaceCompanyMatches() {
    const wsName = String(workspaceProfile?.company_name || "").trim();
    if (!wsName) return true;
    if (!companyName.trim()) return true;
    return companyName.trim().toLowerCase() === wsName.toLowerCase();
  }

  function resolveWithWorkspace(value, fallback, isDirty = false) {
    const v = String(value || "").trim();
    if (isDirty) return v;
    if (v) return v;
    return workspaceCompanyMatches() ? String(fallback || "").trim() : "";
  }

  function getWorkspaceContactDetails() {
    if (!workspaceProfile) return "";
    const parts = [
      workspaceProfile.email,
      workspaceProfile.phone_number,
      workspaceProfile.website
    ]
      .map((v) => String(v || "").trim())
      .filter(Boolean);
    return parts.join(" | ");
  }

  function getSectionSnippet(docId, sectionId) {
    if ((docId === "business_plan" || docId === "client_proposal") && sectionId === "cover_page") {
      const cover = extractCoverPage(docByType?.[docId]?.document_markdown || "");
      const flatCover = stripMarkdown(cover);
      if (!flatCover) return "";
      return flatCover.length > 120 ? `${flatCover.slice(0, 120)}...` : flatCover;
    }
    const heading = sectionHeadingMap(docId)[sectionId];
    const body = heading ? draftSectionMap[heading] : "";
    if (!body) return "";
    const flat = stripMarkdown(body);
    if (!flat) return "";
    return flat.length > 120 ? `${flat.slice(0, 120)}...` : flat;
  }

  function mergeSectionDrafts(docId, existingMarkdown, incomingMarkdown) {
    const existing = extractSections(existingMarkdown || "");
    const incoming = extractSections(incomingMarkdown || "");
    if (docId === "client_proposal" || docId === "business_plan") {
      const coverExisting = extractCoverPage(existingMarkdown);
      const coverIncoming = extractCoverPage(incomingMarkdown);
      if (coverExisting) existing["Cover Page"] = coverExisting;
      if (coverIncoming) incoming["Cover Page"] = coverIncoming;
    }
    const merged = { ...existing, ...incoming };
    const headingMap = sectionHeadingMap(docId);
    const orderedHeadings = sectionsForDoc(docId)
      .map((s) => headingMap[s.id])
      .filter(Boolean);
    const parts = [];
    orderedHeadings.forEach((heading) => {
      if (merged[heading]) {
        parts.push(`## ${heading}\n${merged[heading].trim()}`);
      }
    });
    return parts.join("\n\n").trim();
  }

  function formatPaymentTerms(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const numeric = Number(raw);
    if (Number.isFinite(numeric)) return `${numeric} days`;
    return raw;
  }

  function applyCustomerSelection(customerId) {
    setSelectedCustomerId(customerId);
    if (!customerId) return;
    if (customerId === OTHER_CUSTOMER_ID) {
      setCustomClientName("");
      setBillTo("");
      return;
    }
    const customer = activeCustomers.find((c) => c.id === customerId);
    const vendor = activeVendors.find((v) => v.id === customerId);
    const entry = customer || vendor;
    if (!entry) return;
    if (selectedDoc === "client_proposal") {
      setBillTo(`${entry.name}`);
      if (!dirtyFields.targetMarket && !targetMarket) setTargetMarket(entry.industry || entry.name);
      if (!terms && entry.payment_terms) {
        const formatted = formatPaymentTerms(entry.payment_terms);
        if (formatted) setTerms(`Payment terms: ${formatted}`);
      }
    }
    if (selectedDoc === "sales_letter") {
      setBillTo(`${entry.name}`);
      if (!String(contactName || "").trim()) setContactName(entry.name);
      if (!dirtyFields.targetMarket && !targetMarket) setTargetMarket(entry.name);
    }
  }

  // FIX 3: Helper to build resolved selected_services payload (shared by both generate fns)
  function resolveSelectedServices() {
    return selectedServices
      .map((s) => {
        if (s !== "__other__") return s;
        const name = String(customServiceName || "").trim();
        const desc = String(customServiceDescription || "").trim();
        if (!name && !desc) return "";
        if (name && desc) return `${name}: ${desc}`;
        return name || desc;
      })
      .filter(Boolean);
  }

  // FIX 4: Retry wrapper with exponential backoff for network errors
  async function apiRequestWithRetry(path, method, body, options = {}, maxRetries = 2) {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await apiRequest(path, method, body, options);
      } catch (e) {
        lastError = e;
        const msg = String(e?.message || "").toLowerCase();
        const isNetwork = msg.includes("network") || msg.includes("failed to fetch") || msg.includes("timeout") || msg.includes("load");
        if (!isNetwork || attempt === maxRetries) throw e;
        // Exponential backoff: 1s, 2s
        await new Promise((res) => setTimeout(res, 1000 * Math.pow(2, attempt)));
      }
    }
    throw lastError;
  }

	  async function generateSelected() {
    const resolvedCompanyName = resolveWithWorkspace(companyName, workspaceProfile?.company_name, dirtyFields.companyName);
    const resolvedIndustry = resolveWithWorkspace(industry, workspaceProfile?.primary_industry, dirtyFields.industry);
    const resolvedValueProp = resolveWithWorkspace(
      valueProp,
      workspaceProfile?.key_offering_focus || workspaceProfile?.tagline,
      dirtyFields.valueProp
    );
    const resolvedTargetMarket = resolveWithWorkspace(targetMarket, workspaceProfile?.target_customer_type, dirtyFields.targetMarket);
    const resolvedContactDetails = resolveWithWorkspace(contactDetails, getWorkspaceContactDetails(), dirtyFields.contactDetails);
    const resolvedSenderEmail = resolveWithWorkspace(senderEmail, workspaceProfile?.email, dirtyFields.senderEmail);
    const resolvedSenderPhone = resolveWithWorkspace(senderPhone, workspaceProfile?.phone_number, dirtyFields.senderPhone);
    const resolvedSenderWebsite = resolveWithWorkspace(senderWebsite, workspaceProfile?.website, dirtyFields.senderWebsite);
    if (resolvedCompanyName.trim().length < 2) {
      setError("Enter a business name to generate documents.");
      setShowInputs(true);
      return;
    }
    if ((selectedDoc === "client_proposal" || selectedDoc === "sales_letter") && !String(billTo || customClientName).trim()) {
      setError("Select a client from your catalogue or type a client name to continue.");
      setShowInputs(true);
      return;
    }
    if (selectedDoc === "sales_letter") {
      const wc = Number(wordCount);
      if (!wc || wc <= 0) {
        setError("Enter a target word count for the sales letter.");
        setShowInputs(true);
        return;
      }
    }
    if (needsWorkspace && !workspaceId.trim()) {
      setError("Paste an Idea Validation workspace id to generate this document.");
      setShowInputs(true);
      return;
    }
    if (isFreeOrTrial && selectedDoc === "business_plan") {
      const existingBizPlans = savedDocs.filter(d => d.type === "business_plan" && !String(d.id || "").startsWith("local:"));
      if (existingBizPlans.length >= 1 && !docIdByType["business_plan"]) {
        setError("Free plan allows 1 Business Plan. Delete the existing one or upgrade to generate more.");
        setShowInputs(true);
        return;
      }
    }

	    // Sections behavior:
	    // - For narrative docs (business plan / proposal): allow section-scoped generation.
	    // - For sales letters: always generate the full letter (section drafts are handled separately).
	    const chosenSections = (sectionsByDoc[selectedDoc] || []).filter((sectionId) => sectionId !== "cover_page");
	    const userSelectedSections = chosenSections.length > 0;
	    const sectionsPayload =
	      selectedDoc === "sales_letter"
	        ? null
	        : (userSelectedSections ? chosenSections : generationSectionsForDoc(selectedDoc).map((s) => s.id));

    const wantsSnapshot =
      selectedDoc === "business_plan" && sectionsPayload.includes("financial_snapshot");
    setSectionTabByDoc((prev) => ({ ...prev, [selectedDoc]: null }));
    const chosen = (sectionsByDoc[selectedDoc] || []).filter((sectionId) => sectionId !== "cover_page");
    await syncWorkspaceProfile();
    setIsLoading(true);
    setError(null);
    // Don't null-clear docByType here — preserve existing content while loading
    // so that partial re-generates don't wipe previously generated sections from preview
    try {
      // FIX 4: Use retry wrapper
      const generateBody = {
        document_id: docIdByType[selectedDoc] || null,
        type: selectedDoc,
        company_name: resolvedCompanyName,
        logo_data_url: documentLogo || workspaceProfile?.logo_data_url || workspaceLogoStored || null,
        industry: resolvedIndustry,
        pricing_model: pricingModel,
        workspace_id: (workspaceId || workspaceIdStored || "").trim() || null,
        include_validation_snapshot: wantsSnapshot,
        problem,
        solution,
        target_market: resolvedTargetMarket,
        value_proposition: resolvedValueProp,
        tone,
        extra_notes: extraNotes,
        selected_services: resolveSelectedServices(),
        bill_to: billTo || customClientName,
        items,
        terms,

        proposal_title: proposalTitle,
        contact_details: resolvedContactDetails,
        timeline,
        scope_exclusions: scopeExclusions,
        assumptions,

        headline,
        proof,
        offer,
        cta,
        urgency,
        sender_name: senderName,
        sender_position: senderPosition,
        sender_phone: resolvedSenderPhone,
        sender_email: resolvedSenderEmail,
        sender_website: resolvedSenderWebsite,
        contact_name: contactName,
        objective: getObjectiveValue(selectedDoc),
        subject_lines: getObjectiveValue("sales_letter"),
        followup_sequence: followupChoice === "Other" ? followupCustom : followupChoice,
        sections: sectionsPayload,
        word_count: selectedDoc === "sales_letter" ? Number(wordCount) || null : null,
        proposal_length: selectedDoc === "client_proposal" ? proposalLength : null,
      };
      const res = await apiRequestWithRetry("/blueprint/generate", "POST", generateBody, { timeoutMs: 900000 });
      let resolvedDocumentId = res?.document_id || null;
      if (!resolvedDocumentId) {
        const latestDocs = await refreshSavedDocs();
        const expectedTitle = expectedDocumentTitle(selectedDoc, resolvedCompanyName);
        const matchedDoc =
          latestDocs.find((doc) =>
            doc?.type === selectedDoc &&
            String(doc?.title || "").trim() === expectedTitle &&
            String(doc?.company_name || "").trim().toLowerCase() === resolvedCompanyName.trim().toLowerCase()
          ) ||
          latestDocs.find((doc) =>
            doc?.type === selectedDoc &&
            String(doc?.company_name || "").trim().toLowerCase() === resolvedCompanyName.trim().toLowerCase()
          );
        resolvedDocumentId = matchedDoc?.id || null;
      }
      if (resolvedDocumentId) {
        setDocIdByType((prev) => ({ ...prev, [selectedDoc]: resolvedDocumentId }));
      }
      setEditedHtmlByType((prev) => ({ ...prev, [selectedDoc]: "" }));
	      const incomingMarkdown =
	        res?.document_markdown || (res?.document_html ? htmlToPseudoMarkdown(res.document_html) : "");
	      if (incomingMarkdown) {
          if (selectedDoc !== "sales_letter") {
            // Always merge into section drafts so previously generated sections remain available as tiles.
            setSectionDraftsByDoc((prev) => {
              const merged = mergeSectionDrafts(selectedDoc, prev[selectedDoc] || "", incomingMarkdown);
              return { ...prev, [selectedDoc]: merged };
            });
            setDraftSectionsByDoc((prev) => ({
              ...prev,
              [selectedDoc]: sectionsForDoc(selectedDoc).map((s) => s.id)
            }));
          } else {
            try {
              const resDrafts = await apiRequestWithRetry(
                "/blueprint/generate",
                "POST",
                {
                  ...generateBody,
                  document_id: null,
                  sections: sectionsForDoc(selectedDoc).map((s) => s.id),
                },
                { timeoutMs: 900000 }
              );
              const draftsMarkdown = resDrafts?.document_markdown || "";
              if (draftsMarkdown) {
                setSectionDraftsByDoc((prev) => {
                  const merged = mergeSectionDrafts(selectedDoc, prev[selectedDoc] || "", draftsMarkdown);
                  return { ...prev, [selectedDoc]: merged };
                });
                setDraftSectionsByDoc((prev) => ({
                  ...prev,
                  [selectedDoc]: sectionsForDoc(selectedDoc).map((s) => s.id)
                }));
              }
            } catch {
              // Keep the full document visible even if section-draft backfill fails.
            }
          }

	        // Preview behavior depends on whether the user selected sections.
	        // If they selected specific sections, show ONLY the generated subset.
	        // If they selected none, the API generated the full document already.
	        setDocByType((prev) => {
	          return {
	            ...prev,
	            [selectedDoc]: {
	              ...res,
	              document_id: resolvedDocumentId,
	              document_markdown: incomingMarkdown,
	              document_html: (res.document_html ?? null),
	            }
	          };
	        });
	      } else {
	        setDocByType((prev) => ({
            ...prev,
            [selectedDoc]: {
              ...res,
              document_id: resolvedDocumentId,
            },
          }));
	      }
      if (!resolvedDocumentId) {
        const warnings = Array.isArray(res?.warnings) ? res.warnings : [];
        const saveWarning = warnings.find((message) =>
          String(message || "").toLowerCase().includes("could not save document")
        );
        if (saveWarning) setError(saveWarning);
      }
      setShowInputs(false);
      const nextDocState = {
        ...res,
        document_id: resolvedDocumentId,
        document_markdown: incomingMarkdown || res?.document_markdown || "",
        document_html: (res?.document_html ?? null),
      };
      writeBlueprintCache(authEmail, [
        buildCachedDocEntry(selectedDoc, nextDocState, resolvedDocumentId),
        ...savedDocs.filter((item) => item.type !== selectedDoc),
      ]);
      await refreshSavedDocs();
    } catch (e) {
      const rawMsg = e instanceof Error ? e.message : String(e || "");
      const msg = rawMsg.toLowerCase();
      const isNetwork = msg.includes("network") || msg.includes("failed to fetch") || msg.includes("load");
      const is403 = rawMsg.startsWith("HTTP 403:");
      setError(
        isNetwork
          ? "Network error — please check your connection and try again. Your inputs are saved."
          : is403
          ? rawMsg.replace(/^HTTP 403:\s*/i, "")
          : rawMsg || "Blueprint generation failed"
      );
      setShowInputs(true);
    } finally {
      setIsLoading(false);
      window.dispatchEvent(new CustomEvent("ea:credits:refresh"));
    }
  }

  async function generateSectionDrafts(overrideSections = null) {
    if (!selectedDoc) return;
    const chosen = overrideSections || draftSectionsByDoc[selectedDoc] || [];
    if (!chosen.length) {
      setError("Select at least one section to generate.");
      setShowInputs(true);
      return;
    }
    const resolvedCompanyName = resolveWithWorkspace(companyName, workspaceProfile?.company_name, dirtyFields.companyName);
    const resolvedIndustry = resolveWithWorkspace(industry, workspaceProfile?.primary_industry, dirtyFields.industry);
    const resolvedValueProp = resolveWithWorkspace(
      valueProp,
      workspaceProfile?.key_offering_focus || workspaceProfile?.tagline,
      dirtyFields.valueProp
    );
    const resolvedTargetMarket = resolveWithWorkspace(targetMarket, workspaceProfile?.target_customer_type, dirtyFields.targetMarket);
    const resolvedContactDetails = resolveWithWorkspace(contactDetails, getWorkspaceContactDetails(), dirtyFields.contactDetails);
    const resolvedSenderEmail = resolveWithWorkspace(senderEmail, workspaceProfile?.email, dirtyFields.senderEmail);
    const resolvedSenderPhone = resolveWithWorkspace(senderPhone, workspaceProfile?.phone_number, dirtyFields.senderPhone);
    const resolvedSenderWebsite = resolveWithWorkspace(senderWebsite, workspaceProfile?.website, dirtyFields.senderWebsite);
    if (resolvedCompanyName.trim().length < 2) {
      setError("Enter a business name to generate document sections.");
      setShowInputs(true);
      return;
    }
    if ((selectedDoc === "client_proposal" || selectedDoc === "sales_letter") && !String(billTo || customClientName).trim()) {
      setError("Select a client from your catalogue or type a client name to continue.");
      setShowInputs(true);
      return;
    }
    if (selectedDoc === "sales_letter") {
      const wc = Number(wordCount);
      if (!wc || wc <= 0) {
        setError("Enter a target word count for the sales letter.");
        setShowInputs(true);
        return;
      }
    }
    if (needsWorkspace && !workspaceId.trim()) {
      setError("Paste an Idea Validation workspace id to generate this document.");
      setShowInputs(true);
      return;
    }
    await syncWorkspaceProfile();
    setIsLoading(true);
    setError(null);
    try {
      // FIX 4: Use retry wrapper
      const res = await apiRequestWithRetry("/blueprint/generate", "POST", {
        type: selectedDoc,
        company_name: resolvedCompanyName,
        logo_data_url: documentLogo || workspaceProfile?.logo_data_url || workspaceLogoStored || null,
        industry: resolvedIndustry,
        pricing_model: pricingModel,
        workspace_id: (workspaceId || workspaceIdStored || "").trim() || null,
        include_validation_snapshot:
          selectedDoc === "business_plan" && chosen.includes("financial_snapshot"),
        problem,
        solution,
        target_market: resolvedTargetMarket,
        value_proposition: resolvedValueProp,
        tone,
        extra_notes: extraNotes,
        selected_services: resolveSelectedServices(),
        bill_to: billTo || customClientName,
        items,
        terms,

        proposal_title: proposalTitle,
        contact_details: resolvedContactDetails,
        timeline,
        scope_exclusions: scopeExclusions,
        assumptions,

        headline,
        proof,
        offer,
        cta,
        urgency,
        sender_name: senderName,
        sender_position: senderPosition,
        sender_phone: resolvedSenderPhone,
        sender_email: resolvedSenderEmail,
        sender_website: resolvedSenderWebsite,
        contact_name: contactName,
        objective: getObjectiveValue(selectedDoc),
        subject_lines: getObjectiveValue("sales_letter"),
        followup_sequence: followupChoice === "Other" ? followupCustom : followupChoice,
        sections: chosen,
        word_count: selectedDoc === "sales_letter" ? Number(wordCount) || null : null
      }, { timeoutMs: 900000 });
      const markdown = res?.document_markdown || "";
      setSectionDraftsByDoc((prev) => ({
        ...prev,
        [selectedDoc]: mergeSectionDrafts(selectedDoc, prev[selectedDoc] || "", markdown)
      }));
    } catch (e) {
      const msg = String(e?.message || "").toLowerCase();
      const isNetwork = msg.includes("network") || msg.includes("failed to fetch") || msg.includes("load");
      setError(
        isNetwork
          ? "Network error — please check your connection and try again. Your inputs are saved."
          : (e instanceof Error ? e.message : "Section generation failed")
      );
      setShowInputs(true);
    } finally {
      setIsLoading(false);
    }
  }

  async function saveEdits() {
    const docId = selectedDoc ? docIdByType[selectedDoc] : null;
    if (!selectedDoc || !docId) return;
    const html =
      (editedHtmlByType[selectedDoc] && String(editedHtmlByType[selectedDoc]).trim()
        ? editedHtmlByType[selectedDoc]
        : (selectedDocResult?.document_html || ""));
    const draftsMarkdown = (selectedDoc ? sectionDraftsByDoc[selectedDoc] : "") || "";
    const fullDocumentMarkdown = selectedDocResult?.document_markdown || draftsMarkdown || "";
    setIsSaving(true);
    setError(null);
    try {
      await apiRequest(`/blueprint/documents/${docId}`, "PATCH", {
        document_html: html,
        document_markdown: fullDocumentMarkdown
      });
      if (workspaceIdStored) {
        const ws = await apiRequest("/validation/me", "GET");
        const existingDrafts =
          ws?.data?.blueprint_section_drafts && typeof ws.data.blueprint_section_drafts === "object"
            ? ws.data.blueprint_section_drafts
            : {};
        await apiRequest("/validation/me", "PATCH", {
          data: {
            blueprint_section_drafts: {
              ...existingDrafts,
              [selectedDoc]: draftsMarkdown
            }
          }
        });
      }
      writeBlueprintCache(authEmail, [
        buildCachedDocEntry(selectedDoc, {
          document_markdown: fullDocumentMarkdown,
          document_html: html,
          provider: selectedDocResult?.provider || "saved",
          model: selectedDocResult?.model || "saved",
        }, docId),
        ...savedDocs.filter((item) => item.id !== docId && item.type !== selectedDoc),
      ]);
      await refreshSavedDocs();
      setSavedNotice("Saved");
      setTimeout(() => setSavedNotice(null), 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save changes");
    } finally {
      setIsSaving(false);
    }
  }

  function getSelectedDocumentPayload() {
    if (!selectedDoc) return { html: "", fullDocumentMarkdown: "" };
    const html =
      (editedHtmlByType[selectedDoc] && String(editedHtmlByType[selectedDoc]).trim()
        ? editedHtmlByType[selectedDoc]
        : (selectedDocResult?.document_html || ""));
    const draftsMarkdown = (sectionDraftsByDoc[selectedDoc] || "");
    const fullDocumentMarkdown = selectedDocResult?.document_markdown || draftsMarkdown || "";
    return { html, fullDocumentMarkdown };
  }

  async function syncSelectedDocumentForExport() {
    const docId = selectedDoc ? docIdByType[selectedDoc] : null;
    if (!selectedDoc || !docId) return null;
    const { html, fullDocumentMarkdown } = getSelectedDocumentPayload();
    await apiRequest(`/blueprint/documents/${docId}`, "PATCH", {
      document_html: html,
      document_markdown: fullDocumentMarkdown,
    });
    setDocByType((prev) => ({
      ...prev,
      [selectedDoc]: {
        ...prev[selectedDoc],
        document_html: html,
        document_markdown: fullDocumentMarkdown,
      },
    }));
    writeBlueprintCache(authEmail, [
      buildCachedDocEntry(selectedDoc, {
        document_markdown: fullDocumentMarkdown,
        document_html: html,
        provider: selectedDocResult?.provider || "saved",
        model: selectedDocResult?.model || "saved",
      }, docId),
      ...savedDocs.filter((item) => item.id !== docId && item.type !== selectedDoc),
    ]);
    return { docId, html, fullDocumentMarkdown };
  }

  async function createShareLink(shareConfig) {
    const docId = selectedDoc ? docIdByType[selectedDoc] : null;
    if (!selectedDoc || !docId) {
      const warnings = Array.isArray(selectedDocResult?.warnings) ? selectedDocResult.warnings : [];
      const saveWarning = warnings.find((message) =>
        String(message || "").toLowerCase().includes("could not save document")
      );
      setError(saveWarning || "This document has not been saved yet, so it cannot be shared.");
      return;
    }
    setShareNotice("Creating link...");
    try {
      await syncSelectedDocumentForExport();
      const res = await apiRequest(`/blueprint/documents/${docId}/share`, "POST", shareConfig);
      const token = res?.token;
      if (!token) throw new Error("Share link could not be created.");
      const url = `${window.location.origin}/share/${token}`;
      setShareNotice(null);
      return {
        token,
        url,
        emailSent: Boolean(res?.email_sent),
        emailError: res?.email_error || "",
      };
    } catch (e) {
      setShareNotice(null);
      throw new Error(e instanceof Error ? e.message : "Share failed");
    }
  }

  async function sendBlueprintShareEmail({ token, email }) {
    const res = await apiRequest(`/blueprint/share/${token}/email`, "POST", { email });
    return {
      sent: Boolean(res?.sent),
      error: res?.error || "",
    };
  }

  function downloadPdfFromHtml(html, filename) {
    const source = String(html || "")
      .replace(/<p>\s*<\/p>/gi, "")
      .replace(/<p>&nbsp;<\/p>/gi, "")
      .replace(/(<br\s*\/?>\s*){3,}/gi, "<br>");
    const title = filename.replace(/\.pdf$/i, "");
    const win = window.open("", "_blank");
    if (!win) { setError("Allow pop-ups for this site to download the PDF."); return; }
    win.document.write(`<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>${title}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #0f172a; font-family: "Segoe UI", Arial, sans-serif; }
  .pdf-doc { max-width: 170mm; margin: 0 auto; padding: 16mm 0; }
  h1 { text-align: center; font-size: 20pt; font-weight: 800; margin: 0 0 10pt; letter-spacing: -0.02em; }
  h2 { text-align: center; font-size: 14pt; font-weight: 700; margin: 14pt 0 5pt; }
  h3 { font-size: 12pt; font-weight: 700; margin: 10pt 0 3pt; }
  p { font-size: 11pt; line-height: 1.55; margin: 0 0 6pt; }
  p:empty { display: none; }
  ul, ol { margin: 3pt 0 8pt 18pt; padding: 0; }
  li { font-size: 11pt; line-height: 1.55; margin: 2pt 0; }
  table { width: 100%; border-collapse: collapse; margin: 8pt 0; font-size: 11pt; }
  th, td { border: 1pt solid #cbd5e1; padding: 5pt 8pt; text-align: left; vertical-align: top; }
  th { background: #f8fafc; font-weight: 700; }
  .cover-page { text-align: center; padding: 10pt 0 16pt; }
  .cover-page p { margin: 3pt 0; }
  .document-logo { display: block; max-width: 90pt; max-height: 45pt; width: auto; height: auto; margin: 0 auto 14pt; object-fit: contain; }
  .page-break { page-break-after: always; break-after: page; }
  @media screen { body { background: #e5e7eb; } .pdf-doc { background: #fff; box-shadow: 0 0 24px rgba(0,0,0,.12); padding: 16mm 14mm; } }
  @media print {
    html, body { margin: 0; background: #fff; }
    .pdf-doc { max-width: 100%; padding: 0; box-shadow: none; }
    h1, h2, h3 { page-break-after: avoid; break-after: avoid; }
    h2 + p, h3 + p, h2 + ul, h3 + ul { page-break-before: avoid; break-before: avoid; }
    p { orphans: 3; widows: 3; }
    table { page-break-inside: avoid; }
    ul, ol { page-break-inside: avoid; }
  }
  @page { size: A4; margin: 16mm 18mm; }
</style>
</head><body>
<div class="pdf-doc">${source}</div>
<script>setTimeout(function(){ window.print(); }, 400);<\/script>
</body></html>`);
    win.document.close();
  }

  async function downloadExport(format) {
    const docId = selectedDoc ? docIdByType[selectedDoc] : null;
    if (!docId) {
      setError("Save or generate a document before downloading.");
      return;
    }
    setError(null);
    try {
      const token = localStorage.getItem("ea_token");
      await syncSelectedDocumentForExport();
      const url = `${getApiBaseUrl()}/blueprint/documents/${docId}/export?format=${format}`;
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (!res.ok) {
        if (res.status === 403) {
          throw new Error("Downloading a business plan requires a paid plan. Upgrade to export.");
        } else if (res.status === 404) {
          throw new Error("Document not found. Please regenerate it.");
        } else if (res.status === 500) {
          throw new Error("Server error. Please try again.");
        }
        const text = await res.text().catch(() => "");
        throw new Error(text || "Download failed");
      }
      const blob = await res.blob();
      if (!blob || blob.size === 0) {
        throw new Error("Downloaded file is empty");
      }
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="(.+?)"/);
      const filename = match?.[1] || `document-${Date.now()}.${format === "doc" ? "doc" : format}`;
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(link.href), 100);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed. Please try again.");
    }
  }

  function deleteDocument(docId, typeHint) {
    if (!docId) return;
    setConfirmDialog({
      message: "Delete this document? This cannot be undone.",
      onConfirm: async () => {
        setConfirmDialog(null);
        setIsSaving(true);
    setError(null);
    try {
      try {
        await apiRequest(`/blueprint/documents/${docId}`, "DELETE");
      } catch (e) {
        // 404 means document is already gone — treat as success
        if (!String(e?.message || "").includes("404") && !String(e?.message || "").includes("not found")) {
          throw e;
        }
      }
      if (workspaceIdStored) {
        try {
          const ws = await apiRequest("/validation/me", "GET");
          const existingDrafts =
            ws?.data?.blueprint_section_drafts && typeof ws.data.blueprint_section_drafts === "object"
              ? { ...ws.data.blueprint_section_drafts }
              : {};
          delete existingDrafts[typeHint];
          await apiRequest("/validation/me", "PATCH", { data: { blueprint_section_drafts: existingDrafts } });
        } catch {
          // ignore draft cleanup failures
        }
      }
      setSavedDocs((prev) => prev.filter((d) => d.id !== docId));
      // Remove from localStorage cache so stale data doesn't reappear
      if (authEmail) {
        const cached = readBlueprintCache(authEmail).filter(
          (d) => d.id !== docId && d.type !== typeHint
        );
        writeBlueprintCache(authEmail, cached);
      }
      if (typeHint) {
        setDocByType((prev) => ({ ...prev, [typeHint]: null }));
        setDocIdByType((prev) => {
          const next = { ...prev };
          delete next[typeHint];
          return next;
        });
        setEditedHtmlByType((prev) => {
          const next = { ...prev };
          delete next[typeHint];
          return next;
        });
        setSectionDraftsByDoc((prev) => {
          const next = { ...prev };
          delete next[typeHint];
          return next;
        });
        setDraftSectionsByDoc((prev) => {
          const next = { ...prev };
          delete next[typeHint];
          return next;
        });
        setSectionTabByDoc((prev) => {
          const next = { ...prev };
          delete next[typeHint];
          return next;
        });
      }
      if (selectedDoc && docIdByType[selectedDoc] === docId) {
        closeModal();
      }
      refreshSavedDocs();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to delete document");
      } finally {
        setIsSaving(false);
      }
      },
      onCancel: () => setConfirmDialog(null),
    });
  }

  function fmtDate(d) {
    try {
      return new Date(d).toLocaleString();
    } catch {
      return "";
    }
  }

  function buildAiContext(fieldOverride) {
    return {
      field: fieldOverride || "problem",
      company_name: companyName || workspaceProfile?.company_name || "",
      industry,
      target_market: targetMarket,
      problem,
      solution,
      value_proposition: valueProp,
      selected_services: resolveSelectedServices(),
    };
  }

  if (!workspaceIdStored) {
    return <WorkspacePrompt />;
  }

  return (
    <div>
      <PageHeader
        title="Business Blueprints"
        description="Generate business documents from your inputs."
      />

      <div className="mt-6 space-y-4">
        {error && !isModalOpen ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        ) : null}
        <IllustrationCard
          title="Blueprint overview"
          subtitle="Polished document structure with clean sections."
        >
          <BlueprintIllustration />
        </IllustrationCard>
        <SectionCard title="Documents" subtitle="Click a document to generate it.">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {DOCUMENTS.map((d) => {
              const canAccess = canBlueprintDoc(d.id);
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => canAccess ? openDoc(d.id) : null}
                  disabled={!canAccess}
                  className={`ea-card relative p-4 text-left border-slate-200 ${canAccess ? "ea-card-hover" : "cursor-not-allowed opacity-60 bg-slate-50"}`}
                >
                  <div className="absolute right-3 top-3 flex items-center gap-1.5">
                    {!canAccess ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                        Paid only
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-700 ring-1 ring-slate-200">
                        {pct(completionFor(d.id))}
                      </span>
                    )}
                  </div>
                  <div className="text-sm font-semibold text-slate-900">{d.title}</div>
                  <div className="mt-1 text-xs text-slate-600">{d.desc}</div>
                  {!canAccess && (
                    <Link
                      to="/pricing"
                      onClick={(e) => e.stopPropagation()}
                      className="mt-2 inline-block text-[11px] font-semibold text-indigo-600 hover:underline"
                    >
                      Upgrade to access →
                    </Link>
                  )}
                  {canAccess && d.needsWorkspace ? (
                    <div className="mt-2 text-[11px] font-semibold text-slate-500">Uses Idea Validation metrics</div>
                  ) : null}
                </button>
              );
            })}
          </div>
        </SectionCard>

        {visibleSavedDocs.length ? (
          <SectionCard title="Saved Documents" subtitle="Open and edit your generated documents anytime.">
            <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
              {visibleSavedDocs.slice(0, 10).map((d) => (
                <div
                  key={d.id}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (String(d.id || "").startsWith("local:")) {
                        openDoc(d.type);
                        return;
                      }
                      openSavedDocument(d);
                    }}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="truncate text-sm font-semibold text-slate-900">{d.title}</div>
                    <div className="mt-0.5 truncate text-xs text-slate-600">{d.company_name}</div>
                  </button>
                  <div className="shrink-0 text-[11px] font-semibold text-slate-500">{fmtDate(d.updated_at)}</div>
                  {!String(d.id || "").startsWith("local:") ? (
                    <button
                      type="button"
                      onClick={() => deleteDocument(d.id, d.type)}
                      className="ml-2 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50"
                      title="Delete"
                      aria-label="Delete document"
                    >
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 6h18" />
                        <path d="M8 6V4h8v2" />
                        <path d="M6 6l1 14h10l1-14" />
                        <path d="M10 11v6M14 11v6" />
                      </svg>
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </SectionCard>
        ) : null}
      </div>

      {isModalOpen && selectedMeta ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div className="ea-dialog w-full max-w-[110rem] h-[94vh] overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
              <div>
                <div className="text-sm font-semibold text-slate-900">{selectedMeta.title}</div>
                <div className="mt-0.5 text-xs text-slate-600">{selectedMeta.desc}</div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setShowInputs((v) => {
                      const next = !v;
                      if (!isDesktop) setInputsTab(next ? "inputs" : "sections");
                      return next;
                    });
                  }}
                >
                  {showInputs ? "Hide inputs" : "Edit inputs"}
                </Button>
                <Button disabled={isLoading} onClick={() => setCreditModal({ featureName: "Business Plan Generation", creditCost: 40, onConfirm: () => { setCreditModal(null); generateSelected(); } })}>
                  {isLoading ? <Spinner size={16} /> : null}
                  {isLoading ? "Generating..." : hasGenerated ? "Regenerate" : "Generate"}
                </Button>
                {docIdByType[selectedDoc] ? (
                  <Button
                    variant="secondary"
                    disabled={isSaving}
                    onClick={() => deleteDocument(docIdByType[selectedDoc], selectedDoc)}
                  >
                    Delete
                  </Button>
                ) : null}
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-lg px-2 py-1 text-sm text-slate-600 hover:bg-slate-100"
                >
                  Close
                </button>
              </div>
            </div>

            {error ? (
              <div className="mx-5 mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {error}
              </div>
            ) : null}

            <div className="flex h-[calc(94vh-64px)] min-h-0 flex-col overflow-hidden lg:flex-row">
              {showSectionDrafts ? (
                <div className="hidden lg:block order-3 w-[340px] shrink-0 overflow-auto overflow-x-hidden border-l border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-950/60">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-900/80">
                    <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">Section drafts</div>
                    <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                      Click a section tile to preview. If it has not been generated yet, EnterprateAI will generate it automatically.
                    </div>
                  </div>
                  <div className="mt-4 flex max-h-[520px] flex-col gap-3 overflow-y-auto pr-1">
                    {sectionsForDoc(selectedDoc).map((section) => (
                      <SectionTile
                        key={section.id}
                        label={section.label}
                        selected={(draftSectionsByDoc[selectedDoc] || []).includes(section.id)}
                        snippet={getSectionSnippet(selectedDoc, section.id)}
                        onClick={() => handleDraftTileClick(section.id)}
                      />
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="order-1 flex-1 min-h-0 h-full min-w-0 overflow-hidden bg-slate-50 p-5 relative lg:order-2">
                {showSectionPreview ? (
                  <div className="flex h-full min-h-0 flex-col gap-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm text-slate-500">Section preview</div>
                      {selectedDocResult?.document_markdown ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setSectionTabByDoc((prev) => ({ ...prev, [selectedDoc]: null }))}
                        >
                          Back to document
                        </Button>
                      ) : null}
                    </div>
                    <div className="flex-1 min-h-0">
                      {sectionPreviewHtml ? (
                        <DocumentEditor
                          title={`${selectedMeta.title} — ${sectionsForDoc(selectedDoc).find((s) => s.id === activeDraftSectionId)?.label || "Section"}`}
                          markdown=""
                          initialHtml={sectionPreviewHtml}
                          onHtmlChange={() => {}}
                          defaultMode="preview"
                          compactPreview
                          showEditButton={false}
                          showSaveButton={false}
                          downloadFormats={["pdf"]}
                          onDownload={async (format) => {
                            if (format !== "pdf") {
                              setError("Generate the full document to export Word downloads.");
                              return;
                            }
                            const label =
                              sectionsForDoc(selectedDoc).find((s) => s.id === activeDraftSectionId)?.label ||
                              "section";
                            const safe = String(label)
                              .toLowerCase()
                              .replaceAll(" ", "-")
                              .replaceAll("/", "-")
                              .replaceAll("&", "and");
                            await downloadPdfFromHtml(sectionPreviewHtml, `${selectedMeta.title}-${safe}.pdf`);
                          }}
                          onSave={null}
                        />
                      ) : (
                        <div className="ea-card border-dashed p-6 text-sm text-slate-600">
                          Select a section tile to preview it here.
                        </div>
                      )}
                    </div>
                  </div>
                ) : selectedDocResult?.document_markdown ? (
                  <div className="flex h-full min-h-0 flex-col gap-3">
                    {isFreeOrTrial && selectedDoc === "business_plan" ? (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                        Free plan read only. <Link to="/pricing" className="font-semibold underline hover:text-amber-900">Upgrade</Link> to edit, copy, share, or download.
                      </div>
                    ) : null}
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      <span className="font-semibold">AI output disclaimer: </span>
                      This document is AI-generated and may be incomplete or inaccurate. Review carefully before using for any business, legal, or financial purpose. <Link to="/legal/disclaimer" className="underline hover:text-amber-900">Learn more</Link>.
                    </div>
                    <div className={`flex-1 min-h-0 relative${isFreeOrTrial && selectedDoc === "business_plan" ? " select-none" : ""}`}>
                      {isFreeOrTrial && selectedDoc === "business_plan" && (
                        <div
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-0 z-10 overflow-hidden"
                          style={{
                            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='340' height='180'%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' font-family='sans-serif' font-size='28' font-weight='700' fill='%23000' fill-opacity='0.045' transform='rotate(-30 170 90)'%3EEnterprateAI%3C/text%3E%3C/svg%3E")`,
                            backgroundRepeat: "repeat",
                          }}
                        />
                      )}
                      <DocumentEditor
                        title={selectedMeta.title}
                        markdown={selectedDocResult.document_markdown}
                        initialHtml={selectedDocResult.document_html || ""}
                        onHtmlChange={isFreeOrTrial && selectedDoc === "business_plan" ? undefined : (h) => setEditedHtmlByType((prev) => ({ ...prev, [selectedDoc]: h }))}
                        onDownload={isFreeOrTrial && selectedDoc === "business_plan" ? undefined : downloadExport}
                        onSave={isFreeOrTrial && selectedDoc === "business_plan" ? undefined : saveEdits}
                        hideShare={isFreeOrTrial && selectedDoc === "business_plan"}
                        readOnly={isFreeOrTrial && selectedDoc === "business_plan"}
                        defaultMode="preview"
                        compactPreview
                        shareMenuItems={[
                          {
                            id: "copy_link",
                            label: "Copy link",
                            onClick: () => setShareDialogOpen(true),
                          },
                        ]}
                        toolbarRightSlot={
                          <div className="flex items-center gap-2">
                            {shareNotice ? (
                              <div className="rounded-full bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">
                                {shareNotice}
                              </div>
                            ) : null}
                            {savedNotice ? (
                              <div className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                                {savedNotice}
                              </div>
                            ) : null}
                          </div>
                        }
                        saveLabel={isSaving ? "Saving..." : "Save changes"}
                        saveDisabled={!docIdByType[selectedDoc] || isSaving}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="ea-card border-dashed p-6 text-sm text-slate-600">
                    Click <span className="font-semibold">Generate</span> to preview here.
                  </div>
                )}
                {isLoading ? (
                  <div className="absolute inset-5 z-20 flex items-center justify-center">
                    <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white px-6 py-5 text-center shadow-lg">
                      <div className="flex items-center justify-center">
                        <Spinner />
                      </div>
                      <div className="mt-3 text-sm font-semibold text-slate-900">Generating your document</div>
                      <div className="mt-2 text-xs text-slate-500">
                        {DID_YOU_KNOW_FACTS[didYouKnowIndex]}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>

              {/* FIX 1: Inputs panel — clean single-column layout, no overlapping fields */}
              {showSidePanel ? (
                <div className="order-2 w-full shrink-0 overflow-auto overflow-x-hidden border-t border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-950/60 lg:order-1 lg:w-[340px] lg:border-r lg:border-t-0">
                  {showSectionDrafts && !isDesktop ? (
                    <SegmentedTabs
                      value={effectiveInputsTab}
                      onChange={setInputsTab}
                      options={mobileSideTabs}
                      size="sm"
                    />
                  ) : null}

                  {effectiveInputsTab === "sections" && showSectionDrafts && !isDesktop ? (
                    <div className="mt-4 space-y-3">
                      <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-900/80">
                        <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">Section drafts (standalone)</div>
                        <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                          Select sections to draft. Full document generation still uses the selections from the Inputs tab.
                        </div>
                      </div>
                      <div className="flex max-h-[420px] flex-col gap-3 overflow-y-auto pr-1">
                        {sectionsForDoc(selectedDoc).map((section) => (
                          <SectionTile
                            key={section.id}
                            label={section.label}
                            selected={(draftSectionsByDoc[selectedDoc] || []).includes(section.id)}
                            snippet={getSectionSnippet(selectedDoc, section.id)}
                            onClick={() => handleDraftTileClick(section.id)}
                          />
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {/* Core fields */}
                      <div>
                        <div className="ea-label">Business name</div>
                        <Input
                          value={companyName}
                          onChange={(e) => {
                            setDirtyFields((p) => ({ ...p, companyName: true }));
                            setCompanyName(e.target.value);
                          }}
                          placeholder="e.g., Sparkle Cleaning"
                        />
                      </div>

                      <div>
                        <div className="ea-label">Industry</div>
                        <Input
                          value={industry}
                          onChange={(e) => {
                            setDirtyFields((p) => ({ ...p, industry: true }));
                            setIndustry(e.target.value);
                          }}
                          placeholder="e.g., Cleaning, Healthcare, Technology"
                        />
                      </div>

                      <div>
                        <div className="ea-label">Logo</div>
                        <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-3">
                          <div className="flex items-center gap-3">
                            <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                              {documentLogo || workspaceProfile?.logo_data_url || workspaceLogoStored ? (
                                <img
                                  src={documentLogo || workspaceProfile?.logo_data_url || workspaceLogoStored}
                                  alt="Document logo"
                                  className="h-full w-full object-contain"
                                />
                              ) : (
                                <span className="text-[11px] font-semibold text-slate-400">No logo</span>
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-semibold text-slate-900">Document logo</div>
                              <div className="mt-1 text-xs text-slate-500">
                                Use your workspace logo on cover pages and supporting financial documents. You can replace it here.
                              </div>
                            </div>
                          </div>
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <label className="inline-flex cursor-pointer items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50">
                              Upload logo
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  void handleDocumentLogoChange(file);
                                  e.target.value = "";
                                }}
                              />
                            </label>
                            {(documentLogo || workspaceProfile?.logo_data_url || workspaceLogoStored) ? (
                              <Button
                                variant="ghost"
                                onClick={() => {
                                  void persistWorkspaceLogo(null);
                                }}
                              >
                                Remove
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      <div>
                        <div className="ea-label">Pricing model</div>
                        <select value={pricingModel} onChange={(e) => setPricingModel(e.target.value)} className="ea-input">
                          <option>Subscription</option>
                          <option>One-time</option>
                          <option>Usage-based</option>
                          <option>Hourly</option>
                          <option>Retainer</option>
                        </select>
                      </div>

                      {showWorkspaceId ? (
                        <div>
                          <div className="ea-label">Idea Validation workspace id</div>
                          <Input value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)} placeholder="Paste workspace id" />
                        </div>
                      ) : null}

                      <div>
                        <div className="ea-label">Tone</div>
                        <Input value={tone} onChange={(e) => setTone(e.target.value)} placeholder="professional" />
                      </div>

                      {selectedDoc === "business_plan" || selectedDoc === "client_proposal" ? (
                        <div>
                          <div className="ea-label">Objective</div>
                          <select
                            value={objectiveChoiceByDoc[selectedDoc] || ""}
                            onChange={(e) =>
                              setObjectiveChoiceByDoc((prev) => ({ ...prev, [selectedDoc]: e.target.value }))
                            }
                            className="ea-input"
                          >
                            {objectivesForDoc(selectedDoc).map((o) => (
                              <option key={o} value={o}>{o}</option>
                            ))}
                          </select>
                          {objectiveChoiceByDoc[selectedDoc] === "Other" ? (
                            <Input
                              value={objectiveCustomByDoc[selectedDoc] || ""}
                              onChange={(e) =>
                                setObjectiveCustomByDoc((prev) => ({ ...prev, [selectedDoc]: e.target.value }))
                              }
                              placeholder="Type your objective"
                              className="mt-2"
                            />
                          ) : null}
                        </div>
                      ) : null}

                      {/* Customer selector */}
                      {showProposalExtras || showSalesLetterExtras ? (
                        <div>
                          <div className="ea-label">Customer</div>
                          {(activeCustomers.length || activeVendors.length) ? (
                            <>
                              <select
                                className="ea-input"
                                value={selectedCustomerId}
                                onChange={(e) => applyCustomerSelection(e.target.value)}
                              >
                                <option value="">Select customer</option>
                                {activeCustomers.length ? (
                                  <optgroup label="Customers">
                                    {activeCustomers.map((c) => (
                                      <option key={c.id} value={c.id}>{c.name}</option>
                                    ))}
                                  </optgroup>
                                ) : null}
                                {activeVendors.length ? (
                                  <optgroup label="Vendors">
                                    {activeVendors.map((v) => (
                                      <option key={v.id} value={v.id}>{v.name}</option>
                                    ))}
                                  </optgroup>
                                ) : null}
                                <option value={OTHER_CUSTOMER_ID}>Other (type a name)</option>
                              </select>
                              <div className="mt-1 text-[11px] text-slate-500">
                                Selecting a customer or vendor will prefill the client details and audience.
                              </div>
                            </>
                          ) : null}
                          {(!activeCustomers.length && !activeVendors.length) || selectedCustomerId === OTHER_CUSTOMER_ID ? (
                            <div className="mt-2">
                              <div className="ea-label">Client name</div>
                              <Input
                                value={customClientName}
                                onChange={(e) => {
                                  setCustomClientName(e.target.value);
                                  setBillTo(e.target.value);
                                }}
                                placeholder="Enter client name"
                              />
                            </div>
                          ) : null}
                        </div>
                      ) : null}

                      {/* Core narrative fields */}
                      {showCoreNarrative ? (
                        <>
                          <div>
                            <div className="flex items-center justify-between">
                              <div className="ea-label">Problem</div>
                              <AiFillButton context={buildAiContext("problem")} onFill={(v) => { setDirtyFields((p) => ({ ...p, problem: true })); setProblem(v); }} />
                            </div>
                            <textarea
                              value={problem}
                              onChange={(e) => {
                                setDirtyFields((p) => ({ ...p, problem: true }));
                                setProblem(e.target.value);
                              }}
                              className="min-h-20 ea-input"
                              placeholder="What problem are you solving?"
                            />
                          </div>

                          <div>
                            <div className="flex items-center justify-between">
                              <div className="ea-label">Solution</div>
                              <AiFillButton context={buildAiContext("solution")} onFill={(v) => { setDirtyFields((p) => ({ ...p, solution: true })); setSolution(v); }} />
                            </div>
                            <textarea
                              value={solution}
                              onChange={(e) => {
                                setDirtyFields((p) => ({ ...p, solution: true }));
                                setSolution(e.target.value);
                              }}
                              className="min-h-20 ea-input"
                              placeholder="What are you building and how does it solve it?"
                            />
                          </div>

                          <div>
                            <div className="ea-label">Target market</div>
                            <Input
                              value={targetMarket}
                              onChange={(e) => {
                                setDirtyFields((p) => ({ ...p, targetMarket: true }));
                                setTargetMarket(e.target.value);
                              }}
                              placeholder="Who is it for?"
                            />
                          </div>

                          <div>
                            <div className="flex items-center justify-between">
                              <div className="ea-label">Value proposition</div>
                              <AiFillButton context={buildAiContext("value_proposition")} onFill={(v) => { setDirtyFields((p) => ({ ...p, valueProp: true })); setValueProp(v); }} />
                            </div>
                            <textarea
                              value={valueProp}
                              onChange={(e) => {
                                setDirtyFields((p) => ({ ...p, valueProp: true }));
                                setValueProp(e.target.value);
                              }}
                              className="min-h-16 ea-input"
                              placeholder="Why will they choose you?"
                            />
                          </div>

                          {/* FIX 2: Services as dropdown with checkboxes */}
                          <div>
                            <div className="ea-label">Services to focus on (optional)</div>
                            <ServicesDropdown
                              workspaceServices={(() => {
                                const profileSvcs = Array.isArray(workspaceProfile?.services) ? workspaceProfile.services : [];
                                const seen = new Set(profileSvcs.map((s) => String(s?.service_name || "").toLowerCase()));
                                const merged = [...profileSvcs];
                                for (const s of catalogueServices) {
                                  if (!seen.has(s.service_name.toLowerCase())) merged.push(s);
                                }
                                return merged;
                              })()}
                              selectedServices={selectedServices}
                              setSelectedServices={setSelectedServices}
                              setDirtyFields={setDirtyFields}
                              customServiceName={customServiceName}
                              setCustomServiceName={setCustomServiceName}
                              customServiceDescription={customServiceDescription}
                              setCustomServiceDescription={setCustomServiceDescription}
                            />
                          </div>
                        </>
                      ) : null}

                      {/* Sections to generate */}
                      {selectedDoc && sectionsForDoc(selectedDoc).length ? (
                        <div ref={sectionDraftsRef} className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-900/80">
                          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">Sections to generate (optional)</div>
                          <div className="mt-2 space-y-2">
                            {generationSectionsForDoc(selectedDoc).map((section) => (
                              <label key={section.id} className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                                <input
                                  type="checkbox"
                                  checked={(sectionsByDoc[selectedDoc] || []).includes(section.id)}
                                  onChange={() => toggleSection(selectedDoc, section.id)}
                                />
                                <span>{section.label}</span>
                              </label>
                            ))}
                          </div>
                          <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                            Leave unchecked to generate the full document.
                          </div>
                        </div>
                      ) : null}

                      {/* Invoice fields */}
                      {showQuoteFields ? (
                        <>
                          <div>
                            <div className="ea-label">Bill to</div>
                            <Input value={billTo} onChange={(e) => setBillTo(e.target.value)} placeholder="Client name / address" />
                          </div>
                          <div>
                            <div className="flex items-center justify-between gap-2">
                              <div className="ea-label">Items</div>
                              <button
                                type="button"
                                onClick={addItemLine}
                                className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                              >
                                + Add item
                              </button>
                            </div>
                            <textarea
                              ref={itemsRef}
                              value={items}
                              onChange={(e) => setItems(e.target.value)}
                              className="min-h-20 ea-input"
                              placeholder={"One item per line, e.g.\nOffice cleaning (weekly)\nDeep clean (monthly)"}
                            />
                            <div className="mt-1 text-[11px] text-slate-500">Each line becomes a separate row in the quotation / invoice table.</div>
                          </div>
                          <div>
                            <div className="ea-label">Terms (optional)</div>
                            <Input value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="Payment terms / quotation terms" />
                          </div>
                        </>
                      ) : null}

                      {/* Proposal extras */}
                      {showProposalExtras ? (
                        <>
                          <div>
                            <div className="ea-label">Proposal length</div>
                            <div className="flex gap-3">
                              {["brief", "full"].map(opt => (
                                <label key={opt} className="flex items-center gap-1.5 cursor-pointer text-sm">
                                  <input type="radio" name="proposalLength" value={opt} checked={proposalLength === opt}
                                    onChange={() => setProposalLength(opt)} className="accent-brand-600" />
                                  <span className="capitalize">{opt}</span>
                                </label>
                              ))}
                            </div>
                            <div className="mt-1 text-[11px] text-slate-500">Brief: 4-6 sections. Full: complete proposal.</div>
                          </div>
                          <div>
                            <div className="flex items-center justify-between">
                              <div className="ea-label">Proposal title (optional)</div>
                              <AiFillButton context={buildAiContext("proposal_title")} onFill={(v) => setProposalTitle(v)} />
                            </div>
                            <Input value={proposalTitle} onChange={(e) => setProposalTitle(e.target.value)} placeholder="e.g., Business Proposal" />
                          </div>
                          <div>
                            <div className="ea-label">Contact details (optional)</div>
                            <Input
                              value={contactDetails}
                              onChange={(e) => {
                                setDirtyFields((p) => ({ ...p, contactDetails: true }));
                                setContactDetails(e.target.value);
                              }}
                              placeholder="Email, phone, website (optional)"
                            />
                          </div>
                          <div>
                            <div className="flex items-center justify-between">
                              <div className="ea-label">Timeline / plan (optional)</div>
                              <AiFillButton context={buildAiContext("timeline")} onFill={(v) => setTimeline(v)} />
                            </div>
                            <textarea value={timeline} onChange={(e) => setTimeline(e.target.value)} className="min-h-16 ea-input" placeholder="Phases and milestones in words" />
                          </div>
                          <div>
                            <div className="flex items-center justify-between">
                              <div className="ea-label">Assumptions (optional)</div>
                              <AiFillButton context={buildAiContext("assumptions")} onFill={(v) => setAssumptions(v)} />
                            </div>
                            <textarea value={assumptions} onChange={(e) => setAssumptions(e.target.value)} className="min-h-16 ea-input" placeholder="Key assumptions" />
                          </div>
                          <div>
                            <div className="ea-label">Exclusions (optional)</div>
                            <textarea value={scopeExclusions} onChange={(e) => setScopeExclusions(e.target.value)} className="min-h-16 ea-input" placeholder="What is not included" />
                          </div>
                        </>
                      ) : null}

                      {/* Sales letter extras */}
                      {showSalesLetterExtras ? (
                        <>
                          <div>
                            <div className="ea-label">Target word count</div>
                            <Input
                              type="number"
                              value={wordCount}
                              onChange={(e) => setWordCount(e.target.value)}
                              placeholder="e.g., 700"
                            />
                          </div>
                          <div>
                            <div className="ea-label">Objective</div>
                            <select
                              value={objectiveChoiceByDoc.sales_letter}
                              onChange={(e) =>
                                setObjectiveChoiceByDoc((prev) => ({ ...prev, sales_letter: e.target.value }))
                              }
                              className="ea-input"
                            >
                              {SALES_LETTER_OBJECTIVES.map((o) => (
                                <option key={o} value={o}>{o}</option>
                              ))}
                            </select>
                            {objectiveChoiceByDoc.sales_letter === "Other" ? (
                              <Input
                                value={objectiveCustomByDoc.sales_letter || ""}
                                onChange={(e) =>
                                  setObjectiveCustomByDoc((prev) => ({ ...prev, sales_letter: e.target.value }))
                                }
                                placeholder="Type your objective"
                                className="mt-2"
                              />
                            ) : null}
                          </div>
                          <div>
                            <div className="ea-label">Headline angle (optional)</div>
                            <Input value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="Opening line / headline idea" />
                          </div>
                          <div>
                            <div className="ea-label">Contact name</div>
                            <Input
                              value={contactName}
                              onChange={(e) => setContactName(e.target.value)}
                              placeholder="Who should the letter address directly?"
                            />
                          </div>
                          <div>
                            <div className="flex items-center justify-between">
                              <div className="ea-label">Offer (optional)</div>
                              <AiFillButton context={buildAiContext("offer")} onFill={(v) => setOffer(v)} />
                            </div>
                            <Input value={offer} onChange={(e) => setOffer(e.target.value)} placeholder="What the reader gets (no prices)" />
                          </div>
                          <div>
                            <div className="flex items-center justify-between">
                              <div className="ea-label">Call to action (optional)</div>
                              <AiFillButton context={buildAiContext("cta")} onFill={(v) => setCta(v)} />
                            </div>
                            <Input value={cta} onChange={(e) => setCta(e.target.value)} placeholder="What should they do next?" />
                          </div>
                          <div>
                            <div className="flex items-center justify-between">
                              <div className="ea-label">Proof / credibility (optional)</div>
                              <AiFillButton context={buildAiContext("proof")} onFill={(v) => setProof(v)} />
                            </div>
                            <textarea value={proof} onChange={(e) => setProof(e.target.value)} className="min-h-16 ea-input" placeholder="Experience, results, case study narrative (no numbers)" />
                          </div>
                          <div>
                            <div className="flex items-center justify-between">
                              <div className="ea-label">Urgency / scarcity (optional)</div>
                              <AiFillButton context={buildAiContext("urgency")} onFill={(v) => setUrgency(v)} />
                            </div>
                            <Input value={urgency} onChange={(e) => setUrgency(e.target.value)} placeholder="Reason to act soon (no dates)" />
                          </div>
                          <div>
                            <div className="ea-label">Sender name (optional)</div>
                            <Input value={senderName} onChange={(e) => setSenderName(e.target.value)} placeholder="Your name" />
                          </div>
                          <div>
                            <div className="ea-label">Sender position (optional)</div>
                            <Input value={senderPosition} onChange={(e) => setSenderPosition(e.target.value)} placeholder="Your role/title" />
                          </div>
                          <div>
                            <div className="ea-label">Sender email (optional)</div>
                            <Input
                              value={senderEmail}
                              onChange={(e) => {
                                setDirtyFields((p) => ({ ...p, senderEmail: true }));
                                setSenderEmail(e.target.value);
                              }}
                              placeholder="you@company.com"
                            />
                          </div>
                          <div>
                            <div className="ea-label">Sender phone (optional)</div>
                            <Input
                              value={senderPhone}
                              onChange={(e) => {
                                setDirtyFields((p) => ({ ...p, senderPhone: true }));
                                setSenderPhone(e.target.value);
                              }}
                              placeholder="Phone (optional)"
                            />
                          </div>
                          <div>
                            <div className="ea-label">Sender website (optional)</div>
                            <Input
                              value={senderWebsite}
                              onChange={(e) => {
                                setDirtyFields((p) => ({ ...p, senderWebsite: true }));
                                setSenderWebsite(e.target.value);
                              }}
                              placeholder="company website"
                            />
                          </div>
                          <div>
                            <div className="ea-label">Follow-up sequence</div>
                            <select
                              value={followupChoice}
                              onChange={(e) => setFollowupChoice(e.target.value)}
                              className="ea-input"
                            >
                              <option value="Quick reminder and recap of the main benefit, inviting a short call">
                                Quick reminder and recap of the main benefit, inviting a short call
                              </option>
                              <option value="Share a practical example of how the process reduces risk and saves time">
                                Share a practical example of how the process reduces risk and saves time
                              </option>
                              <option value="Final check-in offering to hold a slot and answer questions">
                                Final check-in offering to hold a slot and answer questions
                              </option>
                              <option value="Other">Other (type your own)</option>
                            </select>
                            {followupChoice === "Other" ? (
                              <Input
                                value={followupCustom}
                                onChange={(e) => setFollowupCustom(e.target.value)}
                                placeholder="Type a custom follow-up line"
                                className="mt-2"
                              />
                            ) : null}
                          </div>
                        </>
                      ) : null}

                      {/* Extra notes always last */}
                      <div>
                        <div className="ea-label">Extra notes (optional)</div>
                        <textarea value={extraNotes} onChange={(e) => setExtraNotes(e.target.value)} className="min-h-16 ea-input" placeholder="Extra context, audience, constraints, etc." />
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>

        </div>
      ) : null}

      {shareDialogOpen ? (
        <DocumentShareModal
          title="Share blueprint document"
          subtitle="Choose who can use this document link before generating it."
          defaultEmail={selectedCustomerId === OTHER_CUSTOMER_ID ? "" : (activeCustomers.find((c) => c.id === selectedCustomerId)?.email || "")}
          onClose={() => setShareDialogOpen(false)}
          onGenerate={createShareLink}
          onSendEmail={sendBlueprintShareEmail}
          getMailtoHref={({ url, email, expiryDays }) => {
            const recipient = encodeURIComponent(email || (selectedCustomerId === OTHER_CUSTOMER_ID ? "" : (activeCustomers.find((c) => c.id === selectedCustomerId)?.email || "")));
            const subject = encodeURIComponent(`${selectedMeta?.title || "Document"} from ${companyName || "EnterprateAI"}`);
            const body = encodeURIComponent(
              `Hi,\n\nHere is your shared document link:\n${url}\n\nThis link expires in ${expiryDays} day${expiryDays !== 1 ? "s" : ""}.\n`
            );
            return `mailto:${recipient}?subject=${subject}&body=${body}`;
          }}
        />
      ) : null}
      {creditModal && (
        <CreditConfirmModal
          featureName={creditModal.featureName}
          creditCost={creditModal.creditCost}
          onConfirm={creditModal.onConfirm}
          onCancel={() => setCreditModal(null)}
        />
      )}
      {confirmDialog ? (
        <ConfirmDialog
          message={confirmDialog.message}
          confirmLabel="Delete"
          danger
          onConfirm={confirmDialog.onConfirm}
          onCancel={confirmDialog.onCancel}
        />
      ) : null}
    </div>
  );
}
