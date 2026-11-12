// A Request for Proposal's description as the poster typed it: paragraphs, bullet lists and short headings,
// never one run-on block (the owner, 12 Nov).
const BULLET = /^\s*(?:[-*•–—]|\d+[.)])\s+/;

function isHeading(line, next) {
  const t = line.trim();
  if (!t || t.length > 60 || BULLET.test(line)) return false;
  if (t.endsWith(":")) return true;
  // A short line with no full stop, followed by more text, reads as a heading ("Ideal fit").
  return !/[.!?,;]$/.test(t) && t.split(/\s+/).length <= 6 && Boolean(next && next.trim());
}

export function requestBlocks(text) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let para = [];
  let list = null;
  const endPara = () => { if (para.length) { blocks.push({ kind: "p", text: para.join(" ") }); para = []; } };
  const endList = () => { if (list) { blocks.push({ kind: "ul", items: list }); list = null; } };
  lines.forEach((line, i) => {
    const t = line.trim();
    if (!t) { endPara(); endList(); return; }
    if (BULLET.test(line)) { endPara(); (list ||= []).push(t.replace(BULLET, "")); return; }
    endList();
    if (isHeading(line, lines[i + 1])) { endPara(); blocks.push({ kind: "h", text: t }); return; }
    para.push(t);
  });
  endPara(); endList();
  return blocks;
}

export default function RequestText({ text, className = "" }) {
  const blocks = requestBlocks(text);
  if (!blocks.length) return null;
  return (
    <div className={`space-y-3 break-words ${className}`}>
      {blocks.map((b, i) => (b.kind === "h"
        ? <p key={i} className="pt-1 font-semibold text-slate-800 dark:text-slate-200">{b.text}</p>
        : b.kind === "ul"
          ? <ul key={i} className="list-disc space-y-1 pl-5 marker:text-slate-400">{b.items.map((it, j) => <li key={j}>{it}</li>)}</ul>
          : <p key={i}>{b.text}</p>))}
    </div>
  );
}
