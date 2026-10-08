import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import logoUrl from "../enterprate-logo.png";
import { activationError, answerTipsPrompt, getMyPreferences, getPreferences, saveMyPreferences, savePreferences, unsubscribe } from "../lib/activation";
import { useAuthStore } from "../store/auth";

// Where the links in a tips email lead, the same switch inside account settings, and the one-time
// question for people who signed up with Google. Unsubscribing is one click and takes effect at once.

function Frame({ title, children }) {
  return (
    <div className="flex min-h-screen flex-col items-center bg-slate-50 px-4 py-10 dark:bg-slate-950">
      <Link to="/" aria-label="EnterprateAI"><img src={logoUrl} alt="EnterprateAI" className="h-8 w-auto" /></Link>
      <main className="mt-8 w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">{title}</h1>
        {children}
      </main>
      <p className="mt-4 max-w-md text-center text-[12px] text-slate-500">Messages about your account, such as password resets and receipts, are not affected by this choice.</p>
    </div>
  );
}

const primary = "rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:bg-slate-300";
const quiet = "text-sm font-semibold text-brand-600 hover:underline";
const day = (iso) => { try { return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); } catch { return ""; } };

export function UnsubscribePage() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [state, setState] = useState({});
  async function go() {
    setState({ busy: true });
    try { const r = await unsubscribe(token); setState({ done: r.message }); }
    catch (e) { setState({ problem: activationError(e, "That didn't work. Please try again.") }); }
  }
  return (
    <Frame title={state.done ? "You're unsubscribed" : "Stop tips from EnterprateAI?"}>
      {state.done ? (
        <>
          <p role="status" className="mt-2 text-sm text-slate-600 dark:text-slate-300">{state.done}</p>
          <p className="mt-4"><Link to={`/email/preferences?token=${encodeURIComponent(token)}`} className={quiet}>Changed your mind? Email preferences</Link></p>
        </>
      ) : (
        <>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">You'll stop receiving getting-started guides and product tips. It takes effect straight away.</p>
          {state.problem && <p role="alert" className="mt-3 text-sm font-medium text-rose-600">{state.problem}</p>}
          <button type="button" className={`mt-4 ${primary}`} disabled={state.busy || !token} onClick={go}>{state.busy ? "Unsubscribing…" : "Unsubscribe"}</button>
        </>
      )}
    </Frame>
  );
}

/** An on/off switch a keyboard and a screen reader can use. */
export function Switch({ checked, onChange, disabled, label }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:opacity-60 ${checked ? "bg-brand-600" : "bg-slate-300 dark:bg-slate-600"}`}>
      <span aria-hidden="true" className={`inline-block h-5 w-5 rounded-full bg-white shadow transition ${checked ? "translate-x-[22px]" : "translate-x-0.5"}`} />
    </button>
  );
}

/** The tips setting. `token` comes from an email link; without it, the signed-in person's own setting is used.
 *  Where the feature isn't set up on the server, this says so (or shows nothing) rather than an error. */
export function TipsSwitch({ token = null, quietWhenUnavailable = false }) {
  const [prefs, setPrefs] = useState(null);
  const [state, setState] = useState({});
  useEffect(() => {
    (token ? getPreferences(token) : getMyPreferences()).then(setPrefs)
      .catch((e) => (e?.status === 503 ? setPrefs({ available: false }) : setState({ problem: activationError(e, "Your preferences couldn't be loaded.") })));
  }, [token]);
  async function change(on) {
    setState({ busy: true });
    try { setPrefs(await (token ? savePreferences(token, on) : saveMyPreferences(on))); setState({ saved: true }); }
    catch (e) { setState({ problem: activationError(e, "That couldn't be saved. Please try again.") }); }
  }
  if (!prefs) return state.problem ? <p role="alert" className="text-sm font-medium text-rose-600">{state.problem}</p> : <p role="status" className="text-sm text-slate-500">Loading…</p>;
  if (prefs.available === false) return quietWhenUnavailable ? null : <p className="text-sm text-slate-500">Email tips aren't available yet.</p>;
  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Getting-started guides and product tips</p>
          <p className="mt-0.5 text-[13px] text-slate-500">Occasional emails about using EnterprateAI: at most a couple a month once you're set up. Never your business information.</p>
        </div>
        <Switch label="Getting-started guides and product tips" checked={Boolean(prefs.product_tips)} disabled={state.busy || !prefs.can_resubscribe} onChange={change} />
      </div>
      {prefs.last_changed_at && <p className="mt-2 text-[12px] text-slate-500">Last changed {day(prefs.last_changed_at)}{prefs.last_changed_from ? ` · from ${prefs.last_changed_from}` : ""}</p>}
      {!prefs.can_resubscribe && <p className="mt-2 text-[13px] text-amber-700 dark:text-amber-300">Emails to this address were stopped because one couldn't be delivered or was reported. Contact support to switch them back on.</p>}
      {state.problem && <p role="alert" className="mt-2 text-[13px] font-medium text-rose-600">{state.problem}</p>}
      <p role="status" className="mt-1 min-h-[1rem] text-[12px] text-slate-500">{state.busy ? "Saving…" : state.saved ? (prefs.product_tips ? "Saved. You'll receive tips." : "Saved. You won't receive tips.") : ""}</p>
    </div>
  );
}

/** Asked once after a first sign-in with Google, which skips the sign-up form's tick box. Unticked
 *  to begin with: a tick is consent; closing it, or continuing without one, is not, and it isn't asked again. */
export function TipsPrompt() {
  const token = useAuthStore((s) => s.token);
  const [prefs, setPrefs] = useState(null);
  const [ticked, setTicked] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!token) { setPrefs(null); return; }
    getMyPreferences().then(setPrefs).catch(() => setPrefs(null));      // never an error for something optional
  }, [token]);
  if (!token || !prefs?.available || !prefs.ask_once) return null;
  async function answer(on) {
    setBusy(true);
    try { await answerTipsPrompt(on); } catch { /* asked again another time */ }
    setPrefs({ ...prefs, ask_once: false });
  }
  return (
    <aside role="dialog" aria-label="Email tips" className="fixed bottom-4 right-4 z-40 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-slate-200 bg-white p-4 shadow-lg dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Would you like tips by email?</p>
        <button type="button" aria-label="Dismiss" disabled={busy} onClick={() => answer(false)} className="-mr-1 -mt-1 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </div>
      <label className="mt-2 flex items-start gap-2 text-[13px] text-slate-600 dark:text-slate-300">
        <input type="checkbox" className="mt-0.5" checked={ticked} onChange={(e) => setTicked(e.target.checked)} />
        <span>{prefs.wording || "Send me getting-started guides and product tips by email. Optional; you can unsubscribe at any time."}</span>
      </label>
      <div className="mt-3 flex justify-end">
        <button type="button" disabled={busy} onClick={() => answer(ticked)} className="rounded-xl bg-brand-600 px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-brand-700 disabled:bg-slate-300">{ticked ? "Save" : "No thanks"}</button>
      </div>
    </aside>
  );
}

export default function EmailPreferencesPage() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  return (
    <Frame title="Email preferences">
      <div className="mt-4">{token ? <TipsSwitch token={token} /> : <p role="alert" className="text-sm text-slate-600 dark:text-slate-300">Open this page from the link in one of our emails, or change this under Account when you're signed in.</p>}</div>
    </Frame>
  );
}
