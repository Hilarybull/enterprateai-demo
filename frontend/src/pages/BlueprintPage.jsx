import { useEffect, useMemo, useRef, useState } from "react";
import html2pdf from "html2pdf.js";
import DocumentEditor from "../components/DocumentEditor";
import Input from "../components/Input";
import PageHeader from "../components/PageHeader";
import SectionCard from "../components/SectionCard";
import Spinner from "../components/Spinner";
import { apiRequest, getApiBaseUrl } from "../api/client";
import Button from "../components/Button";
import { useWorkspaceStore } from "../store/workspace";
import WorkspacePrompt from "../components/WorkspacePrompt";
import { BlueprintIllustration, IllustrationCard } from "../components/Illustrations";
import SegmentedTabs from "../components/SegmentedTabs";

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

const BUSINESS_PLAN_OBJECTIVES = ["Standard"];

const CLIENT_PROPOSAL_OBJECTIVES = ["Sales Proposal"];

const SALES_LETTER_OBJECTIVES = [
  "A reliable, no-drama way to keep standards consistent",
  "Consistent results without extra oversight",
  "Reduce rework and keep delivery on track",
  "Build trust with predictable service quality",
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

export default function BlueprintPage() {
  const workspaceIdStored = useWorkspaceStore((s) => s.workspaceId);
  const setWorkspaceIdStored = useWorkspaceStore((s) => s.setWorkspaceId);
  const setWorkspaceNameStored = useWorkspaceStore((s) => s.setWorkspaceName);
  const ideaValidation = useWorkspaceStore((s) => s.ideaValidation);
  const decisionStatus = useWorkspaceStore((s) => s.decisionStatus);
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
  const [workspaceProfile, setWorkspaceProfile] = useState(null);
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
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [customClientName, setCustomClientName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(null);
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
    if (!selectedDoc || !sectionDraftsByDoc[selectedDoc]) return {};
    return extractSections(sectionDraftsByDoc[selectedDoc]);
  }, [selectedDoc, sectionDraftsByDoc]);
  const activeDraftSectionId = selectedDoc
    ? sectionTabByDoc[selectedDoc] || (draftSectionsByDoc[selectedDoc] || [])[0]
    : null;
  const activeDraftHeading = selectedDoc && activeDraftSectionId
    ? sectionHeadingMap(selectedDoc)[activeDraftSectionId]
    : null;
  const activeDraftBody = activeDraftHeading ? draftSectionMap?.[activeDraftHeading] : "";
  const sectionPreviewHtml =
    activeDraftHeading && activeDraftBody ? buildSectionPreviewHtml(activeDraftHeading, activeDraftBody) : "";
  const showSectionPreview = inputsTab === "sections" && showSectionDrafts;

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
      const res = await apiRequest("/blueprint/documents?limit=30", "GET");
      setSavedDocs(Array.isArray(res) ? res : []);
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    refreshSavedDocs();
  }, []);

  useEffect(() => {
    if (selectedDoc !== "client_proposal" && selectedDoc !== "sales_letter") {
      setSelectedCustomerId("");
      setCustomClientName("");
    }
    setInputsTab("inputs");
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

    if (!companyName && ctx.business_name) setCompanyName(ctx.business_name);
    if (!industry) setIndustry(ctx.primary_industry || ctx.business_type || "");
    if (!targetMarket && prob.customer_segment) setTargetMarket(prob.customer_segment);
    if (!problem && prob.problem_type) setProblem(prob.problem_type);
    if (!solution && offer.service_type) setSolution(offer.service_type);

    const pm = String(offer.pricing_model || "").toLowerCase();
    if (pm && (pricingModel === "Subscription" || !pricingModel)) {
      if (pm === "hourly") setPricingModel("Hourly");
      else if (pm === "retainer") setPricingModel("Retainer");
      else if (pm === "fixed_job") setPricingModel("One-time");
    }
  }, [acceptedIdeaValidation, companyName, industry, pricingModel, problem, solution, targetMarket]);

  useEffect(() => {
    let alive = true;
    async function prefillFromWorkspace() {
    if (acceptedIdeaValidation || !workspaceIdStored) return;
      try {
        const ws = await apiRequest(`/validation/${workspaceIdStored}`, "GET");
        if (!alive) return;
        const profile = ws?.data?.business_profile || {};
        const workspaceProfile = ws?.data?.workspace_profile || {};
        const wpServices = Array.isArray(workspaceProfile.services) ? workspaceProfile.services : [];
        setWorkspaceProfile(workspaceProfile || null);
        if (!companyName && (workspaceProfile.company_name || profile.business_name)) {
          setCompanyName(workspaceProfile.company_name || profile.business_name);
        }
        if (!industry && (workspaceProfile.primary_industry || profile.primary_industry || profile.business_type)) {
          setIndustry(workspaceProfile.primary_industry || profile.primary_industry || profile.business_type);
        }
        if (!valueProp && (workspaceProfile.key_offering_focus || workspaceProfile.tagline || profile.value_proposition)) {
          setValueProp(workspaceProfile.key_offering_focus || workspaceProfile.tagline || profile.value_proposition);
        }
        if (!targetMarket && workspaceProfile.target_customer_type) {
          setTargetMarket(workspaceProfile.target_customer_type);
        }
        if (!solution && wpServices.length) {
          const joined = wpServices
            .map((s) => String(s?.service_name || "").trim())
            .filter(Boolean)
            .join(" / ");
          if (joined) setSolution(joined);
        }
      } catch {
        // ignore
      }
    }
    prefillFromWorkspace();
    return () => {
      alive = false;
    };
  }, [acceptedIdeaValidation, companyName, industry, valueProp, workspaceIdStored, targetMarket, solution]);

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
    if (!workspaceProfile || !workspaceCompanyMatches()) return;
    const defaultContact = getWorkspaceContactDetails();
    if (!contactDetails && defaultContact) setContactDetails(defaultContact);
    if (!senderEmail && workspaceProfile.email) setSenderEmail(String(workspaceProfile.email));
    if (!senderPhone && workspaceProfile.phone_number) setSenderPhone(String(workspaceProfile.phone_number));
    if (!senderWebsite && workspaceProfile.website) setSenderWebsite(String(workspaceProfile.website));
  }, [workspaceProfile, contactDetails, senderEmail, senderPhone, senderWebsite]);

  async function syncWorkspaceProfile() {
    const profile = {
      business_name: companyName?.trim(),
      primary_industry: industry?.trim(),
      business_type: industry?.trim(),
      value_proposition: valueProp?.trim()
    };
    const hasAny = Object.values(profile).some((v) => v && String(v).trim());
    if (!hasAny) return;
    try {
      const ws = await apiRequest("/validation/me", "PATCH", { data: { business_profile: profile } });
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to open saved document");
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
    const saved = savedDocs.find((d) => d.type === docId);
    if (saved) {
      openSavedDocument(saved);
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
    setInputsTab("sections");
    setSectionTabByDoc((prev) => ({ ...prev, [selectedDoc]: sectionId }));
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
    const heading = stripMarkdown(title || "");
    const cleaned = String(body || "").replaceAll("\r\n", "\n").trim();
    if (!heading && !cleaned) return "";
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

  function resolveWithWorkspace(value, fallback) {
    if (String(value || "").trim()) return String(value || "").trim();
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
    const heading = sectionHeadingMap(docId)[sectionId];
    const body = heading ? draftSectionMap[heading] : "";
    if (!body) return "";
    const flat = stripMarkdown(body);
    if (!flat) return "";
    return flat.length > 120 ? `${flat.slice(0, 120)}…` : flat;
  }

  function mergeSectionDrafts(docId, existingMarkdown, incomingMarkdown) {
    const existing = extractSections(existingMarkdown || "");
    const incoming = extractSections(incomingMarkdown || "");
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
      if (!targetMarket) setTargetMarket(entry.industry || entry.name);
      if (!terms && entry.payment_terms) {
        const formatted = formatPaymentTerms(entry.payment_terms);
        if (formatted) setTerms(`Payment terms: ${formatted}`);
      }
    }
    if (selectedDoc === "sales_letter") {
      setBillTo(`${entry.name}`);
      if (!targetMarket) setTargetMarket(entry.name);
    }
  }

  async function generateSelected() {
    const resolvedCompanyName = resolveWithWorkspace(companyName, workspaceProfile?.company_name);
    const resolvedIndustry = resolveWithWorkspace(industry, workspaceProfile?.primary_industry);
    const resolvedValueProp = resolveWithWorkspace(valueProp, workspaceProfile?.key_offering_focus || workspaceProfile?.tagline);
    const resolvedTargetMarket = resolveWithWorkspace(targetMarket, workspaceProfile?.target_customer_type);
    const resolvedContactDetails = resolveWithWorkspace(contactDetails, getWorkspaceContactDetails());
    const resolvedSenderEmail = resolveWithWorkspace(senderEmail, workspaceProfile?.email);
    const resolvedSenderPhone = resolveWithWorkspace(senderPhone, workspaceProfile?.phone_number);
    const resolvedSenderWebsite = resolveWithWorkspace(senderWebsite, workspaceProfile?.website);
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
    const wantsSnapshot =
      selectedDoc === "business_plan" && (sectionsByDoc[selectedDoc] || []).includes("financial_snapshot");
    if (wantsSnapshot && !workspaceId.trim() && !workspaceIdStored) {
      setError("Select a workspace to include the financial snapshot.");
      setShowInputs(true);
      return;
    }
    await syncWorkspaceProfile();
    setIsLoading(true);
    setError(null);
      setDocByType((prev) => ({ ...prev, [selectedDoc]: null }));
    try {
      const res = await apiRequest("/blueprint/generate", "POST", {
        type: selectedDoc,
        company_name: resolvedCompanyName,
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
        objective: getObjectiveValue(selectedDoc),
        subject_lines: getObjectiveValue("sales_letter"),
        followup_sequence: followupChoice === "Other" ? followupCustom : followupChoice,
        sections: sectionsByDoc[selectedDoc] || [],
        word_count: selectedDoc === "sales_letter" ? Number(wordCount) || null : null
      }, { timeoutMs: 240000 });
      setDocByType((prev) => ({ ...prev, [selectedDoc]: res }));
      if (res?.document_id) setDocIdByType((prev) => ({ ...prev, [selectedDoc]: res.document_id }));
      setEditedHtmlByType((prev) => ({ ...prev, [selectedDoc]: "" }));
      const generatedDraftMarkdown =
        res?.document_markdown || (res?.document_html ? htmlToPseudoMarkdown(res.document_html) : "");
      if (generatedDraftMarkdown) {
        setSectionDraftsByDoc((prev) => ({ ...prev, [selectedDoc]: generatedDraftMarkdown }));
        setDraftSectionsByDoc((prev) => ({
          ...prev,
          [selectedDoc]: (prev[selectedDoc] && prev[selectedDoc].length) ? prev[selectedDoc] : sectionsForDoc(selectedDoc).map((s) => s.id)
        }));
      }
      setShowInputs(false);
      refreshSavedDocs();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Blueprint generation failed");
      setShowInputs(true);
    } finally {
      setIsLoading(false);
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
    const resolvedCompanyName = resolveWithWorkspace(companyName, workspaceProfile?.company_name);
    const resolvedIndustry = resolveWithWorkspace(industry, workspaceProfile?.primary_industry);
    const resolvedValueProp = resolveWithWorkspace(valueProp, workspaceProfile?.key_offering_focus || workspaceProfile?.tagline);
    const resolvedTargetMarket = resolveWithWorkspace(targetMarket, workspaceProfile?.target_customer_type);
    const resolvedContactDetails = resolveWithWorkspace(contactDetails, getWorkspaceContactDetails());
    const resolvedSenderEmail = resolveWithWorkspace(senderEmail, workspaceProfile?.email);
    const resolvedSenderPhone = resolveWithWorkspace(senderPhone, workspaceProfile?.phone_number);
    const resolvedSenderWebsite = resolveWithWorkspace(senderWebsite, workspaceProfile?.website);
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
      const res = await apiRequest("/blueprint/generate", "POST", {
        type: selectedDoc,
        company_name: resolvedCompanyName,
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
        objective: getObjectiveValue(selectedDoc),
        subject_lines: getObjectiveValue("sales_letter"),
        followup_sequence: followupChoice === "Other" ? followupCustom : followupChoice,
        sections: chosen,
        word_count: selectedDoc === "sales_letter" ? Number(wordCount) || null : null
      }, { timeoutMs: 240000 });
      const markdown = res?.document_markdown || "";
      setSectionDraftsByDoc((prev) => ({
        ...prev,
        [selectedDoc]: mergeSectionDrafts(selectedDoc, prev[selectedDoc] || "", markdown)
      }));
      setSectionTabByDoc((prev) => ({ ...prev, [selectedDoc]: chosen[0] }));
      setShowInputs(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Section generation failed");
      setShowInputs(true);
    } finally {
      setIsLoading(false);
    }
  }

  async function saveEdits() {
    const docId = selectedDoc ? docIdByType[selectedDoc] : null;
    if (!selectedDoc || !docId) return;
    const html = editedHtmlByType[selectedDoc] || "";
    setIsSaving(true);
    setError(null);
    try {
      await apiRequest(`/blueprint/documents/${docId}`, "PATCH", { document_html: html });
      refreshSavedDocs();
      setSavedNotice("Saved");
      setTimeout(() => setSavedNotice(null), 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save changes");
    } finally {
      setIsSaving(false);
    }
  }

  async function downloadPdfFromHtml(html, filename) {
    try {
      const container = document.createElement("div");
      const source = String(html || "");
      const pdfStyles = `
        <style>
          * { box-sizing: border-box; }
          :root { color-scheme: light; }
          body { margin: 0; padding: 0; }
          .pdf-doc { width: 100%; max-width: 190mm; padding: 14mm 10mm; font-family: "Inter", "Segoe UI", Arial, sans-serif; background: #ffffff; margin: 0 auto; box-sizing: border-box; }
          .pdf-doc, .pdf-doc * { color: #0f172a !important; }
          h1 { text-align: center; font-size: 24px; font-weight: 800; margin: 0 0 14px; letter-spacing: -0.02em; }
          h2 { text-align: center; font-size: 16px; font-weight: 800; margin: 22px 0 10px; letter-spacing: -0.01em; }
          h3 { font-size: 14px; font-weight: 800; margin: 16px 0 6px; }
          h1, h2, h3 { break-after: avoid-page; page-break-after: avoid; }
          h1 + p, h2 + p, h3 + p, h2 + ul, h3 + ul { break-before: avoid-page; page-break-before: avoid; }
          p, li { font-size: 12.5px; line-height: 1.7; orphans: 3; widows: 3; }
          ul { margin: 8px 0 0 18px; padding: 0; }
          li { margin: 6px 0; }
          table { width: 100%; border-collapse: collapse; margin: 12px 0 6px; font-size: 12.5px; }
          th, td { border: 1px solid #e2e8f0; padding: 8px 10px; text-align: left; vertical-align: top; }
          th { background: #f8fafc; font-weight: 700; }
          .cover-page { min-height: 70vh; display: flex; flex-direction: column; justify-content: center; text-align: center; }
          .cover-page p { margin: 6px 0; }
          .page-break { page-break-after: always; break-after: page; height: 1px; }
        </style>
      `;
      const pageParts = source.split('<div class="page-break"></div>');
      const withBreaks = pageParts
        .map((p) => p.trim())
        .filter(Boolean)
        .join('<div class="page-break"></div>');
      container.innerHTML = `${pdfStyles}<div class="pdf-doc">${withBreaks || source}</div>`;
      container.style.width = "210mm";
      container.style.padding = "0";
      container.style.boxSizing = "border-box";
      container.style.fontSize = "14px";
      container.style.lineHeight = "1.5";
      container.style.color = "#0f172a";
      container.style.background = "#ffffff";
      container.className = "pdf-root";
      document.body.appendChild(container);
      await html2pdf()
        .set({
          filename,
          margin: [6, 6, 6, 6],
          pagebreak: { mode: ["css", "legacy", "avoid-all"] },
          image: { type: "jpeg", quality: 0.98 },
          html2canvas: {
            scale: 2,
            useCORS: true,
            windowWidth: 1100,
            windowHeight: 1550,
            backgroundColor: "#ffffff",
            letterRendering: true
          },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait", compress: true }
        })
        .from(container)
        .save();
      document.body.removeChild(container);
    } catch (e) {
      setError("Unable to generate the PDF. Please refresh and try again.");
    }
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
      if (format === "pdf") {
        let html = editedHtmlByType[selectedDoc] || selectedDocResult?.document_html || "";
        if (!html) {
          const docUrl = `${getApiBaseUrl()}/blueprint/documents/${docId}/export?format=doc`;
          const res = await fetch(docUrl, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
          if (!res.ok) {
            const text = await res.text().catch(() => "");
            throw new Error(text || "Export failed");
          }
          html = await res.text();
        }
        const filename = `${selectedMeta?.title || "document"}-${docId}.pdf`;
        await downloadPdfFromHtml(html, filename);
        return;
      }
      const url = `${getApiBaseUrl()}/blueprint/documents/${docId}/export?format=${format}`;
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || "Export failed");
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="(.+?)"/);
      const filename = match?.[1] || `document.${format === "doc" ? "doc" : "pdf"}`;
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(link.href);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    }
  }

  async function deleteDocument(docId, typeHint) {
    if (!docId) return;
    const ok = window.confirm("Delete this document? This cannot be undone.");
    if (!ok) return;
    setIsSaving(true);
    setError(null);
    try {
      await apiRequest(`/blueprint/documents/${docId}`, "DELETE");
      setSavedDocs((prev) => prev.filter((d) => d.id !== docId));
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
      }
      if (selectedDoc && docIdByType[selectedDoc] === docId) {
        closeModal();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete document");
    } finally {
      setIsSaving(false);
    }
  }

  function fmtDate(d) {
    try {
      return new Date(d).toLocaleString();
    } catch {
      return "";
    }
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
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            {DOCUMENTS.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => openDoc(d.id)}
                className={"ea-card ea-card-hover relative p-4 text-left border-slate-200"}
              >
                <div className="absolute right-3 top-3 inline-flex items-center rounded-full bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-700 ring-1 ring-slate-200">
                  {pct(completionFor(d.id))}
                </div>
                <div className="text-sm font-semibold text-slate-900">{d.title}</div>
                <div className="mt-1 text-xs text-slate-600">{d.desc}</div>
                {d.needsWorkspace ? (
                  <div className="mt-2 text-[11px] font-semibold text-slate-500">Uses Idea Validation metrics</div>
                ) : null}
              </button>
            ))}
          </div>
        </SectionCard>

        {savedDocs.length ? (
          <SectionCard title="Saved Documents" subtitle="Open and edit your generated documents anytime.">
            <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
              {savedDocs.slice(0, 10).map((d) => (
                <div
                  key={d.id}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
                >
                  <button
                    type="button"
                    onClick={() => openSavedDocument(d)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="truncate text-sm font-semibold text-slate-900">{d.title}</div>
                    <div className="mt-0.5 truncate text-xs text-slate-600">{d.company_name}</div>
                  </button>
                  <div className="shrink-0 text-[11px] font-semibold text-slate-500">{fmtDate(d.updated_at)}</div>
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
          <div className="ea-dialog w-full max-w-[96rem] h-[90vh] overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
              <div>
                <div className="text-sm font-semibold text-slate-900">{selectedMeta.title}</div>
                <div className="mt-0.5 text-xs text-slate-600">{selectedMeta.desc}</div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  onClick={() => setShowInputs((v) => !v)}
                >
                  {showInputs ? "Hide inputs" : "Edit inputs"}
                </Button>
                <Button disabled={isLoading} onClick={generateSelected}>
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

            <div className="flex h-[calc(90vh-64px)] min-h-0 flex-col overflow-hidden lg:flex-row">
              {showInputs && showSectionDrafts ? (
                <div className="hidden lg:block order-3 w-[380px] shrink-0 overflow-auto border-l border-slate-200 bg-white p-5">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3">
                    <div className="text-sm font-semibold text-slate-900">Section drafts</div>
                    <div className="mt-1 text-[11px] text-slate-500">
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
                  <div className="mt-3">
                    <Button
                      variant="secondary"
                      disabled={isLoading || !(draftSectionsByDoc[selectedDoc] || []).length}
                      onClick={() => generateSectionDrafts()}
                    >
                      {isLoading ? "Generating..." : "Generate section drafts"}
                    </Button>
                  </div>
                </div>
              ) : null}

              <div className="order-1 flex-1 min-h-0 h-full overflow-hidden bg-slate-50 p-5 relative lg:order-2">
                {showSectionPreview ? (
                  <div className="flex h-full min-h-0 flex-col gap-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm text-slate-500">Section preview</div>
                      {selectedDocResult?.document_markdown ? (
                        <Button variant="secondary" size="sm" onClick={() => setInputsTab("inputs")}>
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
                          onDownload={null}
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
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {savedNotice ? (
                        <div className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                          {savedNotice}
                        </div>
                      ) : null}
                      <Button
                        variant="secondary"
                        disabled={!docIdByType[selectedDoc] || isSaving}
                        onClick={saveEdits}
                      >
                        {isSaving ? "Saving..." : "Save changes"}
                      </Button>
                    </div>
                    <div className="flex-1 min-h-0">
                      <DocumentEditor
                        title={selectedMeta.title}
                        markdown={selectedDocResult.document_markdown}
                        initialHtml={selectedDocResult.document_html || ""}
                        onHtmlChange={(h) => setEditedHtmlByType((prev) => ({ ...prev, [selectedDoc]: h }))}
                        onDownload={downloadExport}
                        onSave={saveEdits}
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
              {showInputs ? (
                <div className="order-2 w-full shrink-0 overflow-auto border-t border-slate-200 bg-white p-5 lg:order-1 lg:w-[380px] lg:border-r lg:border-t-0">
                {showSectionDrafts && !isDesktop ? (
                  <SegmentedTabs
                    value={inputsTab}
                    onChange={setInputsTab}
                    options={[
                      { value: "inputs", label: "Inputs" },
                      { value: "sections", label: "Section drafts" }
                    ]}
                    size="sm"
                  />
                ) : null}

                {inputsTab === "sections" && showSectionDrafts && !isDesktop ? (
                  <div className="mt-4 space-y-3">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3">
                      <div className="text-sm font-semibold text-slate-900">Section drafts (standalone)</div>
                      <div className="mt-1 text-[11px] text-slate-500">
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
                    <div>
                      <Button
                        variant="secondary"
                        disabled={isLoading || !(draftSectionsByDoc[selectedDoc] || []).length}
                        onClick={() => generateSectionDrafts()}
                      >
                        {isLoading ? "Generating..." : "Generate section drafts"}
                      </Button>
                    </div>
                  </div>
                ) : (
                <>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div>
                    <div className="ea-label">Business name</div>
                    <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="e.g., Sparkle Cleaning" />
                  </div>
                  <div>
                    <div className="ea-label">Industry</div>
                    <Input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="e.g., Cleaning, Healthcare, Technology" />
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
                  <div className="md:col-span-2">
                    <div className="ea-label">Tone</div>
                    <Input value={tone} onChange={(e) => setTone(e.target.value)} placeholder="professional" />
                  </div>
                  {selectedDoc === "business_plan" || selectedDoc === "client_proposal" ? (
                    <div className="md:col-span-2">
                      <div className="ea-label">Objective</div>
                      <select
                        value={objectiveChoiceByDoc[selectedDoc] || ""}
                        onChange={(e) =>
                          setObjectiveChoiceByDoc((prev) => ({ ...prev, [selectedDoc]: e.target.value }))
                        }
                        className="ea-input"
                      >
                        {objectivesForDoc(selectedDoc).map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
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
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3">
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
                                  <option key={c.id} value={c.id}>
                                    {c.name}
                                  </option>
                                ))}
                              </optgroup>
                            ) : null}
                            {activeVendors.length ? (
                              <optgroup label="Vendors">
                                {activeVendors.map((v) => (
                                  <option key={v.id} value={v.id}>
                                    {v.name}
                                  </option>
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

                  {showCoreNarrative ? (
                    <>
                      <div>
                        <div className="ea-label">Problem</div>
                        <textarea value={problem} onChange={(e) => setProblem(e.target.value)} className="min-h-20 ea-input" placeholder="What problem are you solving?" />
                      </div>
                      <div>
                        <div className="ea-label">Solution</div>
                        <textarea value={solution} onChange={(e) => setSolution(e.target.value)} className="min-h-20 ea-input" placeholder="What are you building and how does it solve it?" />
                      </div>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <div>
                          <div className="ea-label">Target market</div>
                          <Input value={targetMarket} onChange={(e) => setTargetMarket(e.target.value)} placeholder="Who is it for?" />
                        </div>
                        <div>
                          <div className="ea-label">Value proposition</div>
                          <Input value={valueProp} onChange={(e) => setValueProp(e.target.value)} placeholder="Why will they choose you?" />
                        </div>
                      </div>
                    </>
                  ) : null}

                  {selectedDoc && sectionsForDoc(selectedDoc).length ? (
                    <div ref={sectionDraftsRef} className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3">
                      <div className="text-sm font-semibold text-slate-900">Sections to generate (optional)</div>
                      <div className="mt-2 grid grid-cols-1 gap-2">
                        {sectionsForDoc(selectedDoc).map((section) => (
                          <label key={section.id} className="flex items-center gap-2 text-xs text-slate-700">
                            <input
                              type="checkbox"
                              checked={(sectionsByDoc[selectedDoc] || []).includes(section.id)}
                              onChange={() => toggleSection(selectedDoc, section.id)}
                            />
                            <span>{section.label}</span>
                          </label>
                        ))}
                      </div>
                      <div className="mt-2 text-[11px] text-slate-500">
                        Leave unchecked to generate the full document.
                      </div>
                      <div className="mt-3">
                        <Button
                          variant="secondary"
                          disabled={isLoading || !(sectionsByDoc[selectedDoc] || []).length}
                          onClick={generateSectionDrafts}
                        >
                          {isLoading ? "Generating..." : "Generate section drafts"}
                        </Button>
                      </div>
                    </div>
                  ) : null}

                  {showQuoteFields ? (
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div>
                        <div className="ea-label">Bill to</div>
                        <Input value={billTo} onChange={(e) => setBillTo(e.target.value)} placeholder="Client name / address" />
                      </div>
                      <div className="md:col-span-2">
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
                      <div className="md:col-span-2">
                        <div className="ea-label">Terms (optional)</div>
                        <Input value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="Payment terms / quotation terms" />
                      </div>
                    </div>
                  ) : null}

                  {showProposalExtras ? (
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div className="md:col-span-2">
                        <div className="ea-label">Proposal title (optional)</div>
                        <Input value={proposalTitle} onChange={(e) => setProposalTitle(e.target.value)} placeholder="e.g., Business Proposal" />
                      </div>
                      <div className="md:col-span-2">
                        <div className="ea-label">Contact details (optional)</div>
                        <Input value={contactDetails} onChange={(e) => setContactDetails(e.target.value)} placeholder="Email, phone, website (no numbers required)" />
                      </div>
                      <div className="md:col-span-2">
                        <div className="ea-label">Timeline / plan (optional)</div>
                        <textarea value={timeline} onChange={(e) => setTimeline(e.target.value)} className="min-h-16 ea-input" placeholder="Phases and milestones in words" />
                      </div>
                      <div>
                        <div className="ea-label">Assumptions (optional)</div>
                        <textarea value={assumptions} onChange={(e) => setAssumptions(e.target.value)} className="min-h-16 ea-input" placeholder="Key assumptions" />
                      </div>
                      <div>
                        <div className="ea-label">Exclusions (optional)</div>
                        <textarea value={scopeExclusions} onChange={(e) => setScopeExclusions(e.target.value)} className="min-h-16 ea-input" placeholder="What is not included" />
                      </div>
                    </div>
                  ) : null}

                  {showSalesLetterExtras ? (
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div>
                        <div className="ea-label">Target word count</div>
                        <Input
                          type="number"
                          value={wordCount}
                          onChange={(e) => setWordCount(e.target.value)}
                          placeholder="e.g., 700"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <div className="ea-label">Objective</div>
                        <select
                          value={objectiveChoiceByDoc.sales_letter}
                          onChange={(e) =>
                            setObjectiveChoiceByDoc((prev) => ({ ...prev, sales_letter: e.target.value }))
                          }
                          className="ea-input"
                        >
                          {SALES_LETTER_OBJECTIVES.map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
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
                      <div className="md:col-span-2">
                        <div className="ea-label">Headline angle (optional)</div>
                        <Input value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="Opening line / headline idea" />
                      </div>
                      <div className="md:col-span-2">
                        <div className="ea-label">Offer (optional)</div>
                        <Input value={offer} onChange={(e) => setOffer(e.target.value)} placeholder="What the reader gets (no prices)" />
                      </div>
                      <div className="md:col-span-2">
                        <div className="ea-label">Call to action (optional)</div>
                        <Input value={cta} onChange={(e) => setCta(e.target.value)} placeholder="What should they do next?" />
                      </div>
                      <div className="md:col-span-2">
                        <div className="ea-label">Proof / credibility (optional)</div>
                        <textarea value={proof} onChange={(e) => setProof(e.target.value)} className="min-h-16 ea-input" placeholder="Experience, results, case study narrative (no numbers)" />
                      </div>
                      <div className="md:col-span-2">
                        <div className="ea-label">Urgency / scarcity (optional)</div>
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
                        <Input value={senderEmail} onChange={(e) => setSenderEmail(e.target.value)} placeholder="you@company.com" />
                      </div>
                      <div>
                        <div className="ea-label">Sender website (optional)</div>
                        <Input value={senderWebsite} onChange={(e) => setSenderWebsite(e.target.value)} placeholder="company website" />
                      </div>
                      <div className="md:col-span-2">
                        <div className="ea-label">Sender phone (optional)</div>
                        <Input value={senderPhone} onChange={(e) => setSenderPhone(e.target.value)} placeholder="Phone (optional)" />
                      </div>
                      <div className="md:col-span-2">
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
                    </div>
                  ) : null}

                  <div>
                    <div className="ea-label">Extra notes (optional)</div>
                    <textarea value={extraNotes} onChange={(e) => setExtraNotes(e.target.value)} className="min-h-16 ea-input" placeholder="Extra context, audience, constraints, etc." />
                  </div>

                </div>
                </>
                )}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}







