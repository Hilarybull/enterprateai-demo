import { useState, useEffect, useCallback } from "react";
import { apiRequest } from "../api/client";
import { describePermissions } from "../lib/permissions";
import InviteModal from "../components/InviteModal";
import { TeamIllustration } from "../components/Illustrations";

function UserIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function LinkIcon({ className = "h-4 w-4" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 6h18M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5Z" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function initialsFromEmail(email) {
  const name = (email || "").split("@")[0] || "?";
  const parts = name.split(/[.\-_]+/).filter(Boolean);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "?";
}

function StatusBadge({ status }) {
  const styles = {
    pending: "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400",
    accepted: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400",
    revoked: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${styles[status] || styles.revoked}`}>
      {status}
    </span>
  );
}

function PermissionPill({ type, permissions }) {
  const label = type === "module" ? "Module" : "Feature";
  const desc = describePermissions(type, permissions);
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-700 dark:bg-slate-800 dark:text-brand-400">
        {label}
      </span>
      <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[180px] sm:max-w-none">{desc}</span>
    </div>
  );
}

function EmptyState({ icon, title, subtitle, action, illustration }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-white text-center dark:border-slate-800 dark:bg-slate-900">
      {illustration ? (
        <div className="overflow-hidden rounded-t-2xl bg-gradient-to-br from-brand-50 via-white to-indigo-50 dark:from-slate-800 dark:via-slate-900 dark:to-slate-800">
          {illustration}
        </div>
      ) : null}
      <div className="px-6 py-8">
        {!illustration ? (
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800">
            {icon}
          </div>
        ) : null}
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">{title}</p>
        <p className="mt-1 text-xs text-slate-400">{subtitle}</p>
        {action}
      </div>
    </div>
  );
}

export default function TeamPage() {
  const [tab, setTab] = useState("members");
  const [members, setMembers] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showInvite, setShowInvite] = useState(false);
  const [editingMember, setEditingMember] = useState(null);
  const [actionLoading, setActionLoading] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [mem, inv] = await Promise.all([
        apiRequest("/workspace/members", "GET"),
        apiRequest("/workspace/invitations", "GET"),
      ]);
      setMembers(mem || []);
      setInvitations(inv || []);
    } catch (e) {
      setError(e.message || "Failed to load team data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function revoke(invId) {
    setActionLoading(invId);
    try {
      await apiRequest(`/workspace/invitations/${invId}`, "DELETE");
      setInvitations((prev) =>
        prev.map((i) => (i.id === invId ? { ...i, status: "revoked" } : i))
      );
    } catch (e) {
      alert(e.message || "Failed to revoke invitation.");
    } finally {
      setActionLoading(null);
    }
  }

  async function removeMember(memberId) {
    if (!confirm("Remove this member from the workspace?")) return;
    setActionLoading(memberId);
    try {
      await apiRequest(`/workspace/members/${memberId}`, "DELETE");
      setMembers((prev) => prev.filter((m) => m.id !== memberId));
    } catch (e) {
      alert(e.message || "Failed to remove member.");
    } finally {
      setActionLoading(null);
    }
  }

  const pendingInvites = invitations.filter((i) => i.status === "pending");
  const pastInvites = invitations.filter((i) => i.status !== "pending");

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Team & Access</h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            Manage who can access your workspace and what they can see.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowInvite(true)}
          className="flex shrink-0 items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 transition"
        >
          <PlusIcon />
          Invite member
        </button>
      </div>

      {/* Tabs */}
      <div className="flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800 w-fit">
        {[
          { value: "members", label: `Members${members.length > 0 ? ` (${members.length})` : ""}` },
          { value: "invitations", label: `Invitations${pendingInvites.length > 0 ? ` (${pendingInvites.length})` : ""}` },
        ].map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setTab(t.value)}
            className={
              "rounded-lg px-4 py-1.5 text-[13px] font-semibold transition " +
              (tab === t.value
                ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100"
                : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300")
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-brand-600" />
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-600 dark:border-rose-900/30 dark:bg-rose-950/20 dark:text-rose-400">
          {error}
        </div>
      )}

      {/* ── Members tab ── */}
      {!loading && !error && tab === "members" && (
        <>
          {members.length === 0 ? (
            <EmptyState
              illustration={<TeamIllustration />}
              title="No members yet"
              subtitle="Invite people to give them access to your workspace."
              action={
                <button
                  type="button"
                  onClick={() => setShowInvite(true)}
                  className="mt-4 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 transition"
                >
                  Invite member
                </button>
              }
            />
          ) : (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              {/* Desktop table */}
              <table className="hidden w-full text-sm sm:table">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-800">
                    <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">Member</th>
                    <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">Access</th>
                    <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">Role</th>
                    <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-400">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {members.map((m) => (
                    <tr key={m.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700 dark:bg-slate-800 dark:text-brand-400">
                            {initialsFromEmail(m.email)}
                          </span>
                          <span className="font-medium text-slate-800 dark:text-slate-200 truncate max-w-[200px]">{m.email}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <PermissionPill type={m.permission_type} permissions={m.permissions} />
                      </td>
                      <td className="px-4 py-3">
                        <span className="capitalize text-xs text-slate-500">{m.role}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            title="Edit permissions"
                            onClick={() => setEditingMember(m)}
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 transition"
                          >
                            <EditIcon />
                          </button>
                          <button
                            type="button"
                            title="Remove member"
                            onClick={() => removeMember(m.id)}
                            disabled={actionLoading === m.id}
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-500 disabled:opacity-40 dark:hover:bg-rose-950/30 transition"
                          >
                            <TrashIcon />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Mobile card list */}
              <div className="sm:hidden divide-y divide-slate-100 dark:divide-slate-800">
                {members.map((m) => (
                  <div key={m.id} className="flex items-center gap-3 px-4 py-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700 dark:bg-slate-800 dark:text-brand-400">
                      {initialsFromEmail(m.email)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold text-slate-800 dark:text-slate-200">{m.email}</div>
                      <div className="mt-0.5">
                        <PermissionPill type={m.permission_type} permissions={m.permissions} />
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setEditingMember(m)}
                        className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 transition"
                      >
                        <EditIcon />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeMember(m.id)}
                        disabled={actionLoading === m.id}
                        className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-500 disabled:opacity-40 dark:hover:bg-rose-950/30 transition"
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Invitations tab ── */}
      {!loading && !error && tab === "invitations" && (
        <div className="space-y-5">
          {invitations.length === 0 ? (
            <EmptyState
              icon={<LinkIcon className="h-5 w-5" />}
              title="No invitations sent yet"
              subtitle="Generate an invite link to get started."
            />
          ) : (
            <>
              {pendingInvites.length > 0 && (
                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Pending</p>
                  <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                    {/* Desktop */}
                    <table className="hidden w-full text-sm sm:table">
                      <thead>
                        <tr className="border-b border-slate-100 dark:border-slate-800">
                          <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">Recipient</th>
                          <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">Access</th>
                          <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">Expires</th>
                          <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-400">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {pendingInvites.map((inv) => (
                          <tr key={inv.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition">
                            <td className="px-4 py-3">
                              {inv.email ? (
                                <span className="font-medium text-slate-700 dark:text-slate-300">{inv.email}</span>
                              ) : (
                                <span className="flex items-center gap-1.5 text-slate-400 text-xs">
                                  <LinkIcon />Link only
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <PermissionPill type={inv.permission_type} permissions={inv.permissions} />
                            </td>
                            <td className="px-4 py-3 text-xs text-slate-400">
                              {inv.expires_at ? new Date(inv.expires_at).toLocaleDateString() : "—"}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <button
                                type="button"
                                onClick={() => revoke(inv.id)}
                                disabled={actionLoading === inv.id}
                                className="rounded-lg px-3 py-1.5 text-[12px] font-semibold text-rose-500 hover:bg-rose-50 disabled:opacity-40 dark:hover:bg-rose-950/30 transition"
                              >
                                Revoke
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {/* Mobile */}
                    <div className="sm:hidden divide-y divide-slate-100 dark:divide-slate-800">
                      {pendingInvites.map((inv) => (
                        <div key={inv.id} className="px-4 py-3 flex items-center gap-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600 dark:bg-slate-800">
                            {inv.email
                              ? <span className="text-xs font-bold">{initialsFromEmail(inv.email)}</span>
                              : <LinkIcon className="h-3.5 w-3.5" />
                            }
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-[13px] font-medium text-slate-700 dark:text-slate-300 truncate">
                              {inv.email || "Link invite"}
                            </div>
                            <div className="mt-0.5 flex items-center gap-2">
                              <PermissionPill type={inv.permission_type} permissions={inv.permissions} />
                            </div>
                            {inv.expires_at && (
                              <div className="mt-0.5 text-[10px] text-slate-400">
                                Expires {new Date(inv.expires_at).toLocaleDateString()}
                              </div>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => revoke(inv.id)}
                            disabled={actionLoading === inv.id}
                            className="shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-rose-500 hover:bg-rose-50 disabled:opacity-40 dark:hover:bg-rose-950/30 transition"
                          >
                            Revoke
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {pastInvites.length > 0 && (
                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Past</p>
                  <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                    {/* Desktop */}
                    <table className="hidden w-full text-sm sm:table">
                      <thead>
                        <tr className="border-b border-slate-100 dark:border-slate-800">
                          <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">Recipient</th>
                          <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">Access</th>
                          <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {pastInvites.map((inv) => (
                          <tr key={inv.id} className="opacity-60">
                            <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                              {inv.email || (
                                <span className="flex items-center gap-1.5 text-xs text-slate-400"><LinkIcon />Link only</span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <PermissionPill type={inv.permission_type} permissions={inv.permissions} />
                            </td>
                            <td className="px-4 py-3">
                              <StatusBadge status={inv.status} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {/* Mobile */}
                    <div className="sm:hidden divide-y divide-slate-100 dark:divide-slate-800">
                      {pastInvites.map((inv) => (
                        <div key={inv.id} className="flex items-center gap-3 px-4 py-3 opacity-60">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400">
                            {inv.email
                              ? <span className="text-xs font-bold">{initialsFromEmail(inv.email)}</span>
                              : <LinkIcon className="h-3.5 w-3.5" />
                            }
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-[13px] text-slate-600 dark:text-slate-400 truncate">
                              {inv.email || "Link invite"}
                            </div>
                            <div className="mt-0.5">
                              <PermissionPill type={inv.permission_type} permissions={inv.permissions} />
                            </div>
                          </div>
                          <StatusBadge status={inv.status} />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {showInvite && (
        <InviteModal onClose={() => setShowInvite(false)} onSaved={load} />
      )}

      {editingMember && (
        <InviteModal
          onClose={() => setEditingMember(null)}
          memberId={editingMember.id}
          initialPermissionType={editingMember.permission_type}
          initialPermissions={editingMember.permissions}
          onSaved={() => { load(); setEditingMember(null); }}
        />
      )}
    </div>
  );
}
