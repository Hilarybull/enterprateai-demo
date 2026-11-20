import { useState } from "react";
import { getApiBaseUrl } from "../../api/client";

export default function ChatDownload({ item }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  async function download() {
    setBusy(true);
    setProblem("");
    try {
      const token = localStorage.getItem("ea_token");
      if (!token) throw new Error("Sign in to download this file.");
      const path = `/businesses/${encodeURIComponent(item.business_id)}/agent/files/${encodeURIComponent(item.file_id)}`;
      const response = await fetch(getApiBaseUrl() + path, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error("We couldn’t download that file. Please try again.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = item.name || "Document";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (error) {
      setProblem(error.message);
    } finally { setBusy(false); }
  }
  return <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
    <p className="break-words text-sm font-semibold">{item.name}</p>
    <button type="button" onClick={download} disabled={busy} className="mt-3 min-h-11 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
      {busy ? "Downloading…" : `Download ${item.format === "xlsx" ? "Excel file" : "PDF"}`}
    </button>
    {problem && <p role="alert" className="mt-2 text-sm text-rose-700">{problem}</p>}
  </div>;
}
