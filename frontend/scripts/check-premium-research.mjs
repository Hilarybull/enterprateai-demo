// Dev-only check (QA PF3/PF8): each premium feature walked end to end in headless Chrome, with a real mouse.
//
//   npm run build && node scripts/check-premium-research.mjs
//
// For each of the five first-value checks (launch, pricing, funding, customers, idea) it opens the in-app quick check,
// answers it, double-clicks the premium button (one request must go out, the button shows it is working), sees the
// cost before anything starts, starts the research, sees each finding marked Researched or Estimated with its sources,
// accepts one and rejects one, and sees the score and evidence coverage before and after. The server is stood in for
// by made-up answers in the page (no account, no database): what is checked is the page, end to end.

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PREMIUM_PORT || 4191);
const DEBUG = Number(process.env.PREMIUM_DEBUG_PORT || 9341);
const chrome = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find((p) => p && existsSync(p));
if (!chrome) { console.error("Chrome was not found. Set CHROME_PATH to its executable."); process.exit(2); }
if (!existsSync(join(root, "dist", "index.html"))) { console.error("dist/ is missing. Run `npm run build` first."); process.exit(2); }

const GOALS = [
  { route: "launch", key: "launch", cta: "Resolve my 3 launch blockers" },
  { route: "pricing", key: "price_offer", cta: "Find my best price" },
  { route: "funding", key: "need_funding", cta: "Help me become funding-ready" },
  { route: "customers", key: "more_customers", cta: "Find my best customer opportunities" },
  { route: "idea", key: "test_idea", cta: "Validate the weak points" },
];

const mock = (goal) => `(() => {
  const goal = ${JSON.stringify(goal)};
  window.__calls = [];
  try { localStorage.setItem("ea_token", "check"); localStorage.setItem("ea_email", "owner@check.test");
        localStorage.setItem("ea_cookie_consent", '{"operational":true,"analytics":false}'); localStorage.setItem("cookieConsent", "accepted"); } catch (e) {}
  const J = (b, ms) => new Promise((ok) => setTimeout(() => ok(new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } })), ms || 0));
  const result = { assessment_type: "check", headline: "Your check", score: 42, score_label: "out of 100", evidence_coverage: 40, criteria: [], strengths: ["Target customer identified"],
    metrics: [], blockers: [{ key: "a", label: "Launch channel not defined", kind: "unknown" }, { key: "b", label: "Comparable prices are not known", kind: "unknown" }, { key: "c", label: "Demand not validated", kind: "partial" }],
    premium_next_action: { label: goal.cta, explains: "I can now research what is missing." }, free_next_actions: [{ label: "Save for later", save: true }], premium_gate: { allowed: true } };
  const research = { id: "rr_check", goal: goal.key, status: "review", before: { score: 42, score_label: "out of 100", evidence_coverage: 40, blockers: 3 },
    items: [
      { id: "i1", topic: "channels", label: "Where similar businesses find customers", value: "Local community groups and Nextdoor", state: "researched", confidence: 0.75,
        sources: [{ title: "How small service businesses find clients", url: "https://example.org/finding-clients", date: "Mar 2026" }] },
      { id: "i2", topic: "comparable_prices", label: "Comparable prices", value: "About £15 to £20 an hour", state: "estimated", confidence: 0.4, sources: [] }] };
  window.fetch = (u, init) => {
    u = String(u); const m = (init && init.method) || "GET";
    window.__calls.push(m + " " + u.replace(/^https?:..[^/]+/, ""));
    if (/auth.me/.test(u)) return J({ id: "u1", email: "owner@check.test", name: "Check Owner", email_verified: true, onboarding_completed: true });
    if (/validation.(me|ws1)/.test(u)) return J({ id: "ws1", name: "Check Ltd", data: { workspace_profile: { company_name: "Check Ltd" }, financials: {}, catalogue: { products: [], customers: [] } } });
    if (/quick-check.[a-z_]+.premium.quote$/.test(u)) return J({ allowed: true, cost: 2, balance: 20, after: 18, topics: ["Where similar businesses find customers", "Comparable prices"], blockers: 3 }, 300);
    if (/quick-check.[a-z_]+.premium$/.test(u)) return J({ started: true, research }, 400);
    if (/research.rr_check.review$/.test(u)) return J({ research: { ...research, status: "adopted", dataset_version: 1, after: { score: 47, score_label: "out of 100", evidence_coverage: 50, blockers: 3 } }, result });
    if (/quick-check.[a-z_]+$/.test(u) && m === "GET") return J({ goal_key: goal.key, questions: [{ key: "kind", label: "Pick one to start", type: "choice", required: true, options: [{ value: "x", label: "Go" }] }] });
    if (/quick-check.[a-z_]+$/.test(u)) return J({ result });
    if (/plans.my|auth.grants/.test(u)) return J(null);
    if (/workspaces|notifications|blog|categories|members|invitations|restrictions|runs|approvals|announcements|suggestions/.test(u)) return J([]);
    return J({});
  };
})();`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), "premium-check-"));
const server = spawn(process.execPath, [join(root, "node_modules", "vite", "bin", "vite.js"), "preview", "--port", String(PORT), "--strictPort"], { cwd: root, stdio: "ignore" });
const browser = spawn(chrome, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${profile}`, "--window-size=1280,1000", "about:blank"], { stdio: "ignore" });
const cleanUp = () => { for (const p of [browser, server]) { try { p.kill(); } catch { /* gone */ } } try { rmSync(profile, { recursive: true, force: true }); } catch { /* held */ } };
process.on("exit", cleanUp);
async function up(url) {
  for (let n = 0; n < 60; n += 1) { try { const r = await fetch(url); if (r.ok) return r; } catch { /* not yet */ } await sleep(250); }
  throw new Error(`${url} did not answer`);
}
await up(`http://localhost:${PORT}/`);
const page = (await (await up(`http://127.0.0.1:${DEBUG}/json/list`)).json()).find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = bad; });
let seq = 0;
const waiting = new Map();
ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); } };
const send = (method, params = {}) => new Promise((ok) => { seq += 1; waiting.set(seq, ok); ws.send(JSON.stringify({ id: seq, method, params })); });
const value = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true })).result?.result?.value;
await send("Page.enable");
await send("Runtime.enable");

const results = [];
const check = (name, ok, got) => { results.push(ok); console.log(`${ok ? "ok  " : "FAIL"}  ${name}${ok ? "" : `  (got ${JSON.stringify(got)})`}`); };
const until = async (expression, ms = 8000) => { for (let t = 0; t < ms; t += 100) { if (await value(expression)) return true; await sleep(100); } return false; };
const centreOf = (js) => value(`(() => { const el = ${js}; if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
const button = (text) => `[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === ${JSON.stringify(text)})`;
async function click(js, times = 1) {
  const at = await centreOf(js);
  if (!at) return false;
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y, button: "none" });
  for (let n = 0; n < times; n += 1) {
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: at.x, y: at.y, button: "left", buttons: 1, clickCount: n + 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: at.x, y: at.y, button: "left", buttons: 0, clickCount: n + 1 });
  }
  return true;
}

let script = null;
for (const goal of GOALS) {
  console.log(`\n${goal.cta} (/check/${goal.route})`);
  if (script) await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: script });
  script = (await send("Page.addScriptToEvaluateOnNewDocument", { source: mock(goal) })).result.identifier;
  await send("Page.navigate", { url: `http://localhost:${PORT}/check/${goal.route}` });
  // The first page in a fresh browser loads the whole app cold: it is given longer.
  check("the quick check opens", await until(`!!${button("Go")}`, goal === GOALS[0] ? 30000 : 8000), null);
  await click(button("Go"));
  check("the free result is shown", await until(`!!${button(goal.cta)}`), null);
  await click(button(goal.cta), 2);                          // a double click
  await sleep(80);
  check("the button says it is working, and is disabled", await value(`(() => { const b = document.querySelector("[data-fv-premium]"); return b.disabled && /Working/.test(b.textContent); })()`), await value(`document.querySelector("[data-fv-premium]")?.outerHTML.slice(0, 200)`));
  check("the cost is shown before anything starts", await until(`/2 AI Credits: 20 → 18/.test(document.querySelector("[data-fv-cost]")?.textContent || "")`), await value(`document.querySelector("[data-fv-cost]")?.textContent`));
  check("one press, one request", (await value(`window.__calls.filter((c) => /premium.quote$/.test(c)).length`)) === 1, await value(`window.__calls.filter((c) => /premium/.test(c))`));
  check("nothing started before Start", (await value(`window.__calls.filter((c) => /premium$/.test(c)).length`)) === 0, null);
  await click(button("Start the research"), 2);
  check("Start shows it is researching", await value(`/Researching/.test(document.querySelector("[data-fv-start]")?.textContent || "")`), await value(`document.querySelector("[data-fv-start]")?.textContent`));
  check("the review appears", await until(`!!document.querySelector("[data-research-review]")`), null);
  check("started once", (await value(`window.__calls.filter((c) => /premium$/.test(c)).length`)) === 1, await value(`window.__calls.filter((c) => /premium$/.test(c))`));
  const states = await value(`[...document.querySelectorAll("[data-research-state]")].map((s) => s.textContent)`);
  check("findings are Researched or Estimated", JSON.stringify(states) === JSON.stringify(["Researched", "Estimated"]), states);
  check("a researched finding has its source and date", /How small service businesses find clients · Mar 2026/.test(await value(`document.querySelector("[data-research-sources]")?.textContent || ""`)), null);
  await click(`document.querySelectorAll("[data-research-item]")[1].querySelectorAll("button")[2]`);      // Reject the estimate
  await click(button("Use what I accepted and check again"));
  check("before and after are shown", await until(`/42 → 47/.test(document.querySelector("[data-score-change]")?.textContent || "") && /40% → 50%/.test(document.querySelector("[data-coverage-change]")?.textContent || "")`),
    await value(`document.querySelector("[data-research-adopted]")?.textContent`));
  const body = await value(`window.__calls.filter((c) => /review$/.test(c)).length`);
  check("the decisions were sent once", body === 1, body);
}

ws.close();
cleanUp();
const failed = results.filter((r) => !r).length;
console.log(failed ? `\n${failed} check${failed === 1 ? "" : "s"} failed.` : "\nEvery premium feature: cost first, one press, research reviewed, before and after.");
process.exit(failed ? 1 : 0);
