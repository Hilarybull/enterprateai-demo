import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { apiRequest, getApiBaseUrl } from "../api/client";
import { planLabel } from "../lib/plans";
import { useAuthStore } from "../store/auth";
import { Switch, TipsSwitch } from "./EmailPreferencesPage";

// Account settings, in the dashboard's design: a header, a section list on the left and one
// section at a time in a column up to 880px. On a phone the list is the page, and each section
// opens from it with a way back. Sections about the person come first, then the business.

export const SECTIONS = [
  { group: "You", items: [["profile", "Profile"], ["security", "Sign-in & security"], ["email", "Email preferences"], ["privacy", "Privacy & cookies"]] },
  { group: "Business", items: [["workspace", "Workspace"], ["team", "Team"], ["plan", "Plan & credits"]] },
];
const KEYS = SECTIONS.flatMap((g) => g.items.map(([k]) => k));

const card = "rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900";
const title = "text-[15px] font-semibold text-slate-900 dark:text-slate-100";
const sub = "mt-0.5 text-[13px] text-slate-500 dark:text-slate-400";
const input = "mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50 disabled:text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";
const label = "block text-[13px] font-semibold text-slate-700 dark:text-slate-200";
const primary = "rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300";
const outline = "rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200";
const chip = "inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-semibold";
const words = (e, fallback) => { const d = e?.data?.detail; return (typeof d === "string" ? d : d?.message) || fallback; };

function Section({ heading, description, children, tone = "" }) {
  return (
    <section className={`${card} ${tone}`}>
      <h2 className={title}>{heading}</h2>
      {description && <p className={sub}>{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function initialsOf(name, email) {
  const src = (name || email || "?").trim();
  const parts = src.split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "?";
}

/** A chosen image, made small enough to keep as the profile photo. */
function shrink(file, size = 256) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, size / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => reject(new Error("That file isn't an image we can use."));
    img.src = URL.createObjectURL(file);
  });
}

// ── Profile ───────────────────────────────────────────────────────────────────

export function ProfileSection() {
  const { email, name, picture, authProvider, hasPassword } = useAuthStore();
  const setProfile = useAuthStore((s) => s.setProfile);
  const [display, setDisplay] = useState(name || "");
  const [state, setState] = useState({});
  const file = useRef(null);
  const changed = display.trim() !== (name || "").trim();
  const apply = (u) => setProfile({ name: u.name ?? null, picture: u.picture ?? null, authProvider: u.auth_provider ?? null, hasPassword: u.has_password ?? false });

  async function save(e) {
    e.preventDefault();
    setState({ busy: true });
    try { apply(await apiRequest("/auth/me", "PATCH", { name: display.trim() || null })); setState({ saved: "Saved" }); }
    catch (err) { setState({ problem: words(err, "Your profile couldn't be saved. Please try again.") }); }
  }
  async function photo(chosen) {
    setState({ busy: true });
    try { apply(await apiRequest("/auth/me", "PATCH", { picture: chosen ? await shrink(chosen) : "" })); setState({ saved: chosen ? "Photo updated" : "Photo removed" }); }
    catch (err) { setState({ problem: words(err, err?.message || "That photo couldn't be saved.") }); }
  }
  return (
    <Section heading="Profile" description="How you appear in EnterprateAI.">
      <div className="flex flex-wrap items-center gap-4">
        {picture ? <img src={picture} alt="" className="h-16 w-16 rounded-full object-cover ring-1 ring-slate-200 dark:ring-slate-700" />
          : <span aria-hidden="true" className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-50 text-xl font-bold text-brand-700 dark:bg-brand-900/40 dark:text-brand-200">{initialsOf(name, email)}</span>}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={outline} disabled={state.busy} onClick={() => file.current?.click()}>Change photo</button>
            {picture && <button type="button" className="text-[13px] font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200" disabled={state.busy} onClick={() => photo(null)}>Remove</button>}
            <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label="Choose a profile photo" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) photo(f); }} />
          </div>
          <p className="mt-1.5"><span className={`${chip} bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200`}>{authProvider === "google" ? "Signed in with Google" : "Email and password"}{authProvider === "google" && hasPassword ? " · password set" : ""}</span></p>
        </div>
      </div>
      <form onSubmit={save} className="mt-5 grid gap-4 sm:grid-cols-2" aria-label="Profile">
        <label className={label}>Display name<input className={input} value={display} maxLength={100} onChange={(e) => { setDisplay(e.target.value); setState({}); }} /></label>
        <label className={label}>Email address<input className={input} value={email || ""} disabled readOnly /></label>
        <div className="flex items-center gap-3 sm:col-span-2">
          <button type="submit" className={primary} disabled={!changed || state.busy}>{state.busy ? "Saving…" : "Save changes"}</button>
          {state.saved && <span role="status" className="text-[13px] font-medium text-emerald-700 dark:text-emerald-400">{state.saved}</span>}
          {state.problem && <span role="alert" className="text-[13px] font-medium text-rose-600">{state.problem}</span>}
        </div>
      </form>
    </Section>
  );
}

// ── Sign-in & security ────────────────────────────────────────────────────────

export function SecuritySection() {
  const { email, authProvider, hasPassword } = useAuthStore();
  const navigate = useNavigate();
  const [step, setStep] = useState(null);          // null | "request" | "otp" | "form"
  const [otp, setOtp] = useState("");
  const [pw, setPw] = useState({ next: "", again: "" });
  const [state, setState] = useState({});
  const [devices, setDevices] = useState({});

  async function sendCode() {
    setState({ busy: true });
    try { await apiRequest("/auth/me/send-password-otp", "POST"); setStep("otp"); setState({ note: `We sent a 6-digit code to ${email}.` }); }
    catch (e) { setState({ problem: words(e, "The code couldn't be sent. Please try again.") }); }
  }
  async function savePassword(e) {
    e.preventDefault();
    if (pw.next !== pw.again) return setState({ problem: "The two passwords don't match." });
    if (pw.next.length < 8) return setState({ problem: "Use at least 8 characters." });
    setState({ busy: true });
    try {
      await apiRequest("/auth/me/change-password-otp", "POST", { otp_code: otp, new_password: pw.next });
      setOtp(""); setPw({ next: "", again: "" }); setStep(null); setState({ note: "Password updated." });
    } catch (err) { setState({ problem: words(err, "Your password couldn't be updated.") }); }
    return undefined;
  }
  async function signOutOthers() {
    setDevices({ busy: true });
    try {
      const r = await apiRequest("/auth/me/sign-out-others", "POST", {});
      localStorage.setItem("ea_token", r.access_token);      // this device carries on with a fresh sign-in
      useAuthStore.setState({ token: r.access_token });
      setDevices({ done: "Signed out everywhere else. This device stays signed in." });
    } catch (e) { setDevices({ problem: e?.status === 503 ? "This isn't available on this server yet." : words(e, "That didn't work. Please try again.") }); }
  }
  return (
    <div className="space-y-6">
      <Section heading="How you sign in">
        <dl className="grid gap-3 sm:grid-cols-2">
          <div><dt className="text-[13px] font-semibold text-slate-700 dark:text-slate-200">Google</dt>
            <dd className="mt-1"><span className={`${chip} ${authProvider === "google" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`}>{authProvider === "google" ? "Connected" : "Not connected"}</span></dd></div>
          <div><dt className="text-[13px] font-semibold text-slate-700 dark:text-slate-200">Password</dt>
            <dd className="mt-1"><span className={`${chip} ${hasPassword ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`}>{hasPassword ? "Set" : "Not set"}</span></dd></div>
        </dl>
        <div className="mt-4">
          {!step && !hasPassword && <button type="button" className={outline} onClick={() => navigate(`/forgot-password?setup=1${email ? `&email=${encodeURIComponent(email)}` : ""}`)}>Set a password</button>}
          {!step && hasPassword && <button type="button" className={outline} onClick={() => { setStep("request"); setState({}); }}>Change password</button>}
          {step === "request" && (
            <div className="space-y-3">
              <p className="text-[13px] text-slate-600 dark:text-slate-300">We'll send a 6-digit code to {email} before you can change your password.</p>
              <div className="flex flex-wrap gap-2"><button type="button" className={primary} disabled={state.busy} onClick={sendCode}>{state.busy ? "Sending…" : "Send the code"}</button>
                <button type="button" className={outline} onClick={() => { setStep(null); setState({}); }}>Cancel</button></div>
            </div>
          )}
          {step === "otp" && (
            <div className="max-w-xs space-y-3">
              <label className={label}>Code from your email<input className={`${input} tracking-[0.4em]`} inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))} /></label>
              <div className="flex flex-wrap gap-2"><button type="button" className={primary} disabled={otp.length !== 6} onClick={() => { setStep("form"); setState({}); }}>Continue</button>
                <button type="button" className={outline} disabled={state.busy} onClick={sendCode}>Send a new code</button></div>
            </div>
          )}
          {step === "form" && (
            <form onSubmit={savePassword} className="grid max-w-md gap-3" aria-label="Change password">
              <label className={label}>New password<input type="password" className={input} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} placeholder="At least 8 characters" required /></label>
              <label className={label}>Confirm new password<input type="password" className={input} value={pw.again} onChange={(e) => setPw({ ...pw, again: e.target.value })} required /></label>
              <div><button type="submit" className={primary} disabled={state.busy}>{state.busy ? "Saving…" : "Update password"}</button></div>
            </form>
          )}
          {state.note && <p role="status" className="mt-3 text-[13px] font-medium text-emerald-700 dark:text-emerald-400">{state.note}</p>}
          {state.problem && <p role="alert" className="mt-3 text-[13px] font-medium text-rose-600">{state.problem}</p>}
        </div>
      </Section>
      <Section heading="Other devices" description="If you signed in somewhere you no longer use, or think someone else has access, sign out everywhere except here.">
        <button type="button" className={outline} disabled={devices.busy} onClick={signOutOthers}>{devices.busy ? "Signing out…" : "Sign out of other devices"}</button>
        {devices.done && <p role="status" className="mt-3 text-[13px] font-medium text-emerald-700 dark:text-emerald-400">{devices.done}</p>}
        {devices.problem && <p role="alert" className="mt-3 text-[13px] font-medium text-rose-600">{devices.problem}</p>}
      </Section>
    </div>
  );
}

// ── Email preferences ─────────────────────────────────────────────────────────

export function EmailSection() {
  return (
    <Section heading="Email preferences" description="What we may send you.">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Account messages: always on</p>
          <p className="mt-0.5 text-[13px] text-slate-500">Password resets, verification codes, receipts and messages about documents you send or receive. You need these to use your account, so they can't be switched off.</p>
        </div>
        <Switch label="Account messages" checked disabled onChange={() => {}} />
      </div>
      <div className="mt-5 border-t border-slate-100 pt-5 dark:border-slate-800"><TipsSwitch /></div>
    </Section>
  );
}

// ── Privacy & cookies ─────────────────────────────────────────────────────────

export function PrivacySection() {
  const email = useAuthStore((s) => s.email);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const consent = (() => { try { return localStorage.getItem("ea_cookie_consent"); } catch { return null; } })();
  const [data, setData] = useState({});
  const [typed, setTyped] = useState("");
  const [del, setDel] = useState({});

  async function download() {
    setData({ busy: true });
    try {
      const res = await fetch(`${getApiBaseUrl()}/auth/me/export`, { headers: { Authorization: `Bearer ${localStorage.getItem("ea_token") || ""}` } });
      if (!res.ok) throw new Error("failed");
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = "enterprateai-my-data.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setData({ done: "Your data has been downloaded." });
    } catch { setData({ problem: "Your data couldn't be downloaded. Please try again." }); }
  }
  async function remove(e) {
    e.preventDefault();
    setDel({ busy: true });
    try { await apiRequest("/auth/me/delete", "POST", { confirm: typed }); logout(); navigate("/", { replace: true }); }
    catch (err) { setDel({ problem: words(err, "Your account couldn't be deleted. Nothing was changed.") }); }
  }
  const matches = typed.trim().toLowerCase() === String(email || "").toLowerCase() && Boolean(email);
  return (
    <div className="space-y-6">
      <Section heading="Cookies">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-700 dark:text-slate-200">Cookie consent{" "}
            <span className={`${chip} ml-1 ${consent ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`}>{consent ? "Given" : "Not given yet"}</span></p>
          <button type="button" className={outline} onClick={() => { try { localStorage.removeItem("ea_cookie_consent"); } catch { /* asked again anyway */ } window.location.reload(); }}>Change</button>
        </div>
        <p className="mt-2 text-[13px] text-slate-500">Choosing Change asks you again, so you can accept or refuse.</p>
      </Section>
      <Section heading="Your data" description="A copy of your account details and the businesses you own, as one file.">
        <button type="button" className={outline} disabled={data.busy} onClick={download}>{data.busy ? "Preparing…" : "Download my data"}</button>
        {data.done && <p role="status" className="mt-3 text-[13px] font-medium text-emerald-700 dark:text-emerald-400">{data.done}</p>}
        {data.problem && <p role="alert" className="mt-3 text-[13px] font-medium text-rose-600">{data.problem}</p>}
      </Section>
      <Section heading="Delete account" tone="!border-rose-200 dark:!border-rose-900" description="This closes your account and removes the businesses you own, with their records. It can't be undone.">
        <form onSubmit={remove} className="max-w-md space-y-3" aria-label="Delete account">
          <label className={label}>Type your email address to confirm<input className={input} value={typed} onChange={(e) => { setTyped(e.target.value); setDel({}); }} placeholder={email || ""} autoComplete="off" /></label>
          <button type="submit" disabled={!matches || del.busy} className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:bg-slate-300">{del.busy ? "Deleting…" : "Delete my account"}</button>
          {del.problem && <p role="alert" className="text-[13px] font-medium text-rose-600">{del.problem}</p>}
        </form>
      </Section>
    </div>
  );
}

// ── Plan & credits ────────────────────────────────────────────────────────────

export function PlanSection() {
  const subscription = useAuthStore((s) => s.subscription) || {};
  const info = useAuthStore((s) => s.creditInfo);
  const setCreditInfo = useAuthStore((s) => s.setCreditInfo);
  const navigate = useNavigate();
  useEffect(() => { if (!info) apiRequest("/credits/balance", "GET").then((d) => d && setCreditInfo(d)).catch(() => {}); }, [info, setCreditInfo]);
  const free = (subscription.plan_key || "explorer") === "explorer";
  const renews = subscription.current_period_end || subscription.renews_at || info?.next_reset_at || info?.resets_at;
  const when = renews ? new Date(renews).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : null;
  return (
    <Section heading="Plan & credits">
      <dl className="grid gap-4 sm:grid-cols-3">
        <div><dt className="text-[13px] text-slate-500">Current plan</dt><dd className="mt-1 text-lg font-bold text-slate-900 dark:text-slate-100">{planLabel(subscription.plan_key, subscription.status)}</dd></div>
        <div><dt className="text-[13px] text-slate-500">AI credits remaining</dt><dd className="mt-1 text-lg font-bold tabular-nums text-slate-900 dark:text-slate-100">{typeof info?.available_credits === "number" ? info.available_credits.toLocaleString() : "—"}</dd></div>
        <div><dt className="text-[13px] text-slate-500">{free ? "Allocation" : "Renews"}</dt><dd className="mt-1 text-sm font-semibold text-slate-800 dark:text-slate-200">{free ? "Free trial allocation" : when || "See billing"}</dd></div>
      </dl>
      <div className="mt-5 flex flex-wrap gap-2">
        <button type="button" className={primary} onClick={() => navigate("/pricing")}>{free ? "Upgrade" : "Change plan"}</button>
        <button type="button" className={outline} onClick={() => navigate("/credits")}>Credit history</button>
      </div>
    </Section>
  );
}

function TeamSection() {
  return (
    <Section heading="Team" description="Invite people to your business and decide what each of them can use.">
      <Link to="/team" className={`${outline} inline-block`}>Open team settings</Link>
    </Section>
  );
}

// ── the page ──────────────────────────────────────────────────────────────────

/** `workspace` is the existing workspace profile section, passed in so this page stays about layout. */
export default function AccountSettings({ workspace }) {
  const [params, setParams] = useSearchParams();
  const asked = params.get("section") || (params.get("tab") === "workspace" ? "workspace" : null);      // ?tab=workspace is the older address for the same thing
  const open = KEYS.includes(asked) ? asked : null;      // on a phone nothing is open until a section is chosen
  const shown = open || "profile";                        // on a wider screen /account opens Profile; the business is at ?section=workspace
  const go = (key) => setParams(key ? { section: key } : {}, { replace: false });
  const name = SECTIONS.flatMap((g) => g.items).find(([k]) => k === shown)?.[1];
  return (
    <div className="mx-auto w-full max-w-[1120px] pb-12">
      <header className="mb-6">
        <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">Settings</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-[28px] dark:text-slate-100">Account <span className="text-brand-600">Settings</span></h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Your profile, how you sign in, what we email you, and your business.</p>
      </header>
      <div className="grid gap-6 md:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className={`${open ? "hidden md:block" : "block"} md:sticky md:top-6 md:self-start`}>
          {SECTIONS.map((g) => (
            <div key={g.group} className="mb-4">
              <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{g.group}</p>
              <ul className="overflow-hidden rounded-2xl border border-slate-200 bg-white md:space-y-0.5 md:rounded-none md:border-0 md:bg-transparent dark:border-slate-800 dark:bg-slate-900 md:dark:bg-transparent">
                {g.items.map(([key, text]) => (
                  <li key={key} className="border-b border-slate-100 last:border-b-0 md:border-0 dark:border-slate-800">
                    <button type="button" onClick={() => go(key)} aria-current={shown === key ? "page" : undefined}
                      className={`flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-semibold transition md:rounded-xl md:px-3 md:py-2 ${shown === key
                        ? "text-slate-800 md:bg-brand-50 md:text-brand-700 md:ring-1 md:ring-brand-100 dark:text-slate-100" : "text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"}`}>
                      {text}
                      <svg viewBox="0 0 24 24" className="h-4 w-4 text-slate-400 md:hidden" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className={`${open ? "block" : "hidden md:block"} min-w-0 max-w-[880px]`}>
          <button type="button" onClick={() => go(null)} className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:underline md:hidden">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>
            All settings
          </button>
          <h2 className="sr-only">{name}</h2>
          <div className="space-y-6">
            {shown === "profile" && <ProfileSection />}
            {shown === "security" && <SecuritySection />}
            {shown === "email" && <EmailSection />}
            {shown === "privacy" && <PrivacySection />}
            {shown === "workspace" && workspace}
            {shown === "team" && <TeamSection />}
            {shown === "plan" && <PlanSection />}
          </div>
        </div>
      </div>
    </div>
  );
}
