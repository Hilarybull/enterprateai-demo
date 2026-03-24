import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { useAuthStore } from "../store/auth";
import { apiRequest, getApiBaseUrl } from "../api/client";
import logoUrl from "../logo.png";
import { useWorkspaceStore } from "../store/workspace";

const NAV = [
  { to: "/dashboard", label: "Dashboard", subtitle: "Overview & analytics", icon: "grid" },
  { to: "/validation", label: "Idea Validation", subtitle: "Validate business ideas", icon: "bulb" },
  { to: "/registration", label: "Business Registration", subtitle: "Legal & compliance", icon: "doc" },
  { to: "/blueprint", label: "Business Blueprints", subtitle: "Plans & documents", icon: "book" },
  { to: "/simulation", label: "Simulation", subtitle: "What-if scenarios", icon: "beaker" },
  { to: "/catalogue", label: "Catalogue", subtitle: "Products & offers", icon: "box" },
  { to: "/financials", label: "Financials", subtitle: "Invoicing & tracking", icon: "cash" }
];

function initialsFromEmail(email) {
  const e = String(email || "").trim();
  if (!e) return "U";
  const name = e.split("@")[0] || "U";
  const parts = name.split(/[.\-_]+/).filter(Boolean);
  const first = (parts[0] || name)[0] || "U";
  const second = (parts[1] || "")[0] || "";
  return (first + second).toUpperCase();
}

function Icon({ name, className = "h-4 w-4" }) {
  const base = { className, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2" };

  if (name === "menu")
    return (
      <svg {...base}>
        <path d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    );
  if (name === "x")
    return (
      <svg {...base}>
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    );
  if (name === "grid")
    return (
      <svg {...base}>
        <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />
      </svg>
    );
  if (name === "bulb")
    return (
      <svg {...base}>
        <path d="M9 18h6" />
        <path d="M10 22h4" />
        <path d="M12 2a7 7 0 0 0-4 12c.6.5 1 1.2 1.1 2h5.8c.1-.8.5-1.5 1.1-2A7 7 0 0 0 12 2Z" />
      </svg>
    );
  if (name === "doc")
    return (
      <svg {...base}>
        <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
        <path d="M14 2v5h5" />
      </svg>
    );
  if (name === "book")
    return (
      <svg {...base}>
        <path d="M4 19a2 2 0 0 0 2 2h14" />
        <path d="M6 2h14v17H6a2 2 0 0 0-2 2V4a2 2 0 0 1 2-2Z" />
      </svg>
    );
  if (name === "beaker")
    return (
      <svg {...base}>
        <path d="M6 2h12" />
        <path d="M10 2v6l-5 9a3 3 0 0 0 2.6 4.5h8.8A3 3 0 0 0 19 17l-5-9V2" />
        <path d="M8 14h8" />
      </svg>
    );
  if (name === "box")
    return (
      <svg {...base}>
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
        <path d="M3.3 7.3 12 12l8.7-4.7" />
        <path d="M12 22V12" />
      </svg>
    );
  if (name === "cash")
    return (
      <svg {...base}>
        <path d="M3 7h18v10H3z" />
        <path d="M7 7v10" />
        <path d="M17 7v10" />
        <path d="M12 10a2 2 0 1 0 0 4a2 2 0 0 0 0-4Z" />
      </svg>
    );
  if (name === "settings")
    return (
      <svg {...base}>
        <path d="M12 15.5A3.5 3.5 0 1 0 12 8.5a3.5 3.5 0 0 0 0 7Z" />
        <path d="M19.4 15a7.8 7.8 0 0 0 .1-1 7.8 7.8 0 0 0-.1-1l2-1.5-2-3.5-2.4 1a7.7 7.7 0 0 0-1.7-1L15 3h-6l-.3 2.5a7.7 7.7 0 0 0-1.7 1l-2.4-1-2 3.5 2 1.5a7.8 7.8 0 0 0-.1 1 7.8 7.8 0 0 0 .1 1l-2 1.5 2 3.5 2.4-1a7.7 7.7 0 0 0 1.7 1L9 21h6l.3-2.5a7.7 7.7 0 0 0 1.7-1l2.4 1 2-3.5-2-1.5Z" />
      </svg>
    );
  if (name === "help")
    return (
      <svg {...base}>
        <path d="M12 18h.01" />
        <path d="M9.1 9a3 3 0 1 1 4.6 2.6c-.9.6-1.7 1.2-1.7 2.4v.5" />
        <path d="M22 12A10 10 0 1 1 12 2a10 10 0 0 1 10 10Z" />
      </svg>
    );
  if (name === "bell")
    return (
      <svg {...base}>
        <path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 7h18s-3 0-3-7" />
        <path d="M13.7 21a2 2 0 0 1-3.4 0" />
      </svg>
    );
  if (name === "chev")
    return (
      <svg {...base}>
        <path d="M9 6l6 6-6 6" />
      </svg>
    );

  return null;
}

function SidebarLink({ item, onClick }) {
  return (
    <NavLink
      to={item.to}
      onClick={onClick}
      className={({ isActive }) =>
        "group flex items-center gap-3 rounded-2xl px-3 py-2 transition " +
        (isActive ? "bg-brand-50 text-brand-700 ring-1 ring-brand-100" : "text-slate-700 hover:bg-slate-50 hover:text-slate-900")
      }
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-white text-slate-700 ring-1 ring-slate-200 group-hover:bg-slate-50 group-[.active]:bg-gradient-to-br group-[.active]:from-brand-50 group-[.active]:to-accent-50">
        <Icon name={item.icon} className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <div className="truncate text-[13px] font-semibold">{item.label}</div>
        <div className="truncate text-[11px] text-slate-500 [@media(max-height:780px)]:hidden">{item.subtitle}</div>
      </div>
    </NavLink>
  );
}

export default function Layout() {
  const email = useAuthStore((s) => s.email);
  const token = useAuthStore((s) => s.token);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [apiStatus, setApiStatus] = useState("unknown"); // unknown | ok | down
  const [search, setSearch] = useState("");
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [editingWorkspace, setEditingWorkspace] = useState(false);
  const [workspaceDraftName, setWorkspaceDraftName] = useState("");
  const workspaceName = useWorkspaceStore((s) => s.workspaceName);
  const decisionStatus = useWorkspaceStore((s) => s.decisionStatus);
  const setWorkspaceId = useWorkspaceStore((s) => s.setWorkspaceId);
  const setWorkspaceName = useWorkspaceStore((s) => s.setWorkspaceName);
  const setDecisionStatus = useWorkspaceStore((s) => s.setDecisionStatus);
  const setIdeaValidation = useWorkspaceStore((s) => s.setIdeaValidation);
  const setInputs = useWorkspaceStore((s) => s.setInputs);
  const setCurrency = useWorkspaceStore((s) => s.setCurrency);

  const enableHealthCheck = String(import.meta.env.ENABLE_HEALTH_CHECK ?? "false").toLowerCase() === "true";

  useEffect(() => {
    if (!enableHealthCheck) return;
    let cancelled = false;

    async function ping() {
      try {
        const res = await fetch(`${getApiBaseUrl()}/health`, { method: "GET" });
        if (cancelled) return;
        setApiStatus(res.ok ? "ok" : "down");
      } catch {
        if (cancelled) return;
        setApiStatus("down");
      }
    }

    ping();
    const id = setInterval(ping, 30000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [enableHealthCheck]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    async function validateSession() {
      try {
        await apiRequest("/auth/me", "GET");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e || "");
        if (!cancelled && msg.startsWith("HTTP 401:")) {
          logout();
          navigate("/login", { replace: true });
        }
      }
    }

    validateSession();
    return () => {
      cancelled = true;
    };
  }, [token, logout, navigate]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    async function loadWorkspace() {
      try {
        const ws = await apiRequest("/validation/me", "GET");
        if (cancelled || !ws) return;
        setWorkspaceId(ws.id || null);
        setWorkspaceName(ws.name || null);
        setWorkspaceDraftName(ws.name || "");
        const status = ws?.data?.decision?.status;
        if (status === "accepted" || status === "rejected") setDecisionStatus(status);
        else setDecisionStatus(null);
        if (ws?.data?.idea_validation) setIdeaValidation(ws.data.idea_validation);
        if (ws?.data?.inputs || ws?.data?.assumptions) setInputs(ws.data.inputs || ws.data.assumptions);
        const currency =
          ws?.data?.idea_validation?.context?.currency ||
          ws?.data?.business_profile?.currency ||
          ws?.data?.business_context?.currency;
        if (currency) setCurrency(currency);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e || "");
        if (msg.startsWith("HTTP 404:")) {
          setWorkspaceId(null);
          setWorkspaceName(null);
          setDecisionStatus(null);
        }
      }
    }

    loadWorkspace();
    return () => {
      cancelled = true;
    };
  }, [token, setCurrency, setDecisionStatus, setIdeaValidation, setInputs, setWorkspaceId, setWorkspaceName]);

  const initials = useMemo(() => initialsFromEmail(email), [email]);
  const filteredNav = useMemo(() => {
    const q = String(search || "").trim().toLowerCase();
    if (!q) return NAV;
    return NAV.filter((i) => `${i.label} ${i.subtitle}`.toLowerCase().includes(q));
  }, [search]);

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === "Escape") {
        setWorkspaceOpen(false);
      }
    }

    function onDocClick(e) {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (t.closest("[data-ea-workspace]")) return;
      setWorkspaceOpen(false);
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onDocClick);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onDocClick);
    };
  }, []);

  const Sidebar = (
    <aside className="flex h-full w-[260px] flex-col border-r border-slate-200 bg-white px-3 py-4 lg:w-[280px] lg:px-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
              <img src={logoUrl} alt="EnterprateAI" className="h-8 w-8 object-contain" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-500">EnterprateAI</div>
              <div className="mt-0.5 truncate text-[12px] font-semibold text-slate-900">AI operating system</div>
            </div>
          </div>
        </div>
        <button className="md:hidden rounded-xl p-2 text-slate-600 hover:bg-slate-100" onClick={() => setMobileOpen(false)}>
          <Icon name="x" />
        </button>
      </div>

      <nav className="ea-scroll mt-3 flex-1 space-y-1 overflow-auto pr-1">
        {filteredNav.map((item) => (
          <SidebarLink key={item.to} item={item} onClick={() => setMobileOpen(false)} />
        ))}
      </nav>

      {enableHealthCheck ? (
        <div className="mt-3 rounded-2xl bg-white p-3 ring-1 ring-slate-200 [@media(max-height:780px)]:hidden">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Status</div>
            <span
              className={
                "inline-flex h-2 w-2 rounded-full " +
                (apiStatus === "ok" ? "bg-emerald-500" : apiStatus === "down" ? "bg-rose-500" : "bg-slate-300")
              }
              title={apiStatus}
            />
          </div>
          <div className="mt-1 flex items-center justify-between gap-3 text-xs text-slate-600">
            <div>{apiStatus === "ok" ? "Online" : apiStatus === "down" ? "Offline" : "Checking..."}</div>
            <button type="button" className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">
              <Icon name="bell" className="h-4 w-4" />
              Alerts
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-auto h-2" />
    </aside>
  );

  return (
    <div className="relative h-[100dvh] bg-slate-50">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-brand-50 via-accent-50/30 to-white" />
      <div className="pointer-events-none absolute -top-24 left-1/3 h-72 w-72 -translate-x-1/2 rounded-full bg-brand-200/35 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 left-2/3 h-72 w-72 -translate-x-1/2 rounded-full bg-accent-200/25 blur-3xl" />

      <div className="relative flex h-full w-full overflow-hidden">
        <div className="hidden md:block">{Sidebar}</div>

        {mobileOpen ? (
          <div className="fixed inset-0 z-50 md:hidden">
            <div className="absolute inset-0 bg-slate-900/40" onClick={() => setMobileOpen(false)} />
            <div className="absolute inset-y-0 left-0">{Sidebar}</div>
          </div>
        ) : null}

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/80 backdrop-blur">
            <div className="flex items-center justify-between gap-3 px-4 py-3 md:px-6">
              <div className="flex items-center gap-2 md:hidden">
                <button
                  className="rounded-xl p-2 text-slate-700 hover:bg-slate-100"
                  onClick={() => setMobileOpen(true)}
                  aria-label="Open menu"
                >
                  <Icon name="menu" />
                </button>
              </div>

              <div className="flex min-w-0 flex-1 items-center gap-3">
                <div className="min-w-0 flex-1">
                  <input
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 shadow-sm outline-none ring-brand-200 focus:ring"
                    placeholder="Search modules, features..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="relative hidden md:block" data-ea-workspace>
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
                    onClick={() => {
                      setWorkspaceOpen((v) => !v);
                    }}
                    aria-haspopup="menu"
                    aria-expanded={workspaceOpen}
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-gradient-to-br from-brand-50 to-accent-50 text-xs font-semibold text-brand-700 ring-1 ring-brand-100">
                      {initials}
                    </span>
                    <span className="max-w-[180px] truncate">
                      {decisionStatus === "accepted" && workspaceName ? workspaceName : "My workspace"}
                    </span>
                    <Icon name="chev" className="h-4 w-4 text-slate-400" />
                  </button>

                  {workspaceOpen ? (
                    <div className="absolute right-0 top-full z-30 mt-2 w-64 rounded-2xl border border-slate-200 bg-white p-2 shadow-lg">
                      <div className="px-3 py-2">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Workspace</div>
                        <div className="mt-1 truncate text-sm font-semibold text-slate-900">
                          {decisionStatus === "accepted" && workspaceName ? workspaceName : "My workspace"}
                        </div>
                        <div className="mt-0.5 text-xs text-slate-500">
                          {decisionStatus === "accepted" ? "Accepted" : decisionStatus === "rejected" ? "Rejected" : "Pending"}
                        </div>
                        {email ? <div className="mt-2 truncate text-xs font-semibold text-slate-700">{email}</div> : null}
                      </div>
                      <div className="my-1 h-px bg-slate-200" />
                      {!editingWorkspace ? (
                        <button
                          type="button"
                          className="w-full rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                          onClick={() => {
                            setWorkspaceDraftName(decisionStatus === "accepted" && workspaceName ? workspaceName : "My workspace");
                            setEditingWorkspace(true);
                          }}
                        >
                          Edit workspace name
                        </button>
                      ) : (
                        <div className="px-3 py-2">
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Rename workspace</div>
                          <input
                            className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                            value={workspaceDraftName}
                            onChange={(e) => setWorkspaceDraftName(e.target.value)}
                          />
                          <div className="mt-2 flex items-center gap-2">
                            <button
                              type="button"
                              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                              onClick={() => {
                                setEditingWorkspace(false);
                              }}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
                              onClick={async () => {
                                const nextName = String(workspaceDraftName || "").trim();
                                if (!nextName) return;
                                try {
                                  const ws = await apiRequest("/validation/me", "PATCH", { name: nextName, data: {} });
                                  if (ws?.name) setWorkspaceName(ws.name);
                                  setEditingWorkspace(false);
                                } catch {
                                  setEditingWorkspace(false);
                                }
                              }}
                            >
                              Save
                            </button>
                          </div>
                        </div>
                      )}
                      <button type="button" className="w-full rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">
                        Help & Support
                      </button>
                      <div className="my-1 h-px bg-slate-200" />
                      <button
                        type="button"
                        className="w-full rounded-xl px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50"
                        onClick={() => {
                          logout();
                          navigate("/login");
                        }}
                      >
                        Log out
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </header>

          <div className="ea-scroll flex-1 overflow-auto">
            <div className="mx-auto w-full max-w-7xl p-4 md:p-6">
              <Outlet />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
