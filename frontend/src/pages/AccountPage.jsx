import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuthStore } from "../store/auth";
import { apiRequest } from "../api/client";

function initialsFromName(name, email) {
  const source = name?.trim() || email || "";
  const parts = source.split(/[\s.\-_@]+/).filter(Boolean);
  const first = (parts[0] || "")[0] || "";
  const second = (parts[1] || "")[0] || "";
  return (first + second).toUpperCase() || "?";
}

function Card({ children, className = "" }) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 ${className}`}>
      {children}
    </div>
  );
}

function CardHeader({ title, description }) {
  return (
    <div className="border-b border-slate-100 px-6 py-4 dark:border-slate-800">
      <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
      {description && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{description}</p>}
    </div>
  );
}

function CardBody({ children }) {
  return <div className="px-6 py-5">{children}</div>;
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


export default function AccountPage() {
  const email = useAuthStore((s) => s.email);
  const name = useAuthStore((s) => s.name);
  const picture = useAuthStore((s) => s.picture);
  const authProvider = useAuthStore((s) => s.authProvider);
  const hasPassword = useAuthStore((s) => s.hasPassword);
  const setProfile = useAuthStore((s) => s.setProfile);

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
    <div className="mx-auto max-w-4xl space-y-6">

      {/* Page header */}
      <div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Account settings</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Manage your personal details and security.</p>
      </div>

      {/* Two-column on lg+, stacked on smaller screens */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">

        {/* ── Profile card ── */}
        <Card>
          <CardHeader title="Profile" description="Your name and email address." />
          <CardBody>
            {/* Avatar row */}
            <div className="mb-6 flex items-center gap-4 rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-800/50">
              {picture ? (
                <img
                  src={picture}
                  alt={name || email}
                  className="h-12 w-12 rounded-full object-cover ring-2 ring-white dark:ring-slate-700"
                />
              ) : (
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-600 text-base font-bold text-white">
                  {initials}
                </div>
              )}
              <div className="min-w-0">
                {name ? (
                  <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{name}</div>
                ) : (
                  <div className="text-sm italic text-slate-400 dark:text-slate-500">No display name set</div>
                )}
                <div className="truncate text-xs text-slate-500 dark:text-slate-400">{email}</div>
                {authProvider === "google" && (
                  <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600 ring-1 ring-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:ring-slate-600">
                    <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="currentColor">
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

            <form onSubmit={handleProfileSave} className="space-y-4">
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
              <Alert type={profileMsg?.type} message={profileMsg?.text} />
              <SubmitButton loading={profileLoading}>Save profile</SubmitButton>
            </form>
          </CardBody>
        </Card>

        {/* ── Password card ── */}
        <Card>
          <CardHeader
            title="Password"
            description={isGoogleOnly ? "No password set on this account." : "Update your login password."}
          />
          <CardBody>
            {isGoogleOnly ? (
              <div className="flex flex-col items-center gap-3 py-6 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
                  <svg className="h-5 w-5 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                </div>
                <p className="max-w-xs text-sm text-slate-500 dark:text-slate-400">
                  No password is set on this account. You can create one so you can also sign in with email and password.
                </p>
                <Link
                  to={`/forgot-password?setup=1${email ? `&email=${encodeURIComponent(email)}` : ""}`}
                  className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-100 transition dark:border-slate-700 dark:bg-slate-800 dark:text-brand-400 dark:hover:bg-slate-700"
                >
                  Set a password
                </Link>
              </div>
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
          </CardBody>
        </Card>

      </div>
    </div>
  );
}
