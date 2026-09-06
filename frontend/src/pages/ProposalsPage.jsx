import { useEffect, useImperativeHandle, useRef, forwardRef, useState, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuthStore } from "../store/auth";
import { useWorkspaceStore } from "../store/workspace";
import { useProposalStore, STATUS_LABELS, STATUS_COLORS, ACTIVE_STATUSES, hasPaidAccess } from "../store/proposal";
import { getCurrencySymbol } from "../lib/currencies";
import Spinner from "../components/Spinner";
import { apiRequest } from "../api/client";

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt)) return "—";
  return dt.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function fmtRel(d) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt)) return "—";
  const diff = Date.now() - dt.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return fmtDate(d);
}

function titleCase(s) {
  return (s || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function StatusBadge({ status }) {
  const cls = STATUS_COLORS[status] || "bg-slate-100 text-slate-500";
  return (
    <span className={`inline-flex items-center rounded-lg px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}>
      {STATUS_LABELS[status] || titleCase(status)}
    </span>
  );
}

// ─── toast ────────────────────────────────────────────────────────────────────

function Toast({ msg, type = "success", onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3200);
    return () => clearTimeout(t);
  }, [onDone]);
  return createPortal(
    <div className={`fixed bottom-6 left-1/2 z-[200] -translate-x-1/2 rounded-2xl px-5 py-3 text-[13px] font-semibold text-white shadow-xl transition
      ${type === "error" ? "bg-red-600" : "bg-emerald-600"}`}>
      {msg}
    </div>,
    document.body
  );
}

// ─── empty state ──────────────────────────────────────────────────────────────

function EmptyState({ icon, title, body, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-50 dark:bg-brand-900/20">
        {icon}
      </div>
      <p className="mb-1 text-[15px] font-semibold text-slate-700 dark:text-slate-300">{title}</p>
      <p className="mb-5 max-w-xs text-[13px] text-slate-500 dark:text-slate-400">{body}</p>
      {action}
    </div>
  );
}

// ─── settings tab ─────────────────────────────────────────────────────────────

const PROPOSAL_MODES = [
  { key: "general", label: "General", desc: "Accept proposals from any business" },
  { key: "specific", label: "Specific", desc: "Only proposals matching a published request" },
  { key: "invite_only", label: "Invite Only", desc: "Proposals from invited businesses only" },
];

const PROPOSAL_CATEGORIES = [
  "Software & Technology", "Design & Creative", "Consulting & Advisory",
  "Marketing & Growth", "Finance & Accounting", "Legal & Compliance",
  "Logistics & Supply Chain", "Operations & Admin", "HR & Recruitment",
  "Manufacturing & Production", "Research & Analysis", "Other",
];

export function SettingsTab() {
  const { preferences, preferencesLoading, preferencesError, fetchPreferences, savePreferences } = useProposalStore();
  const subscription = useAuthStore((s) => s.subscription);
  const paid = hasPaidAccess(subscription?.plan_key);

  const [enabled, setEnabled] = useState(false);
  const [modes, setModes] = useState(["general"]);
  const [categories, setCategories] = useState([]);
  const [cap, setCap] = useState("");
  const [visibility, setVisibility] = useState("marketplace");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  // Only fetch if preferences not yet in store — avoids stale race-condition overwrites
  const initDone = useRef(false);
  useEffect(() => {
    if (!preferences) fetchPreferences();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync local form once — never again (prevents API response overwriting user edits)
  useEffect(() => {
    if (initDone.current || !preferences) return;
    initDone.current = true;
    setEnabled(preferences.enabled ?? false);
    setModes(preferences.accepted_modes ?? ["general"]);
    setCategories(preferences.accepted_categories ?? []);
    setCap(preferences.proposal_cap != null ? String(preferences.proposal_cap) : "");
    setVisibility(preferences.visibility ?? "marketplace");
  }, [preferences]);

  function toggleMode(k) {
    setModes((m) => m.includes(k) ? m.filter((x) => x !== k) : [...m, k]);
  }
  function toggleCat(c) {
    setCategories((cs) => cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c]);
  }

  // Auto-save toggle and keep initDone locked so remount syncs from store (which we optimistically update)
  async function handleToggleEnabled() {
    const next = !enabled;
    setEnabled(next);
    // Optimistically patch store so if component remounts mid-save it syncs the correct value
    useProposalStore.setState((s) => ({
      preferences: s.preferences ? { ...s.preferences, enabled: next } : s.preferences,
    }));
    await savePreferences({
      enabled: next,
      accepted_modes: modes,
      accepted_categories: categories.length > 0 ? categories : null,
      proposal_cap: cap !== "" ? parseInt(cap, 10) : null,
      visibility,
    });
  }

  async function handleSave() {
    setSaving(true);
    const res = await savePreferences({
      enabled,
      accepted_modes: modes,
      accepted_categories: categories.length > 0 ? categories : null,
      proposal_cap: cap !== "" ? parseInt(cap, 10) : null,
      visibility,
    });
    setSaving(false);
    setToast(res.ok
      ? { msg: "Proposal settings saved", type: "success" }
      : { msg: res.error || "Save failed", type: "error" });
  }

  if (preferencesLoading && !preferences) {
    return <div className="flex justify-center py-16"><Spinner /></div>;
  }

  return (
    <div className="mx-auto max-w-2xl py-8">
      {toast && <Toast msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />}

      {/* Open for Proposals toggle */}
      <div className="ea-card mb-6 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-[15px] font-bold text-slate-800 dark:text-slate-100">Open for Proposals</h3>
            <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400">
              When enabled, your business is discoverable as "Open for Proposals" on the Marketplace.
              Other businesses can apply to work with you.
            </p>
          </div>
          <button
            type="button"
            onClick={handleToggleEnabled}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500
              ${enabled ? "bg-indigo-600" : "bg-slate-300 dark:bg-slate-600"}`}
            aria-checked={enabled}
            role="switch"
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform
                ${enabled ? "translate-x-6" : "translate-x-1"}`}
            />
          </button>
        </div>

        {enabled && (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 dark:border-emerald-800 dark:bg-emerald-900/20">
            <div className="flex items-center gap-2 text-[12px] font-semibold text-emerald-700 dark:text-emerald-300">
              <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M9 12l2 2 4-4" /><circle cx="12" cy="12" r="10" />
              </svg>
              Your business will appear as "Open for Proposals" on the Marketplace.
            </div>
          </div>
        )}
      </div>


      {!paid && (
        <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
          <div className="flex items-start gap-3">
            <svg className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 9v4M12 17h.01" /><path d="M10.3 3.6l-8.7 15A2 2 0 0 0 3.3 21h17.4a2 2 0 0 0 1.7-3.4l-8.7-15a2 2 0 0 0-3.4 0Z" />
            </svg>
            <div>
              <p className="text-[12px] font-semibold text-amber-700 dark:text-amber-300">Starter Insight plan required</p>
              <p className="mt-0.5 text-[11px] text-amber-600 dark:text-amber-400">
                Receiving and generating proposals requires a Starter Insight or higher plan. Saving settings is free.
              </p>
            </div>
          </div>
        </div>
      )}

      {preferencesError && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-[12px] text-red-600 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          {preferencesError}
        </div>
      )}

      <button
        type="button"
        disabled={saving || preferencesLoading}
        onClick={handleSave}
        className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-[13px] font-bold text-white hover:bg-brand-700 disabled:opacity-50 transition">
        {saving ? <Spinner size="sm" /> : null}
        {saving ? "Saving…" : "Save Settings"}
      </button>
    </div>
  );
}

// ─── request builder modal ─────────────────────────────────────────────────────

const REQ_MODES = [
  { key: "general", label: "General", desc: "Accept proposals from any business" },
  { key: "specific", label: "Specific", desc: "Only proposals matching this request" },
  { key: "invite_only", label: "Invite Only", desc: "Proposals from invited businesses only" },
];

const REQ_FORMAT_SVGS = {
  text:         <svg className="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>,
  document:     <svg className="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>,
  image:        <svg className="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21,15 16,10 5,21"/></svg>,
  figures:      <svg className="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
  presentation: <svg className="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>,
  link:         <svg className="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>,
};

const REQ_FORMATS = [
  { key: "text",         label: "Text",         desc: "Written explanation" },
  { key: "document",     label: "Document",     desc: "PDF or Word file" },
  { key: "image",        label: "Image",        desc: "PNG, JPG or similar" },
  { key: "figures",      label: "Figures",      desc: "Numbers, tables or data" },
  { key: "presentation", label: "Presentation", desc: "Slides or deck" },
  { key: "link",         label: "Link / URL",   desc: "Website or portfolio link" },
];

function RequestModal({ onClose, onSaved, editItem }) {
  const { createRequest, updateRequest } = useProposalStore();
  const wsCurrency = useWorkspaceStore((s) => s.currency) || "GBP";
  const workspaceName = useWorkspaceStore((s) => s.workspaceName) || "";
  const [type, setType] = useState(editItem?.type ?? "general");
  const [title, setTitle] = useState(editItem?.title ?? "");
  const [description, setDescription] = useState(editItem?.description ?? "");
  const [budget, setBudget] = useState(editItem?.budget_range ?? "");
  const [budgetVisible, setBudgetVisible] = useState(editItem?.budget_visible ?? false);
  const [deadline, setDeadline] = useState(editItem?.deadline ? editItem.deadline.slice(0, 10) : "");
  const [cap, setCap] = useState(editItem?.submission_cap != null ? String(editItem.submission_cap) : "");
  const [acceptedModes, setAcceptedModes] = useState(() => {
    const stored = editItem?.accepted_modes;
    if (Array.isArray(stored) && stored.length > 0) return [stored[0]];
    return ["general"];
  });
  const [visibility, setVisibility] = useState(editItem?.visibility ?? "marketplace");
  // Split stored categories into known ones + free-text "other"
  const _storedCats = editItem?.accepted_categories ?? [];
  const _knownCats = PROPOSAL_CATEGORIES.filter(c => c !== "Other");
  const [acceptedCategories, setAcceptedCategories] = useState(_storedCats.filter(c => _knownCats.includes(c) || c === "Other"));
  const [otherCatText, setOtherCatText] = useState(_storedCats.find(c => !PROPOSAL_CATEGORIES.includes(c)) ?? "");
  const [requirements, setRequirements] = useState(editItem?.requirements ?? []);
  const [newReq, setNewReq] = useState("");
  const [newReqFormat, setNewReqFormat] = useState("text");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [aiDescLoading, setAiDescLoading] = useState(false);
  const [aiDescHint, setAiDescHint] = useState("");
  const [catDropOpen, setCatDropOpen] = useState(false);
  const catDropRef = useRef(null);

  // Close category dropdown on outside click
  useEffect(() => {
    if (!catDropOpen) return;
    const close = (e) => { if (catDropRef.current && !catDropRef.current.contains(e.target)) setCatDropOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [catDropOpen]);

  // Specific-mode criteria
  const _storedCriteria = editItem?.specific_criteria ?? {};
  const [critBusinessTypes, setCritBusinessTypes] = useState(_storedCriteria.business_types ?? []);
  const [critStages, setCritStages] = useState(_storedCriteria.operating_stages ?? []);
  const _knownCountries = ["United Kingdom","United States","Canada","Australia","Germany","France","Netherlands","Ireland","India","Nigeria","South Africa","Kenya","Ghana","Singapore","UAE"];
  const _storedCountry = _storedCriteria.country ?? "";
  const [critCountry, setCritCountry] = useState(_knownCountries.includes(_storedCountry) ? _storedCountry : (_storedCountry ? "Other" : ""));
  const [critCountryOther, setCritCountryOther] = useState(_knownCountries.includes(_storedCountry) ? "" : _storedCountry);
  const _knownIndustries = ["Consulting","Technology","Finance","Healthcare","Education","Retail","E-commerce","Logistics","Manufacturing","Real Estate","Marketing","HR & Recruitment","Legal","Creative & Design"];
  const _storedIndustry = _storedCriteria.industry ?? "";
  const [critIndustry, setCritIndustry] = useState(_knownIndustries.includes(_storedIndustry) ? _storedIndustry : (_storedIndustry ? "Other" : ""));
  const [critIndustryOther, setCritIndustryOther] = useState(_knownIndustries.includes(_storedIndustry) ? "" : _storedIndustry);

  // Invite-only: marketplace business search
  const [bizListings, setBizListings] = useState([]);
  const [bizSearch, setBizSearch] = useState("");
  const [inviteEmails, setInviteEmails] = useState("");
  const [inviteSelected, setInviteSelected] = useState([]); // [{workspace_id, name}]

  const isInviteOnly = acceptedModes[0] === "invite_only";
  const isSpecific = acceptedModes[0] === "specific";

  // Auto-set visibility to private when invite_only is selected
  useEffect(() => {
    if (isInviteOnly && visibility !== "private") setVisibility("private");
  }, [isInviteOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch marketplace listings when invite_only mode is active
  useEffect(() => {
    if (!isInviteOnly) return;
    const cats = acceptedCategories.filter(c => c !== "Other");
    const params = new URLSearchParams({ page_size: "50" });
    if (bizSearch.trim()) params.set("search", bizSearch.trim());
    apiRequest(`/marketplace/listings?${params}`, "GET", undefined, { timeoutMs: 60000 })
      .then((data) => {
        let items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
        // Client-side category filter when categories are selected
        if (cats.length > 0) {
          items = items.filter((biz) => {
            const bizCats = [
              biz.primary_industry,
              ...(biz.services || []).map((s) => s.service_category),
            ].filter(Boolean);
            return bizCats.some((c) => cats.includes(c));
          });
        }
        setBizListings(items);
      })
      .catch(() => setBizListings([]));
  }, [isInviteOnly, acceptedCategories, bizSearch]);

  // Brief upload
  const [briefUploading, setBriefUploading] = useState(false);
  const [briefError, setBriefError] = useState(null);
  const briefInputRef = useRef(null);

  const userEmail = useAuthStore((s) => s.email) || "";

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleBriefUpload(file) {
    if (!file) return;
    setBriefUploading(true); setBriefError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const data = await apiRequest("/proposals/extract-brief", "POST", fd);
      if (data.text) {
        setDescription(data.text);
        if (!title.trim() && data.title_hint) setTitle(data.title_hint);
      }
    } catch (e) {
      setBriefError(e instanceof Error ? e.message : "Could not extract text from file.");
    } finally {
      setBriefUploading(false);
    }
  }

  async function handleAiDesc() {
    if (!title.trim()) {
      setAiDescHint("Enter a request title first");
      setTimeout(() => setAiDescHint(""), 2500);
      return;
    }
    setAiDescHint("");
    setAiDescLoading(true);
    try {
      const res = await apiRequest("/proposals/generate-description", "POST", { title });
      if (res?.description) setDescription(res.description);
    } catch { /* silent */ } finally {
      setAiDescLoading(false);
    }
  }

  function addReq() {
    const t = newReq.trim();
    if (!t) return;
    setRequirements((r) => [...r, { text: t, mandatory: false, weight: 1, format: newReqFormat }]);
    setNewReq("");
    setNewReqFormat("text");
  }
  function removeReq(i) { setRequirements((r) => r.filter((_, idx) => idx !== i)); }
  function toggleMandatory(i) {
    setRequirements((r) => r.map((x, idx) => idx === i ? { ...x, mandatory: !x.mandatory } : x));
  }
  function setReqFormat(i, fmt) {
    setRequirements((r) => r.map((x, idx) => idx === i ? { ...x, format: fmt } : x));
  }

  async function handleSave() {
    if (!title.trim()) { setError("Title is required."); return; }
    setSaving(true); setError(null);
    const effectiveVisibility = isInviteOnly ? "private" : visibility;
    const payload = {
      type, title: title.trim(), description: description.trim() || null,
      budget_range: budget.trim() || null, budget_currency: wsCurrency || "GBP", budget_visible: budgetVisible,
      deadline: deadline || null,
      submission_cap: cap !== "" ? parseInt(cap, 10) : null,
      requirements,
      accepted_modes: acceptedModes.length ? acceptedModes : ["general"],
      accepted_categories: (() => {
        const cats = acceptedCategories.filter(c => c !== "Other");
        if (acceptedCategories.includes("Other") && otherCatText.trim()) cats.push(otherCatText.trim());
        else if (acceptedCategories.includes("Other")) cats.push("Other");
        return cats.length ? cats : null;
      })(),
      visibility: effectiveVisibility,
      ...(isInviteOnly && {
        invited_workspace_ids: inviteSelected.map(s => s.workspace_id),
        invite_emails: inviteEmails.split(/[\s,;]+/).map(e => e.trim()).filter(Boolean),
      }),
      ...(isSpecific && {
        specific_criteria: {
          business_types: critBusinessTypes,
          operating_stages: critStages,
          country: critCountry === "Other" ? (critCountryOther.trim() || null) : (critCountry || null),
          industry: critIndustry === "Other" ? (critIndustryOther.trim() || null) : (critIndustry || null),
        },
      }),
    };
    const res = editItem
      ? await updateRequest(editItem.id, payload)
      : await createRequest(payload);
    if (res.ok && isInviteOnly && inviteEmails.trim()) {
      const emailList = inviteEmails.split(/[\s,;]+/).map(e => e.trim()).filter(Boolean);
      if (emailList.length > 0) {
        const savedId = res.data?.id || editItem?.id;
        const inviteUrl = `${window.location.origin}/marketplace?request=${savedId}`;
        try {
          await apiRequest(`/proposals/requests/${savedId}/invite`, "POST", {
            emails: emailList,
            invite_url: inviteUrl,
            sender_name: workspaceName,
          });
        } catch (_) { /* don't block save if invite send fails */ }
      }
    }
    setSaving(false);
    if (res.ok) { onSaved && onSaved(res.data); onClose(); }
    else setError(res.error);
  }

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center p-0 sm:items-center sm:p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="ea-dialog relative z-10 w-full max-w-2xl overflow-hidden rounded-t-3xl sm:rounded-2xl" style={{ maxHeight: "95vh" }}>
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-6 py-4 dark:border-slate-800">
          <h2 className="text-[16px] font-bold text-slate-800 dark:text-slate-100">
            {editItem ? "Edit Proposal Request" : "New Proposal Request"}
          </h2>
          <button onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div className="ea-scroll overflow-y-auto px-6 py-5 space-y-5" style={{ maxHeight: "calc(95vh - 140px)" }}>

          {/* Title */}
          <div>
            <label className="mb-1.5 block text-[12px] font-semibold text-slate-600 dark:text-slate-400">
              Request Title <span className="text-red-500">*</span>
            </label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Looking for a software development partner"
              className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-[13px] text-slate-800 shadow-sm focus:border-brand-400 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200" />
          </div>

          {/* Description + brief upload */}
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label className="text-[12px] font-semibold text-slate-600 dark:text-slate-400">Description</label>
              <div className="flex items-center gap-2">
                <button type="button"
                  disabled={aiDescLoading}
                  onClick={handleAiDesc}
                  title="AI-generate a description from the title"
                  className="flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-600 hover:bg-indigo-100 transition disabled:opacity-50 dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-400">
                  {aiDescLoading
                    ? <><svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" strokeOpacity=".25"/><path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round"/></svg>Writing…</>
                    : <><svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.09 3.26L16.5 4l-2.34 2.68L15 10l-3-1.8L9 10l.84-3.32L7.5 4l3.41 1.26L12 2z"/><path d="M5 14l.63 1.9L7.5 15l-1.37 1.56.87 1.94L5 17.4l-2 1.1.87-1.94L2.5 15l1.87.9L5 14z"/><path d="M19 14l.63 1.9 1.87-.9-1.37 1.56.87 1.94L19 17.4l-2 1.1.87-1.94L16.5 15l1.87.9L19 14z"/></svg>AI Fill</>}
                </button>
                <button type="button"
                  disabled={briefUploading}
                  onClick={() => briefInputRef.current?.click()}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-500 hover:border-brand-400 hover:text-brand-600 transition disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  {briefUploading ? "Extracting…" : "Upload Brief (PDF / DOCX / TXT)"}
                </button>
                <input ref={briefInputRef} type="file" accept=".pdf,.docx,.txt,.md" className="hidden"
                  onChange={(e) => { handleBriefUpload(e.target.files?.[0]); e.target.value = ""; }} />
              </div>
            </div>
            {(briefError || aiDescHint) && <p className="mb-1.5 text-[11px] text-amber-600 dark:text-amber-400">{briefError || aiDescHint}</p>}
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={5}
              placeholder="Describe what you're looking for, your context, and any key criteria…&#10;Or upload a brief above to auto-fill this field."
              className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-[13px] text-slate-800 shadow-sm focus:border-brand-400 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 resize-none" />
          </div>

          {/* Budget + Deadline row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-[12px] font-semibold text-slate-600 dark:text-slate-400">
                Budget Range <span className="font-normal text-slate-400">({wsCurrency})</span>
              </label>
              <div className="flex items-center rounded-xl border border-slate-200 bg-white shadow-sm focus-within:border-brand-400 dark:border-slate-700 dark:bg-slate-900">
                <span className="pl-3 pr-1 text-[13px] font-medium text-slate-400 select-none">{getCurrencySymbol(wsCurrency)}</span>
                <input value={budget} onChange={(e) => setBudget(e.target.value)}
                  placeholder={`e.g. 10,000 – 50,000`}
                  className="flex-1 rounded-xl bg-transparent px-2 py-2.5 text-[13px] text-slate-800 focus:outline-none dark:text-slate-200" />
              </div>
              <label className="mt-2 flex cursor-pointer items-center gap-2 text-[11px] text-slate-500">
                <input type="checkbox" checked={budgetVisible} onChange={(e) => setBudgetVisible(e.target.checked)}
                  className="h-3.5 w-3.5 rounded accent-brand-600" />
                Show to proposers
              </label>
            </div>
            <div>
              <label className="mb-1.5 block text-[12px] font-semibold text-slate-600 dark:text-slate-400">Deadline</label>
              <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-[13px] text-slate-800 shadow-sm focus:border-brand-400 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200" />
            </div>
          </div>

          {/* Submission cap */}
          <div>
            <label className="mb-1.5 block text-[12px] font-semibold text-slate-600 dark:text-slate-400">Submission Cap</label>
            <input type="number" min="1" value={cap} onChange={(e) => setCap(e.target.value)} placeholder="No limit"
              className="w-36 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-[13px] text-slate-800 shadow-sm focus:border-brand-400 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200" />
          </div>

          {/* Category Filter — multi-select dropdown */}
          <div>
            <label className="mb-1.5 block text-[12px] font-semibold text-slate-600 dark:text-slate-400">
              Category Filter <span className="font-normal text-slate-400">(leave blank for all)</span>
            </label>
            <div className="relative" ref={catDropRef}>
              <button type="button" onClick={() => setCatDropOpen(v => !v)}
                className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-[13px] shadow-sm focus:outline-none focus:border-brand-400 dark:border-slate-700 dark:bg-slate-900">
                <span className={acceptedCategories.length === 0 ? "text-slate-400" : "text-slate-800 dark:text-slate-200"}>
                  {acceptedCategories.length === 0
                    ? "All categories"
                    : acceptedCategories.length === 1
                      ? acceptedCategories[0] === "Other" && otherCatText ? otherCatText : acceptedCategories[0]
                      : `${acceptedCategories.length} selected`}
                </span>
                <svg className={`h-4 w-4 text-slate-400 transition-transform ${catDropOpen ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
              </button>
              {catDropOpen && (
                <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-52 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
                  {PROPOSAL_CATEGORIES.map((cat) => {
                    const active = acceptedCategories.includes(cat);
                    return (
                      <label key={cat} className="flex cursor-pointer items-center gap-2.5 px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800">
                        <input type="checkbox" checked={active}
                          onChange={() => setAcceptedCategories(prev => active ? prev.filter(c => c !== cat) : [...prev, cat])}
                          className="h-3.5 w-3.5 rounded accent-brand-600 shrink-0" />
                        <span className="text-[13px] text-slate-700 dark:text-slate-300">{cat}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
            {acceptedCategories.includes("Other") && (
              <input value={otherCatText} onChange={(e) => setOtherCatText(e.target.value)}
                placeholder="Describe your category..."
                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] text-slate-700 shadow-sm focus:border-brand-400 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200" />
            )}
          </div>

          {/* Accepted Mode + Visibility */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-[12px] font-semibold text-slate-600 dark:text-slate-400">Accepted Mode</label>
              <div className="space-y-1.5">
                {REQ_MODES.map((m) => (
                  <label key={m.key} className="flex cursor-pointer items-start gap-2">
                    <input type="radio" name="accepted_mode" value={m.key}
                      checked={acceptedModes[0] === m.key}
                      onChange={() => setAcceptedModes([m.key])}
                      className="mt-0.5 h-3.5 w-3.5 accent-brand-600 shrink-0" />
                    <div>
                      <span className="text-[12px] font-medium text-slate-700 dark:text-slate-300">{m.label}</span>
                      <span className="ml-1 text-[10px] text-slate-400">{m.desc}</span>
                    </div>
                  </label>
                ))}
              </div>
            </div>
            {!isInviteOnly && (
              <div className="flex flex-col justify-start gap-2 pt-1 sm:pt-6">
                <label className="flex cursor-pointer items-center gap-2.5">
                  <input type="checkbox"
                    checked={visibility === "marketplace"}
                    onChange={(e) => setVisibility(e.target.checked ? "marketplace" : "private")}
                    className="h-4 w-4 rounded accent-brand-600 shrink-0" />
                  <span className="text-[12px] font-semibold text-slate-700 dark:text-slate-300">Show on Marketplace</span>
                </label>
              </div>
            )}
          </div>

          {/* Specific: match criteria */}
          {isSpecific && (
            <div className="space-y-3 rounded-xl border border-violet-100 bg-violet-50/60 p-4 dark:border-violet-800 dark:bg-violet-900/10">
              <div className="text-[12px] font-semibold text-violet-700 dark:text-violet-300">Match Criteria</div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Only businesses matching these criteria can submit proposals. Leave blank to allow any.</p>

              {/* Business Type */}
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Business Type</label>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { value: "sole_trader", label: "Sole Trader" },
                    { value: "partnership", label: "Partnership" },
                    { value: "limited_company", label: "Limited Company" },
                    { value: "llp", label: "LLP" },
                    { value: "non_profit", label: "Non-profit" },
                    { value: "startup", label: "Startup" },
                  ].map(opt => {
                    const active = critBusinessTypes.includes(opt.value);
                    return (
                      <button key={opt.value} type="button"
                        onClick={() => setCritBusinessTypes(prev => active ? prev.filter(v => v !== opt.value) : [...prev, opt.value])}
                        className={`rounded-full px-2.5 py-1 text-[11px] font-semibold border transition
                          ${active ? "border-violet-400 bg-violet-100 text-violet-700 dark:border-violet-600 dark:bg-violet-800/40 dark:text-violet-300"
                                   : "border-slate-200 bg-white text-slate-500 hover:border-violet-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"}`}>
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Operating Stage */}
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Operating Stage</label>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { value: "idea", label: "Idea stage" },
                    { value: "pre_revenue", label: "Pre-revenue" },
                    { value: "early_revenue", label: "Early revenue" },
                    { value: "growing", label: "Growing" },
                    { value: "established", label: "Established" },
                  ].map(opt => {
                    const active = critStages.includes(opt.value);
                    return (
                      <button key={opt.value} type="button"
                        onClick={() => setCritStages(prev => active ? prev.filter(v => v !== opt.value) : [...prev, opt.value])}
                        className={`rounded-full px-2.5 py-1 text-[11px] font-semibold border transition
                          ${active ? "border-violet-400 bg-violet-100 text-violet-700 dark:border-violet-600 dark:bg-violet-800/40 dark:text-violet-300"
                                   : "border-slate-200 bg-white text-slate-500 hover:border-violet-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"}`}>
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Industry */}
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Industry (optional)</label>
                <select value={critIndustry} onChange={(e) => setCritIndustry(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] text-slate-700 shadow-sm focus:border-violet-400 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                  <option value="">Any industry</option>
                  {["Consulting","Technology","Finance","Healthcare","Education","Retail","E-commerce","Logistics","Manufacturing","Real Estate","Marketing","HR & Recruitment","Legal","Creative & Design","Other"].map(ind => (
                    <option key={ind} value={ind}>{ind}</option>
                  ))}
                </select>
                {critIndustry === "Other" && (
                  <input value={critIndustryOther} onChange={(e) => setCritIndustryOther(e.target.value)}
                    placeholder="Specify industry…"
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] text-slate-700 shadow-sm focus:border-violet-400 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200" />
                )}
              </div>

              {/* Country */}
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Country (optional)</label>
                <select value={critCountry} onChange={(e) => setCritCountry(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] text-slate-700 shadow-sm focus:border-violet-400 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                  <option value="">Any country</option>
                  {["United Kingdom","United States","Canada","Australia","Germany","France","Netherlands","Ireland","India","Nigeria","South Africa","Kenya","Ghana","Singapore","UAE","Other"].map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                {critCountry === "Other" && (
                  <input value={critCountryOther} onChange={(e) => setCritCountryOther(e.target.value)}
                    placeholder="Enter country name…"
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] text-slate-700 shadow-sm focus:border-violet-400 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200" />
                )}
              </div>
            </div>
          )}

          {/* Invite Only: select businesses + email invite */}
          {isInviteOnly && (
            <div className="space-y-3 rounded-xl border border-indigo-100 bg-indigo-50/60 p-4 dark:border-indigo-800 dark:bg-indigo-900/10">
              <div className="text-[12px] font-semibold text-indigo-700 dark:text-indigo-300">Invite Businesses</div>

              {/* Business search dropdown */}
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  Select from Marketplace
                  {acceptedCategories.length > 0 && (
                    <span className="ml-1 font-normal text-slate-400">(filtered by selected categories)</span>
                  )}
                </label>
                <input
                  value={bizSearch}
                  onChange={(e) => setBizSearch(e.target.value)}
                  placeholder="Search businesses by name…"
                  className="mb-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] text-slate-700 shadow-sm focus:border-brand-400 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                />
                {bizListings.length > 0 ? (
                  <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900 scrollbar-thin">
                    {bizListings.map((biz) => {
                      const alreadyAdded = inviteSelected.some(s => s.workspace_id === biz.workspace_id);
                      return (
                        <button
                          key={biz.workspace_id}
                          type="button"
                          disabled={alreadyAdded}
                          onClick={() => {
                            if (!alreadyAdded) setInviteSelected(prev => [...prev, { workspace_id: biz.workspace_id, name: biz.company_name || biz.workspace_name || "Business" }]);
                          }}
                          className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[12px] transition
                            ${alreadyAdded ? "text-slate-400 cursor-default" : "text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"}`}>
                          <span>{biz.company_name || biz.workspace_name || "Business"}</span>
                          {alreadyAdded
                            ? <span className="text-[10px] font-semibold text-emerald-600">Added</span>
                            : <span className="text-[10px] text-brand-600">+ Add</span>}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-400">No businesses found. Try clearing the search or adjusting category filters.</p>
                )}
              </div>

              {/* Selected businesses chips */}
              {inviteSelected.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {inviteSelected.map((s) => (
                    <span key={s.workspace_id} className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-100 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-700 dark:border-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                      {s.name}
                      <button type="button" onClick={() => setInviteSelected(prev => prev.filter(x => x.workspace_id !== s.workspace_id))}
                        className="ml-0.5 text-indigo-400 hover:text-red-500 transition">
                        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M6 6l12 12M18 6L6 18" /></svg>
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* Email invite */}
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-slate-500 dark:text-slate-400">Or Invite by Email</label>
                <input
                  value={inviteEmails}
                  onChange={(e) => setInviteEmails(e.target.value)}
                  placeholder="name@company.com, another@co.com"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] text-slate-700 shadow-sm focus:border-brand-400 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                />
                <p className="mt-0.5 text-[10px] text-slate-400">Invitations will be sent after the request is saved and published.</p>
              </div>
            </div>
          )}

          {/* Requirements */}
          <div>
            <label className="mb-1.5 block text-[12px] font-semibold text-slate-600 dark:text-slate-400">Requirements</label>
            <div className="space-y-2">
              {requirements.map((r, i) => {
                const fmt = REQ_FORMATS.find(f => f.key === (r.format || "text")) || REQ_FORMATS[0];
                return (
                  <div key={i} className="rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
                    <div className="flex items-center gap-2 px-3 py-2">
                      <label className="flex cursor-pointer items-center gap-1.5 shrink-0">
                        <input type="checkbox" checked={r.mandatory} onChange={() => toggleMandatory(i)}
                          className="h-3.5 w-3.5 rounded accent-brand-600" />
                        <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Must</span>
                      </label>
                      <span className="flex-1 text-[12px] text-slate-700 dark:text-slate-300">{r.text}</span>
                      <span className="shrink-0 inline-flex items-center gap-1 rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-600 dark:border-brand-800 dark:bg-brand-900/20 dark:text-brand-400">
                        {REQ_FORMAT_SVGS[r.format || "text"]} {fmt.label}
                      </span>
                      <button type="button" onClick={() => removeReq(i)}
                        className="shrink-0 text-slate-400 hover:text-red-500 transition">
                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
                      </button>
                    </div>
                    {/* Format selector row */}
                    <div className="flex flex-wrap gap-1 border-t border-slate-100 px-3 py-1.5 dark:border-slate-800">
                      {REQ_FORMATS.map(f => (
                        <button key={f.key} type="button"
                          onClick={() => setReqFormat(i, f.key)}
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold transition
                            ${(r.format || "text") === f.key
                              ? "bg-brand-600 text-white"
                              : "border border-slate-200 text-slate-500 hover:border-brand-300 hover:text-brand-600 dark:border-slate-700 dark:text-slate-400"}`}>
                          {REQ_FORMAT_SVGS[f.key]} {f.label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
              {/* Add new requirement */}
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/50">
                <input value={newReq} onChange={(e) => setNewReq(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addReq(); } }}
                  placeholder="Describe the requirement…"
                  className="mb-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12px] text-slate-700 shadow-sm focus:border-brand-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200" />
                <div className="flex items-center gap-2">
                  <div className="flex flex-wrap gap-1 flex-1">
                    {REQ_FORMATS.map(f => (
                      <button key={f.key} type="button"
                        onClick={() => setNewReqFormat(f.key)}
                        title={f.desc}
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold transition
                          ${newReqFormat === f.key
                            ? "bg-brand-600 text-white"
                            : "border border-slate-200 text-slate-500 hover:border-brand-300 hover:text-brand-600 dark:border-slate-700 dark:text-slate-400"}`}>
                        {REQ_FORMAT_SVGS[f.key]} {f.label}
                      </button>
                    ))}
                  </div>
                  <button type="button" onClick={addReq}
                    className="shrink-0 rounded-xl border border-brand-200 bg-brand-50 px-3 py-1.5 text-[12px] font-semibold text-brand-700 hover:bg-brand-100 dark:border-brand-800 dark:bg-brand-900/20 dark:text-brand-300 transition">
                    Add
                  </button>
                </div>
              </div>
            </div>
          </div>

        </div>

        {error && (
          <div className="border-t border-red-100 bg-red-50 px-6 py-2.5 text-[12px] text-red-600 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-3 border-t border-slate-100 px-6 py-4 dark:border-slate-800">
          <button onClick={onClose} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-[13px] font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-transparent dark:text-slate-400 transition">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2 text-[13px] font-bold text-white hover:bg-brand-700 disabled:opacity-50 transition">
            {saving && <Spinner size="sm" />}
            {saving ? "Saving…" : editItem ? "Save Changes" : "Create Request"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── confirm modal ────────────────────────────────────────────────────────────

function ConfirmModal({ title, body, confirmLabel = "Delete", confirmCls = "bg-red-600 hover:bg-red-700", iconColor = "red", onConfirm, onCancel }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onCancel(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const iconBg = iconColor === "amber" ? "bg-amber-50 dark:bg-amber-900/20" : "bg-red-50 dark:bg-red-900/20";
  const iconFg = iconColor === "amber" ? "text-amber-500" : "text-red-500";
  const icon = iconColor === "amber"
    ? <path d="M18 6L6 18M6 6l12 12" />
    : <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />;

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative z-10 w-full max-w-sm rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-col items-center px-6 pt-7 pb-2 text-center">
          <div className={`mb-3 flex h-12 w-12 items-center justify-center rounded-2xl ${iconBg}`}>
            <svg className={`h-6 w-6 ${iconFg}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {icon}
            </svg>
          </div>
          <h3 className="text-[15px] font-bold text-slate-800 dark:text-slate-100">{title}</h3>
          {body && <p className="mt-1 text-[13px] text-slate-500 dark:text-slate-400">{body}</p>}
        </div>
        <div className="flex gap-3 px-6 py-5">
          <button type="button" onClick={onCancel}
            className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-[13px] font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-transparent dark:text-slate-400 transition">
            Cancel
          </button>
          <button type="button" onClick={onConfirm}
            className={`flex-1 rounded-xl px-4 py-2.5 text-[13px] font-bold text-white transition ${confirmCls}`}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── request card ─────────────────────────────────────────────────────────────

function RequestStatusBadge({ status }) {
  const map = {
    DRAFT: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
    PUBLISHED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
    PAUSED: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
    CLOSED: "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400",
    EXPIRED: "bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500",
  };
  return (
    <span className={`inline-flex items-center rounded-lg px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${map[status] || map.DRAFT}`}>
      {titleCase(status)}
    </span>
  );
}

function InviteModal({ req, onClose }) {
  const workspaceName = useWorkspaceStore((s) => s.workspaceName) || "";
  const userEmail = useAuthStore((s) => s.email) || "";
  const [emails, setEmails] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const inviteUrl = `${window.location.origin}/marketplace?request=${req.id}`;
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(inviteUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }

  async function handleSend() {
    const list = emails.split(/[\s,;]+/).map(e => e.trim()).filter(Boolean);
    if (!list.length) return;
    setSending(true); setResult(null);
    try {
      const data = await apiRequest(`/proposals/requests/${req.id}/invite`, "POST", {
        emails: list,
        invite_url: inviteUrl,
        sender_name: workspaceName || userEmail,
      });
      setResult(data);
      if (data.sent?.length) setEmails("");
    } catch (e) {
      setResult({ sent: [], failed: list });
    } finally { setSending(false); }
  }

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <h3 className="text-[14px] font-bold text-slate-800 dark:text-slate-100">Share "{req.title}"</h3>
          <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="px-5 py-4 space-y-4">
          {/* Copy link */}
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Invite Link</div>
            <div className="flex gap-2">
              <input readOnly value={inviteUrl} className="flex-1 min-w-0 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 select-all" />
              <button type="button" onClick={handleCopy}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-[11px] font-semibold transition ${copied ? "bg-emerald-600 text-white" : "bg-indigo-600 text-white hover:bg-indigo-700"}`}>
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>
          {/* Email invite */}
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Invite by Email</div>
            <div className="flex gap-2">
              <input value={emails} onChange={e => setEmails(e.target.value)}
                placeholder="name@company.com, another@co.com"
                className="flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] text-slate-700 focus:border-indigo-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300" />
              <button type="button" disabled={!emails.trim() || sending} onClick={handleSend}
                className="shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-indigo-700 transition disabled:opacity-40">
                {sending ? "Sending…" : "Send"}
              </button>
            </div>
            {result && (
              <div className="mt-1.5 text-[10px]">
                {result.sent?.length > 0 && <span className="text-emerald-600">Sent to {result.sent.join(", ")}. </span>}
                {result.failed?.length > 0 && <span className="text-red-500">Failed: {result.failed.join(", ")}.</span>}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function RequestCard({ req, onEdit, onPublish, onClose: onCloseReq, onReopen, onDelete, onView, onInvite }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const [copied, setCopied] = useState(false);
  const dotRef = useRef(null);

  function openMenu(e) {
    e.stopPropagation();
    const rect = dotRef.current?.getBoundingClientRect();
    if (rect) setMenuPos({ top: rect.bottom + 4, left: Math.max(8, rect.right - 160) });
    setMenuOpen(true);
  }

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuOpen]);

  const canPublish = req.status === "DRAFT";
  const canClose = req.status === "PUBLISHED" || req.status === "PAUSED";
  const canReopen = req.status === "CLOSED";
  const canDelete = req.status === "DRAFT" || req.status === "CLOSED";
  const canShare = req.status === "PUBLISHED";
  const inviteUrl = `${window.location.origin}/marketplace?request=${req.id}`;

  function handleCopyLink(e) {
    e.stopPropagation();
    navigator.clipboard.writeText(inviteUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
    setMenuOpen(false);
  }

  return (
    <div className="ea-card relative overflow-hidden transition hover:shadow-md cursor-pointer" onClick={() => onView && onView(req)}>
      <div className="p-5">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <RequestStatusBadge status={req.status || "DRAFT"} />
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                {titleCase(req.type || "general")}
              </span>
              {(req.accepted_modes || [])[0] === "invite_only" && (
                <span className="text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                  Invite Only
                </span>
              )}
            </div>
            <h3 className="text-[14px] font-bold text-slate-800 dark:text-slate-100 leading-tight line-clamp-2">{req.title}</h3>
          </div>
          <button ref={dotRef} onClick={openMenu}
            className="shrink-0 flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
            </svg>
          </button>
        </div>

        {req.description && (
          <p className="mb-3 text-[12px] text-slate-500 dark:text-slate-400 line-clamp-2">{req.description}</p>
        )}

        <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400 dark:text-slate-500">
          {req.deadline && (
            <span className="inline-flex items-center gap-1">
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
              </svg>
              Deadline: {fmtDate(req.deadline)}
            </span>
          )}
          {req.budget_range && req.budget_visible && (
            <span>Budget: {req.budget_currency ? `${req.budget_currency} ` : ""}{req.budget_range}</span>
          )}
          {req.submission_count != null && (
            <span>{req.submission_count} proposal{req.submission_count !== 1 ? "s" : ""}</span>
          )}
          <span>Created {fmtRel(req.created_at)}</span>
        </div>
      </div>

      {menuOpen && createPortal(
        <div className="fixed z-[120] w-40 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900"
          style={{ top: menuPos.top, left: menuPos.left }} onClick={(e) => e.stopPropagation()}>
          <button onClick={() => { setMenuOpen(false); onEdit && onEdit(req); }}
            className="flex w-full items-center gap-2 px-3.5 py-2.5 text-[12px] text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800 transition">
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5Z" /></svg>
            Edit
          </button>
          {canShare && (
            <button onClick={handleCopyLink}
              className="flex w-full items-center gap-2 px-3.5 py-2.5 text-[12px] text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-900/20 transition">
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              {copied ? "Copied!" : "Copy Link"}
            </button>
          )}
          {canShare && (
            <button onClick={() => { setMenuOpen(false); onInvite && onInvite(req); }}
              className="flex w-full items-center gap-2 px-3.5 py-2.5 text-[12px] text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-900/20 transition">
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
              Invite via Email
            </button>
          )}
          {canPublish && (
            <button onClick={() => { setMenuOpen(false); onPublish && onPublish(req); }}
              className="flex w-full items-center gap-2 px-3.5 py-2.5 text-[12px] text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-900/20 transition">
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
              Publish
            </button>
          )}
          {canClose && (
            <button onClick={() => { setMenuOpen(false); onCloseReq && onCloseReq(req); }}
              className="flex w-full items-center gap-2 px-3.5 py-2.5 text-[12px] text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-900/20 transition">
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M15 9l-6 6M9 9l6 6" /></svg>
              Close
            </button>
          )}
          {canReopen && (
            <button onClick={() => { setMenuOpen(false); onReopen && onReopen(req); }}
              className="flex w-full items-center gap-2 px-3.5 py-2.5 text-[12px] text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-900/20 transition">
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10M23 14l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>
              Reopen
            </button>
          )}
          {canReopen && (
            <button onClick={() => { setMenuOpen(false); onEdit && onEdit(req); }}
              className="flex w-full items-center gap-2 px-3.5 py-2.5 text-[12px] text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800 transition">
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5Z" /></svg>
              Edit
            </button>
          )}
          {canDelete && (
            <button onClick={() => { setMenuOpen(false); onDelete && onDelete(req); }}
              className="flex w-full items-center gap-2 px-3.5 py-2.5 text-[12px] text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20 transition">
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>
              Delete
            </button>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

// ─── requests tab ─────────────────────────────────────────────────────────────

export function RequestsTab({ createTrigger }) {
  const { requests, requestsLoading, requestsError, fetchRequests, publishRequest, reopenRequest, closeRequest, deleteRequest, preferences, fetchPreferences } = useProposalStore();
  const subscription = useAuthStore((s) => s.subscription);
  const isPaid = hasPaidAccess(subscription?.plan_key);
  const navigate = useNavigate();

  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [toast, setToast] = useState(null);
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [search, setSearch] = useState("");
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [detailItem, setDetailItem] = useState(null);
  const [inviteTarget, setInviteTarget] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmClose, setConfirmClose] = useState(null);
  const [publishGate, setPublishGate] = useState(null); // req blocked by missing open_for_proposals
  const [showUpgradeGate, setShowUpgradeGate] = useState(false);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);
  useEffect(() => { fetchPreferences(); }, [fetchPreferences]);

  const seenTrigger = useRef(createTrigger ?? 0);
  useEffect(() => {
    if ((createTrigger ?? 0) > seenTrigger.current) {
      seenTrigger.current = createTrigger;
      setEditItem(null);
      setShowModal(true);
    }
  }, [createTrigger]);

  const filtered = useMemo(() => {
    let list = filterStatus === "ALL" ? requests : requests.filter((r) => (r.status || "DRAFT") === filterStatus);
    if (search) list = list.filter(r => [r.title, r.description, r.category].some(v => typeof v === "string" && v.toLowerCase().includes(search.toLowerCase())));
    return list;
  }, [requests, filterStatus, search]);

  async function handlePublish(req) {
    if (!isPaid) { setShowUpgradeGate(true); return; }
    if (!preferences?.enabled) {
      setPublishGate(req);
      return;
    }
    const res = await publishRequest(req.id);
    setToast(res.ok ? { msg: "Request published to Marketplace", type: "success" } : { msg: res.error, type: "error" });
  }

  function handleClose(req) {
    setConfirmClose(req);
  }

  async function doClose() {
    if (!confirmClose) return;
    const req = confirmClose;
    setConfirmClose(null);
    const res = await closeRequest(req.id);
    setToast(res.ok ? { msg: "Request closed", type: "success" } : { msg: res.error, type: "error" });
  }

  async function handleReopen(req) {
    const res = await reopenRequest(req.id);
    setToast(res.ok ? { msg: "Request reopened and published", type: "success" } : { msg: res.error, type: "error" });
  }

  async function handleDelete(req) {
    setConfirmDelete(req);
  }

  async function doDelete() {
    if (!confirmDelete) return;
    const req = confirmDelete;
    setConfirmDelete(null);
    const res = await deleteRequest(req.id);
    if (res.ok) {
      if (detailItem?.id === req.id) setDetailItem(null);
    }
    setToast(res.ok ? { msg: "Request deleted", type: "success" } : { msg: res.error, type: "error" });
  }

  return (
    <div>
      {toast && <Toast msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />}
      {showModal && (
        <RequestModal
          editItem={editItem}
          onClose={() => { setShowModal(false); setEditItem(null); }}
          onSaved={(updated) => {
            fetchRequests();
            if (updated && detailItem) setDetailItem(updated);
            setToast({ msg: editItem ? "Request updated" : "Request created", type: "success" });
          }}
        />
      )}
      {detailItem && (
        <RequestDetailPanel req={detailItem} onClose={() => setDetailItem(null)} onEdit={(r) => { setDetailItem(null); setEditItem(r); setShowModal(true); }} />
      )}
      {inviteTarget && <InviteModal req={inviteTarget} onClose={() => setInviteTarget(null)} />}
      {confirmDelete && (
        <ConfirmModal
          title={`Delete "${confirmDelete.title}"?`}
          body="This action cannot be undone. The request and all its data will be permanently removed."
          confirmLabel="Delete Request"
          onConfirm={doDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
      {confirmClose && (
        <ConfirmModal
          title={`Close "${confirmClose.title}"?`}
          body="No new proposals will be accepted. You can reopen, edit or delete this request afterwards."
          confirmLabel="Close Request"
          confirmCls="bg-amber-500 hover:bg-amber-600"
          iconColor="amber"
          onConfirm={doClose}
          onCancel={() => setConfirmClose(null)}
        />
      )}

      {publishGate && createPortal(
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 shadow-2xl overflow-hidden">
            <div className="bg-amber-50 dark:bg-amber-900/20 px-6 pt-6 pb-4 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-800/40">
                <svg className="h-6 w-6 text-amber-600 dark:text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
              </div>
              <h3 className="text-[15px] font-bold text-slate-800 dark:text-slate-100">Proposals Not Enabled</h3>
              <p className="mt-1.5 text-[12px] text-slate-500 dark:text-slate-400">
                You need to turn on <span className="font-semibold text-amber-700 dark:text-amber-400">Open for Proposals</span> before you can publish a request to the Marketplace.
              </p>
            </div>
            <div className="px-6 py-4 space-y-2.5">
              <button
                onClick={() => { setPublishGate(null); navigate("/account?tab=workspace"); }}
                className="w-full rounded-xl bg-brand-600 px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-brand-700 transition">
                Go to Account Settings
              </button>
              <button
                onClick={() => setPublishGate(null)}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2.5 text-[13px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition">
                Cancel
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {showUpgradeGate && createPortal(
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setShowUpgradeGate(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="bg-gradient-to-br from-brand-500 to-accent-600 px-6 pt-6 pb-4 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white/20">
                <svg className="h-6 w-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
              </div>
              <h3 className="text-[15px] font-bold text-white">Upgrade to Create Proposals</h3>
              <p className="mt-1.5 text-[12px] text-white/80">
                Creating and publishing proposal requests is available on paid plans. Upgrade to start attracting proposals from other businesses.
              </p>
            </div>
            <div className="px-6 py-4 space-y-2.5">
              <button
                onClick={() => { setShowUpgradeGate(false); navigate("/settings?tab=billing"); }}
                className="w-full rounded-xl bg-brand-600 px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-brand-700 transition">
                View Plans & Upgrade
              </button>
              <button
                onClick={() => setShowUpgradeGate(false)}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2.5 text-[13px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition">
                Cancel
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-bold text-slate-800 dark:text-slate-100">Proposal Requests</h2>
          <p className="text-[12px] text-slate-500 dark:text-slate-400">Manage requests you've created for incoming proposals.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search requests..." className="rounded-lg border border-slate-200 bg-white pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300 w-40" />
          </div>
          <div className="relative">
            <button type="button" onClick={() => setShowFilterMenu(v => !v)}
              className={`inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${filterStatus !== "ALL" ? "border-indigo-400 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="4" y1="8" x2="20" y2="8"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="12" y1="16" x2="12" y2="16"/></svg>
              {filterStatus !== "ALL" ? filterStatus.charAt(0) + filterStatus.slice(1).toLowerCase() : "Filter"}
            </button>
            {showFilterMenu && (
              <div className="absolute right-0 top-9 z-30 min-w-[140px] rounded-xl border border-slate-200 bg-white shadow-xl py-1">
                {["ALL", "DRAFT", "PUBLISHED", "PAUSED", "CLOSED"].map(s => (
                  <button key={s} onClick={() => { setFilterStatus(s); setShowFilterMenu(false); }}
                    className={`w-full px-4 py-2 text-left text-xs hover:bg-slate-50 ${filterStatus === s ? "font-semibold text-indigo-600" : "text-slate-700"}`}>
                    {s === "ALL" ? "All Statuses" : s.charAt(0) + s.slice(1).toLowerCase()}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => { if (!isPaid) { setShowUpgradeGate(true); return; } setEditItem(null); setShowModal(true); }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-700 transition">
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14" /></svg>
            New Request
          </button>
        </div>
      </div>

      {requestsLoading && !requests.length && (
        <div className="flex justify-center py-16"><Spinner /></div>
      )}

      {requestsError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[12px] text-red-600 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          {requestsError}
        </div>
      )}

      {!requestsLoading && !requestsError && filtered.length === 0 && (
        <EmptyState
          icon={<svg className="h-8 w-8 text-brand-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14,2 14,8 20,8" /><line x1="12" y1="18" x2="12" y2="12" /><line x1="9" y1="15" x2="15" y2="15" /></svg>}
          title={filterStatus === "ALL" ? "No proposal requests yet" : `No ${titleCase(filterStatus)} requests`}
          body={filterStatus === "ALL" ? "Create a General or Specific request to attract proposals from other businesses." : `You have no requests with status ${titleCase(filterStatus)}.`}
          action={filterStatus === "ALL" && (
            <button onClick={() => { if (!isPaid) { setShowUpgradeGate(true); return; } setShowModal(true); }}
              className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-[13px] font-bold text-white hover:bg-brand-700 transition">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14" /></svg>
              Create Request
            </button>
          )}
        />
      )}

      {filtered.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((req) => (
            <RequestCard
              key={req.id}
              req={req}
              onEdit={(r) => { setEditItem(r); setShowModal(true); }}
              onPublish={handlePublish}
              onClose={handleClose}
              onReopen={handleReopen}
              onDelete={handleDelete}
              onView={(r) => setDetailItem(r)}
              onInvite={(r) => setInviteTarget(r)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── request detail panel ─────────────────────────────────────────────────────

function RequestDetailPanel({ req, onClose, onEdit }) {
  const { inbox } = useProposalStore();
  const related = inbox.filter((p) => p.request_id === req.id);

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-end p-0 sm:p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="ea-dialog relative z-10 h-full w-full overflow-hidden sm:h-auto sm:max-h-[90vh] sm:w-[520px] sm:rounded-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-6 py-4 dark:border-slate-800">
          <h2 className="text-[15px] font-bold text-slate-800 dark:text-slate-100 truncate">{req.title}</h2>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => onEdit && onEdit(req)}
              className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5Z" /></svg>
            </button>
            <button onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
        </div>

        <div className="ea-scroll overflow-y-auto px-6 py-5 space-y-5" style={{ maxHeight: "calc(90vh - 80px)" }}>
          <div className="flex flex-wrap items-center gap-2">
            <RequestStatusBadge status={req.status || "DRAFT"} />
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{titleCase(req.type || "general")}</span>
            {(req.accepted_modes || [])[0] === "invite_only" && (
              <span className="text-[11px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                Invite Only
              </span>
            )}
          </div>

          {req.description && (
            <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/50">
              <p className="text-[13px] leading-relaxed text-slate-700 dark:text-slate-300 whitespace-pre-line">{req.description}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 text-[12px]">
            {req.deadline && (
              <div>
                <div className="mb-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">Deadline</div>
                <div className="font-semibold text-slate-700 dark:text-slate-300">{fmtDate(req.deadline)}</div>
              </div>
            )}
            {req.budget_range && (
              <div>
                <div className="mb-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">Budget</div>
                <div className="font-semibold text-slate-700 dark:text-slate-300">
                  {req.budget_visible ? `${req.budget_currency ? req.budget_currency + " " : ""}${req.budget_range}` : "Hidden from proposers"}
                </div>
              </div>
            )}
            {req.submission_cap && (
              <div>
                <div className="mb-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">Submission Cap</div>
                <div className="font-semibold text-slate-700 dark:text-slate-300">{req.submission_cap}</div>
              </div>
            )}
            <div>
              <div className="mb-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">Created</div>
              <div className="font-semibold text-slate-700 dark:text-slate-300">{fmtDate(req.created_at)}</div>
            </div>
          </div>

          {req.requirements?.length > 0 && (
            <div>
              <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Requirements</div>
              <div className="space-y-1.5">
                {req.requirements.map((r, i) => (
                  <div key={i} className="flex items-center gap-2 text-[12px] text-slate-600 dark:text-slate-400">
                    {r.mandatory && (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">Must</span>
                    )}
                    <span>{r.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {related.length > 0 && (
            <div>
              <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                Proposals Received ({related.length})
              </div>
              <div className="space-y-2">
                {related.map((p) => (
                  <div key={p.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                    <div>
                      <div className="text-[12px] font-semibold text-slate-700 dark:text-slate-300">{p.proposer_name || "Business"}</div>
                      <div className="text-[10px] text-slate-400">{fmtRel(p.submitted_at)}</div>
                    </div>
                    <StatusBadge status={p.status} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── proposal card ─────────────────────────────────────────────────────────────

function ProposalCard({ proposal, role, onClick, onDelete }) {
  const isNew = role === "recipient" && proposal.status === "SUBMITTED" && !proposal.viewed_at;

  return (
    <div
      onClick={() => onClick && onClick(proposal)}
      className={`ea-card relative cursor-pointer overflow-hidden transition hover:shadow-md
        ${isNew ? "border-brand-200 dark:border-brand-700" : ""}`}>
      {isNew && (
        <div className="absolute left-0 top-0 h-full w-1 bg-brand-500 rounded-l-2xl" />
      )}
      <div className="p-5">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
              <StatusBadge status={proposal.status} />
              {isNew && (
                <span className="rounded-lg bg-brand-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">New</span>
              )}
            </div>
            <h3 className="text-[13px] font-bold text-slate-800 dark:text-slate-100 leading-tight line-clamp-2">
              {role === "recipient" ? (proposal.proposer_name || "Unnamed Business") : (proposal.request_title || proposal.title || proposal.description || "General Proposal")}
            </h3>
            {role === "proposer" && proposal.recipient_name && (
              <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">To: {proposal.recipient_name}</p>
            )}
          </div>
          {onDelete && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onDelete(proposal.id); }}
              className="shrink-0 flex h-6 w-6 items-center justify-center rounded-lg text-slate-300 hover:bg-red-50 hover:text-red-500 transition dark:text-slate-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
              title="Remove from inbox">
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4h6v2" />
              </svg>
            </button>
          )}
        </div>

        {proposal.summary && (
          <p className="mb-3 text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2">{proposal.summary}</p>
        )}

        <div className="flex flex-wrap items-center gap-3 text-[10px] text-slate-400 dark:text-slate-500">
          <span>{fmtRel(proposal.submitted_at || proposal.updated_at)}</span>
          {proposal.version && <span>v{proposal.version}</span>}
        </div>
      </div>
    </div>
  );
}

// ─── proposal detail modal ─────────────────────────────────────────────────────

function ProposalDetailModal({ proposal, role, onClose, onStatusChange }) {
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [showReasonInput, setShowReasonInput] = useState(false);
  const [reason, setReason] = useState("");
  const [pendingAction, setPendingAction] = useState(null);
  const [linkReqId, setLinkReqId] = useState("");
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkedId, setLinkedId] = useState(null);
  const { transitionStatus, linkToRequest, requests, fetchRequests } = useProposalStore();

  useEffect(() => { if (role === "recipient") fetchRequests(); }, [role, fetchRequests]);

  async function handleLink() {
    if (!linkReqId) return;
    setLinkLoading(true);
    const res = await linkToRequest(proposal.id, linkReqId);
    setLinkLoading(false);
    if (res.ok) {
      setLinkedId(linkReqId);
      setTimeout(() => { onStatusChange && onStatusChange(); }, 900);
    } else {
      setActionError(res.error);
    }
  }

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function doTransition(status) {
    if (["DECLINED", "WITHDRAWN", "CLARIFICATION_REQUESTED"].includes(status)) {
      setPendingAction(status);
      setShowReasonInput(true);
      return;
    }
    setActionLoading(true);
    setActionError(null);
    const res = await transitionStatus(proposal.id, status);
    setActionLoading(false);
    if (res.ok) onStatusChange && onStatusChange();
    else setActionError(res.error);
  }

  async function submitWithReason() {
    if (!pendingAction) return;
    setActionLoading(true);
    setActionError(null);
    const res = await transitionStatus(proposal.id, pendingAction, reason);
    setActionLoading(false);
    setShowReasonInput(false);
    if (res.ok) onStatusChange && onStatusChange();
    else setActionError(res.error);
  }

  // Available actions based on role + current status
  const actions = [];
  if (role === "recipient") {
    if (proposal.status === "SUBMITTED" || proposal.status === "VIEWED") {
      actions.push({ label: "Mark Under Review", status: "UNDER_REVIEW", cls: "bg-indigo-600 hover:bg-indigo-700" });
      actions.push({ label: "Decline", status: "DECLINED", cls: "bg-red-500 hover:bg-red-600" });
    }
    if (proposal.status === "UNDER_REVIEW") {
      actions.push({ label: "Shortlist", status: "SHORTLISTED", cls: "bg-purple-600 hover:bg-purple-700" });
      actions.push({ label: "Request Clarification", status: "CLARIFICATION_REQUESTED", cls: "bg-amber-500 hover:bg-amber-600" });
      actions.push({ label: "Decline", status: "DECLINED", cls: "bg-red-500 hover:bg-red-600" });
    }
    if (proposal.status === "SHORTLISTED") {
      actions.push({ label: "Mark Preferred", status: "PREFERRED", cls: "bg-violet-600 hover:bg-violet-700" });
    }
    if (proposal.status === "PREFERRED") {
      actions.push({ label: "Begin Negotiation", status: "NEGOTIATION", cls: "bg-fuchsia-600 hover:bg-fuchsia-700" });
    }
    if (proposal.status === "NEGOTIATION") {
      actions.push({ label: "Award", status: "AWARDED", cls: "bg-emerald-600 hover:bg-emerald-700" });
    }
  }
  if (role === "proposer") {
    if (ACTIVE_STATUSES.includes(proposal.status)) {
      actions.push({ label: "Withdraw", status: "WITHDRAWN", cls: "bg-slate-500 hover:bg-slate-600" });
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center p-0 sm:items-center sm:p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="ea-dialog relative z-10 w-full max-w-2xl overflow-hidden rounded-t-3xl sm:rounded-2xl" style={{ maxHeight: "90vh" }}>
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-6 py-4 dark:border-slate-800">
          <div className="flex items-center gap-3 min-w-0">
            <StatusBadge status={proposal.status} />
            <h2 className="text-[15px] font-bold text-slate-800 dark:text-slate-100 truncate">
              {role === "recipient" ? (proposal.proposer_name || "Proposal") : (proposal.request_title || "Your Proposal")}
            </h2>
          </div>
          <button onClick={onClose}
            className="shrink-0 flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div className="ea-scroll overflow-y-auto px-6 py-5 space-y-5" style={{ maxHeight: "calc(90vh - 140px)" }}>
          <div className="grid grid-cols-2 gap-4 text-[12px]">
            {role === "recipient" && (
              <>
                <div>
                  <div className="mb-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">From</div>
                  <div className="font-semibold text-slate-700 dark:text-slate-300">{proposal.proposer_name || "—"}</div>
                </div>
                {proposal.proposer_email && (
                  <div>
                    <div className="mb-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">Email</div>
                    <a href={`mailto:${proposal.proposer_email}`}
                      className="font-semibold text-brand-600 dark:text-brand-400 hover:underline truncate block">
                      {proposal.proposer_email}
                    </a>
                  </div>
                )}
                {(() => {
                  const effectiveReqId = proposal.request_id || linkedId;
                  const effectiveReqTitle = proposal.request_title || requests.find(r => r.id === effectiveReqId)?.title;
                  return effectiveReqId ? (
                    <div>
                      <div className="mb-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">Request</div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-700 dark:text-slate-300 truncate">{effectiveReqTitle || effectiveReqId}</span>
                        {linkedId && <span className="text-[10px] font-semibold text-emerald-600">Linked</span>}
                      </div>
                    </div>
                  ) : (
                    <div className="col-span-2">
                      <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">Link to Request</div>
                      <div className="flex gap-2">
                        <select value={linkReqId} onChange={e => setLinkReqId(e.target.value)}
                          className="flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300">
                          <option value="">— select a request —</option>
                          {requests.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}
                        </select>
                        <button type="button" disabled={!linkReqId || linkLoading} onClick={handleLink}
                          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-40">
                          {linkLoading ? "Linking…" : "Link"}
                        </button>
                      </div>
                    </div>
                  );
                })()}
              </>
            )}
            {role === "proposer" && (
              <>
                <div>
                  <div className="mb-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">Submitted To</div>
                  <div className="font-semibold text-slate-700 dark:text-slate-300">{proposal.recipient_name || "—"}</div>
                </div>
                <div>
                  <div className="mb-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">Version</div>
                  <div className="font-semibold text-slate-700 dark:text-slate-300">v{proposal.version || 1}</div>
                </div>
              </>
            )}
            <div>
              <div className="mb-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">Submitted</div>
              <div className="font-semibold text-slate-700 dark:text-slate-300">{fmtDate(proposal.submitted_at)}</div>
            </div>
            {proposal.deadline && (
              <div>
                <div className="mb-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">Deadline</div>
                <div className="font-semibold text-slate-700 dark:text-slate-300">{fmtDate(proposal.deadline)}</div>
              </div>
            )}
          </div>

          {proposal.summary && (
            <div>
              <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">Summary</div>
              <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/50">
                <p className="text-[13px] leading-relaxed text-slate-700 dark:text-slate-300 whitespace-pre-line">{proposal.summary}</p>
              </div>
            </div>
          )}

          {proposal.requirement_responses?.length > 0 && (
            <div>
              <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Requirement Responses</div>
              <div className="space-y-3">
                {proposal.requirement_responses.map((item, i) => (
                  <div key={i} className={`rounded-xl border p-3 ${item.mandatory ? "border-indigo-100 bg-indigo-50/50 dark:border-indigo-800 dark:bg-indigo-900/10" : "border-slate-100 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/40"}`}>
                    <div className="mb-1 flex flex-wrap items-center gap-1.5">
                      {item.mandatory
                        ? <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400">Required</span>
                        : <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-500 dark:bg-slate-700 dark:text-slate-400">Optional</span>}
                      {item.format && (
                        <span className="inline-flex items-center gap-1 rounded border border-brand-200 bg-brand-50 px-1.5 py-0.5 text-[9px] font-semibold text-brand-600 dark:border-brand-800 dark:bg-brand-900/20 dark:text-brand-400">
                          {REQ_FORMAT_SVGS[item.format] || null}
                          {item.format.charAt(0).toUpperCase() + item.format.slice(1)}
                        </span>
                      )}
                      {item.response?.trim()
                        ? <svg className="h-3 w-3 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6L9 17l-5-5" /></svg>
                        : <svg className="h-3 w-3 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/></svg>}
                    </div>
                    <p className="mb-1 text-[11px] font-semibold text-slate-600 dark:text-slate-400">{item.text}</p>
                    {item.response?.trim()
                      ? <p className="text-[12px] leading-relaxed text-slate-700 dark:text-slate-300 whitespace-pre-line">{item.response}</p>
                      : !item.attachment
                        ? <p className="text-[11px] italic text-slate-400 dark:text-slate-500">No response provided.</p>
                        : null}
                    {(item.attachment?.url || item.attachment?.data_url) && (
                      <a href={item.attachment.url || item.attachment.data_url}
                        download={!item.attachment.url ? item.attachment.filename : undefined}
                        target={item.attachment.url ? "_blank" : undefined}
                        rel={item.attachment.url ? "noopener noreferrer" : undefined}
                        className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-brand-600 hover:bg-brand-50 transition dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-brand-900/20">
                        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17,8 12,3 7,8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                        {item.attachment.filename || "Download file"}
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {proposal.sections?.length > 0 && proposal.sections.map((sec, i) => (
            <div key={i}>
              <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">{sec.heading}</div>
              <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/50">
                <p className="text-[13px] leading-relaxed text-slate-700 dark:text-slate-300 whitespace-pre-line">{sec.content}</p>
              </div>
            </div>
          ))}

          <div>
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Documents</div>
            {proposal.attachments?.length > 0 ? (
              <div className="space-y-2">
                {proposal.attachments.map((a, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 text-[12px] dark:border-slate-700 dark:bg-slate-900">
                    <svg className="h-4 w-4 text-slate-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14,2 14,8 20,8" />
                    </svg>
                    <span className="flex-1 truncate text-slate-600 dark:text-slate-400">{a.filename || a.name}</span>
                    {(a.url || a.data_url) && (
                      <a href={a.url || a.data_url} download={!a.url ? (a.filename || a.name) : undefined} target={a.url ? "_blank" : undefined} rel={a.url ? "noopener noreferrer" : undefined}
                        className="shrink-0 rounded-lg bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-600 hover:bg-brand-100 transition dark:bg-brand-900/20 dark:text-brand-400">
                        Download
                      </a>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[12px] italic text-slate-400 dark:text-slate-500">No document was attached to this submission.</p>
            )}
          </div>

          {/* Timeline */}
          {proposal.events?.length > 0 && (
            <div>
              <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Timeline</div>
              <div className="space-y-2">
                {proposal.events.map((ev, i) => (
                  <div key={i} className="flex items-start gap-3 text-[11px]">
                    <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-brand-400" />
                    <div>
                      <span className="font-semibold text-slate-600 dark:text-slate-400">{ev.event_type ? titleCase(ev.event_type) : "Event"}</span>
                      {ev.reason && <span className="ml-1 text-slate-400">— {ev.reason}</span>}
                      <div className="text-[10px] text-slate-400">{fmtRel(ev.created_at)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {showReasonInput && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
              <p className="mb-2 text-[12px] font-semibold text-amber-700 dark:text-amber-300">
                Reason for {pendingAction ? titleCase(pendingAction) : "action"}
              </p>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                placeholder="Optional, provide context for the other party..."
                className="w-full rounded-xl border border-amber-300 bg-white px-3 py-2 text-[12px] text-slate-700 focus:border-amber-400 focus:outline-none dark:border-amber-700 dark:bg-slate-900 dark:text-slate-200 resize-none"
              />
              <div className="mt-2 flex gap-2">
                <button onClick={submitWithReason} disabled={actionLoading}
                  className="rounded-xl bg-amber-600 px-4 py-2 text-[12px] font-bold text-white hover:bg-amber-700 disabled:opacity-50 transition">
                  {actionLoading ? "Saving…" : "Confirm"}
                </button>
                <button onClick={() => { setShowReasonInput(false); setPendingAction(null); }}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-[12px] font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-transparent dark:text-slate-400 transition">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {actionError && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-[12px] text-red-600 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
              {actionError}
            </div>
          )}
        </div>

        {actions.length > 0 && !showReasonInput && (
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-6 py-4 dark:border-slate-800">
            {actions.map((a) => (
              <button key={a.status} onClick={() => doTransition(a.status)} disabled={actionLoading}
                className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-[12px] font-bold text-white transition disabled:opacity-50 ${a.cls}`}>
                {actionLoading && <Spinner size="sm" />}
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

// ─── inbox tab ────────────────────────────────────────────────────────────────

export function InboxTab() {
  const { inbox, inboxLoading, inboxError, fetchInbox, deleteFromInbox } = useProposalStore();
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [search, setSearch] = useState("");
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [selected, setSelected] = useState(null);
  const [newToast, setNewToast] = useState(null);
  const prevCountRef = useRef(null);

  useEffect(() => { fetchInbox(); }, [fetchInbox]);

  // Poll every 30s and refresh on tab focus; toast when new proposals arrive
  useEffect(() => {
    const poll = setInterval(fetchInbox, 30_000);
    const onFocus = () => fetchInbox();
    document.addEventListener("visibilitychange", onFocus);
    return () => { clearInterval(poll); document.removeEventListener("visibilitychange", onFocus); };
  }, [fetchInbox]);

  useEffect(() => {
    const count = inbox.length;
    if (prevCountRef.current !== null && count > prevCountRef.current) {
      const diff = count - prevCountRef.current;
      setNewToast(`${diff} new proposal${diff > 1 ? "s" : ""} received`);
    }
    prevCountRef.current = count;
  }, [inbox.length]);

  const filtered = useMemo(() => {
    let list = filterStatus === "ALL" ? inbox : inbox.filter((p) => p.status === filterStatus);
    if (search) list = list.filter(p => [p.title, p.description, p.from_workspace_name].some(v => typeof v === "string" && v.toLowerCase().includes(search.toLowerCase())));
    return list;
  }, [inbox, filterStatus, search]);

  return (
    <div>
      {newToast && <Toast msg={newToast} type="success" onDone={() => setNewToast(null)} />}
      {selected && (
        <ProposalDetailModal
          proposal={selected}
          role="recipient"
          onClose={() => setSelected(null)}
          onStatusChange={() => { setSelected(null); fetchInbox(); }}
        />
      )}

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-bold text-slate-800 dark:text-slate-100">Proposal Inbox</h2>
          <p className="text-[12px] text-slate-500 dark:text-slate-400">Proposals submitted to your business by other businesses.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search inbox..." className="rounded-lg border border-slate-200 bg-white pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300 w-40" />
          </div>
          <div className="relative">
            <button type="button" onClick={() => setShowFilterMenu(v => !v)}
              className={`inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${filterStatus !== "ALL" ? "border-indigo-400 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="4" y1="8" x2="20" y2="8"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="12" y1="16" x2="12" y2="16"/></svg>
              {filterStatus !== "ALL" ? (STATUS_LABELS[filterStatus] || filterStatus) : "Filter"}
            </button>
            {showFilterMenu && (
              <div className="absolute right-0 top-9 z-30 min-w-[160px] rounded-xl border border-slate-200 bg-white shadow-xl py-1">
                {["ALL", "SUBMITTED", "UNDER_REVIEW", "SHORTLISTED", "PREFERRED", "NEGOTIATION"].map(s => (
                  <button key={s} onClick={() => { setFilterStatus(s); setShowFilterMenu(false); }}
                    className={`w-full px-4 py-2 text-left text-xs hover:bg-slate-50 ${filterStatus === s ? "font-semibold text-indigo-600" : "text-slate-700"}`}>
                    {s === "ALL" ? "All Statuses" : (STATUS_LABELS[s] || s)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {inboxLoading && !inbox.length && <div className="flex justify-center py-16"><Spinner /></div>}

      {inboxError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[12px] text-red-600 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          {inboxError}
        </div>
      )}

      {!inboxLoading && !inboxError && filtered.length === 0 && (
        <EmptyState
          icon={<svg className="h-8 w-8 text-brand-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Z" /><path d="m22 6-10 7L2 6" /></svg>}
          title={filterStatus === "ALL" ? "No proposals yet" : `No ${STATUS_LABELS[filterStatus] || titleCase(filterStatus)} proposals`}
          body={filterStatus === "ALL"
            ? "Enable \"Open for Proposals\" in Settings and publish a request to start receiving proposals."
            : "No proposals match this filter."}
        />
      )}

      {filtered.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => (
            <ProposalCard key={p.id} proposal={p} role="recipient" onClick={setSelected} onDelete={(id) => deleteFromInbox(id)} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── activity tab ─────────────────────────────────────────────────────────────

export function ActivityTab() {
  const { activity, activityLoading, activityError, fetchActivity } = useProposalStore();
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [search, setSearch] = useState("");
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [selected, setSelected] = useState(null);

  useEffect(() => { fetchActivity(); }, [fetchActivity]);

  const filtered = useMemo(() => {
    let list = filterStatus === "ALL" ? activity : activity.filter((p) => p.status === filterStatus);
    if (search) list = list.filter(p => [p.title, p.description, p.to_workspace_name].some(v => typeof v === "string" && v.toLowerCase().includes(search.toLowerCase())));
    return list;
  }, [activity, filterStatus, search]);

  return (
    <div>
      {selected && (
        <ProposalDetailModal
          proposal={selected}
          role="proposer"
          onClose={() => setSelected(null)}
          onStatusChange={() => { setSelected(null); fetchActivity(); }}
        />
      )}

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-bold text-slate-800 dark:text-slate-100">Proposal Activity</h2>
          <p className="text-[12px] text-slate-500 dark:text-slate-400">Proposals you have submitted to other businesses.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search activity..." className="rounded-lg border border-slate-200 bg-white pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300 w-40" />
          </div>
          <div className="relative">
            <button type="button" onClick={() => setShowFilterMenu(v => !v)}
              className={`inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${filterStatus !== "ALL" ? "border-indigo-400 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="4" y1="8" x2="20" y2="8"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="12" y1="16" x2="12" y2="16"/></svg>
              {filterStatus !== "ALL" ? (STATUS_LABELS[filterStatus] || filterStatus) : "Filter"}
            </button>
            {showFilterMenu && (
              <div className="absolute right-0 top-9 z-30 min-w-[160px] rounded-xl border border-slate-200 bg-white shadow-xl py-1">
                {["ALL", "SUBMITTED", "VIEWED", "UNDER_REVIEW", "SHORTLISTED", "PREFERRED", "NEGOTIATION", "AWARDED"].map(s => (
                  <button key={s} onClick={() => { setFilterStatus(s); setShowFilterMenu(false); }}
                    className={`w-full px-4 py-2 text-left text-xs hover:bg-slate-50 ${filterStatus === s ? "font-semibold text-indigo-600" : "text-slate-700"}`}>
                    {s === "ALL" ? "All Statuses" : (STATUS_LABELS[s] || s)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {activityLoading && !activity.length && <div className="flex justify-center py-16"><Spinner /></div>}

      {activityError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[12px] text-red-600 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          {activityError}
        </div>
      )}

      {!activityLoading && !activityError && filtered.length === 0 && (
        <EmptyState
          icon={<svg className="h-8 w-8 text-brand-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14,2 14,8 20,8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10,9 9,9 8,9" /></svg>}
          title={filterStatus === "ALL" ? "No proposals submitted" : `No ${STATUS_LABELS[filterStatus] || titleCase(filterStatus)} proposals`}
          body={filterStatus === "ALL"
            ? "Visit the Marketplace to find businesses open for proposals and apply."
            : "No proposals match this filter."}
          action={filterStatus === "ALL" && (
            <a href="/marketplace"
              className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-[13px] font-bold text-white hover:bg-brand-700 transition">
              Browse Marketplace
            </a>
          )}
        />
      )}

      {filtered.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => (
            <ProposalCard key={p.id} proposal={p} role="proposer" onClick={setSelected} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Submit Proposal Modal ────────────────────────────────────────────────────

function SubmitProposalModal({ targetWorkspaceId, onClose, onSuccess }) {
  const { submitProposal } = useProposalStore();
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!title.trim()) { setError("Please enter a proposal title."); return; }
    setSubmitting(true); setError(null);
    const res = await submitProposal({
      recipient_workspace_id: targetWorkspaceId,
      title: title.trim(),
      summary: summary.trim() || null,
    });
    setSubmitting(false);
    if (res.ok) { onSuccess(); }
    else { setError(res.error || "Submission failed. Please try again."); }
  }

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center p-0 sm:items-center sm:p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="ea-dialog relative z-10 w-full max-w-lg overflow-hidden rounded-t-3xl sm:rounded-2xl">
        <div className="h-1.5 w-full bg-gradient-to-r from-indigo-500 to-violet-500" />
        <div className="px-6 pt-5 pb-3 flex items-start justify-between">
          <div>
            <h2 className="text-[17px] font-bold text-slate-900 dark:text-slate-100">Submit a Proposal</h2>
            <p className="mt-0.5 text-[12px] text-slate-500 dark:text-slate-400">Your proposal will go straight to their inbox.</p>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 pb-6 space-y-4">
          <div>
            <label className="mb-1.5 block text-[12px] font-semibold text-slate-600 dark:text-slate-400">
              Proposal Title <span className="text-red-500">*</span>
            </label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Software Development Partnership Proposal"
              className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-[13px] text-slate-800 shadow-sm focus:border-indigo-400 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-[12px] font-semibold text-slate-600 dark:text-slate-400">
              Cover Letter / Summary
            </label>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={5}
              placeholder="Introduce yourself, explain why you're a great fit, and highlight key offerings..."
              className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-[13px] text-slate-800 shadow-sm focus:border-indigo-400 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            />
          </div>

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-[12px] text-red-600 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-[13px] font-semibold text-slate-600 hover:bg-slate-50 transition dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800">
              Cancel
            </button>
            <button type="submit" disabled={submitting}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-[13px] font-bold text-white hover:bg-indigo-700 transition disabled:opacity-50 disabled:cursor-not-allowed">
              {submitting && <Spinner size={14} />}
              {submitting ? "Submitting…" : "Submit Proposal"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}

// ─── main page ────────────────────────────────────────────────────────────────

const TABS = [
  { key: "inbox", label: "Inbox" },
  { key: "activity", label: "Activity" },
  { key: "requests", label: "Requests" },
];

export const ProposalsPanel = forwardRef(function ProposalsPanel({ initialTab = "inbox" }, ref) {
  const [tab, setTab] = useState(initialTab);
  const { inboxUnread } = useProposalStore();

  useImperativeHandle(ref, () => ({
    switchToActivity: () => setTab("activity"),
  }));

  return (
    <div>
      {/* Tab bar */}
      <div className="mb-6 flex gap-1 border-b border-slate-200 dark:border-slate-700">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`relative flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-[13px] font-semibold transition
              ${tab === t.key
                ? "border-indigo-600 text-indigo-700 dark:border-indigo-400 dark:text-indigo-300"
                : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"}`}>
            {t.label}
            {t.key === "inbox" && inboxUnread > 0 && (
              <span className="rounded-full bg-indigo-600 px-1.5 py-0.5 text-[9px] font-bold text-white leading-none min-w-[16px] text-center">
                {inboxUnread}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "inbox" && <InboxTab />}
      {tab === "activity" && <ActivityTab />}
      {tab === "requests" && <RequestsTab />}
    </div>
  );
});

export default function ProposalsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const action = searchParams.get("action");
  const target = searchParams.get("target");
  const showSubmit = (action === "upload" || action === "generate") && target;
  const panelRef = useRef(null);

  function handleSubmitSuccess() {
    setSearchParams({});
    // Switch to activity tab so they can see the submitted proposal
    if (panelRef.current?.switchToActivity) panelRef.current.switchToActivity();
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      {showSubmit && (
        <SubmitProposalModal
          targetWorkspaceId={target}
          onClose={() => setSearchParams({})}
          onSuccess={handleSubmitSuccess}
        />
      )}
      <div className="mb-6">
        <h1 className="text-[22px] font-extrabold tracking-tight text-slate-900 dark:text-slate-100">Opportunities</h1>
        <p className="mt-1 text-[13px] text-slate-500 dark:text-slate-400">
          Send and receive business opportunities. Manage incoming proposals and track your submissions.
        </p>
      </div>
      <ProposalsPanel ref={panelRef} />
    </div>
  );
}
