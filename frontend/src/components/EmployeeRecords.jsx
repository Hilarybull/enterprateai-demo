import { useState } from "react";
import Input from "./Input";
import Button from "./Button";
import SectionCard from "./SectionCard";
import { CardIcon, ActionMenu } from "./MasterRecordUI";

const empty = { name: "", job_title: "", department: "", email: "", phone: "", start_date: "" };
function TeamIcon({ archived = false }) {
  return <CardIcon tone={archived ? "bg-slate-100 text-slate-600" : "bg-sky-50 text-sky-600"}><svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="8" r="3" /><path d="M5 21v-2a7 7 0 0 1 14 0v2M4 8a3 3 0 0 0 0 6M20 8a3 3 0 0 1 0 6" /></svg></CardIcon>;
}
export default function EmployeeRecords({ employees = [], onSave }) {
  const [draft, setDraft] = useState({ ...empty });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  async function save(next, reset = false) {
    setBusy(true); setError("");
    try { await onSave(next); if (reset) setDraft({ ...empty }); }
    catch (e) { setError(e.message || "Your changes could not be saved. Please try again."); }
    finally { setBusy(false); }
  }
  function archive(record, archived) {
    return save(employees.map(item => item.id === record.id ? { ...item, archived, archived_at: archived ? new Date().toISOString() : null } : item), draft.id === record.id);
  }
  const active = employees.filter(e => !e.archived && [e.name, e.job_title, e.department, e.email].join(" ").toLowerCase().includes(query.toLowerCase()));
  const archived = employees.filter(e => e.archived);
  const pages = Math.max(1, Math.ceil(active.length / 6));
  const currentPage = Math.min(page, pages - 1);
  function row(e, isArchived = false) {
    return <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3">
      <div className="min-w-0 flex-1"><div className="break-words text-sm font-semibold text-slate-900">{e.name}</div><div className="break-words text-xs text-slate-500">{[e.job_title || "Role not added", e.department, e.email, e.phone].filter(Boolean).join(" · ")}</div></div>
      <ActionMenu label={`Actions for ${e.name}`} disabled={busy} items={isArchived ? [{label: "Restore", onClick: () => archive(e, false)}] : [{label: "Edit", onClick: () => { setDraft({ ...e }); setError(""); }}, {label: "Archive", onClick: () => archive(e, true)}]} />
    </div>;
  }
  return <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
    <SectionCard title={draft.id ? "Edit employee" : "Employees"} subtitle="Add your team members and their contact details." className="min-w-0 lg:col-span-2" icon={<TeamIcon />}>
      {error ? <p role="alert" className="mb-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
      <form className="grid grid-cols-1 gap-3" onSubmit={e => { e.preventDefault(); const record = { ...draft, name: draft.name.trim(), id: draft.id || crypto.randomUUID(), updated_at: new Date().toISOString() }; if (!record.name) return; save(draft.id ? employees.map(item => item.id === draft.id ? record : item) : [...employees, record], true); }}>
        {[["name", "Full name", "text"], ["job_title", "Job title", "text"], ["department", "Department", "text"], ["email", "Work email", "email"], ["phone", "Phone", "tel"], ["start_date", "Start date", "date"]].map(([key, label, type]) => <label key={key} className="block"><span className="ea-label">{label}{key === "name" ? " *" : ""}</span><Input type={type} required={key === "name"} disabled={busy} value={draft[key] || ""} onChange={e => setDraft({ ...draft, [key]: e.target.value })} /></label>)}
        <div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy}>{busy ? "Saving…" : draft.id ? "Save changes" : "Add employee"}</Button>{draft.id ? <Button type="button" variant="secondary" disabled={busy} onClick={() => setDraft({ ...empty })}>Cancel</Button> : null}</div>
      </form>
    </SectionCard>
    <SectionCard title="Active employees" subtitle="People currently on your team." className="min-w-0 lg:col-span-3 flex flex-col" icon={<TeamIcon />}>
      <Input aria-label="Find an employee" placeholder="Search by name, role or department" value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} />
      <div className="mt-3 flex-1 space-y-2">{active.slice(currentPage * 6, (currentPage + 1) * 6).map(e => row(e))}{!active.length ? <div className="rounded-xl border border-dashed border-slate-200 p-3 text-xs text-slate-500">{query ? "No employees match your search." : "No active employees yet."}</div> : null}</div>
      {pages > 1 ? <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-slate-500">{active.length} employees · Page {currentPage + 1} of {pages}</span><div className="flex gap-2"><Button size="sm" variant="secondary" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Prev</Button><Button size="sm" variant="secondary" disabled={currentPage === pages - 1} onClick={() => setPage(currentPage + 1)}>Next</Button></div></div> : null}
    </SectionCard>
    <SectionCard title="Archived employees" subtitle="Restore team members from the archive." className="min-w-0 lg:col-span-5" icon={<TeamIcon archived />}><div className="space-y-2">{archived.length ? archived.map(e => row(e, true)) : <div className="rounded-xl border border-dashed border-slate-200 p-3 text-xs text-slate-500">No archived employees.</div>}</div></SectionCard>
  </div>;
}
