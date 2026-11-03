// Cloudflare Turnstile: a usually invisible check that a request came from a person. Off until VITE_TURNSTILE_SITE_KEY is set
// when the site is built. Each token works once, so a new one is asked for each time.
const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const WAIT_MS = 8000;
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

function freshToken(siteKey) {
  return loadScript().then((turnstile) => new Promise((resolve) => {
    const box = document.createElement("div");
    box.style.cssText = "position:fixed;bottom:12px;right:12px;z-index:9999";      // shown only if Cloudflare needs the person to press it
    document.body.appendChild(box);
    let id = null;
    const done = (token) => {
      clearTimeout(timer);
      try { if (id !== null) turnstile.remove(id); } catch { /* already gone */ }
      box.remove();
      resolve(token || "");
    };
    const timer = setTimeout(() => done(""), WAIT_MS);
    id = turnstile.render(box, { sitekey: siteKey, appearance: "interaction-only", callback: done, "error-callback": () => done(""), "expired-callback": () => done("") });
  }));
}

/** Request options carrying a new token; empty with no key set, so nothing changes until it is turned on. */
export async function humanCheck(siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY) {
  if (!siteKey) return {};
  const token = await freshToken(siteKey).catch(() => "");
  return token ? { headers: { "X-Turnstile-Token": token } } : {};
}
