import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import DocumentEditor from "../components/DocumentEditor";
import Spinner from "../components/Spinner";
import Button from "../components/Button";
import { apiRequest } from "../api/client";

export default function SharedBlueprintPage() {
  const { token } = useParams();
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const shareUrl = useMemo(() => `${window.location.origin}/share/${token || ""}`, [token]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!token) {
        setError("Missing share token.");
        setLoading(false);
        return;
      }
      setLoading(true);
      setError("");
      try {
        const data = await apiRequest(`/blueprint/share/${token}`, "GET");
        if (!cancelled) setDoc(data);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unable to load shared document.";
        if (!cancelled) setError(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-6xl px-6 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-slate-900">Shared document</div>
            <div className="mt-1 text-xs text-slate-500">Read-only view</div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={async () => {
                await navigator.clipboard.writeText(shareUrl);
              }}
            >
              Copy link
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="mt-6 flex items-center justify-center rounded-2xl border border-slate-200 bg-white p-8">
            <Spinner />
          </div>
        ) : error ? (
          <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : doc?.document_markdown ? (
          <div className="mt-6 h-[calc(100vh-140px)] min-h-[520px]">
            <DocumentEditor
              title={doc?.title || "Document"}
              markdown={doc.document_markdown}
              initialHtml={doc.document_html || ""}
              onHtmlChange={() => {}}
              defaultMode="preview"
              compactPreview
              showEditButton={false}
              showSaveButton={false}
              onDownload={null}
              onSave={null}
            />
          </div>
        ) : (
          <div className="mt-6 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
            This share link is valid, but the document is empty.
          </div>
        )}
      </div>
    </div>
  );
}

