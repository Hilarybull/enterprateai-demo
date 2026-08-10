import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/auth";
import { useWorkspaceStore } from "../store/workspace";
import { apiRequest } from "../api/client";

function initialsFromName(name, email) {
  const source = name?.trim() || email || "";
  const parts = source.split(/[\s.\-_@]+/).filter(Boolean);
  const first = (parts[0] || "")[0] || "";
  const second = (parts[1] || "")[0] || "";
  return (first + second).toUpperCase() || "?";
}

/* ── primitives ── */

function Card({ children, className = "" }) {
  return (
    <div className={`flex flex-col rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 ${className}`}>
      {children}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</label>
      {children}
    </div>
  );
}

function Input({ ...props }) {
  return (
    <input
      className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none ring-brand-200 placeholder:text-slate-400 focus:ring-2 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 dark:disabled:bg-slate-800/50 dark:disabled:text-slate-500"
      {...props}
    />
  );
}

function SubmitButton({ loading, children }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60 transition"
    >
      {loading ? "Saving…" : children}
    </button>
  );
}

function Alert({ type, message }) {
  if (!message) return null;
  const styles =
    type === "error"
      ? "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-800"
      : "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800";
  return (
    <p className={`rounded-xl border px-4 py-2.5 text-sm ${styles}`}>{message}</p>
  );
}

function SectionLabel({ children }) {
  return (
    <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">
      {children}
    </div>
  );
}

function DetailItem({ label, value }) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</div>
      <div className="mt-0.5 text-[13px] text-slate-700 dark:text-slate-200 leading-snug">{value}</div>
    </div>
  );
}

function ExternalLink({ href, label }) {
  if (!href) return null;
  const url = href.startsWith("http") ? href : `https://${href}`;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      className="text-[13px] text-brand-600 underline-offset-2 hover:underline dark:text-brand-400">
      {label || href.replace(/^https?:\/\/(www\.)?/, "")}
    </a>
  );
}

function Pill({ children }) {
  return (
    <span className="inline-block rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
      {children}
    </span>
  );
}

function CompanyAvatar({ logo, name, size = "lg" }) {
  const sizeClass = size === "lg" ? "h-16 w-16 text-xl" : "h-10 w-10 text-base";
  if (logo) {
    return (
      <div className={`${sizeClass} shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5 dark:border-slate-700 dark:bg-slate-800`}>
        <img src={logo} alt={name} className="h-full w-full object-contain" />
      </div>
    );
  }
  return (
    <div className={`${sizeClass} shrink-0 flex items-center justify-center rounded-2xl bg-brand-50 dark:bg-brand-900/30`}>
      <span className="font-bold text-brand-600 dark:text-brand-400">{(name || "?")[0].toUpperCase()}</span>
    </div>
  );
}

/* ── tabs ── */

const TABS = [
  { id: "account", label: "Account" },
  { id: "workspace", label: "Workspace" },
];

function TabBar({ active, onChange }) {
  return (
    <div className="flex gap-1 border-b border-slate-200 dark:border-slate-800">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={`relative px-4 py-2.5 text-sm font-medium transition-colors ${
            active === t.id
              ? "text-slate-900 dark:text-slate-100"
              : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
          }`}
        >
          {t.label}
          {active === t.id && (
            <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-brand-600 dark:bg-brand-400" />
          )}
        </button>
      ))}
    </div>
  );
}

/* ── workspace tab ── */

const STAGE_LABELS = { idea: "Idea stage", pre_revenue: "Pre-revenue", early_revenue: "Early revenue", growing: "Growing", established: "Established" };
const DELIVERY_LABELS = { manual: "Manual / service-led", hybrid: "Hybrid", automated: "Automated" };

function WorkspaceTab({ workspaceId }) {
  const navigate = useNavigate();
  const [ws, setWs] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!workspaceId) { setLoading(false); return; }
    let alive = true;
    apiRequest(`/validation/${workspaceId}`, "GET", undefined, { timeoutMs: 15000 })
      .then((data) => { if (alive) { setWs(data?.data || null); setLoading(false); } })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [workspaceId]);

  const p = ws?.workspace_profile || {};
  const b = ws?.business_profile || {};
  const companyName = p.company_name || b.business_name || "";
  const logo = p.logo_data_url || null;
  const tagline = p.tagline || "";
  const about = p.about_company || b.about || "";
  const industry = (p.primary_industry || b.primary_industry || "").replace(/_/g, " ");
  const bizType = (p.business_type || "").replace(/_/g, " ");
  const stage = STAGE_LABELS[p.operating_stage] || (p.operating_stage || "").replace(/_/g, " ");
  const delivery = DELIVERY_LABELS[p.delivery_model] || (p.delivery_model || "").replace(/_/g, " ");
  const locationStr = [p.city, p.country].filter(Boolean).join(", ");
  const contactEmail = p.email || b.email || "";
  const phone = p.phone_number || "";
  const website = p.website || b.website || "";
  const linkedin = p.linkedin_url || "";
  const twitter = p.twitter_url || "";
  const instagram = p.instagram_url || "";
  const services = (Array.isArray(p.services) ? p.services : []).filter((s) => s.service_name || typeof s === "string");
  const targetCustomer = (p.target_customer_type || "").replace(/_/g, " ");
  const revenueModel = (p.primary_revenue_model || "").replace(/_/g, " ");
  const keyOffering = p.key_offering_focus || "";
  const vision = p.vision || "";
  const mission = p.mission || "";
  const coreValues = Array.isArray(p.core_values)
    ? p.core_values.filter(Boolean)
    : (typeof p.core_values === "string" && p.core_values ? [p.core_values] : []);
  const companySize = (p.company_size || "").replace(/_/g, " ");
  const yearEstablished = p.year_established ? String(p.year_established) : "";
  const hasContact = contactEmail || phone || website || linkedin || twitter || instagram;
  const hasVMV = vision || mission || coreValues.length > 0;
  const hasOps = delivery || revenueModel || targetCustomer || keyOffering || companySize;

  if (!workspaceId) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">No workspace set up yet.</p>
        <button
          type="button"
          onClick={() => navigate("/validation?from=module&return=%2Faccount")}
          className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 transition"
        >
          Set up workspace
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="grid grid-cols-3 gap-4 pt-2">
        {[...Array(9)].map((_, i) => (
          <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
        ))}
      </div>
    );
  }

  if (!companyName) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">Workspace profile not filled in yet.</p>
        <button
          type="button"
          onClick={() => navigate("/validation?from=module&return=%2Faccount")}
          className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 transition"
        >
          Fill in workspace profile
        </button>
      </div>
    );
  }

  return (
    <Card className="overflow-hidden">
      {/* Company banner */}
      <div className="bg-slate-50 px-6 py-5 dark:bg-slate-800/40 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4 min-w-0">
            <CompanyAvatar logo={logo} name={companyName} size="lg" />
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 leading-tight">{companyName}</h3>
              {tagline && <p className="mt-0.5 text-sm italic text-slate-500 dark:text-slate-400">{tagline}</p>}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {industry && <Pill>{industry}</Pill>}
                {bizType && <Pill>{bizType}</Pill>}
                {stage && <Pill>{stage}</Pill>}
                {locationStr && <Pill>📍 {locationStr}</Pill>}
                {yearEstablished && <Pill>Est. {yearEstablished}</Pill>}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => navigate("/validation?from=module&return=%2Faccount")}
            className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            Edit workspace
          </button>
        </div>
      </div>

      {/* Two-column body */}
      <div className="grid grid-cols-1 divide-y divide-slate-100 dark:divide-slate-800 md:grid-cols-2 md:divide-x md:divide-y-0">

        {/* Left */}
        <div className="px-6 py-5 space-y-5">
          {about && (
            <div>
              <SectionLabel>About</SectionLabel>
              <p className="text-[13px] leading-relaxed text-slate-600 dark:text-slate-400">{about}</p>
            </div>
          )}

          {services.length > 0 && (
            <div>
              <SectionLabel>Services</SectionLabel>
              <div className="flex flex-wrap gap-1.5">
                {services.map((s, i) => (
                  <Pill key={i}>{s.service_name || s}</Pill>
                ))}
              </div>
            </div>
          )}

          {hasOps && (
            <div>
              <SectionLabel>Operations</SectionLabel>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                <DetailItem label="Delivery" value={delivery} />
                <DetailItem label="Revenue model" value={revenueModel} />
                <DetailItem label="Target customer" value={targetCustomer} />
                <DetailItem label="Key offering" value={keyOffering} />
                {companySize && <DetailItem label="Company size" value={companySize} />}
              </dl>
            </div>
          )}
        </div>

        {/* Right */}
        <div className="px-6 py-5 space-y-5">
          {hasVMV && (
            <div>
              <SectionLabel>Vision · Mission · Values</SectionLabel>
              <div className="space-y-3">
                {vision && (
                  <div className="rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-800/50">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1">Vision</div>
                    <p className="text-[13px] text-slate-700 dark:text-slate-200 leading-relaxed">{vision}</p>
                  </div>
                )}
                {mission && (
                  <div className="rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-800/50">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1">Mission</div>
                    <p className="text-[13px] text-slate-700 dark:text-slate-200 leading-relaxed">{mission}</p>
                  </div>
                )}
                {coreValues.length > 0 && (
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1.5">Core values</div>
                    <div className="flex flex-wrap gap-1.5">
                      {coreValues.map((v, i) => <Pill key={i}>{v}</Pill>)}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {hasContact && (
            <div>
              <SectionLabel>Contact & links</SectionLabel>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                <DetailItem label="Email" value={contactEmail} />
                <DetailItem label="Phone" value={phone} />
                {website && (
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Website</div>
                    <div className="mt-0.5"><ExternalLink href={website} /></div>
                  </div>
                )}
                {linkedin && (
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">LinkedIn</div>
                    <div className="mt-0.5"><ExternalLink href={linkedin} label="View profile" /></div>
                  </div>
                )}
                {twitter && (
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">X / Twitter</div>
                    <div className="mt-0.5"><ExternalLink href={twitter} label="View profile" /></div>
                  </div>
                )}
                {instagram && (
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Instagram</div>
                    <div className="mt-0.5"><ExternalLink href={instagram} label="View profile" /></div>
                  </div>
                )}
              </dl>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

/* ── main page ── */

export default function AccountPage() {
  const email = useAuthStore((s) => s.email);
  const name = useAuthStore((s) => s.name);
  const picture = useAuthStore((s) => s.picture);
  const authProvider = useAuthStore((s) => s.authProvider);
  const hasPassword = useAuthStore((s) => s.hasPassword);
  const setProfile = useAuthStore((s) => s.setProfile);
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);

  const [tab, setTab] = useState("account");
  const [displayName, setDisplayName] = useState(name || "");
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileMsg, setProfileMsg] = useState(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState(null);

  const initials = initialsFromName(name, email);
  const isGoogleOnly = !hasPassword;

  async function handleProfileSave(e) {
    e.preventDefault();
    setProfileLoading(true);
    setProfileMsg(null);
    try {
      const updated = await apiRequest("/auth/me", "PATCH", { name: displayName || null });
      setProfile({ name: updated.name ?? null, picture: updated.picture ?? null, authProvider: updated.auth_provider ?? null, hasPassword: updated.has_password ?? false });
      setProfileMsg({ type: "success", text: "Profile updated." });
    } catch (err) {
      setProfileMsg({ type: "error", text: err?.message || "Failed to update profile." });
    } finally {
      setProfileLoading(false);
    }
  }

  async function handlePasswordSave(e) {
    e.preventDefault();
    setPasswordMsg(null);
    if (newPassword !== confirmPassword) {
      setPasswordMsg({ type: "error", text: "New passwords do not match." });
      return;
    }
    if (newPassword.length < 8) {
      setPasswordMsg({ type: "error", text: "New password must be at least 8 characters." });
      return;
    }
    setPasswordLoading(true);
    try {
      await apiRequest("/auth/me/password", "POST", {
        current_password: currentPassword,
        new_password: newPassword,
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordMsg({ type: "success", text: "Password changed successfully." });
    } catch (err) {
      const msg = err?.message || "";
      setPasswordMsg({
        type: "error",
        text: msg.includes("incorrect") ? "Current password is incorrect." : msg || "Failed to change password.",
      });
    } finally {
      setPasswordLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl pb-12">

      <div className="mb-5">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Account settings</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Manage your personal details, security, and workspace.</p>
      </div>

      <TabBar active={tab} onChange={setTab} />

      <div className="mt-6">

        {/* ── Account tab ── */}
        {tab === "account" && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-stretch">

            {/* Profile card */}
            <Card>
              <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Profile</h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Your name and email address.</p>
              </div>

              {/* Avatar section */}
              <div className="px-6 pt-6 pb-5 flex flex-col items-center text-center border-b border-slate-100 dark:border-slate-800">
                {picture ? (
                  <img src={picture} alt={name || email} className="h-16 w-16 rounded-full object-cover ring-4 ring-white shadow dark:ring-slate-700" />
                ) : (
                  <div className="h-16 w-16 flex items-center justify-center rounded-full bg-brand-600 text-xl font-bold text-white shadow">
                    {initials}
                  </div>
                )}
                <div className="mt-3">
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {name || <span className="italic text-slate-400">No display name</span>}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{email}</div>
                  {authProvider === "google" && (
                    <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[10px] font-semibold text-slate-600 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700">
                      <svg className="h-3 w-3" viewBox="0 0 24 24">
                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                      </svg>
                      Google account
                    </span>
                  )}
                </div>
              </div>

              {/* Form — flex-1 + flex-col so button is pinned to bottom */}
              <div className="flex-1 px-6 py-5 flex flex-col">
                <form onSubmit={handleProfileSave} className="flex flex-col flex-1">
                  <div className="space-y-4">
                    <Field label="Display name">
                      <Input
                        type="text"
                        placeholder="Your full name"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        maxLength={100}
                      />
                    </Field>
                    <Field label="Email address">
                      <Input type="email" value={email || ""} disabled />
                      <p className="text-[11px] text-slate-400 dark:text-slate-500">Email cannot be changed.</p>
                    </Field>
                  </div>
                  <div className="mt-auto pt-5 space-y-3">
                    <Alert type={profileMsg?.type} message={profileMsg?.text} />
                    <SubmitButton loading={profileLoading}>Save profile</SubmitButton>
                  </div>
                </form>
              </div>
            </Card>

            {/* Password card */}
            <Card>
              <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Password</h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {isGoogleOnly ? "No password set on this account." : "Update your login password."}
                </p>
              </div>

              {/* Security status — mirrors the avatar section for equal visual weight */}
              <div className="px-6 pt-6 pb-5 flex flex-col items-center text-center border-b border-slate-100 dark:border-slate-800">
                <div className={`h-16 w-16 flex items-center justify-center rounded-full shadow ${isGoogleOnly ? "bg-slate-100 dark:bg-slate-800" : "bg-emerald-50 dark:bg-emerald-900/20"}`}>
                  {isGoogleOnly ? (
                    <svg className="h-7 w-7 text-slate-400" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/>
                    </svg>
                  ) : (
                    <svg className="h-7 w-7 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                      <rect x="3" y="11" width="18" height="11" rx="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  )}
                </div>
                <div className="mt-3">
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {isGoogleOnly ? "No password" : "Password set"}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {isGoogleOnly ? "Signed in via Google SSO" : "Email & password login active"}
                  </div>
                  {isGoogleOnly && (
                    <Link
                      to={`/forgot-password?setup=1${email ? `&email=${encodeURIComponent(email)}` : ""}`}
                      className="mt-2 inline-block text-[11px] font-semibold text-brand-600 hover:underline dark:text-brand-400"
                    >
                      Set a password →
                    </Link>
                  )}
                </div>
              </div>

              {/* Form */}
              <div className="flex-1 px-6 py-5">
                {isGoogleOnly ? (
                  <p className="text-[13px] text-slate-500 dark:text-slate-400 leading-relaxed">
                    Adding a password lets you sign in with your email and password in addition to Google. Click <strong className="font-semibold text-slate-700 dark:text-slate-300">Set a password</strong> above to get started.
                  </p>
                ) : (
                  <form onSubmit={handlePasswordSave} className="space-y-4">
                    <Field label="Current password">
                      <Input
                        type="password"
                        placeholder="Enter current password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        required
                      />
                      <Link
                        to={`/forgot-password${email ? `?email=${encodeURIComponent(email)}` : ""}`}
                        className="self-start text-[11px] font-semibold text-brand-600 hover:underline dark:text-brand-400"
                      >
                        Forgot password?
                      </Link>
                    </Field>
                    <Field label="New password">
                      <Input
                        type="password"
                        placeholder="At least 8 characters"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        required
                      />
                    </Field>
                    <Field label="Confirm new password">
                      <Input
                        type="password"
                        placeholder="Repeat new password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        required
                      />
                    </Field>
                    <Alert type={passwordMsg?.type} message={passwordMsg?.text} />
                    <SubmitButton loading={passwordLoading}>Change password</SubmitButton>
                  </form>
                )}
              </div>
            </Card>

          </div>
        )}

        {/* ── Workspace tab ── */}
        {tab === "workspace" && (
          <WorkspaceTab workspaceId={workspaceId} />
        )}

      </div>
    </div>
  );
}
