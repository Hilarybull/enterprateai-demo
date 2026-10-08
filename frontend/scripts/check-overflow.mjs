// Dev-only check: nothing on the landing page or the dashboard may stick out of its container.
//
//   npm run build && npm run check:overflow
//
// It serves the built app, opens "/" and "/dashboard" in headless Chrome at 1440, 1024, 768 and
// 390 pixels wide, and fails when:
//   - an element (not absolutely or fixed positioned) ends to the right of its parent, by more than 1px;
//   - the page can be scrolled sideways (the document is wider than the window);
//   - a KPI value is set to cut its text off with an ellipsis.
// The dashboard is given made-up data (no server, no sign-in), with five KPI amounts from £0.00 to
// £98,765,432.10 so short and very long figures are both measured.
//
// Set OVERFLOW_SHOTS to a folder to also save a picture of each page at each width.
// Chrome is found from CHROME_PATH, or the usual install places. Nothing is left behind in dist/.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const PORT = Number(process.env.OVERFLOW_PORT || 4188);
const WIDTHS = [1440, 1024, 768, 390];
const KPI_VALUES = ["£0.00", "£300.00", "£12,345.67", "£1,245,300.00", "£98,765,432.10"];

const chrome = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find((p) => p && existsSync(p));
if (!chrome) { console.error("Chrome was not found. Set CHROME_PATH to its executable."); process.exit(2); }
if (!existsSync(join(dist, "index.html"))) { console.error("dist/ is missing. Run `npm run build` first."); process.exit(2); }

// ── made-up data for the dashboard ───────────────────────────────────────────
const insight = (key, title, tone, text, extra = {}) => ({ key, widget_id: key, title, tone, state: "available", priority_class: 3, text, why: {}, ...extra });
const DASHBOARD = {
  enabled: true, business_id: "ws1", max_priority_cards: 4, composition_key: "check",
  kpis: KPI_VALUES.map((value, n) => ({ key: `k${n}`, label: ["Total Revenue", "Cash", "Expenses and CoS", "Receivables", "Pipeline"][n], value,
    trend: { points: [1, 3, 2, 5, 4, 6].map((v, d) => ({ at: new Date(Date.now() - (6 - d) * 86400000).toISOString(), value: v * (n + 1) })) } })),
  insights: [
    insight("risk", "Fragility / Risk Alert", "rose", "One customer makes up most of your revenue this quarter, so a late payment from them would leave the business short of cash within weeks."),
    insight("next_step", "Recommended Next Step", "brand", "Follow up the two overdue invoices.", { detail: "2 overdue · £199.00", cta: { label: "Open invoices", to: "/operations" }, agent_action: { label: "Ask Agent to prepare a follow-up", capability: "payment_followup" } }),
    insight("scenario", "Suggested Scenario", "indigo", "See what happens to your cash if your largest customer pays 30 days late, and which costs you could delay to stay above your buffer through the quarter and into the next one.",
      { note: "This scenario is on paid plans. Your plan includes the Baseline Continuity projection in Simulation.", cta: { label: "See the scenario", to: "/pricing", upgrade: true, locked: true } }),
    insight("cash", "Cash Position", "emerald", "Cash covers about four months of costs at the current rate.", { cta: { label: "Open the plan", to: "/business-plan" } }),
  ],
  context: { pathway: "small_business", business_stage: "operating", stage_label: "Operating", stage_source: "records",
    stages: [{ key: "idea", label: "Idea" }, { key: "pre_launch", label: "Pre-launch" }, { key: "operating", label: "Operating" }, { key: "growth", label: "Growth" }],
    goals: [], headline: { label: "Business health", value: "78", state: "available" } },
  action_cards: [], financial_summary: { receivables: 1245300 }, launch_readiness: { items: [], done: 0, total: 0, percent: 0 }, needs_approval: [], preferences: { hidden_widget_ids: [] },
  freshness: { generated_at: new Date().toISOString() }, entitlement: {}, readiness_features: { funding: true, launch: true },
  report: { key: "business_health_report", title: "Business Health Report", description: "A full assessment of your business performance, risks and recommendations.", cta: "View Business Health Report", action: {} },
  agent: { suggestions: [{ key: "s1", icon: "doc", text: "Would you like me to prepare a payment follow-up for the two overdue invoices?", action: { capability: "payment_followup" } },
    { key: "s2", icon: "doc", text: "Create a quotation from a customer enquiry.", action: { to: "/operations" } }],
    needs_approval: [{ approval_id: "ap1", run_id: "r1", title: "Quotation QUO-1031026 for Altmosphere Consulting Ltd", subtitle: "Ready to send", age: "2h", payload: { total: 2400, currency: "GBP" } }],
    needs_approval_count: 1, shortcuts: [], placeholder: "Ask EnterprateAI about quotes, payments, risks or scenarios",
    entitlement: { is_paid: false, agent_tasks: false, agent_tasks_from: "Starter", monthly_runs: 5, monthly_runs_used: 0, credits: 46 } },
};

const mock = (path) => `<script>
(function(){
  window.__errors = []; window.addEventListener('error', function(e){ window.__errors.push(String(e.message) + ' AT ' + e.filename + ':' + e.lineno + ':' + e.colno); });
  window.addEventListener('unhandledrejection', function(e){ window.__errors.push('rejected: ' + String(e.reason && e.reason.message || e.reason)); });
  try { history.replaceState(null, '', ${JSON.stringify(path)}); } catch(e){}
  try { localStorage.setItem('ea_cookie_consent','{"operational":true,"analytics":false}'); localStorage.setItem('cookieConsent','accepted');
        ${path === "/" ? "localStorage.removeItem('ea_token');" : "localStorage.setItem('ea_token','check'); localStorage.setItem('ea_email','owner@check.test');"} } catch(e){}
  var DASH = ${JSON.stringify(DASHBOARD)};
  window.fetch = function(u){
    u = String(u);
    var J = function(b, s){ return Promise.resolve(new Response(JSON.stringify(b), {status: s||200, headers: {'Content-Type':'application/json'}})); };
    if (/businesses\\/ws1\\/dashboard/.test(u)) return J(DASH);
    if (/auth\\/me/.test(u)) return J({id: 'u1', email: 'owner@check.test', name: 'Check Owner', email_verified: true, onboarding_completed: true});
    if (/validation\\/(me|ws1)/.test(u)) return J({id: 'ws1', name: 'Overflow Check Ltd', data: {workspace_profile: {company_name: 'Overflow Check Ltd'}, financials: {invoices: [], expenses: [], quotes: [], contracts: []}, catalogue: {products: [], customers: [], vendors: []}}});
    if (/workspaces|notifications|blog|categories|members|invitations|restrictions|runs|approvals|announcements/.test(u)) return J([]);
    if (/auth.grants|plans.my/.test(u)) return J(null);
    (window.__unknown = window.__unknown || []).push(u.replace(/^https?:..[^/]+/, '').slice(0, 60));
    return J({});
  };
})();
</script>`;

// ── the measurement, run inside the page ─────────────────────────────────────
function measure() {
  const out = { width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth, problems: [], kpis: [] };
  const name = (el) => {
    const tag = el.tagName.toLowerCase();
    const mark = [...el.attributes].find((a) => a.name.startsWith("data-") && a.name !== "data-m");
    const cls = String(el.className?.baseVal ?? el.className ?? "").split(/\s+/).filter(Boolean).slice(0, 4).join(".");
    return `${tag}${el.id ? `#${el.id}` : ""}${mark ? `[${mark.name}${mark.value ? `=${mark.value}` : ""}]` : ""}${cls ? `.${cls}` : ""} "${(el.textContent || "").trim().slice(0, 40)}"`;
  };
  const turned = (cs) => (cs.transform && cs.transform !== "none") || (cs.rotate && cs.rotate !== "none");
  for (const el of document.body.querySelectorAll("*")) {
    if (el.closest("svg") && el.tagName.toLowerCase() !== "svg") continue;      // shapes inside a drawing are the drawing's business
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || cs.position === "absolute" || cs.position === "fixed") continue;
    const box = el.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    const parent = el.parentElement;
    if (!parent || parent === document.body) continue;
    const pcs = getComputedStyle(parent);
    if (/(auto|scroll)/.test(pcs.overflowX)) continue;      // a row that is meant to scroll sideways
    if (turned(cs) || el.closest("[aria-hidden='true'][data-hero-preview], [data-hero-preview]") && turned(getComputedStyle(el.closest("[data-hero-preview]").children[1] || el))) continue;      // tilted for effect: its box is not its edge
    let tilted = false;
    for (let up = el.parentElement; up && up !== document.body; up = up.parentElement) { if (turned(getComputedStyle(up))) { tilted = true; break; } }
    if (tilted) continue;
    const over = box.right - parent.getBoundingClientRect().right;
    if (over > 1) out.problems.push(`${Math.round(over)}px past its parent: ${name(el)}  (parent: ${name(parent).slice(0, 80)})`);
  }
  for (const el of document.querySelectorAll("[data-kpi-value], [data-kpi-value] *")) {
    if (getComputedStyle(el).textOverflow === "ellipsis") out.problems.push(`KPI value is set to cut off with an ellipsis: ${name(el)}`);
  }
  for (const el of document.querySelectorAll("[data-kpi-value]")) {
    out.kpis.push(`${el.getAttribute("title")} shown as "${el.textContent.trim()}"${el.scrollWidth > el.clientWidth + 1 ? " OVERFLOWS" : ""}`);
    if (el.scrollWidth > el.clientWidth + 1) out.problems.push(`KPI value does not fit its card: ${el.getAttribute("title")}`);
  }
  if (out.scrollWidth > out.width) out.problems.push(`The page scrolls sideways: the document is ${out.scrollWidth}px wide in a ${out.width}px window.`);
  return out;
}
const reporter = `<style>*, *::before, *::after { animation: none !important; transition: none !important; }</style><script>
window.addEventListener('load', function(){ setTimeout(function(){
  var result; try { result = (${measure.toString()})(); } catch (e) { result = { problems: ['The check itself failed: ' + e.message], kpis: [] }; }
  var rendered = document.querySelector('#hero, [data-kpi-grid], [data-agent-card]');
  if (!rendered) result.problems.push('The page did not render what was expected (no hero, Agent card or KPI grid found). It shows: ' + (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 220) + ' @ ' + location.pathname + ' | errors: ' + (window.__errors || []).slice(0, 3).join(' ; ') + ' | asked: ' + (window.__unknown || []).join(' , ') + ' | root: ' + ((document.getElementById('root') || {}).innerHTML || '').slice(0, 160));
  var holder = document.createElement('pre'); holder.id = 'overflow-result'; holder.textContent = JSON.stringify(result);
  (window.parent !== window ? window.parent.document.body : document.body).appendChild(holder);
}, 3500); });
</script>`;

const html = readFileSync(join(dist, "index.html"), "utf8");
const made = [];
const write = (name, text) => { writeFileSync(join(dist, name), text); made.push(join(dist, name)); };
const PAGES = [["landing", "/"], ["dashboard", "/dashboard"]];
for (const [key, path] of PAGES) {
  write(`_overflow_${key}.html`, html.replace("<head>", `<head>${mock(path)}${reporter}`));
  // Narrow widths are measured in a frame of exactly that width (a headless window can't be made that narrow).
  for (const w of WIDTHS) write(`_overflow_${key}_${w}.html`, `<!doctype html><body style="margin:0"><iframe src="/_overflow_${key}.html" style="width:${w}px;height:1400px;border:0;display:block"></iframe>`);
}

const server = spawn(process.execPath, [join(root, "node_modules", "vite", "bin", "vite.js"), "preview", "--port", String(PORT), "--strictPort"], { cwd: root, stdio: "ignore" });
const cleanUp = () => { try { server.kill(); } catch { /* already gone */ } for (const f of made) rmSync(f, { force: true }); };
process.on("exit", cleanUp);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ready() {
  for (let n = 0; n < 40; n += 1) {
    try { const r = await fetch(`http://localhost:${PORT}/`); if (r.ok) return true; } catch { /* not up yet */ }
    await sleep(250);
  }
  return false;
}

let failed = 0;
if (!(await ready())) { console.error("The preview server did not start."); process.exit(2); }
for (const [key, path] of PAGES) {
  for (const w of WIDTHS) {
    const run = spawnSync(chrome, ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--window-size=${Math.max(w, 600) + 40},1500`, "--virtual-time-budget=9000", "--dump-dom",
      `http://localhost:${PORT}/_overflow_${key}_${w}.html`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    // OVERFLOW_SHOTS=<folder> also saves a picture of each page at each width, to look at.
    if (process.env.OVERFLOW_SHOTS) {
      spawnSync(chrome, ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--window-size=${Math.max(w, 600) + 40},1500`, "--virtual-time-budget=9000",
        `--screenshot=${join(process.env.OVERFLOW_SHOTS, `${key}-${w}.png`)}`, `http://localhost:${PORT}/_overflow_${key}_${w}.html`], { encoding: "utf8" });
    }
    const found = (run.stdout || "").match(/<pre id="overflow-result">([\s\S]*?)<\/pre>/);
    let result;
    try { result = JSON.parse(found[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")); }
    catch { result = { problems: ["No result came back from the page."], kpis: [] }; }
    const bad = result.problems.length;
    failed += bad;
    console.log(`${bad ? "FAIL" : "ok  "}  ${path.padEnd(11)} ${String(w).padStart(4)}px${result.scrollWidth ? `  document ${result.scrollWidth}px` : ""}`);
    for (const k of result.kpis || []) console.log(`        ${k}`);
    for (const p of result.problems.slice(0, 25)) console.log(`      - ${p}`);
    if (bad > 25) console.log(`      ...and ${bad - 25} more`);
  }
}
cleanUp();
console.log(failed ? `\n${failed} problem${failed === 1 ? "" : "s"} found.` : "\nNothing sticks out of its container, and no page scrolls sideways.");
process.exit(failed ? 1 : 0);
