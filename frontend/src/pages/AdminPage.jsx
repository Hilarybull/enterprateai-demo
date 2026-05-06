import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/auth";
import { apiRequest } from "../api/client";

const ADMIN_EMAIL = "tech.support@enterprateai.com";

function StatTile({ label, value, color = "brand" }) {
  const colors = {
    brand: "bg-brand-50 text-brand-700 border-brand-100",
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-100",
    violet: "bg-violet-50 text-violet-700 border-violet-100",
    amber: "bg-amber-50 text-amber-700 border-amber-100",
    sky: "bg-sky-50 text-sky-700 border-sky-100",
    rose: "bg-rose-50 text-rose-700 border-rose-100",
    slate: "bg-slate-50 text-slate-700 border-slate-100",
  };
  return (
    <div className={`rounded-2xl border px-5 py-4 ${colors[color] || colors.brand}`}>
      <div className="text-3xl font-bold tabular-nums">{value ?? "—"}</div>
      <div className="mt-1 text-xs font-semibold uppercase tracking-wide opacity-70">{label}</div>
    </div>
  );
}

function DataTable({ columns, rows, emptyText = "No data" }) {
  if (!rows || rows.length === 0) {
    return <div className="py-10 text-center text-sm text-slate-400">{emptyText}</div>;
  }
  return (
    <div className="ea-scroll overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full min-w-max text-sm">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50">
            {columns.map((col) => (
              <th
                key={col.key}
                className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500"
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.id || i} className="border-b border-slate-50 hover:bg-slate-50/60">
              {columns.map((col) => (
                <td key={col.key} className="px-4 py-2.5 text-slate-700">
                  {col.render ? col.render(row) : row[col.key] ?? "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function AdminPage() {
  const navigate = useNavigate();
  const email = useAuthStore((s) => s.email);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("overview");

  const isAdmin = email === ADMIN_EMAIL;

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    async function load() {
      try {
        const data = await apiRequest("/admin/stats", "GET");
        if (!cancelled) setStats(data);
      } catch (e) {
        if (!cancelled) setError(e.message || "Failed to load admin stats.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [isAdmin]);

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-100">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-8 w-8 text-rose-500">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
        </div>
        <h2 className="mt-4 text-lg font-semibold text-slate-900">Access denied</h2>
        <p className="mt-2 text-sm text-slate-500">This page is restricted to system administrators.</p>
        <button
          type="button"
          onClick={() => navigate("/dashboard")}
          className="mt-6 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 transition"
        >
          Back to dashboard
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center">
        <p className="text-sm text-rose-600">{error}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 transition"
        >
          Retry
        </button>
      </div>
    );
  }

  const TABS = [
    { key: "overview", label: "Overview" },
    { key: "workspaces", label: `Workspaces (${stats?.total_workspaces ?? 0})` },
    { key: "users", label: `Users (${stats?.total_users ?? 0})` },
    { key: "members", label: `Members (${stats?.total_members ?? 0})` },
    { key: "invitations", label: `Invitations (${stats?.total_invitations ?? 0})` },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-100">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-5 w-5 text-rose-600">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.955 11.955 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
          </svg>
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900">System Admin</h1>
          <p className="text-xs text-slate-500">Enterprate AI — platform overview</p>
        </div>
        <div className="ml-auto rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-700">
          Admin
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              tab === t.key
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Overview */}
      {tab === "overview" && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <StatTile label="Workspaces" value={stats.total_workspaces} color="brand" />
            <StatTile label="Users" value={stats.total_users} color="emerald" />
            <StatTile label="Members" value={stats.total_members} color="violet" />
            <StatTile label="Invitations" value={stats.total_invitations} color="amber" />
            <StatTile label="Simulations run" value={stats.total_simulations} color="sky" />
            <StatTile label="Blueprints" value={stats.total_blueprints} color="rose" />
            <StatTile label="Validated workspaces" value={stats.total_validated_workspaces} color="slate" />
          </div>

          {/* Recent workspaces snapshot */}
          <div className="ea-card space-y-3 p-4">
            <h2 className="text-sm font-semibold text-slate-800">Recent workspaces</h2>
            <DataTable
              columns={[
                { key: "id", label: "ID", render: (r) => <span className="font-mono text-[11px] text-slate-400">{r.id.slice(0, 8)}…</span> },
                { key: "name", label: "Name", render: (r) => <span className="font-medium text-slate-800">{r.name || "Unnamed"}</span> },
                { key: "created_at", label: "Created", render: (r) => formatDate(r.created_at) },
              ]}
              rows={(stats.workspaces || []).slice(0, 10)}
              emptyText="No workspaces yet"
            />
          </div>
        </div>
      )}

      {/* Workspaces tab */}
      {tab === "workspaces" && (
        <div className="ea-card p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">All workspaces</h2>
          <DataTable
            columns={[
              { key: "id", label: "ID", render: (r) => <span className="font-mono text-[11px] text-slate-400">{r.id.slice(0, 12)}…</span> },
              { key: "name", label: "Name", render: (r) => <span className="font-medium text-slate-800">{r.name || "Unnamed"}</span> },
              { key: "created_at", label: "Created", render: (r) => formatDate(r.created_at) },
            ]}
            rows={stats.workspaces || []}
            emptyText="No workspaces"
          />
        </div>
      )}

      {/* Users tab */}
      {tab === "users" && (
        <div className="ea-card p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">All users</h2>
          <DataTable
            columns={[
              { key: "id", label: "ID", render: (r) => <span className="font-mono text-[11px] text-slate-400">{r.id.slice(0, 12)}…</span> },
              { key: "email", label: "Email", render: (r) => <span className="font-medium text-slate-800">{r.email}</span> },
              { key: "created_at", label: "Joined", render: (r) => formatDate(r.created_at) },
            ]}
            rows={stats.users || []}
            emptyText="No users"
          />
        </div>
      )}

      {/* Members tab */}
      {tab === "members" && (
        <div className="ea-card p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Workspace members</h2>
          <DataTable
            columns={[
              { key: "id", label: "ID", render: (r) => <span className="font-mono text-[11px] text-slate-400">{r.id.slice(0, 8)}…</span> },
              { key: "workspace_id", label: "Workspace", render: (r) => <span className="font-mono text-[11px] text-slate-500">{r.workspace_id.slice(0, 8)}…</span> },
              { key: "user_id", label: "User", render: (r) => <span className="font-mono text-[11px] text-slate-500">{r.user_id.slice(0, 8)}…</span> },
              {
                key: "permission_type",
                label: "Permission",
                render: (r) => (
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    r.permission_type === "full" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                  }`}>
                    {r.permission_type || "—"}
                  </span>
                ),
              },
              { key: "created_at", label: "Added", render: (r) => formatDate(r.created_at) },
            ]}
            rows={stats.members || []}
            emptyText="No members"
          />
        </div>
      )}

      {/* Invitations tab */}
      {tab === "invitations" && (
        <div className="ea-card p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Workspace invitations</h2>
          <DataTable
            columns={[
              { key: "id", label: "ID", render: (r) => <span className="font-mono text-[11px] text-slate-400">{r.id.slice(0, 8)}…</span> },
              { key: "workspace_id", label: "Workspace", render: (r) => <span className="font-mono text-[11px] text-slate-500">{r.workspace_id.slice(0, 8)}…</span> },
              { key: "invited_email", label: "Invited email", render: (r) => <span className="font-medium text-slate-800">{r.invited_email || "—"}</span> },
              {
                key: "status",
                label: "Status",
                render: (r) => (
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    r.status === "accepted" ? "bg-emerald-100 text-emerald-700"
                    : r.status === "pending" ? "bg-amber-100 text-amber-700"
                    : "bg-slate-100 text-slate-500"
                  }`}>
                    {r.status || "—"}
                  </span>
                ),
              },
              { key: "created_at", label: "Sent", render: (r) => formatDate(r.created_at) },
            ]}
            rows={stats.invitations || []}
            emptyText="No invitations"
          />
        </div>
      )}
    </div>
  );
}
