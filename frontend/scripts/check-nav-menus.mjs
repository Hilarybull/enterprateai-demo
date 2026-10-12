// Dev-only check (QA U5): the public navigation menus with a real mouse, in headless Chrome.
//
//   npm run build && node scripts/check-nav-menus.mjs
//
// The mouse moves over "Features" (the menu opens on hover), then clicks the same trigger: the menu must stay
// open, and stay open when the mouse leaves. A second click closes it. The Articles menu, with one category that
// has an article and one that has none, lists the latest article and only the category with something in it, and
// never says "No categories yet". The pointer events are Chrome's own (DevTools Input.dispatchMouseEvent), not
// synthetic ones. No server is needed: the page's requests are answered with made-up data.

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.NAV_PORT || 4189);
const DEBUG = Number(process.env.NAV_DEBUG_PORT || 9339);
const chrome = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find((p) => p && existsSync(p));
if (!chrome) { console.error("Chrome was not found. Set CHROME_PATH to its executable."); process.exit(2); }
if (!existsSync(join(root, "dist", "index.html"))) { console.error("dist/ is missing. Run `npm run build` first."); process.exit(2); }

const MOCK = `(() => {
  const J = (b) => Promise.resolve(new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } }));
  try { localStorage.setItem("ea_cookie_consent", '{"operational":true,"analytics":false}'); localStorage.setItem("cookieConsent", "accepted"); localStorage.removeItem("ea_token"); } catch (e) {}
  window.fetch = (u) => {
    u = String(u);
    if (/blog\\/categories/.test(u)) return J([{ id: "c1", slug: "cash-flow", name: "Cash flow" }, { id: "c2", slug: "empty-topic", name: "Empty topic" }]);
    if (/blog\\/articles/.test(u)) return J([{ id: "a1", slug: "late-payments", title: "Getting paid on time", category_id: "c1" }]);
    return J([]);
  };
})();`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), "nav-check-"));
const server = spawn(process.execPath, [join(root, "node_modules", "vite", "bin", "vite.js"), "preview", "--port", String(PORT), "--strictPort"], { cwd: root, stdio: "ignore" });
const browser = spawn(chrome, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${profile}`, "--window-size=1440,900", "about:blank"], { stdio: "ignore" });
const cleanUp = () => {
  for (const p of [browser, server]) { try { p.kill(); } catch { /* already gone */ } }
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome may still hold it for a moment */ }
};
process.on("exit", cleanUp);

async function up(url) {
  for (let n = 0; n < 60; n += 1) {
    try { const r = await fetch(url); if (r.ok) return r; } catch { /* not yet */ }
    await sleep(250);
  }
  throw new Error(`${url} did not answer`);
}

await up(`http://localhost:${PORT}/`);
const targets = await (await up(`http://127.0.0.1:${DEBUG}/json/list`)).json();
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = bad; });
let seq = 0;
const waiting = new Map();
ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); } };
const send = (method, params = {}) => new Promise((ok) => { seq += 1; waiting.set(seq, ok); ws.send(JSON.stringify({ id: seq, method, params })); });
const value = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true })).result?.result?.value;

await send("Page.enable");
await send("Runtime.enable");
await send("Page.addScriptToEvaluateOnNewDocument", { source: MOCK });
await send("Page.navigate", { url: `http://localhost:${PORT}/features` });
for (let n = 0; n < 40 && !(await value(`!!document.querySelector('[data-menu-button]')`)); n += 1) await sleep(250);
// The header settles once its fonts and the menus' data are in: measured until the trigger stops moving.
await send("Runtime.evaluate", { expression: "document.fonts.ready.then(() => true)", awaitPromise: true });
let last = "";
for (let n = 0; n < 20; n += 1) {
  const now = await value(`JSON.stringify([...document.querySelectorAll('[data-menu-button]')].map((b) => Math.round(b.getBoundingClientRect().x)))`);
  if (now === last) break;
  last = now;
  await sleep(250);
}

const centre = async (label) => value(`(() => { const b = document.querySelector('[aria-label="${label} menu"]'); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
const expanded = async (label) => value(`document.querySelector('[aria-label="${label} menu"]').getAttribute('aria-expanded')`);
const move = (x, y) => send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", pointerType: "mouse" });
const click = async (x, y) => {
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1, pointerType: "mouse" });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1, pointerType: "mouse" });
};

const results = [];
const check = (name, ok, got) => { results.push(ok); console.log(`${ok ? "ok  " : "FAIL"}  ${name}${ok ? "" : `  (got ${JSON.stringify(got)})`}`); };

// Features: hover, then click the same trigger, then leave, then click again. The trigger is measured before each
// move, so the mouse is always where the button is.
let f = await centre("Features");
await move(f.x - 40, f.y + 300);
await sleep(100);
f = await centre("Features");
await move(f.x, f.y);
await sleep(250);
check("hovering Features opens its menu", (await expanded("Features")) === "true", await expanded("Features"));
f = await centre("Features");
await click(f.x, f.y);
await sleep(250);
check("clicking the trigger of a menu hovering opened keeps it open", (await expanded("Features")) === "true", await expanded("Features"));
await move(f.x + 500, f.y + 600);
await sleep(400);
check("a menu pinned by a click stays open when the mouse leaves", (await expanded("Features")) === "true", await expanded("Features"));
f = await centre("Features");
await move(f.x, f.y);
await sleep(100);
await click(f.x, f.y);
await sleep(250);
check("a second click closes it", (await expanded("Features")) === "false", await expanded("Features"));
await move(f.x + 500, f.y + 600);
await sleep(400);

// Articles: hover opens it; it lists the latest article and only the category with an article in it.
const a = await centre("Articles");
await move(a.x, a.y);
await sleep(300);
const panel = await value(`document.querySelector('[role="menu"][aria-label="Articles"]')?.textContent || ""`);
check("hovering Articles opens its menu", panel.length > 0, panel);
check("the Articles menu lists the latest article", panel.includes("Getting paid on time"), panel);
check("a category with no articles is not listed", panel.includes("Cash flow") && !panel.includes("Empty topic"), panel);
check("the Articles menu never says \"No categories yet\"", !/No categories yet/.test(panel), panel);
const a2 = await centre("Articles");
await click(a2.x, a2.y);
await sleep(250);
check("clicking Articles after hovering keeps it open", (await expanded("Articles")) === "true", await expanded("Articles"));

ws.close();
cleanUp();
const failed = results.filter((r) => !r).length;
console.log(failed ? `\n${failed} check${failed === 1 ? "" : "s"} failed.` : "\nThe menus open on hover, stay open on a click, and close on a second click.");
process.exit(failed ? 1 : 0);
