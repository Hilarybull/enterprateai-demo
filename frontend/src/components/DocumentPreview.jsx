import Card from "./Card";
import Button from "./Button";

export default function DocumentPreview({ markdown }) {
  return (
    <Card title="Document Preview (Markdown)">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          onClick={async () => {
            await navigator.clipboard.writeText(markdown);
          }}
        >
          Copy
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "enterprateai-document.md";
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          Download
        </Button>
      </div>
      <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm text-slate-800 ring-1 ring-slate-200">
        {markdown}
      </pre>
    </Card>
  );
}
