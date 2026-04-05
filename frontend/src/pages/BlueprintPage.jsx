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

const DOCUMENTS = [
  {
    id: "business_plan",
    title: "Business Plan",
    desc: "Strategy + structured narrative sections",
    needsWorkspace: false
  },
  {
    id: "client_proposal",
    title: "Client Proposal",
    desc: "Client-specific scope, approach, and terms",
    needsWorkspace: false
  },
  {
    id: "sales_letter",
    title: "Sales Letter",
    desc: "Outreach copy from your offer and value prop",
    needsWorkspace: false
  }
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
  const [subjectLineChoice, setSubjectLineChoice] = useState("A reliable, no-drama way to keep standards consistent");
  const [subjectLineCustom, setSubjectLineCustom] = useState("");
  const [followupChoice, setFollowupChoice] = useState("Touch one: quick reminder and recap of the main benefit, inviting a short call");
  const [followupCustom, setFollowupCustom] = useState("");

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [docByType, setDocByType] = useState({});
  const [docIdByType, setDocIdByType] = useState({});
  const [editedHtmlByType, setEditedHtmlByType] = useState({});
  const [savedDocs, setSavedDocs] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [customClientName, setCustomClientName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(null);
  const [includeSnapshot, setIncludeSnapshot] = useState(false);

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
  const acceptedIdeaValidation = decisionStatus === "accepted" ? ideaValidation : null;
  const OTHER_CUSTOMER_ID = "__other__";

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
  }, [selectedDoc]);

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
        if (!companyName && profile.business_name) setCompanyName(profile.business_name);
        if (!industry && (profile.primary_industry || profile.business_type)) setIndustry(profile.primary_industry || profile.business_type);
        if (!valueProp && profile.value_proposition) setValueProp(profile.value_proposition);
      } catch {
        // ignore
      }
    }
    prefillFromWorkspace();
    return () => {
      alive = false;
    };
  }, [acceptedIdeaValidation, companyName, industry, valueProp, workspaceIdStored]);

  useEffect(() => {
    let alive = true;
    async function loadCatalogue() {
      if (!workspaceIdStored) return;
      try {
        const ws = await apiRequest("/validation/me", "GET");
        if (!alive || !ws) return;
        const cat = ws?.data?.catalogue || {};
        setCustomers(Array.isArray(cat.customers) ? cat.customers : []);
      } catch {
        // ignore
      }
    }
    loadCatalogue();
    return () => {
      alive = false;
    };
  }, [workspaceIdStored]);

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
    if (!customer) return;
    if (selectedDoc === "client_proposal") {
      setBillTo(`${customer.name}`);
      if (!targetMarket) setTargetMarket(customer.industry || customer.name);
      if (!terms && customer.payment_terms) {
        const formatted = formatPaymentTerms(customer.payment_terms);
        if (formatted) setTerms(`Payment terms: ${formatted}`);
      }
    }
    if (selectedDoc === "sales_letter") {
      setBillTo(`${customer.name}`);
      if (!targetMarket) setTargetMarket(customer.name);
    }
  }

  async function generateSelected() {
    if (companyName.trim().length < 2) {
      setError("Enter a business name to generate documents.");
      setShowInputs(true);
      return;
    }
    if ((selectedDoc === "client_proposal" || selectedDoc === "sales_letter") && !String(billTo || customClientName).trim()) {
      setError("Select a client from your catalogue or type a client name to continue.");
      setShowInputs(true);
      return;
    }
    if (needsWorkspace && !workspaceId.trim()) {
      setError("Paste an Idea Validation workspace id to generate this document.");
      setShowInputs(true);
      return;
    }
    if (includeSnapshot && !workspaceId.trim() && !workspaceIdStored) {
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
        company_name: companyName,
        industry,
        pricing_model: pricingModel,
        workspace_id: (workspaceId || workspaceIdStored || "").trim() || null,
        include_validation_snapshot: includeSnapshot,
        problem,
        solution,
        target_market: targetMarket,
        value_proposition: valueProp,
        tone,
        extra_notes: extraNotes,
        bill_to: billTo || customClientName,
        items,
        terms,

        proposal_title: proposalTitle,
        contact_details: contactDetails,
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
        sender_phone: senderPhone,
        sender_email: senderEmail,
        sender_website: senderWebsite,
        subject_lines: subjectLineChoice === "Other" ? subjectLineCustom : subjectLineChoice,
        followup_sequence: followupChoice === "Other" ? followupCustom : followupChoice
      }, { timeoutMs: 120000 });
      setDocByType((prev) => ({ ...prev, [selectedDoc]: res }));
      if (res?.document_id) setDocIdByType((prev) => ({ ...prev, [selectedDoc]: res.document_id }));
      setEditedHtmlByType((prev) => ({ ...prev, [selectedDoc]: "" }));
      setShowInputs(false);
      refreshSavedDocs();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Blueprint generation failed");
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
          .pdf-doc { width: 190mm; padding: 14mm 10mm; font-family: "Inter", "Segoe UI", Arial, sans-serif; background: #ffffff; margin: 0 auto; }
          .pdf-doc, .pdf-doc * { color: #0f172a !important; }
          h1 { text-align: center; font-size: 24px; font-weight: 800; margin: 0 0 14px; letter-spacing: -0.02em; }
          h2 { text-align: center; font-size: 16px; font-weight: 800; margin: 22px 0 10px; letter-spacing: -0.01em; }
          h3 { font-size: 14px; font-weight: 800; margin: 16px 0 6px; }
          p, li { font-size: 12.5px; line-height: 1.7; }
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
          <div className="ea-dialog w-full max-w-6xl h-[90vh] overflow-hidden">
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

            <div className="flex h-[calc(90vh-64px)] min-h-0 overflow-hidden">
              {showInputs ? (
                <div className="w-full shrink-0 overflow-auto border-b border-slate-200 bg-white p-5 lg:w-[420px] lg:border-b-0 lg:border-r">
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
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3">
                  {showProposalExtras || showSalesLetterExtras ? (
                    <div>
                      <div className="ea-label">Customer</div>
                      {activeCustomers.length ? (
                        <>
                          <select
                            className="ea-input"
                            value={selectedCustomerId}
                            onChange={(e) => applyCustomerSelection(e.target.value)}
                          >
                            <option value="">Select customer</option>
                            {activeCustomers.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                            <option value={OTHER_CUSTOMER_ID}>Other (type a name)</option>
                          </select>
                          <div className="mt-1 text-[11px] text-slate-500">
                            Selecting a customer will prefill the client details and audience.
                          </div>
                        </>
                      ) : null}
                      {!activeCustomers.length || selectedCustomerId === OTHER_CUSTOMER_ID ? (
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

                  {selectedDoc === "business_plan" ? (
                    <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={includeSnapshot}
                        onChange={(e) => setIncludeSnapshot(e.target.checked)}
                      />
                      <span>Include financial snapshot</span>
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
                        <div className="ea-label">Subject line</div>
                        <select
                          value={subjectLineChoice}
                          onChange={(e) => setSubjectLineChoice(e.target.value)}
                          className="ea-input"
                        >
                          <option value="A reliable, no-drama way to keep standards consistent">
                            A reliable, no-drama way to keep standards consistent
                          </option>
                          <option value="A simple proposal for dependable delivery">
                            A simple proposal for dependable delivery
                          </option>
                          <option value="Other">Other (type your own)</option>
                        </select>
                        {subjectLineChoice === "Other" ? (
                          <Input
                            value={subjectLineCustom}
                            onChange={(e) => setSubjectLineCustom(e.target.value)}
                            placeholder="Type a custom subject line"
                            className="mt-2"
                          />
                        ) : null}
                      </div>
                      <div className="md:col-span-2">
                        <div className="ea-label">Follow-up sequence</div>
                        <select
                          value={followupChoice}
                          onChange={(e) => setFollowupChoice(e.target.value)}
                          className="ea-input"
                        >
                          <option value="Touch one: quick reminder and recap of the main benefit, inviting a short call">
                            Touch one: quick reminder and recap of the main benefit, inviting a short call
                          </option>
                          <option value="Touch two: share a practical example of how the process reduces risk and saves time">
                            Touch two: share a practical example of how the process reduces risk and saves time
                          </option>
                          <option value="Touch three: final check-in offering to hold a slot and answer questions">
                            Touch three: final check-in offering to hold a slot and answer questions
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

                  {error ? (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                      {error}
                    </div>
                  ) : null}
                </div>
                </div>
              ) : null}

              <div className="flex-1 min-h-0 h-full overflow-hidden bg-slate-50 p-5">
                {selectedDocResult?.document_markdown ? (
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
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}







