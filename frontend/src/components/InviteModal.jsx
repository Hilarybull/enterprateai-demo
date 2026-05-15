import { useState, useEffect, useRef } from "react";
import { apiRequest } from "../api/client";
import { MODULES, FEATURES } from "../lib/permissions";

function CheckIcon({ className = "h-3 w-3" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}

function ChevronDown() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function Checkbox({ checked, partial = false, size = "md" }) {
  const sz = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";
  return (
    <span
      className={
        "flex shrink-0 items-center justify-center rounded border transition " +
        sz + " " +
        (checked
          ? "border-brand-600 bg-brand-600 text-white"
          : partial
          ? "border-brand-400 bg-brand-50 dark:bg-slate-800"
          : "border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-900")
      }
    >
      {checked && <CheckIcon className={size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3"} />}
      {!checked && partial && <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />}
    </span>
  );
}

function ModuleSelector({ selected, onChange }) {
  const allSelected = selected.length === MODULES.length;

  function toggleAll() {
    onChange(allSelected ? [] : MODULES.map((m) => m.key));
  }

  function toggle(key) {
    onChange(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]);
  }

  return (
    <div className="space-y-2.5">
      <button
        type="button"
        onClick={toggleAll}
        className="flex items-center gap-2 text-xs font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-400"
      >
        <Checkbox checked={allSelected} />
        {allSelected ? "Deselect all" : "Select all"}
      </button>
      <div className="grid grid-cols-2 gap-2">
        {MODULES.map((mod) => {
          const checked = selected.includes(mod.key);
          return (
            <button
              key={mod.key}
              type="button"
              onClick={() => toggle(mod.key)}
              className={
                "flex items-center gap-2.5 rounded-xl border p-2.5 text-left transition " +
                (checked
                  ? "border-brand-200 bg-brand-50 dark:border-slate-700 dark:bg-slate-800"
                  : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800")
              }
            >
              <Checkbox checked={checked} />
              <div className="min-w-0">
                <div className="truncate text-[12px] font-semibold leading-tight text-slate-800 dark:text-slate-100">{mod.label}</div>
                <div className="truncate text-[10px] leading-tight text-slate-400 mt-0.5">{mod.subtitle}</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function FeatureSelector({ selected, onChange }) {
  const [expanded, setExpanded] = useState({});

  function toggleModule(modKey) {
    setExpanded((prev) => ({ ...prev, [modKey]: !prev[modKey] }));
  }

  function toggleModuleAll(modKey) {
    const features = FEATURES[modKey] || [];
    const current = selected[modKey] || [];
    const allChecked = current.length === features.length;
    onChange({ ...selected, [modKey]: allChecked ? [] : features.map((f) => f.key) });
  }

  function toggleFeature(modKey, featKey) {
    const current = selected[modKey] || [];
    const next = current.includes(featKey) ? current.filter((k) => k !== featKey) : [...current, featKey];
    onChange({ ...selected, [modKey]: next });
  }

  function moduleCheckState(modKey) {
    const features = FEATURES[modKey] || [];
    const current = selected[modKey] || [];
    if (current.length === 0) return "none";
    if (current.length === features.length) return "all";
    return "partial";
  }

  return (
    <div className="space-y-1.5">
      {MODULES.map((mod) => {
        const features = FEATURES[mod.key] || [];
        const state = moduleCheckState(mod.key);
        const isOpen = expanded[mod.key];
        const selectedCount = (selected[mod.key] || []).length;

        return (
          <div key={mod.key} className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-2 bg-white px-3 py-2.5 dark:bg-slate-900">
              <button
                type="button"
                onClick={() => toggleModuleAll(mod.key)}
                aria-label={`Select all features in ${mod.label}`}
              >
                <Checkbox checked={state === "all"} partial={state === "partial"} />
              </button>
              <button
                type="button"
                onClick={() => toggleModule(mod.key)}
                className="flex flex-1 items-center justify-between gap-2 min-w-0"
              >
                <div className="min-w-0 flex items-center gap-2 text-left">
                  <span className="text-[13px] font-semibold text-slate-800 dark:text-slate-100 truncate">{mod.label}</span>
                  {selectedCount > 0 && (
                    <span className="shrink-0 rounded-full bg-brand-100 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700 dark:bg-slate-800 dark:text-brand-400">
                      {selectedCount}/{features.length}
                    </span>
                  )}
                </div>
                <span className={"shrink-0 text-slate-400 transition-transform duration-200 " + (isOpen ? "rotate-180" : "")}>
                  <ChevronDown />
                </span>
              </button>
            </div>
            {isOpen && (
              <div className="border-t border-slate-100 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-950">
                <div className="space-y-1">
                  {features.map((feat) => {
                    const checked = (selected[mod.key] || []).includes(feat.key);
                    return (
                      <button
                        key={feat.key}
                        type="button"
                        onClick={() => toggleFeature(mod.key, feat.key)}
                        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-white dark:hover:bg-slate-900 transition"
                      >
                        <Checkbox checked={checked} size="sm" />
                        <span className="text-[12px] text-slate-700 dark:text-slate-300">{feat.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function InviteModal({ onClose, initialPermissionType, initialPermissions, memberId, onSaved }) {
  const isEditMode = Boolean(memberId);

  const [tab, setTab] = useState(initialPermissionType || "module");
  const [accessMode, setAccessMode] = useState("link");
  const [selectedModules, setSelectedModules] = useState(initialPermissions?.modules || []);
  const [selectedFeatures, setSelectedFeatures] = useState(initialPermissions?.features || {});
  const [email, setEmail] = useState("");
  const [expiryDays, setExpiryDays] = useState(7);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [inviteLink, setInviteLink] = useState(null);
  const [emailStatus, setEmailStatus] = useState(null);
  const [copied, setCopied] = useState(false);

  const backdropRef = useRef(null);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function buildPermissions() {
    if (tab === "module") return { modules: selectedModules };
    const cleaned = {};
    for (const [mod, feats] of Object.entries(selectedFeatures)) {
      if (feats && feats.length > 0) cleaned[mod] = feats;
    }
    return { features: cleaned };
  }

  function hasSelection() {
    if (tab === "module") return selectedModules.length > 0;
    return Object.values(selectedFeatures).some((f) => f && f.length > 0);
  }

  async function handleGenerate() {
    if (!hasSelection()) { setError("Select at least one module or feature."); return; }
    if (accessMode === "email" && !email.trim()) { setError("Enter the email address for this invite."); return; }
    setLoading(true);
    setError(null);
    setEmailStatus(null);
    try {
      const result = await apiRequest("/workspace/invitations", "POST", {
        access_mode: accessMode,
        email: accessMode === "email" ? email.trim() : null,
        permission_type: tab,
        permissions: buildPermissions(),
        expires_in_days: expiryDays,
      });
      setInviteLink(`${window.location.origin}/join/${result.token}`);
      setEmailStatus({
        sent: Boolean(result?.email_sent),
        error: result?.email_error || "",
      });
    } catch (e) {
      setError(e.message || "Failed to create invitation.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveEdit() {
    if (!hasSelection()) { setError("Select at least one module or feature."); return; }
    setLoading(true);
    setError(null);
    try {
      await apiRequest(`/workspace/members/${memberId}`, "PATCH", {
        permission_type: tab,
        permissions: buildPermissions(),
      });
      onSaved?.();
      onClose();
    } catch (e) {
      setError(e.message || "Failed to update permissions.");
    } finally {
      setLoading(false);
    }
  }

  async function copyLink() {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard api unavailable */ }
  }

  function openMailto() {
    const subject = encodeURIComponent("You've been invited to a workspace");
    const body = encodeURIComponent(
      `Hi,\n\nYou've been invited to join a workspace on EnterprateAI.\n\nClick the link below to accept:\n${inviteLink}\n\nThis link expires in ${expiryDays} day${expiryDays !== 1 ? "s" : ""}.\n`
    );
    window.open(`mailto:${accessMode === "email" ? email : ""}?subject=${subject}&body=${body}`);
  }

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-sm p-0 sm:p-4"
      onClick={(e) => { if (e.target === backdropRef.current) onClose(); }}
    >
      <div className="relative flex w-full sm:max-w-lg flex-col bg-white dark:bg-slate-900 shadow-2xl rounded-t-2xl sm:rounded-2xl max-h-[92dvh] sm:max-h-[88vh] overflow-hidden">

        {/* Drag handle on mobile */}
        <div className="flex justify-center pt-3 pb-1 sm:hidden">
          <div className="h-1 w-10 rounded-full bg-slate-200 dark:bg-slate-700" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 px-4 sm:px-5 py-3 sm:py-4">
          <div>
            <h2 className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">
              {isEditMode ? "Edit Permissions" : "Invite to Workspace"}
            </h2>
            {!isEditMode && (
              <p className="text-[11px] text-slate-400 mt-0.5">Share access by module or individual feature</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-3 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 transition"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 space-y-4">

          {/* Access type toggle */}
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Grant access by
            </p>
            <div className="flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
              {[{ value: "module", label: "Module" }, { value: "feature", label: "Feature" }].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => { setTab(opt.value); setError(null); }}
                  className={
                    "flex-1 rounded-lg py-2 text-[13px] font-semibold transition " +
                    (tab === opt.value
                      ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100"
                      : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300")
                  }
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-slate-400 dark:text-slate-500">
              {tab === "module"
                ? "Full access to all features within selected modules."
                : "Pick specific features per module for finer control."}
            </p>
          </div>

          {/* Selection */}
          {tab === "module"
            ? <ModuleSelector selected={selectedModules} onChange={setSelectedModules} />
            : <FeatureSelector selected={selectedFeatures} onChange={setSelectedFeatures} />
          }

          {/* Email + expiry (invite mode only) */}
          {!isEditMode && (
            <div className="space-y-3 border-t border-slate-100 dark:border-slate-800 pt-4">
              <div>
                <label className="mb-1.5 block text-[12px] font-semibold text-slate-700 dark:text-slate-300">
                  Who can use this link?
                </label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {[
                    {
                      value: "link",
                      title: "Anyone with link",
                      desc: "Multiple users can join with this same link until it expires or is revoked.",
                    },
                    {
                      value: "email",
                      title: "Specific email only",
                      desc: "Only the entered email can use this link, and only once.",
                    },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => {
                        setAccessMode(opt.value);
                        if (opt.value === "link") setEmail("");
                        setError(null);
                      }}
                      className={
                        "rounded-xl border p-3 text-left transition " +
                        (accessMode === opt.value
                          ? "border-brand-300 bg-brand-50 dark:border-slate-700 dark:bg-slate-800"
                          : "border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800")
                      }
                    >
                      <div className="text-[12px] font-semibold text-slate-800 dark:text-slate-100">{opt.title}</div>
                      <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{opt.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
              {accessMode === "email" && (
                <div>
                  <label className="mb-1.5 block text-[12px] font-semibold text-slate-700 dark:text-slate-300">
                    Email address
                    <span className="ml-1 font-normal text-slate-400">(required)</span>
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="colleague@company.com"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-brand-300 focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-slate-600 transition"
                  />
                </div>
              )}
              <div>
                <label className="mb-1.5 block text-[12px] font-semibold text-slate-700 dark:text-slate-300">
                  Link expires in
                </label>
                <select
                  value={expiryDays}
                  onChange={(e) => setExpiryDays(Number(e.target.value))}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-brand-300 focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 transition"
                >
                  <option value={1}>1 day</option>
                  <option value={3}>3 days</option>
                  <option value={7}>7 days</option>
                  <option value={14}>14 days</option>
                  <option value={30}>30 days</option>
                </select>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="rounded-xl bg-rose-50 px-3 py-2.5 text-[12px] font-medium text-rose-600 dark:bg-rose-950/30 dark:text-rose-400">
              {error}
            </div>
          )}

          {/* Generated link */}
          {inviteLink && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 space-y-3 dark:border-emerald-900/50 dark:bg-emerald-950/20">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
                  <CheckIcon className="h-3 w-3" />
                </span>
                <span className="text-[12px] font-semibold text-emerald-700 dark:text-emerald-400">
                  {accessMode === "email" && emailStatus?.sent
                    ? `Invitation email sent to ${email.trim()}`
                    : `Invite link ready - ${accessMode === "email" ? "email-only" : "multi-use"} - expires in ${expiryDays} day${expiryDays !== 1 ? "s" : ""}`}
                </span>
              </div>
              {accessMode === "email" && emailStatus && !emailStatus.sent ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
                  {emailStatus.error || "The invitation link was created, but the email was not sent. You can still copy the link and send it manually."}
                </div>
              ) : null}
              <div className="flex items-center gap-2 rounded-lg bg-white ring-1 ring-slate-200 pl-2.5 pr-1 py-1 dark:bg-slate-900 dark:ring-slate-700">
                <span className="min-w-0 flex-1 truncate text-[11px] font-mono text-slate-600 dark:text-slate-400">
                  {inviteLink}
                </span>
                <button
                  type="button"
                  onClick={copyLink}
                  className={
                    "shrink-0 flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-semibold transition " +
                    (copied
                      ? "bg-emerald-600 text-white"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700")
                  }
                >
                  {copied ? <CheckIcon /> : <CopyIcon />}
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
              <button
                type="button"
                onClick={openMailto}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-white py-2 text-[13px] font-semibold text-slate-700 hover:bg-emerald-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 transition"
              >
                <MailIcon />
                {emailStatus?.sent ? "Open email app anyway" : "Send via email app"}
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-100 dark:border-slate-800 px-4 sm:px-5 py-3 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 transition"
          >
            {inviteLink ? "Close" : "Cancel"}
          </button>
          {isEditMode ? (
            <button
              type="button"
              onClick={handleSaveEdit}
              disabled={loading || !hasSelection()}
              className="w-full sm:w-auto rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50 transition"
            >
              {loading ? "Saving..." : "Save changes"}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleGenerate}
              disabled={loading || !hasSelection()}
              className="w-full sm:w-auto rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50 transition"
            >
              {loading ? "Creating..." : accessMode === "email" ? "Create and send" : "Generate invite link"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
