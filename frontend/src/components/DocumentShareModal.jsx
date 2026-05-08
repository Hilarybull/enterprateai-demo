import { useEffect, useRef, useState } from "react";

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

export default function DocumentShareModal({
  onClose,
  onGenerate,
  getMailtoHref,
  defaultEmail = "",
  title = "Share document",
  subtitle = "Choose who can use this link before generating it.",
}) {
  const backdropRef = useRef(null);
  const [accessMode, setAccessMode] = useState(defaultEmail ? "email" : "link");
  const [email, setEmail] = useState(defaultEmail);
  const [expiryDays, setExpiryDays] = useState(7);
  const [shareLink, setShareLink] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    setShareLink("");
    setCopied(false);
    setError("");
  }, [accessMode, email, expiryDays]);

  async function handleGenerate() {
    if (accessMode === "email" && !email.trim()) {
      setError("Enter the email address for this share link.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const url = await onGenerate({
        access_mode: accessMode,
        email: accessMode === "email" ? email.trim() : null,
        expires_in_days: expiryDays,
      });
      if (!url) throw new Error("Share link could not be created.");
      setShareLink(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create share link.");
    } finally {
      setLoading(false);
    }
  }

  async function copyLink() {
    if (!shareLink) return;
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  function openMailto() {
    if (!shareLink || !getMailtoHref) return;
    window.location.href = getMailtoHref({
      url: shareLink,
      accessMode,
      email: accessMode === "email" ? email.trim() : "",
      expiryDays,
    });
  }

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-[200] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onClick={(e) => { if (e.target === backdropRef.current) onClose(); }}
    >
      <div
        className="relative flex w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center pt-3 pb-1 sm:hidden">
          <div className="h-1 w-10 rounded-full bg-slate-200" />
        </div>

        <div className="relative border-b border-slate-100 px-4 py-4 text-center sm:px-5 sm:py-5">
          <div className="mx-auto max-w-sm">
            <h2 className="text-[15px] font-semibold text-slate-900">{title}</h2>
            <p className="mt-1 text-[11px] leading-5 text-slate-400">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-3 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 sm:right-5 sm:top-4"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
          <div>
            <label className="mb-1.5 block text-[12px] font-semibold text-slate-700">
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
                    setError("");
                  }}
                  className={
                    "rounded-xl border p-3 text-left transition " +
                    (accessMode === opt.value
                      ? "border-brand-300 bg-brand-50"
                      : "border-slate-200 bg-white hover:bg-slate-50")
                  }
                >
                  <div className="text-[12px] font-semibold text-slate-800">{opt.title}</div>
                  <div className="mt-1 text-[11px] text-slate-500">{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {accessMode === "email" && (
            <div>
              <label className="mb-1.5 block text-[12px] font-semibold text-slate-700">
                Email address
                <span className="ml-1 font-normal text-slate-400">(required)</span>
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="recipient@company.com"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-brand-300 focus:ring-2 focus:ring-brand-100"
              />
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-[12px] font-semibold text-slate-700">
              Link expires in
            </label>
            <select
              value={expiryDays}
              onChange={(e) => setExpiryDays(Number(e.target.value))}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-brand-300 focus:ring-2 focus:ring-brand-100"
            >
              <option value={1}>1 day</option>
              <option value={3}>3 days</option>
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
            </select>
          </div>

          {error ? (
            <div className="rounded-xl bg-rose-50 px-3 py-2.5 text-[12px] font-medium text-rose-600">
              {error}
            </div>
          ) : null}

          {shareLink ? (
            <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
                  <CheckIcon className="h-3 w-3" />
                </span>
                <span className="text-[12px] font-semibold text-emerald-700">
                  Share link ready - {accessMode === "email" ? "email-only" : "multi-use"} - expires in {expiryDays} day{expiryDays !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="flex items-center gap-2 rounded-lg bg-white py-1 pl-2.5 pr-1 ring-1 ring-slate-200">
                <span className="min-w-0 flex-1 truncate text-[11px] font-mono text-slate-600">
                  {shareLink}
                </span>
                <button
                  type="button"
                  onClick={copyLink}
                  className={
                    "shrink-0 flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-semibold transition " +
                    (copied ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200")
                  }
                >
                  {copied ? <CheckIcon /> : <CopyIcon />}
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
              {getMailtoHref ? (
                <button
                  type="button"
                  onClick={openMailto}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-white py-2 text-[13px] font-semibold text-slate-700 transition hover:bg-emerald-50"
                >
                  <MailIcon />
                  Send via email
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-end sm:px-5">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 sm:w-auto"
          >
            {shareLink ? "Close" : "Cancel"}
          </button>
          {!shareLink ? (
            <button
              type="button"
              onClick={handleGenerate}
              disabled={loading}
              className="w-full rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50 sm:w-auto"
            >
              {loading ? "Generating..." : "Generate share link"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
