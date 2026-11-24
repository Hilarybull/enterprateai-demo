import { getApiBaseUrl } from "../api/client";

// QA R7-5: a business plan or proposal, section by section, as each is written (server-sent events from
// /blueprint/generate/stream). Resolves with the whole document; rejects with an error the page can explain
// (err.data.detail for a refusal, err.retry when trying again may work). Nothing is charged unless it completes.

export const STREAMED_DOCS = ["business_plan", "client_proposal"];

export async function streamBlueprint(body, { onSection = () => {}, signal } = {}) {
  const token = localStorage.getItem("ea_token");
  const res = await fetch(`${getApiBaseUrl()}/blueprint/generate/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    let data = null;
    try { data = await res.json(); } catch { /* no body */ }
    const err = new Error(`HTTP ${res.status}: ${JSON.stringify(data || {})}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let at;
    while ((at = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, at);
      buffer = buffer.slice(at + 2);
      const line = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;      // a keep-alive
      const event = JSON.parse(line.slice(6));
      if (event.type === "section") onSection(event.heading, event.text);
      else if (event.type === "done") return event.result;
      else if (event.type === "error") {
        const err = new Error(event.message || "The document couldn't be generated. Nothing was charged.");
        err.retry = Boolean(event.retry);
        err.status = event.status;
        err.data = event.detail ? { detail: event.detail } : null;
        throw err;
      }
    }
  }
  const err = new Error("The connection closed before the document was finished. Nothing was charged. Please try again.");
  err.retry = true;
  throw err;
}
