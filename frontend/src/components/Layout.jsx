import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState, useRef } from "react";
import { useAuthStore } from "../store/auth";
import { apiRequest, getApiBaseUrl } from "../api/client";
import logoUrl from "../enterprate-logo.png";
import { useWorkspaceStore } from "../store/workspace";
import BusinessAssistant from "./BusinessAssistant";
import InviteModal from "./InviteModal";
import { getAcceptedServiceValidationEntry } from "../lib/acceptedValidation";
import { hasModuleAccess } from "../lib/permissions";

const NAV = [
  { to: "/dashboard", label: "Dashboard", subtitle: "Overview & analytics", icon: "grid", moduleKey: "dashboard" },
  { to: "/validation", label: "Idea Validation", subtitle: "Validate business ideas", icon: "bulb", moduleKey: "validation" },
  { to: "/blueprint", label: "Business Blueprints", subtitle: "Plans & documents", icon: "book", moduleKey: "blueprint" },
  { to: "/simulation", label: "Simulation", subtitle: "What-if scenarios", icon: "beaker", moduleKey: "simulation" },
  { to: "/catalogue", label: "Catalogue", subtitle: "Products & offers", icon: "box", moduleKey: "catalogue" },
  { to: "/financials", label: "Financials", subtitle: "Invoicing & tracking", icon: "cash", moduleKey: "financials" }
];

// { to: "/registration", label: "Business Registration", subtitle: "Legal & compliance", icon: "doc", moduleKey: "registration" }

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
  if (name === "users")
    return (
      <svg {...base}>
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    );
  if (name === "user-plus")
    return (
      <svg {...base}>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <line x1="19" y1="8" x2="19" y2="14" />
        <line x1="22" y1="11" x2="16" y2="11" />
      </svg>
    );
  if (name === "lock")
    return (
      <svg {...base}>
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    );

  return null;
}

function SidebarLink({ item, onClick, forceInactive, locked }) {
  if (locked) {
    return (
      <div
        className="group mx-1 flex cursor-not-allowed items-center gap-3 rounded-2xl px-3 py-2.5 opacity-35 select-none"
        title="You don't have access to this module"
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-white text-slate-400 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
          <Icon name={item.icon} className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-slate-500 dark:text-slate-500">{item.label}</div>
          <div className="truncate text-[11px] text-slate-400 [@media(max-height:780px)]:hidden">{item.subtitle}</div>
        </div>
        <Icon name="lock" className="h-3.5 w-3.5 shrink-0 text-slate-400" />
      </div>
    );
  }

  return (
    <NavLink
      to={item.to}
      onClick={onClick}
      className={({ isActive }) =>
        "group mx-1 flex items-center gap-3 rounded-2xl px-3 py-2.5 transition " +
        (isActive && !forceInactive
          ? "bg-brand-50 text-brand-700 ring-1 ring-brand-100 dark:bg-slate-900 dark:text-slate-100 dark:ring-slate-800"
          : "text-slate-700 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-slate-900")
      }
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-white text-slate-700 ring-1 ring-slate-200 group-hover:bg-slate-50 group-[.active]:bg-gradient-to-br group-[.active]:from-brand-50 group-[.active]:to-accent-50 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-800 dark:group-hover:bg-slate-800 dark:group-[.active]:from-slate-800 dark:group-[.active]:to-slate-700">
        <Icon name={item.icon} className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <div className="truncate text-[13px] font-semibold">{item.label}</div>
        <div className="truncate text-[11px] text-slate-500 dark:text-slate-400 [@media(max-height:780px)]:hidden">{item.subtitle}</div>
      </div>
    </NavLink>
  );
}

export default function Layout() {
  const token = useAuthStore((s) => s.token);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [apiStatus, setApiStatus] = useState("unknown"); // unknown | ok | down
  const [search, setSearch] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem("ea_theme") || "system");
  const profileRef = useRef(null);

  const workspaceName = useWorkspaceStore((s) => s.workspaceName);
  const workspaceLogo = useWorkspaceStore((s) => s.workspaceLogo);
  const decisionStatus = useWorkspaceStore((s) => s.decisionStatus);
  const serviceDecisionStatus = useWorkspaceStore((s) => s.serviceDecisionStatus);
  const isMemberMode = useWorkspaceStore((s) => s.isMemberMode);
  const memberPermissionType = useWorkspaceStore((s) => s.memberPermissionType);
  const memberPermissions = useWorkspaceStore((s) => s.memberPermissions);
  const memberWorkspaceName = useWorkspaceStore((s) => s.memberWorkspaceName);

  const setWorkspaceId = useWorkspaceStore((s) => s.setWorkspaceId);
  const setWorkspaceName = useWorkspaceStore((s) => s.setWorkspaceName);
  const setWorkspaceLogo = useWorkspaceStore((s) => s.setWorkspaceLogo);
  const setDecisionStatus = useWorkspaceStore((s) => s.setDecisionStatus);
  const setServiceDecisionStatus = useWorkspaceStore((s) => s.setServiceDecisionStatus);
  const setWorkspaceLoadedAt = useWorkspaceStore((s) => s.setWorkspaceLoadedAt);
  const setIdeaValidation = useWorkspaceStore((s) => s.setIdeaValidation);
  const setDraftIdeaValidation = useWorkspaceStore((s) => s.setDraftIdeaValidation);
  const setDraftServiceIdea = useWorkspaceStore((s) => s.setDraftServiceIdea);
  const setInputs = useWorkspaceStore((s) => s.setInputs);
  const setCurrency = useWorkspaceStore((s) => s.setCurrency);
  const setValidation = useWorkspaceStore((s) => s.setValidation);
  const setMemberMode = useWorkspaceStore((s) => s.setMemberMode);
  const clearMemberMode = useWorkspaceStore((s) => s.clearMemberMode);

  const enableHealthCheck = String(import.meta.env.ENABLE_HEALTH_CHECK ?? "false").toLowerCase() === "true";
  const acceptedAny = decisionStatus === "accepted" || serviceDecisionStatus === "accepted";
  const rejectedAny = decisionStatus === "rejected" || serviceDecisionStatus === "rejected";
  const workspaceDisplayName = isMemberMode
    ? (memberWorkspaceName || "Shared workspace")
    : (acceptedAny && workspaceName ? workspaceName : workspaceName || "My workspace");
  const email = useAuthStore((s) => s.email);
  const profileInitials = initialsFromEmail(email);

  useEffect(() => {
    if (theme === "dark") document.documentElement.classList.add("dark");
    else document.documentElement.classList.remove("dark");
    if (theme === "system") {
      localStorage.removeItem("ea_theme");
    } else {
      localStorage.setItem("ea_theme", theme);
    }
  }, [theme]);

  useEffect(() => {
    if (!profileOpen) return;
    function handleClick(e) {
      if (!profileRef.current || profileRef.current.contains(e.target)) return;
      setProfileOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [profileOpen]);

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
      // If already in member mode (persisted), reload the owner's workspace first
      const persisted = useWorkspaceStore.getState();
      if (persisted.isMemberMode && persisted.membershipId) {
        try {
          const memberships = await apiRequest("/workspace/me/memberships", "GET");
          if (cancelled) return;
          const membership = Array.isArray(memberships) && memberships.length > 0 ? memberships[0] : null;
          if (membership) {
            const ownerWs = await apiRequest(`/validation/${membership.workspace_id}`, "GET");
            if (cancelled) return;
            setWorkspaceId(membership.workspace_id);
            setWorkspaceName(ownerWs?.name || membership.workspace_name || null);
            setWorkspaceLogo(ownerWs?.data?.workspace_profile?.logo_data_url || null);
            setWorkspaceLoadedAt(new Date().toISOString());
            setMemberMode(membership.id, membership.permission_type, membership.permissions, ownerWs?.name || membership.workspace_name || "Shared workspace");
            const status = ownerWs?.data?.decision?.status;
            if (status === "accepted" || status === "rejected") setDecisionStatus(status);
            else setDecisionStatus(null);
            const acceptedServiceEntry = getAcceptedServiceValidationEntry(ownerWs?.data);
            if (acceptedServiceEntry?.decision_status === "accepted") {
              setServiceDecisionStatus("accepted");
              if (acceptedServiceEntry?.result) setValidation(acceptedServiceEntry.result);
            } else {
              setServiceDecisionStatus(null);
            }
            if (ownerWs?.data?.idea_validation) setIdeaValidation(ownerWs.data.idea_validation);
            if (ownerWs?.data?.inputs || ownerWs?.data?.assumptions) setInputs(ownerWs.data.inputs || ownerWs.data.assumptions);
            const currency = ownerWs?.data?.idea_validation?.context?.currency || ownerWs?.data?.business_profile?.currency;
            if (currency) setCurrency(currency);
            return; // Done — member mode successfully reloaded
          }
        } catch {
          // Membership no longer valid — fall through to own workspace
        }
      }

      try {
        const ws = await apiRequest("/validation/me", "GET");
        if (cancelled || !ws) return;

        // User has their own workspace — owner mode
        clearMemberMode();
        setWorkspaceId(ws.id || null);
        setWorkspaceName(ws.name || null);
        setWorkspaceLogo(ws?.data?.workspace_profile?.logo_data_url || null);
        setWorkspaceLoadedAt(new Date().toISOString());
        const status = ws?.data?.decision?.status;
        if (status === "accepted" || status === "rejected") setDecisionStatus(status);
        else setDecisionStatus(null);
        const acceptedServiceEntry = getAcceptedServiceValidationEntry(ws?.data);
        if (acceptedServiceEntry?.decision_status === "accepted") {
          setServiceDecisionStatus("accepted");
          if (acceptedServiceEntry?.result) setValidation(acceptedServiceEntry.result);
          if (acceptedServiceEntry?.payload) setDraftServiceIdea(acceptedServiceEntry.payload);
        } else {
          setServiceDecisionStatus(null);
        }
        if (ws?.data?.idea_validation) setIdeaValidation(ws.data.idea_validation);
        if (ws?.data?.draft_idea_validation) setDraftIdeaValidation(ws.data.draft_idea_validation);
        if (ws?.data?.draft_service_idea && !acceptedServiceEntry?.payload) setDraftServiceIdea(ws.data.draft_service_idea);
        if (ws?.data?.inputs || ws?.data?.assumptions) setInputs(ws.data.inputs || ws.data.assumptions);
        const currency =
          ws?.data?.idea_validation?.context?.currency ||
          ws?.data?.business_profile?.currency ||
          ws?.data?.business_context?.currency;
        if (currency) setCurrency(currency);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e || "");
        if (msg.startsWith("HTTP 404:")) {
          // No own workspace — check if user is a member of another workspace
          if (cancelled) return;
          try {
            const memberships = await apiRequest("/workspace/me/memberships", "GET");
            if (cancelled) return;
            if (Array.isArray(memberships) && memberships.length > 0) {
              const membership = memberships[0]; // use the first (most recent) membership
              // Load the owner's workspace data
              const ownerWs = await apiRequest(`/validation/${membership.workspace_id}`, "GET");
              if (cancelled) return;
              setWorkspaceId(membership.workspace_id);
              setWorkspaceName(ownerWs?.name || membership.workspace_name || null);
              setWorkspaceLogo(ownerWs?.data?.workspace_profile?.logo_data_url || null);
              setWorkspaceLoadedAt(new Date().toISOString());
              setMemberMode(
                membership.id,
                membership.permission_type,
                membership.permissions,
                ownerWs?.name || membership.workspace_name || "Shared workspace"
              );
              const status = ownerWs?.data?.decision?.status;
              if (status === "accepted" || status === "rejected") setDecisionStatus(status);
              else setDecisionStatus(null);
              const acceptedServiceEntry = getAcceptedServiceValidationEntry(ownerWs?.data);
              if (acceptedServiceEntry?.decision_status === "accepted") {
                setServiceDecisionStatus("accepted");
                if (acceptedServiceEntry?.result) setValidation(acceptedServiceEntry.result);
              } else {
                setServiceDecisionStatus(null);
              }
              if (ownerWs?.data?.idea_validation) setIdeaValidation(ownerWs.data.idea_validation);
              if (ownerWs?.data?.inputs || ownerWs?.data?.assumptions) setInputs(ownerWs.data.inputs || ownerWs.data.assumptions);
              const currency =
                ownerWs?.data?.idea_validation?.context?.currency ||
                ownerWs?.data?.business_profile?.currency ||
                ownerWs?.data?.business_context?.currency;
              if (currency) setCurrency(currency);
            } else {
              // No memberships either
              setWorkspaceId(null);
              setWorkspaceName(null);
              setWorkspaceLogo(null);
              setDecisionStatus(null);
              setServiceDecisionStatus(null);
              clearMemberMode();
            }
          } catch {
            setWorkspaceId(null);
            setWorkspaceName(null);
            setWorkspaceLogo(null);
            setDecisionStatus(null);
            setServiceDecisionStatus(null);
            clearMemberMode();
          }
        }
      }
    }

    loadWorkspace();
    return () => {
      cancelled = true;
    };
  }, [token, setCurrency, setDecisionStatus, setDraftIdeaValidation, setDraftServiceIdea, setIdeaValidation, setInputs, setServiceDecisionStatus, setValidation, setWorkspaceId, setWorkspaceLogo, setWorkspaceName, setWorkspaceLoadedAt, setMemberMode, clearMemberMode]);

  const filteredNav = useMemo(() => {
    const q = String(search || "").trim().toLowerCase();
    const base = !q ? NAV : NAV.filter((i) => `${i.label} ${i.subtitle}`.toLowerCase().includes(q));
    return base.map((item) => ({
      ...item,
      locked: isMemberMode && !hasModuleAccess(item.moduleKey, memberPermissionType, memberPermissions),
    }));
  }, [search, isMemberMode, memberPermissionType, memberPermissions]);

  // Determine if the current route is locked for this member
  const currentRouteModuleKey = useMemo(() => {
    const path = location.pathname;
    if (path.startsWith("/dashboard")) return "dashboard";
    if (path.startsWith("/validation") || path.startsWith("/results")) return "validation";
    if (path.startsWith("/blueprint")) return "blueprint";
    if (path.startsWith("/simulation")) return "simulation";
    if (path.startsWith("/catalogue")) return "catalogue";
    if (path.startsWith("/financials")) return "financials";
    return null;
  }, [location.pathname]);

  const isCurrentRouteLocked = isMemberMode && currentRouteModuleKey && !hasModuleAccess(currentRouteModuleKey, memberPermissionType, memberPermissions);

  const isCreateWorkspaceRoute =
    location.pathname === "/validation" &&
    new URLSearchParams(location.search).get("from") === "module";

  const Sidebar = (
    <aside className="flex h-full w-[260px] flex-col border-r border-slate-200 bg-white px-4 py-4 dark:border-slate-800 dark:bg-slate-950 lg:w-[280px] lg:px-5">
      <div className="mx-1 flex items-start justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <img src={logoUrl} alt="EnterprateAI" className="h-7 w-auto object-contain sm:h-8" />
          </div>
        </div>
        <button className="md:hidden rounded-xl p-2 text-slate-600 hover:bg-slate-100" onClick={() => setMobileOpen(false)}>
          <Icon name="x" />
        </button>
      </div>

      {/* Member mode badge */}
      {isMemberMode && (
        <div className="mx-1 mt-3 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center gap-2">
            <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-600">
              <svg className="h-3 w-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-400">Guest access</div>
              <div className="truncate text-[11px] font-medium text-slate-700 dark:text-slate-300">{memberWorkspaceName || "Shared workspace"}</div>
            </div>
          </div>
        </div>
      )}

      <nav className="ea-scroll mt-4 flex-1 space-y-1 overflow-auto pr-1">
        {filteredNav.map((item) => (
          <SidebarLink
            key={item.to}
            item={item}
            onClick={() => setMobileOpen(false)}
            forceInactive={item.to === "/validation" && isCreateWorkspaceRoute}
            locked={item.locked}
          />
        ))}
      </nav>

      <div className="mt-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900/70 dark:ring-slate-800">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {isMemberMode ? "Shared workspace" : "Workspace"}
          </div>
          {enableHealthCheck ? (
            <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-500">
              <span
                className={
                  "inline-flex h-2 w-2 rounded-full " +
                  (apiStatus === "ok" ? "bg-emerald-500" : apiStatus === "down" ? "bg-rose-500" : "bg-slate-300")
                }
                title={apiStatus}
              />
              <span className="dark:text-slate-400">{apiStatus === "ok" ? "Online" : apiStatus === "down" ? "Offline" : "Checking..."}</span>
            </div>
          ) : null}
        </div>
        <div className="mt-2 text-base font-semibold text-slate-900 dark:text-slate-100">{workspaceDisplayName}</div>
        {isMemberMode ? (
          <>
            <div className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2 py-1 text-[11px] font-semibold text-brand-700 dark:bg-slate-800 dark:text-brand-400">
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              Guest member
            </div>
            <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
              You have limited access. Locked modules are faded in the nav.
            </p>
          </>
        ) : (
          <>
            <div className="mt-1 inline-flex items-center gap-2 rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
              Starter Plan
            </div>
            <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              {acceptedAny
                ? "Workspace verified"
                : rejectedAny
                  ? "Needs review"
                  : "Setup in progress"}
            </div>
            <button
              type="button"
              onClick={() => setInviteOpen(true)}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-3 py-2 text-[12px] font-semibold text-white hover:bg-brand-700 transition"
            >
              <Icon name="user-plus" className="h-3.5 w-3.5" />
              Invite member
            </button>
          </>
        )}
      </div>

      <div className="mt-auto h-2" />
    </aside>
  );

  return (
    <div className="relative h-[100dvh] bg-slate-50 dark:bg-slate-950">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-purple-50 via-blue-50 to-purple-50 dark:from-slate-900 dark:via-slate-950 dark:to-slate-900" />
      <div className="pointer-events-none absolute -top-24 left-1/3 h-72 w-72 -translate-x-1/2 rounded-full bg-purple-200/35 blur-3xl dark:bg-purple-900/30" />
      <div className="pointer-events-none absolute -bottom-24 left-2/3 h-72 w-72 -translate-x-1/2 rounded-full bg-blue-200/30 blur-3xl dark:bg-blue-900/20" />

      <div className="relative flex h-full w-full overflow-hidden">
        <div className="hidden md:block">{Sidebar}</div>

        {mobileOpen ? (
          <div className="fixed inset-0 z-50 md:hidden">
            <div className="absolute inset-0 bg-slate-900/40" onClick={() => setMobileOpen(false)} />
            <div className="absolute inset-y-0 left-0">{Sidebar}</div>
          </div>
        ) : null}

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
            {/* Member mode top banner */}
            {isMemberMode && (
              <div className="flex items-center gap-2 border-b border-brand-100 bg-brand-50 px-4 py-1.5 text-[12px] font-medium text-brand-700 dark:border-slate-800 dark:bg-slate-900/60 dark:text-brand-300">
                <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <span>You're viewing <strong>{memberWorkspaceName || "a shared workspace"}</strong> as a guest. Only your granted modules are accessible.</span>
              </div>
            )}
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
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 shadow-sm outline-none ring-brand-200 focus:ring dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
                    placeholder="Search modules, features..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>

              <div className="relative flex items-center gap-2" ref={profileRef}>
                <button
                  type="button"
                  onClick={() => setProfileOpen((v) => !v)}
                  className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
                >
                  {workspaceLogo ? (
                    <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-white">
                      <img src={workspaceLogo} alt={workspaceDisplayName || "Workspace logo"} className="h-full w-full object-contain" />
                    </span>
                  ) : (
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-white">
                      {profileInitials}
                    </span>
                  )}
                </button>
                {profileOpen ? (
                  <div className="absolute right-0 top-12 z-30 w-56 rounded-2xl border border-slate-200 bg-white p-2 text-xs shadow-xl dark:border-slate-800 dark:bg-slate-900">
                    <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Account</div>
                    {email === "tech.support@enterprateai.com" && (
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20"
                        onClick={() => { setProfileOpen(false); navigate("/ent-admin"); }}
                      >
                        <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0"><path fillRule="evenodd" d="M9.661 2.237a.531.531 0 01.678 0 11.947 11.947 0 007.078 2.749.5.5 0 01.479.425c.069.52.104 1.05.104 1.589 0 5.162-3.26 9.563-7.834 11.256a.48.48 0 01-.332 0C5.26 16.563 2 12.162 2 7c0-.538.035-1.069.104-1.589a.5.5 0 01.48-.425 11.947 11.947 0 007.077-2.749z" clipRule="evenodd" /></svg>
                        Admin dashboard
                      </button>
                    )}
                    {!isMemberMode && (
                      <>
                        <button
                          type="button"
                          className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                          onClick={() => {
                            setProfileOpen(false);
                            const returnTo = encodeURIComponent(location.pathname + location.search);
                            navigate(`/validation?from=module&return=${returnTo}`);
                          }}
                        >
                          Edit workspace
                        </button>
                        <button
                          type="button"
                          className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                          onClick={() => {
                            setProfileOpen(false);
                            navigate("/team");
                          }}
                        >
                          Team & access
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                      onClick={() => {
                        setProfileOpen(false);
                        window.location.href = "mailto:support@enterprate.ai";
                      }}
                    >
                      Help & support
                    </button>
                    <div className="mt-2 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Appearance</div>
                    {[
                      { value: "system", label: "System" },
                      { value: "light", label: "Light" },
                      { value: "dark", label: "Dark" }
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                        onClick={() => setTheme(opt.value)}
                      >
                        <span>{opt.label}</span>
                        <span
                          className={
                            "h-2 w-2 rounded-full " +
                            (theme === opt.value ? "bg-brand-600" : "bg-slate-200")
                          }
                        />
                      </button>
                    ))}
                    <div className="my-2 h-px bg-slate-200 dark:bg-slate-800" />
                    <button
                      type="button"
                      className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                      onClick={() => {
                        setProfileOpen(false);
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
          </header>

          <div className="ea-scroll flex-1 overflow-auto">
            <div className="mx-auto w-full max-w-7xl p-4 md:p-6">
              {isCurrentRouteLocked ? (
                <div className="flex flex-col items-center justify-center py-24 text-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
                    <Icon name="lock" className="h-7 w-7 text-slate-400" />
                  </div>
                  <h2 className="mt-4 text-lg font-semibold text-slate-900 dark:text-slate-100">Access restricted</h2>
                  <p className="mt-2 max-w-sm text-sm text-slate-500 dark:text-slate-400">
                    You don't have permission to view this module. Contact the workspace owner to request access.
                  </p>
                  <button
                    type="button"
                    onClick={() => navigate("/dashboard")}
                    className="mt-6 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 transition"
                  >
                    Back to dashboard
                  </button>
                </div>
              ) : (
                <Outlet />
              )}
            </div>
          </div>
          <BusinessAssistant />
        </main>
      </div>
      {inviteOpen && <InviteModal onClose={() => setInviteOpen(false)} />}
    </div>
  );
}
