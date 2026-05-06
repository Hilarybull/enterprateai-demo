import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/auth";
import { apiRequest } from "../api/client";
import logoUrl from "../enterprate-logo.png";

const ADMIN_EMAIL = "tech.support@enterprateai.com";

const STAT_CONFIG = [
  {
    key: "total_workspaces",
    label: "Workspaces",
    color: "bg-brand-50 text-brand-700 border-brand-100",
    iconBg: "bg-brand-100",
    iconColor: "text-brand-600",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-5 w-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
      </svg>
    ),
  },
  {
    key: "total_users",
    label: "Total Users",
    color: "bg-emerald-50 text-emerald-700 border-emerald-100",
    iconBg: "bg-emerald-100",
    iconColor: "text-emerald-600",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-5 w-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
      </svg>
    ),
  },
  {
    key: "total_members",
    label: "Members",
    color: "bg-violet-50 text-violet-700 border-violet-100",
    iconBg: "bg-violet-100",
    iconColor: "text-violet-600",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-5 w-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
      </svg>
    ),
  },
  {
    key: "total_invitations",
    label: "Invitations",
    color: "bg-amber-50 text-amber-700 border-amber-100",
    iconBg: "bg-amber-100",
    iconColor: "text-amber-600",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-5 w-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
      </svg>
    ),
  },
  {
    key: "total_simulations",
    label: "Simulations",
    color: "bg-sky-50 text-sky-700 border-sky-100",
    iconBg: "bg-sky-100",
    iconColor: "text-sky-600",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-5 w-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
      </svg>
    ),
  },
  {
    key: "total_blueprints",
    label: "Blueprints",
    color: "bg-indigo-50 text-indigo-700 border-indigo-100",
    iconBg: "bg-indigo-100",
    iconColor: "text-indigo-600",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-5 w-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
      </svg>
    ),
  },
  {
    key: "total_validated_workspaces",
    label: "Validated",
    color: "bg-teal-50 text-teal-700 border-teal-100",
    iconBg: "bg-teal-100",
    iconColor: "text-teal-600",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-5 w-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
];

function StatTile({ config, value }) {
  return (
    <div className={`flex items-center gap-3 rounded-2xl border p-4 ${config.color}`}>
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${config.iconBg} ${config.iconColor}`}>
        {config.icon}
      </div>
      <div className="min-w-0">
        <div className="text-2xl font-bold tabular-nums leading-none">{value ?? "—"}</div>
        <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide opacity-70 truncate">{config.label}</div>
      </div>
    </div>
  );
}

function DataTable({ columns, rows, emptyText = "No data" }) {
  if (!rows || rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-6 w-6 text-slate-400">
            <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
          </svg>
        </div>
        <p className="mt-3 text-sm text-slate-400">{emptyText}</p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full min-w-max text-sm">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50/80">
            {columns.map((col) => (
              <th key={col.key} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {rows.map((row, i) => (
            <tr key={row.id || i} className="hover:bg-slate-50/60 transition-colors">
              {columns.map((col) => (
                <td key={col.key} className="px-4 py-3 text-slate-700">
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

const TABS = [
  { key: "overview", label: "Overview", icon: <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4"><path d="M2 10a8 8 0 1116 0 8 8 0 01-16 0zm6.39-2.908a.75.75 0 01.766.027l3.5 2.25a.75.75 0 010 1.262l-3.5 2.25A.75.75 0 018 12.25v-4.5a.75.75 0 01.39-.658z" /></svg> },
  { key: "workspaces", label: "Workspaces", icon: <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4"><path d="M2 4.25A2.25 2.25 0 014.25 2h11.5A2.25 2.25 0 0118 4.25v8.5A2.25 2.25 0 0115.75 15h-3.105a3.501 3.501 0 001.1 1.677A.75.75 0 0113.26 18H6.74a.75.75 0 01-.484-1.323A3.501 3.501 0 007.355 15H4.25A2.25 2.25 0 012 12.75v-8.5z" /></svg> },
  { key: "users", label: "Users", icon: <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4"><path d="M10 8a3 3 0 100-6 3 3 0 000 6zM3.465 14.493a1.23 1.23 0 00.41 1.412A9.957 9.957 0 0010 18c2.31 0 4.438-.784 6.131-2.1.43-.333.604-.903.408-1.41a7.002 7.002 0 00-13.074.003z" /></svg> },
  { key: "members", label: "Members", icon: <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4"><path d="M7 8a3 3 0 100-6 3 3 0 000 6zM14.5 9a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM1.615 16.428a1.224 1.224 0 01-.256-1.12 6.002 6.002 0 0111.272 0 1.224 1.224 0 01-.256 1.12A6.985 6.985 0 017 18a6.985 6.985 0 01-5.385-1.572zM14.5 16h-.106c.07-.297.088-.611.048-.933a7.47 7.47 0 00-1.588-3.755 4.502 4.502 0 015.874 2.636.818.818 0 01-.36.98A7.465 7.465 0 0114.5 16z" /></svg> },
  { key: "invitations", label: "Invitations", icon: <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4"><path d="M3 4a2 2 0 00-2 2v1.161l8.441 4.221a1.25 1.25 0 001.118 0L19 7.162V6a2 2 0 00-2-2H3z" /><path d="M19 8.839l-7.77 3.885a2.75 2.75 0 01-2.46 0L1 8.839V14a2 2 0 002 2h14a2 2 0 002-2V8.839z" /></svg> },
];

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
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-8 w-8 text-slate-400">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
        </div>
        <h2 className="mt-4 text-lg font-semibold text-slate-900">Access restricted</h2>
        <p className="mt-2 max-w-xs text-sm text-slate-500">This page is restricted to system administrators only.</p>
        <button
          type="button"
          onClick={() => navigate("/dashboard")}
          className="mt-6 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
        >
          Back to dashboard
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50">
        <img src={logoUrl} alt="EnterprateAI" className="h-8 w-auto opacity-60" />
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
        <p className="text-xs text-slate-400">Loading system data…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50 px-4 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-6 w-6 text-slate-400">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
        </div>
        <p className="text-sm font-medium text-slate-700">Failed to load data</p>
        <p className="text-xs text-slate-400">{error}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
        >
          Retry
        </button>
      </div>
    );
  }

  const tabCounts = {
    workspaces: stats?.total_workspaces ?? 0,
    users: stats?.total_users ?? 0,
    members: stats?.total_members ?? 0,
    invitations: stats?.total_invitations ?? 0,
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6">
          <img src={logoUrl} alt="EnterprateAI" className="h-7 w-auto sm:h-8" />
          <div className="h-5 w-px bg-slate-200" />
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-800">System Admin</span>
            <span className="hidden rounded-full bg-brand-100 px-2.5 py-0.5 text-[11px] font-semibold text-brand-700 sm:inline">
              Control Panel
            </span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-xs text-slate-400 sm:block">{email}</span>
            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
              Admin
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">

        {/* Stat tiles */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
          {STAT_CONFIG.map((cfg) => (
            <StatTile key={cfg.key} config={cfg} value={stats[cfg.key]} />
          ))}
        </div>

        {/* Tab navigation */}
        <div className="overflow-x-auto">
          <div className="flex min-w-max gap-1 rounded-2xl border border-slate-200 bg-white p-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition whitespace-nowrap ${
                  tab === t.key
                    ? "bg-brand-600 text-white shadow-sm"
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
                }`}
              >
                {t.icon}
                {t.label}
                {tabCounts[t.key] !== undefined ? (
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
                    tab === t.key ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"
                  }`}>
                    {tabCounts[t.key]}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </div>

        {/* Overview */}
        {tab === "overview" && (
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-800">Recent workspaces</h2>
                <button type="button" onClick={() => setTab("workspaces")} className="text-xs font-medium text-brand-600 hover:text-brand-700">
                  View all →
                </button>
              </div>
              <DataTable
                columns={[
                  { key: "name", label: "Name", render: (r) => <span className="font-medium text-slate-800">{r.name || "Unnamed"}</span> },
                  { key: "created_at", label: "Created", render: (r) => <span className="text-xs text-slate-500">{formatDate(r.created_at)}</span> },
                ]}
                rows={(stats.workspaces || []).slice(0, 8)}
                emptyText="No workspaces yet"
              />
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-800">Recent users</h2>
                <button type="button" onClick={() => setTab("users")} className="text-xs font-medium text-brand-600 hover:text-brand-700">
                  View all →
                </button>
              </div>
              <DataTable
                columns={[
                  { key: "email", label: "Email", render: (r) => <span className="font-medium text-slate-800">{r.email}</span> },
                  { key: "created_at", label: "Joined", render: (r) => <span className="text-xs text-slate-500">{formatDate(r.created_at)}</span> },
                ]}
                rows={(stats.users || []).slice(0, 8)}
                emptyText="No users yet"
              />
            </div>
          </div>
        )}

        {/* Workspaces */}
        {tab === "workspaces" && (
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="mb-4 text-sm font-semibold text-slate-800">All workspaces</h2>
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

        {/* Users */}
        {tab === "users" && (
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="mb-4 text-sm font-semibold text-slate-800">All users</h2>
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

        {/* Members */}
        {tab === "members" && (
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="mb-4 text-sm font-semibold text-slate-800">Workspace members</h2>
            <DataTable
              columns={[
                { key: "workspace_id", label: "Workspace", render: (r) => <span className="font-mono text-[11px] text-slate-400">{String(r.workspace_id || "").slice(0, 10)}…</span> },
                { key: "user_id", label: "User ID", render: (r) => <span className="font-mono text-[11px] text-slate-400">{String(r.user_id || "").slice(0, 10)}…</span> },
                {
                  key: "permission_type",
                  label: "Permission",
                  render: (r) => (
                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${
                      r.permission_type === "full" || r.permission_type === "module"
                        ? "bg-brand-100 text-brand-700"
                        : "bg-amber-100 text-amber-700"
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

        {/* Invitations */}
        {tab === "invitations" && (
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="mb-4 text-sm font-semibold text-slate-800">Workspace invitations</h2>
            <DataTable
              columns={[
                { key: "workspace_id", label: "Workspace", render: (r) => <span className="font-mono text-[11px] text-slate-400">{String(r.workspace_id || "").slice(0, 10)}…</span> },
                { key: "invited_email", label: "Email invited", render: (r) => <span className="font-medium text-slate-800">{r.invited_email || "—"}</span> },
                {
                  key: "status",
                  label: "Status",
                  render: (r) => (
                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${
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
      </main>
    </div>
  );
}
