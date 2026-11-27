import { useEffect, useRef, useState } from "react";
import { apiRequest } from "../../api/client";
import { Icon } from "./AgentBits";

const TYPES = [["Upload a document", ".pdf,.docx,.txt", "PDF, Word or text", "doc"], ["Upload an image", ".png,.jpg,.jpeg", "Photos or screenshots", "image"], ["Upload a spreadsheet", ".csv,.xlsx", "Excel or CSV", "table"]];
export default function ChatAttachments({ businessId, disabled, onPick, onSaved }) {
  const [open, setOpen] = useState(false), [saved, setSaved] = useState(null), [loading, setLoading] = useState(false), [error, setError] = useState("");
  const root = useRef(null), trigger = useRef(null), file = useRef(null);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  useEffect(() => {
    const outside = e => { if (!root.current?.contains(e.target)) setOpen(false); };
    const upload = () => { if (!disabled && businessId) { setSaved(null); setOpen(true); } };
    document.addEventListener("pointerdown", outside); window.addEventListener("ea:chat-upload", upload);
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("ea:chat-upload", upload); };
  }, [disabled, businessId]);
  useEffect(() => { if (open) root.current?.querySelector('[role="menuitem"]')?.focus(); }, [open, saved]);
  useEffect(() => { setOpen(false); setSaved(null); }, [businessId]);
  const choose = accept => { file.current.accept = accept; file.current.click(); close(); };
  async function browse() {
    setLoading(true); setError(""); setSaved([]);
    try { const result = await apiRequest(`/businesses/${encodeURIComponent(businessId)}/agent/files`); setSaved(result.documents || []); }
    catch { setError("Couldn't load your saved files. Try again."); }
    finally { setLoading(false); }
  }
  function keys(e) {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
      e.preventDefault(); const buttons = [...root.current.querySelectorAll('[role="menuitem"]')];
      const index = buttons.indexOf(document.activeElement);
      buttons[e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 : (index + (e.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length]?.focus();
    }
  }
  return <div ref={root} className="relative shrink-0" onKeyDown={keys}>
    <input ref={file} type="file" className="hidden" data-chat-file onChange={e => { const selected = e.target.files?.[0]; e.target.value = ""; if (selected) onPick(selected); }} />
    <button ref={trigger} type="button" disabled={disabled || !businessId} aria-label="Attach a document" aria-haspopup="menu" aria-expanded={open} onClick={() => { setSaved(null); setError(""); setOpen(!open); }} className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-40">
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.5l-8.5 8.5a6 6 0 01-8.5-8.5l9-9a4 4 0 015.7 5.7l-9 9a2 2 0 01-2.8-2.8l8.3-8.3" /></svg>
    </button>
    {open && <div role="menu" aria-label="Attachment options" className="absolute bottom-full left-0 z-50 mb-3 max-h-[60dvh] w-72 max-w-[calc(100vw-3rem)] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900">
      {saved === null ? <>{TYPES.map(([label, accept, detail, icon]) => <button key={label} type="button" role="menuitem" onClick={() => choose(accept)} className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-slate-100 focus:bg-slate-100 dark:hover:bg-slate-800 dark:focus:bg-slate-800"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-slate-800 dark:text-brand-300"><Icon name={icon} /></span><span><span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">{label}</span><span className="block text-xs text-slate-500">{detail}</span></span></button>)}
        <button type="button" role="menuitem" onClick={browse} className="mt-1 flex min-h-11 w-full items-center gap-3 rounded-xl border-t border-slate-100 px-3 py-3 text-left text-sm font-semibold text-brand-700 hover:bg-slate-100 dark:border-slate-700 dark:text-brand-300 dark:hover:bg-slate-800"><Icon name="folder" className="h-5 w-5 shrink-0" />Choose a saved file</button></> : <>
        <button type="button" role="menuitem" onClick={() => { setSaved(null); setError(""); }} className="min-h-11 rounded-lg px-3 text-sm font-semibold text-brand-700">← Attachment options</button>
        {loading ? <p role="status" className="p-3 text-sm text-slate-500">Loading saved files…</p> : saved.map(doc => <button type="button" role="menuitem" key={doc.id} onClick={() => { close(); onSaved(doc); }} className="block min-h-11 w-full break-words rounded-xl px-3 py-3 text-left text-sm text-slate-800 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800">{doc.name || "Untitled file"}</button>)}
        {!loading && !error && !saved.length && <p className="p-3 text-sm text-slate-500">No saved files yet. Upload a file to get started.</p>}
        {error && <div role="alert" className="p-3 text-sm text-rose-600">{error}<button type="button" role="menuitem" onClick={browse} className="block min-h-11 font-semibold">Try again</button></div>}
      </>}
    </div>}
  </div>;
}
