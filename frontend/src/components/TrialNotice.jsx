import { useEffect, useState } from "react";

export default function TrialNotice({ accountKey, endsAt, exhausted = false, onUpgrade }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer); }, []);
  const end = endsAt ? new Date(endsAt) : null;
  const days = end && !Number.isNaN(end.getTime()) ? Math.max(0, Math.ceil((end.getTime() - now) / 86400000)) : null;
  const deadline = days !== null ? end.toLocaleDateString("en-GB", {day:"numeric",month:"long",year:"numeric"}) : "your trial ends";
  const dayText = `${days} ${days === 1 ? "day" : "days"}`;
  const message = days === 0 ? "Your trial has ended. Choose a plan to keep your AI agents working and your business growing."
    : exhausted ? `Your trial AI credits are used up. Upgrade to put your agents back to work. Other tools remain available${days !== null ? ` for ${dayText}` : " until your trial ends"}.`
    : `${days !== null ? `You have ${dayText} left` : "Make the most of your trial"} to plan smarter, win business and grow with full access and 200 AI credits included. Upgrade before ${deadline} to keep your AI agents working for you.`;
  const key = `ea_trial_notice:${accountKey || "current"}:${endsAt || ""}:${exhausted ? "exhausted" : "active"}`;
  const [dismissed, setDismissed] = useState(null);
  let stored = false;
  try { stored = localStorage.getItem(key) === "dismissed"; } catch { /* Dismissal still works for this view. */ }
  if (dismissed === key || stored) return null;
  function dismiss() {
    setDismissed(key);
    try { localStorage.setItem(key, "dismissed"); } catch { /* Storage is optional. */ }
  }
  return <div data-trial-notice role="status" className="mb-4 flex shrink-0 items-start gap-2 rounded-xl border border-brand-200 bg-brand-50 p-3 text-sm text-brand-900">
    <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-3">
      <p className="min-w-0 flex-1 basis-64">{message}</p>
      <button type="button" onClick={onUpgrade} className="min-h-11 shrink-0 rounded-lg bg-brand-600 px-4 py-2 font-semibold text-white">Upgrade</button>
    </div>
    <button type="button" aria-label="Dismiss trial notice" onClick={dismiss} className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg hover:bg-brand-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600">
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m6 6 12 12M6 18 18 6" /></svg>
    </button>
  </div>;
}
