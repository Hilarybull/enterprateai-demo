// Dev-only check (QA R9): every premium button walked in headless Chrome, with the real quick-check screens and LIVE
// research (the real search and model). The page's business calls go to an API given in PREMIUM_LIVE_API, which holds
// a synthetic workspace in memory (never the dev database); only sign-in and the workspace list are stood in for.
//
//   PREMIUM_LIVE_API=http://127.0.0.1:8021 PREMIUM_ANSWERS='{"launch":{...}}' node scripts/check-premium-live.mjs
//
// For each check: answers the quick check through its own screens, presses the premium button, reads the cost, starts
// the research, records what the review shows (researched / estimated / on record / calculated / to answer / sources),
// adopts the proposals ("Adopt all"), skips the questions, and records the score before and after and the time taken.

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const LIVE = process.env.PREMIUM_LIVE_API;
const ANSWERS = JSON.parse(process.env.PREMIUM_ANSWERS || "{}");
const OUT = process.env.PREMIUM_OUT || "";
const PORT = Number(process.env.PREMIUM_PORT || 4193);
const DEBUG = Number(process.env.PREMIUM_DEBUG_PORT || 9343);
if (!LIVE) { console.error("Set PREMIUM_LIVE_API to the live API's address."); process.exit(2); }
const chrome = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((p) => p && existsSync(p));
if (!chrome) { console.error("Chrome was not found."); process.exit(2); }

const GOALS = [["launch", "launch"], ["funding", "need_funding"], ["pricing", "price_offer"], ["customers", "more_customers"], ["idea", "test_idea"]];

const mock = () => `(() => {
  const LIVE = ${JSON.stringify(LIVE)};
  try { localStorage.setItem("ea_token", "check"); localStorage.setItem("ea_email", "owner@check.test");
        localStorage.setItem("ea_cookie_consent", '{"operational":true,"analytics":false}'); localStorage.setItem("cookieConsent", "accepted"); } catch (e) {}
  const J = (b) => Promise.resolve(new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } }));
  const real = window.fetch.bind(window);
  window.__premium = [];
  window.fetch = (u, init) => {
    u = String(u);
    const path = u.replace(/^https?:..[^/]+/, "");
    if (/^\\/businesses\\/|^\\/health/.test(path)) {
      return real(LIVE + path.replace(/^\\/businesses\\/[^/]+/, "/businesses/A"), init).then(async (res) => {
        if (/premium$/.test(path)) { try { window.__premium.push(await res.clone().json()); } catch (e) {} }
        return res;
      });
    }
    if (/auth.me/.test(u)) return J({ id: "u1", email: "owner@check.test", name: "Check Owner", email_verified: true, onboarding_completed: true });
    if (/validation.(me|A)/.test(u)) return J({ id: "A", name: "Synthetic workspace", data: { workspace_profile: { company_name: "Synthetic workspace" }, financials: {}, catalogue: { products: [], customers: [] } } });
    if (/plans.my|auth.grants/.test(u)) return J(null);
    if (/workspaces|notifications|blog|categories|members|invitations|restrictions|runs|approvals|announcements|suggestions/.test(u)) return J([]);
    return J({});
  };
})();`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), "premium-live-"));
const server = spawn(process.execPath, [join(root, "node_modules", "vite", "bin", "vite.js"), "preview", "--port", String(PORT), "--strictPort"], { cwd: root, stdio: "ignore" });
const browser = spawn(chrome, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${profile}`, "--window-size=1280,1100", "about:blank"], { stdio: "ignore" });
const cleanUp = () => { for (const p of [browser, server]) { try { p.kill(); } catch { /* gone */ } } try { rmSync(profile, { recursive: true, force: true }); } catch { /* held */ } };
process.on("exit", cleanUp);
async function up(url) { for (let n = 0; n < 80; n += 1) { try { const r = await fetch(url); if (r.ok) return r; } catch { /* not yet */ } await sleep(250); } throw new Error(`${url} did not answer`); }
await up(`http://localhost:${PORT}/`);
const page = (await (await up(`http://127.0.0.1:${DEBUG}/json/list`)).json()).find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = bad; });
let seq = 0;
const waiting = new Map();
ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); } };
const send = (method, params = {}) => new Promise((ok) => { seq += 1; waiting.set(seq, ok); ws.send(JSON.stringify({ id: seq, method, params })); });
const value = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
const until = async (expression, ms = 10000) => { for (let t = 0; t < ms; t += 200) { if (await value(expression)) return true; await sleep(200); } return false; };
async function clickAt(js) {
  const at = await value(`(() => { const el = ${js}; if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  if (!at) return false;
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y, button: "none" });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: at.x, y: at.y, button: "left", buttons: 1, clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: at.x, y: at.y, button: "left", buttons: 0, clickCount: 1 });
  return true;
}
const button = (text) => `[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === ${JSON.stringify(text)})`;
await send("Page.enable");
await send("Runtime.enable");
await send("Page.addScriptToEvaluateOnNewDocument", { source: mock() });

const report = [];
console.log("health:", await (await fetch(`${LIVE}/health/research`)).text());
for (const [route, key] of GOALS) {
  const started = Date.now();
  await send("Page.navigate", { url: `http://localhost:${PORT}/check/${route}` });
  if (!(await until(`!!document.querySelector("[data-quick-check] form, [data-quick-check] [data-said]")`, 30000))) { report.push({ check: key, error: "the quick check did not open" }); continue; }
  const answers = ANSWERS[key] || {};
  // The quick check's own screens: each question, one at a time.
  for (let n = 0; n < 15; n += 1) {
    if (await value(`!!document.querySelector("[data-first-value]")`)) break;
    const q = await value(`(() => { const f = document.querySelector("[data-quick-check] form"); if (!f) return null; const input = f.querySelector("input[id^=qc-], textarea[id^=qc-]");
      const group = f.querySelector("[role=group]"); return { key: input ? input.id.slice(3) : null, filled: input ? input.value : "", options: group ? [...group.querySelectorAll("button")].map((b) => b.textContent.trim()) : [] }; })()`);
    if (!q) { await sleep(300); continue; }
    if (q.options.length && !q.key) {
      const want = String(answers[await value(`document.querySelector("[data-quick-check] form label, [data-quick-check] form [role=group]")?.getAttribute("aria-label") || ""`)] || "");
      const pick = q.options.find((o) => want && o.toLowerCase().includes(want.toLowerCase())) || q.options[0];
      await clickAt(`[...document.querySelectorAll("[data-quick-check] form [role=group] button")].find((b) => b.textContent.trim() === ${JSON.stringify(pick)})`);
    } else {
      const give = answers[q.key] != null ? String(answers[q.key]) : q.filled || "Not sure";
      await value(`(() => { const el = document.getElementById("qc-${q.key}"); const setter = Object.getOwnPropertyDescriptor(el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value").set;
        setter.call(el, ${JSON.stringify(give)}); el.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
      await clickAt(`document.querySelector("[data-quick-check] form button[type=submit]")`);
    }
    await sleep(400);
  }
  if (!(await until(`!!document.querySelector("[data-fv-premium]")`, 20000))) { report.push({ check: key, error: "no result card" }); continue; }
  const label = await value(`document.querySelector("[data-fv-premium]").textContent.trim()`);
  const before = await value(`document.querySelector("[data-fv-score]")?.textContent.trim()`);
  await clickAt(`document.querySelector("[data-fv-premium]")`);
  await until(`!!document.querySelector("[data-fv-confirm]") || !!document.querySelector("[data-fv-gate]")`, 20000);
  const cost = await value(`document.querySelector("[data-fv-cost]")?.textContent || document.querySelector("[data-fv-gate]")?.textContent || ""`);
  const plan = await value(`document.querySelector("[data-fv-plan]")?.textContent || ""`);
  await clickAt(button("Start the research"));
  const t0 = Date.now();
  await until(`!!document.querySelector("[data-research-review]") || !!document.querySelector("[data-research-adopted]")`, 180000);
  const researchSeconds = Math.round((Date.now() - t0) / 100) / 10;
  const counts = await value(`document.querySelector("[data-research-counts]")?.textContent || ""`);
  const items = await value(`[...document.querySelectorAll("[data-research-item]")].map((li) => ({ kind: li.getAttribute("data-kind"), label: li.querySelector("span")?.textContent,
    badge: li.querySelector("[data-research-state]")?.textContent, value: (li.querySelector("[data-research-value]")?.textContent || li.querySelector("[data-question] label")?.textContent || "").slice(0, 160),
    sources: [...li.querySelectorAll("[data-research-sources] li")].map((s) => s.textContent.slice(0, 120)), used_for: li.querySelector("[data-used-for]")?.textContent || "" }))`);
  const premium = await value(`window.__premium[window.__premium.length - 1] || null`);
  // Adopt the proposals, skip the questions, check again.
  await clickAt(`document.querySelector("[data-adopt-all]")`);
  for (let n = 0; n < 12; n += 1) {
    const ok = await clickAt(`[...document.querySelectorAll("[data-question] button")].find((b) => b.textContent.trim() === "Skip" && b.getAttribute("aria-pressed") !== "true")`);
    if (!ok) break;
    await sleep(80);
  }
  await clickAt(button("Use what I adopted and check again"));
  await until(`!!document.querySelector("[data-research-adopted]")`, 30000);
  const after = await value(`document.querySelector("[data-score-change]")?.textContent || ""`);
  const coverage = await value(`document.querySelector("[data-coverage-change]")?.textContent || ""`);
  const sourcesUsed = await value(`[...document.querySelectorAll("[data-sources-used] li")].map((s) => s.textContent.slice(0, 200))`);
  const figures = await value(`[...document.querySelectorAll("[data-figure]")].map((f) => f.querySelector("span")?.textContent)`);
  const cardScore = await value(`document.querySelector("[data-fv-score]")?.textContent.trim()`);
  report.push({ check: key, label, before, cost, plan, counts, researchSeconds, totalSeconds: Math.round((Date.now() - started) / 100) / 10,
    charged: premium?.research?.charged, error: premium?.research?.error || null, after, coverage, card_after: cardScore, figures, sourcesUsed: sourcesUsed.length,
    sourcesSample: sourcesUsed.slice(0, 3), items });
  console.log(`${key}: ${counts} | charged ${premium?.research?.charged} | ${before} -> ${after} | ${researchSeconds}s`);
}
ws.close();
cleanUp();
if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 1));
process.exit(0);
