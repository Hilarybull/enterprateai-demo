// Cloudflare Turnstile: a usually invisible check that a request came from a person; if that can't settle it, a checkbox appears. Off until VITE_TURNSTILE_SITE_KEY is set
// when the site is built. Each token works once, so a new one is asked for each time.
const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const QUIET_MS = 8000;
const CHECKBOX_MS = 120000;
let loading = null;

function loadScript() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const tag = document.createElement("script");
      tag.src = SCRIPT;
      tag.async = true;
      tag.onload = () => resolve(window.turnstile);
      tag.onerror = () => { loading = null; reject(new Error("turnstile")); };
      document.head.appendChild(tag);
    });
  }
  return loading;
}

/** Quietly, in the background. Comes back empty at once if Cloudflare wants the person to do something. */
function quietToken(turnstile, siteKey) {
  return new Promise((resolve) => {
    const box = document.createElement("div");
    box.style.cssText = "position:fixed;width:0;height:0;overflow:hidden";
    document.body.appendChild(box);
    let id = null;
    const done = (token) => {
      clearTimeout(timer);
      try { if (id !== null) turnstile.remove(id); } catch { /* already gone */ }
      box.remove();
      resolve(token || "");
    };
    const timer = setTimeout(() => done(""), QUIET_MS);
    id = turnstile.render(box, { sitekey: siteKey, appearance: "interaction-only", callback: done, "error-callback": () => done(""),
      "expired-callback": () => done(""), "before-interactive-callback": () => done("") });
  });
}

/** The checkbox, in the middle of the screen, for as long as the person needs. */
function checkboxToken(turnstile, siteKey) {
  return new Promise((resolve) => {
    const cover = document.createElement("div");
    cover.setAttribute("role", "dialog");
    cover.setAttribute("aria-modal", "true");
    cover.setAttribute("aria-label", "Confirm you are a person");
    cover.style.cssText = "position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(15,23,42,.5)";
    const card = document.createElement("div");
    card.style.cssText = "max-width:360px;width:100%;box-sizing:border-box;padding:20px;border-radius:16px;background:#fff;color:#0f172a;font:14px system-ui,sans-serif;text-align:center";
    const words = document.createElement("p");
    words.textContent = "Please tick the box to continue.";
    words.style.cssText = "margin:0 0 12px;font-weight:600";
    const box = document.createElement("div");
    box.style.cssText = "display:flex;justify-content:center;min-height:65px";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.style.cssText = "margin-top:12px;background:none;border:0;color:#475569;cursor:pointer;font:inherit;text-decoration:underline";
    card.append(words, box, cancel);
    cover.appendChild(card);
    document.body.appendChild(cover);
    let id = null;
    const done = (token) => {
      clearTimeout(timer);
      try { if (id !== null) turnstile.remove(id); } catch { /* already gone */ }
      cover.remove();
      resolve(token || "");
    };
    const timer = setTimeout(() => done(""), CHECKBOX_MS);
    cancel.onclick = () => done("");
    id = turnstile.render(box, { sitekey: siteKey, appearance: "always", callback: done, "error-callback": () => done(""), "expired-callback": () => done("") });
  });
}

async function freshToken(siteKey) {
  const turnstile = await loadScript();
  return (await quietToken(turnstile, siteKey)) || checkboxToken(turnstile, siteKey);
}

/** Request options carrying a new token; empty with no key set, so nothing changes until it is turned on. */
export async function humanCheck(siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY) {
  if (!siteKey) return {};
  let token = "";
  try { token = await freshToken(siteKey); } catch { /* reported below; never send an empty check */ }
  if (!token) {
    const error = new Error("The verification check did not load. Refresh the page or try another browser.");
    error.code = "PERSON_CHECK_UNAVAILABLE";
    error.status = 400;
    throw error;
  }
  return { headers: { "X-Turnstile-Token": token } };
}
