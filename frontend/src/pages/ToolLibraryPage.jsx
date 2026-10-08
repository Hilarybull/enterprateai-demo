import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import { useAuthStore } from "../store/auth";
import { useWorkspaceStore } from "../store/workspace";
import { trackDashboard } from "../lib/dashboard";
import { TOOLS, TOOL_GROUPS, searchTools, toolAccess } from "../lib/tools";

// Every tool this account can open, in one place. The dashboard decides what deserves
// attention now; this is where anything else is found. Tools open the existing pages for
// the current business, so nothing is duplicated.
export default function ToolLibraryPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [query, setQuery] = useState(params.get("q") || "");      // a search started from the dashboard carries over
  const subscription = useAuthStore((s) => s.subscription);
  const platformGrants = useAuthStore((s) => s.platformGrants);
  const platformRestrictions = useAuthStore((s) => s.platformRestrictions);
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const isMemberMode = useWorkspaceStore((s) => s.isMemberMode);
  const memberPermissionType = useWorkspaceStore((s) => s.memberPermissionType);
  const memberPermissions = useWorkspaceStore((s) => s.memberPermissions);

  const visible = useMemo(() => {
    const who = { subscription, platformGrants, platformRestrictions, isMemberMode, memberPermissionType, memberPermissions };
    return TOOLS.map((t) => ({ ...t, access: toolAccess(t, who) })).filter((t) => t.access.state !== "hidden");
  }, [subscription, platformGrants, platformRestrictions, isMemberMode, memberPermissionType, memberPermissions]);
  const found = useMemo(() => searchTools(visible, query), [visible, query]);
  const groups = TOOL_GROUPS.map((g) => ({ name: g, tools: found.filter((t) => t.group === g) })).filter((g) => g.tools.length);

  function open(tool) {
    trackDashboard(workspaceId, tool.access.state === "upgrade" ? "upgrade_clicked" : "tool_opened", tool.id, { source: "tool_library" });
    navigate(tool.access.state === "upgrade" ? "/pricing" : tool.to);
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Tool Library" description="Every EnterprateAI tool available to you. Your dashboard shows what needs attention now; open anything else from here." />

      <div className="relative max-w-xl">
        <svg className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
        </svg>
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search tools"
          placeholder="Search tools, e.g. invoices, cash forecast, quotation"
          className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm text-slate-900 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
      </div>

      {groups.length === 0 ? (
        <p role="status" className="rounded-2xl border border-slate-200 bg-white px-5 py-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">
          No tool matches “{query}”. Try a different word, such as “invoice”, “plan” or “scenario”.
        </p>
      ) : groups.map((group) => (
        <section key={group.name} aria-labelledby={`tools-${group.name}`}>
          <h2 id={`tools-${group.name}`} className="mb-3 text-[13px] font-semibold uppercase tracking-[0.14em] text-slate-400">{group.name}</h2>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {group.tools.map((tool) => {
              const locked = tool.access.state === "upgrade";
              return (
                <li key={tool.id}>
                  <button type="button" onClick={() => open(tool)}
                    aria-label={locked ? `${tool.name}: available on ${tool.access.plan}. See plans` : `Open ${tool.name}`}
                    className="group flex h-full w-full flex-col rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-brand-300 hover:shadow dark:border-slate-800 dark:bg-slate-900">
                    <span className="flex items-start justify-between gap-3">
                      <span className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">{tool.name}</span>
                      {locked ? (
                        <span className="shrink-0 rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200">
                          {tool.access.plan} plan
                        </span>
                      ) : (
                        <svg className="mt-1 h-4 w-4 shrink-0 text-slate-300 transition group-hover:text-brand-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
                      )}
                    </span>
                    <span className="mt-1.5 text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">{tool.description}</span>
                    {locked && <span className="mt-2 text-[12px] font-semibold text-brand-600">Upgrade to unlock</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
