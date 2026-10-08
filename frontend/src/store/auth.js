import { create } from "zustand";
import { apiRequest, apiRequestCached, clearSessionCache, sessionGet } from "../api/client";
import { useWorkspaceStore } from "./workspace";
import { firstNameOf } from "../lib/greeting";

function humanizeAuthError(e) {
  const msg = e instanceof Error ? e.message : String(e || "");
  if (e?.code === "NETWORK_ERROR" || msg === "NETWORK_ERROR") {
    // The API URL is developer detail; real customers get a plain message.
    if (import.meta.env.DEV) {
      const base = import.meta.env.VITE_API_URL ?? import.meta.env.REACT_APP_BACKEND_URL ?? "http://localhost:8000";
      return `Can't reach the server at ${base}. Start the backend and check your API URL.`;
    }
    return "We couldn't reach the server. Please check your connection and try again in a moment.";
  }
  if (msg === "AUTH_RESPONSE_INVALID") return "Authentication failed. Please try again.";
  if (msg.startsWith("HTTP 401:")) return "Invalid credentials. Try again or create an account.";
  if (msg.startsWith("HTTP 403:")) {
    const lower = msg.toLowerCase();
    if (lower.includes("suspended") || lower.includes("blocked")) {
      return msg.replace(/^HTTP 403:\s*/, "");
    }
    if (lower.includes("email not verified") || lower.includes("verification")) {
      return msg.replace(/^HTTP 403:\s*/, "");
    }
    return "Access denied.";
  }
  if (msg.startsWith("HTTP 409:")) return "Account already exists. Sign in instead.";
  if (msg.startsWith("HTTP 422:")) return "Please enter a valid email and a password (8+ characters).";
  if (msg.startsWith("HTTP 500:")) return "Server configuration error. Try again later.";
  return msg;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A slow or briefly unreachable server is not a reason to give up: try a few times.
async function withRetry(fn, attempts = 3) {
  for (let i = 0; ; i += 1) {
    try {
      return await fn(i > 0);
    } catch (e) {
      if (i >= attempts - 1 || e?.status === 401 || e?.status === 403) throw e;
      await sleep(600 * (i + 1));
    }
  }
}

// These all go through sessionGet, so however many parts of the app ask, each is
// requested once and the answer shared.
async function fetchPlatformRestrictions() {
  try {
    return await withRetry((again) => sessionGet("/auth/restrictions", { force: again }));
  } catch {
    return [];
  }
}

async function fetchPlatformGrants({ force = false } = {}) {
  try {
    return await withRetry((again) => sessionGet("/auth/grants", { force: force || again }));
  } catch {
    return null;
  }
}

async function fetchSubscription({ force = false } = {}) {
  try {
    return await withRetry((again) => sessionGet("/plans/my", { force: force || again }));
  } catch {
    return null;
  }
}

// The dashboard needs the workspace and the agent summary as well as the session.
// Ask for them at the same moment instead of after the session check has finished;
// the layout and the page then pick up these same requests.
function prefetchDashboard() {
  if (typeof window === "undefined" || window.location.pathname !== "/dashboard") return;
  const ws = useWorkspaceStore.getState();
  if (ws.isMemberMode) return;
  const summary = (id) => apiRequestCached(`/businesses/${id}/agent/summary`).catch(() => {});
  if (ws.workspaceId) {
    apiRequestCached(`/validation/${ws.workspaceId}`).catch(() => {});
    summary(ws.workspaceId);
  } else {
    // First visit on this device: the workspace id isn't known yet, so the summary follows it.
    apiRequestCached("/validation/me").then((doc) => { if (doc?.id) summary(doc.id); }).catch(() => {});
  }
}

let hydrating = null;   // one session check at a time, shared by everyone who asks

const DEFAULT_SUB = { plan_key: "explorer", billing_period: "monthly", status: "active" };

function clearDemoTourState() {
  sessionStorage.removeItem("ea_tour_active");
  sessionStorage.removeItem("ea_tour_step");
  sessionStorage.removeItem("ea_tour_done");
}

async function backfillAuthName(email, currentName, setProfile) {
  const lowerEmail = String(email || "").toLowerCase();
  if (!lowerEmail || currentName || lowerEmail === "demo" || lowerEmail === "demo@enterprate.ai" || lowerEmail === "tech.support@enterprateai.com" || lowerEmail.includes("superadmin")) return;
  const taskKey = `ea_task_session:${lowerEmail}`;
  let sessionId = null;
  try { sessionId = localStorage.getItem(taskKey); } catch { return; }
  if (!sessionId) return;
  let session;
  try { session = await sessionGet(`/task-sessions/${sessionId}`, { force: true }).catch(() => null); } catch { session = null; }
  const name = firstNameOf(session?.first_name);
  if (!name) return;
  try {
    const me = await apiRequest("/auth/me", "PATCH", { name });
    setProfile({ name: me?.name ?? name, picture: me?.picture ?? null, authProvider: me?.auth_provider ?? null, hasPassword: me?.has_password ?? false });
  } catch {
    // Quietly ignore: greeting can still use the session name on this visit.
  }
}
export const useAuthStore = create((set, get) => ({
  token: null,
  email: null,
  name: null,
  picture: null,
  authProvider: null,
  hasPassword: false,
  hydrated: false,
  isLoading: false,
  error: null,
  platformRestrictions: [],
  platformGrants: [],
  subscription: DEFAULT_SUB,
  creditBalance: null,
  creditInfo: null,
  // True while the session check is being retried because the server is slow or unreachable.
  connecting: false,
  verificationPending: false,
  verificationEmail: null,
  clearVerificationPending: () => set({ verificationPending: false, verificationEmail: null }),
  resendVerification: async (email) => {
    await apiRequest("/auth/resend-verification", "POST", { email });
  },
  setCreditBalance: (v) => set({ creditBalance: typeof v === "number" ? v : null }),
  setCreditInfo: (info) => set({ creditInfo: info || null, creditBalance: typeof info?.available_credits === "number" ? info.available_credits : null }),

  hydrate: () => {
    if (hydrating) return hydrating;
    const run = (async () => {
      const token = localStorage.getItem("ea_token");
      const email = localStorage.getItem("ea_email");

      if (!token) {
        clearDemoTourState();
        set({ token: null, email: null, hydrated: true, connecting: false });
        return;
      }

      const signedOut = () => {
        localStorage.removeItem("ea_token");
        localStorage.removeItem("ea_email");
        clearSessionCache();
        clearDemoTourState();
        set({ token: null, email: null, name: null, picture: null, authProvider: null, hasPassword: false, hydrated: true, connecting: false });
      };

      prefetchDashboard();
      const rest = Promise.all([fetchPlatformRestrictions(), fetchPlatformGrants(), fetchSubscription()]);

      // Confirm the token with the server. Only the server refusing it (401, or 403 for a
      // suspended account) signs the user out. A timeout, a network error or a 5xx means
      // "not known yet": keep the token, keep showing the loading state, and try again.
      let me;
      for (let attempt = 0; ; attempt += 1) {
        try {
          me = await sessionGet("/auth/me", { force: attempt > 0 });
          break;
        } catch (e) {
          if (e?.status === 401 || e?.status === 403) return signedOut();
          if (localStorage.getItem("ea_token") !== token) {
            // Signed out, or signed in again, in another tab while we were waiting.
            if (hydrating === run) hydrating = null;
            return get().hydrate();
          }
          set({ connecting: true });
          await sleep(Math.min(1000 * 2 ** attempt, 8000));
        }
      }

      const [restrictions, grants, sub] = await rest;
      set({
        token,
        email: me?.email ?? email,
        name: me?.name ?? null,
        picture: me?.picture ?? null,
        authProvider: me?.auth_provider ?? null,
        hasPassword: me?.has_password ?? false,
        platformRestrictions: restrictions ?? [],
        platformGrants: grants ?? [],
        subscription: sub ?? DEFAULT_SUB,
        hydrated: true,
        connecting: false,
      });
      await backfillAuthName(me?.email ?? email, me?.name ?? null, set);
      if ((me?.email ?? email) !== "demo") clearDemoTourState();
    })();
    hydrating = run;
    run.finally(() => { if (hydrating === run) hydrating = null; });
    return run;
  },

  refreshSubscription: async () => {
    const sub = await fetchSubscription({ force: true });
    if (sub) set({ subscription: sub });
    return sub;
  },

  refreshGrants: async () => {
    const grants = await fetchPlatformGrants();
    if (grants !== null) set({ platformGrants: grants ?? [] });
    return grants;
  },

  setPlatformRestrictions: (restrictions) => set({ platformRestrictions: restrictions }),

  register: async (email, password, extra = {}) => {
    set({ isLoading: true, error: null });
    try {
      // Attach referral click data if stored from a /r/:code visit
      let refData = {};
      try {
        const raw = localStorage.getItem("ea_referral");
        if (raw) {
          const parsed = JSON.parse(raw);
          const expiresAt = parsed.expires_at ? new Date(parsed.expires_at) : null;
          if (expiresAt && expiresAt > new Date()) {
            refData = { ref_click_id: parsed.click_id, ref_code: parsed.code };
          }
          localStorage.removeItem("ea_referral");
        }
      } catch (_) {}
      const result = await apiRequest("/auth/register", "POST", { email, password, ...extra, ...refData });
      if (result?.email_verification_sent) {
        set({ verificationPending: true, verificationEmail: email });
        return;
      }
      await get().login(email, password);
    } catch (e) {
      set({ error: humanizeAuthError(e) });
    } finally {
      set({ isLoading: false });
    }
  },

  login: async (email, password) => {
    set({ isLoading: true, error: null });
    try {
      const tokenRes = await apiRequest("/auth/login", "POST", { email, password });
      const token = tokenRes?.access_token ?? tokenRes?.token ?? null;
      if (!token) throw new Error("AUTH_RESPONSE_INVALID");
      localStorage.setItem("ea_token", token);
      localStorage.setItem("ea_email", email);
      clearDemoTourState();
      useWorkspaceStore.getState().resetForUser(email);
      set({ token, email, hydrated: true });
      Promise.all([
        sessionGet("/auth/me").catch(() => null),
        fetchPlatformRestrictions(),
        fetchPlatformGrants(),
        fetchSubscription(),
      ]).then(([me, restrictions, grants, sub]) => set({
        name: me?.name ?? null,
        picture: me?.picture ?? null,
        authProvider: me?.auth_provider ?? null,
        hasPassword: me?.has_password ?? false,
        platformRestrictions: restrictions,
        platformGrants: grants ?? [],
        subscription: sub ?? DEFAULT_SUB,
      })).catch(() => {});
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e || "");
      if (msg.startsWith("HTTP 403:") && msg.toLowerCase().includes("not verified")) {
        // Show the "check your inbox" screen, which offers a fresh link.
        set({ verificationPending: true, verificationEmail: email, error: null });
      } else {
        set({ error: humanizeAuthError(e) });
      }
    } finally {
      set({ isLoading: false });
    }
  },

  /** Signed in by a verified email code (a task saved from the homepage): the same state a password or Google sign-in leaves. */
  tokenLogin: async (token, email) => {
    if (!token) throw new Error("AUTH_RESPONSE_INVALID");
    localStorage.setItem("ea_token", token);
    if (email) localStorage.setItem("ea_email", email);
    clearDemoTourState();
    if (email) useWorkspaceStore.getState().resetForUser(email);
    set({ token, email: email || null, hydrated: true, error: null });
    Promise.all([
      sessionGet("/auth/me").catch(() => null),
      fetchPlatformRestrictions(),
      fetchPlatformGrants(),
      fetchSubscription(),
    ]).then(async ([me, restrictions, grants, sub]) => {
      set({ name: me?.name ?? null, picture: me?.picture ?? null, authProvider: me?.auth_provider ?? null, hasPassword: me?.has_password ?? false,
        platformRestrictions: restrictions, platformGrants: grants ?? [], subscription: sub ?? DEFAULT_SUB });
      await backfillAuthName(me?.email ?? email, me?.name ?? null, set);
    }).catch(() => {});
  },

  googleLogin: async (credential) => {
    set({ isLoading: true, error: null });
    try {
      let refData = {};
      try {
        const raw = localStorage.getItem("ea_referral");
        if (raw) {
          const parsed = JSON.parse(raw);
          const expiresAt = parsed.expires_at ? new Date(parsed.expires_at) : null;
          if (expiresAt && expiresAt > new Date()) {
            refData = { ref_click_id: parsed.click_id, ref_code: parsed.code };
          }
          localStorage.removeItem("ea_referral");
        }
      } catch (_) {}
      const tokenRes = await apiRequest("/auth/google", "POST", { credential, ...refData });
      const token = tokenRes?.access_token ?? tokenRes?.token ?? null;
      if (!token) throw new Error("AUTH_RESPONSE_INVALID");
      localStorage.setItem("ea_token", token);
      set({ token, hydrated: true });
      Promise.all([
        sessionGet("/auth/me").catch(() => null),
        fetchPlatformRestrictions(),
        fetchPlatformGrants(),
        fetchSubscription(),
      ]).then(async ([me, restrictions, grants, sub]) => {
        if (me?.email) localStorage.setItem("ea_email", me.email);
        if (me?.email && me.email !== "demo") clearDemoTourState();
        if (me?.email) useWorkspaceStore.getState().resetForUser(me.email);
        set({
          email: me?.email ?? null,
          name: me?.name ?? null,
          picture: me?.picture ?? null,
          authProvider: me?.auth_provider ?? null,
          hasPassword: me?.has_password ?? false,
          platformRestrictions: restrictions,
          platformGrants: grants ?? [],
          subscription: sub ?? DEFAULT_SUB,
        });
        await backfillAuthName(me?.email ?? localStorage.getItem("ea_email") ?? "", me?.name ?? null, set);
      }).catch(() => {});
    } catch (e) {
      set({ error: humanizeAuthError(e) });
    } finally {
      set({ isLoading: false });
    }
  },

  setProfile: ({ name, picture, authProvider, hasPassword }) => set({ name, picture, authProvider, hasPassword: hasPassword ?? false }),

  logout: () => {
    localStorage.removeItem("ea_token");
    localStorage.removeItem("ea_email");
    clearSessionCache();
    clearDemoTourState();
    useWorkspaceStore.getState().resetForUser(null);
    set({ token: null, email: null, name: null, picture: null, authProvider: null, hasPassword: false, hydrated: true, connecting: false, platformRestrictions: [], platformGrants: [], subscription: DEFAULT_SUB, creditBalance: null, creditInfo: null });
  }
}));

// The server refused the token on /auth/me (see api/client.js): sign out everywhere in this tab.
if (typeof window !== "undefined") {
  window.addEventListener("ea:unauthorized", () => {
    if (useAuthStore.getState().token) useAuthStore.getState().logout();
  });
}
