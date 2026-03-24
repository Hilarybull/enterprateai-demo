import { useState } from "react";
import Button from "../../../components/Button";

export default function CopyField({ label, value }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const text = String(value ?? "");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 800);
    } catch {
      // ignore
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
          <div className="mt-1 truncate text-sm font-semibold text-slate-900">{value || "-"}</div>
        </div>
        <Button variant="secondary" className="shrink-0 px-3 py-2 text-xs" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}

