import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import DOMPurify from "dompurify";

// The message box for emails written in the superadmin (the owner, 12 Nov): formatting, links and attachments.
// What it hands back: html (cleaned), text (the same message as plain words, for mail apps that show no formatting)
// and attachments as { filename, content } with the file in base64, the way Resend takes them.

export const MAX_ATTACHMENTS = 10;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;      // all files together
const ALLOWED = { ALLOWED_TAGS: ["p", "br", "div", "b", "strong", "i", "em", "u", "s", "strike", "h2", "h3", "ul", "ol", "li", "blockquote", "a"], ALLOWED_ATTR: ["href"] };

// Each person's own details, filled in as each copy is sent. "who" says which lists have it.
export const EMAIL_VARIABLES = [
  { key: "name", label: "Name", hint: "Their name, or \"there\" when it isn't known", who: ["one", "users", "workspaces", "claimed", "unclaimed"] },
  { key: "first_name", label: "First name", hint: "Their first name, or \"there\"", who: ["one", "users", "workspaces", "claimed", "unclaimed"] },
  { key: "email", label: "Email address", hint: "The address this copy goes to", who: ["one", "users", "workspaces", "claimed", "unclaimed"] },
  { key: "login_link", label: "Sign in link", hint: "Our sign in page", who: ["one", "users", "workspaces", "claimed", "unclaimed"] },
  { key: "business", label: "Business name", hint: "Their workspace or business", who: ["workspaces", "claimed", "unclaimed"] },
  { key: "profile_link", label: "Profile link", hint: "Their own Marketplace profile page", who: ["claimed", "unclaimed"] },
  { key: "claim_link", label: "Claim link", hint: "Their own page to claim their business", who: ["unclaimed"] },
];
const KNOWN = new Set(EMAIL_VARIABLES.map((v) => v.key));
/** Variables typed in that can't be filled in, like {message}. */
export const unknownVariables = (...parts) => [...new Set(parts.flatMap((p) => [...String(p || "").matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((m) => m[1])))].filter((k) => !KNOWN.has(k)).map((k) => `{${k}}`);

export const cleanHtml = (html) => DOMPurify.sanitize(html || "", ALLOWED);
const sizeWords = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const asBase64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(",", 2)[1] || "");
  r.onerror = () => reject(r.error);
  r.readAsDataURL(file);
});

const TOOLS = [
  ["bold", "B", "Bold", "font-bold"], ["italic", "I", "Italic", "italic"], ["underline", "U", "Underline", "underline"],
  ["strikeThrough", "S", "Strikethrough", "line-through"], null,
  ["h2", "H", "Heading", "font-bold"], ["p", "¶", "Normal text", ""], null,
  ["insertUnorderedList", "•", "Bulleted list", ""], ["insertOrderedList", "1.", "Numbered list", ""], ["blockquote", "❝", "Quote", ""], null,
  ["link", "Link", "Insert link", ""], ["unlink", "Unlink", "Remove link", ""], ["removeFormat", "Clear", "Clear formatting", ""], null,
  ["undo", "↶", "Undo", ""], ["redo", "↷", "Redo", ""],
];

const RichEmailEditor = forwardRef(function RichEmailEditor({ onChange, label = "Message", files, onFiles, variables = EMAIL_VARIABLES }, ref) {
  const box = useRef(null);
  const saved = useRef(null);
  const picker = useRef(null);
  const [link, setLink] = useState(null);      // the address being typed for a link, or null when closed
  const [problem, setProblem] = useState(null);
  const [menu, setMenu] = useState(false);

  const report = () => {
    const el = box.current;
    onChange?.({ html: cleanHtml(el?.innerHTML), text: (el?.innerText ?? el?.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim() });
  };
  useImperativeHandle(ref, () => ({ clear() { if (box.current) box.current.innerHTML = ""; report(); } }));

  const keepSelection = () => {
    const s = window.getSelection();
    if (s && s.rangeCount && box.current?.contains(s.anchorNode)) saved.current = s.getRangeAt(0).cloneRange();
  };
  const restoreSelection = () => {
    box.current?.focus();
    if (!saved.current) return;
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(saved.current);
  };
  function run(cmd) {
    if (cmd === "link") { keepSelection(); setLink(""); return; }
    box.current?.focus();
    if (cmd === "h2" || cmd === "p" || cmd === "blockquote") document.execCommand("formatBlock", false, cmd);
    else document.execCommand(cmd, false, null);
    report();
  }
  function addLink(e) {
    e?.preventDefault();
    let url = (link || "").trim();
    if (!url) { setLink(null); return; }
    if (!/^(https?:|mailto:)/i.test(url) && !/^\{[a-z_]*_link\}$/.test(url)) url = url.includes("@") && !url.includes("/") ? `mailto:${url}` : `https://${url}`;
    restoreSelection();
    const s = window.getSelection();
    if (s && s.isCollapsed) document.execCommand("insertHTML", false, `<a href="${url.replace(/"/g, "&quot;")}">${url.replace(/^mailto:/, "").replace(/</g, "&lt;")}</a>`);
    else document.execCommand("createLink", false, url);
    setLink(null);
    report();
  }
  function insertVariable(key) {
    restoreSelection();
    document.execCommand("insertText", false, `{${key}}`);
    setMenu(false);
    report();
  }
  async function attach(list) {
    setProblem(null);
    const chosen = [...(list || [])];
    if (!chosen.length) return;
    const all = [...(files || [])];
    for (const f of chosen) {
      if (all.length >= MAX_ATTACHMENTS) { setProblem(`Up to ${MAX_ATTACHMENTS} files.`); break; }
      const total = all.reduce((n, x) => n + x.size, 0) + f.size;
      if (total > MAX_ATTACHMENT_BYTES) { setProblem(`Files can add up to ${sizeWords(MAX_ATTACHMENT_BYTES)} at most. ${f.name} doesn't fit.`); continue; }
      try { all.push({ filename: f.name, size: f.size, content: await asBase64(f) }); }
      catch { setProblem(`${f.name} couldn't be read.`); }
    }
    onFiles?.(all);
    if (picker.current) picker.current.value = "";
  }

  return (
    <div>
      <span className="block text-[12px] font-semibold text-slate-700 dark:text-slate-200">{label}</span>
      <div className="mt-1 overflow-hidden rounded-xl border border-slate-300 bg-white focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20 dark:border-slate-700 dark:bg-slate-950">
        <div role="toolbar" aria-label="Formatting" className="flex flex-wrap items-center gap-0.5 border-b border-slate-200 bg-slate-50 px-1.5 py-1 dark:border-slate-800 dark:bg-slate-900">
          {TOOLS.map((t, i) => (t ? (
            <button key={t[0]} type="button" title={t[2]} aria-label={t[2]} onMouseDown={(e) => { e.preventDefault(); keepSelection(); }} onClick={() => run(t[0])}
              className={`min-w-[30px] rounded-md px-2 py-1 text-[13px] text-slate-700 hover:bg-slate-200 dark:text-slate-200 dark:hover:bg-slate-800 ${t[3]}`}>{t[1]}</button>
          ) : <span key={`gap${i}`} aria-hidden="true" className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" />))}
          <span aria-hidden="true" className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" />
          <span className="relative">
            <button type="button" aria-haspopup="menu" aria-expanded={menu} onMouseDown={(e) => { e.preventDefault(); keepSelection(); }} onClick={() => setMenu((m) => !m)}
              className="rounded-md px-2 py-1 text-[13px] font-medium text-slate-700 hover:bg-slate-200 dark:text-slate-200 dark:hover:bg-slate-800">{"{ }"} Variables</button>
            {menu && (
              <span role="menu" aria-label="Variables" className="absolute left-0 top-full z-20 mt-1 block w-72 rounded-xl border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                {variables.map((v) => (
                  <button key={v.key} type="button" role="menuitem" onMouseDown={(e) => e.preventDefault()} onClick={() => insertVariable(v.key)}
                    className="block w-full rounded-lg px-2.5 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800">
                    <span className="flex items-center justify-between gap-2 text-[13px] font-semibold text-slate-800 dark:text-slate-100">{v.label}<code className="text-[11px] font-normal text-brand-600">{`{${v.key}}`}</code></span>
                    <span className="block text-[11px] text-slate-500">{v.hint}{v.note ? `. ${v.note}` : ""}</span>
                  </button>
                ))}
                <span className="block px-2.5 pb-1 pt-1.5 text-[11px] text-slate-400">Each person gets their own. You can type these in the subject too.</span>
              </span>
            )}
          </span>
          <button type="button" onClick={() => picker.current?.click()} className="rounded-md px-2 py-1 text-[13px] font-medium text-slate-700 hover:bg-slate-200 dark:text-slate-200 dark:hover:bg-slate-800">📎 Attach files</button>
          <input ref={picker} type="file" multiple hidden aria-label="Attach files" onChange={(e) => attach(e.target.files)} />
        </div>
        {link !== null && (
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-2 py-1.5 dark:border-slate-800 dark:bg-slate-950">
            <input autoFocus aria-label="Link address" placeholder="Web address, email, or a link variable like {claim_link}" value={link} onChange={(e) => setLink(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addLink(e); if (e.key === "Escape") setLink(null); }}
              className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-[13px] dark:border-slate-700 dark:bg-slate-900" />
            <button type="button" onClick={addLink} className="rounded-md bg-brand-600 px-3 py-1 text-[12px] font-semibold text-white hover:bg-brand-700">Add link</button>
            <button type="button" onClick={() => setLink(null)} className="rounded-md px-2 py-1 text-[12px] text-slate-600 hover:bg-slate-100 dark:text-slate-300">Cancel</button>
          </div>
        )}
        <div ref={box} role="textbox" aria-multiline="true" aria-label={label} contentEditable suppressContentEditableWarning
          onInput={report} onBlur={keepSelection} onKeyUp={keepSelection} onMouseUp={keepSelection}
          onDrop={(e) => { if (e.dataTransfer?.files?.length) { e.preventDefault(); attach(e.dataTransfer.files); } }}
          className="rich-email min-h-[180px] max-h-[460px] overflow-y-auto px-3 py-2 text-[14px] leading-relaxed text-slate-800 outline-none dark:text-slate-100 [&_a]:text-brand-600 [&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:border-slate-300 [&_blockquote]:pl-3 [&_blockquote]:text-slate-600 [&_h2]:text-[18px] [&_h2]:font-bold [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6" />
      </div>
      {problem && <p role="alert" className="mt-1 text-[12px] font-medium text-rose-600">{problem}</p>}
      {files?.length > 0 && (
        <ul aria-label="Attached files" className="mt-2 flex flex-wrap gap-1.5">
          {files.map((f, i) => (
            <li key={`${f.filename}${i}`} className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 py-0.5 pl-3 pr-1 text-[12px] text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
              📎 {f.filename} <span className="text-slate-400">{sizeWords(f.size)}</span>
              <button type="button" aria-label={`Remove ${f.filename}`} onClick={() => onFiles?.(files.filter((_, j) => j !== i))} className="rounded-full px-1.5 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800">×</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});

export default RichEmailEditor;
