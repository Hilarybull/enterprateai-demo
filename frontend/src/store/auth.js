import { create } from "zustand";
import { apiRequest } from "../api/client";

function humanizeAuthError(e) {
  const msg = e instanceof Error ? e.message : String(e || "");
  if (msg === "NETWORK_ERROR") {
    const base = import.meta.env.VITE_API_URL ?? import.meta.env.REACT_APP_BACKEND_URL ?? "http://localhost:8000";
    return `Can't reach the server at ${base}. Start the backend and check your API URL.`;
  }
  if (msg === "AUTH_RESPONSE_INVALID") return "Authentication failed. Please try again.";
  if (msg.startsWith("HTTP 401:")) return "Invalid credentials. Try again or create an account.";
  if (msg.startsWith("HTTP 403:")) {
    const lower = msg.toLowerCase();
    if (lower.includes("suspended") || lower.includes("blocked")) {
      return msg.replace(/^HTTP 403:\s*/, "");
    }
    return "Access denied.";
  }
  if (msg.startsWith("HTTP 409:")) return "Account already exists. Sign in instead.";
  if (msg.startsWith("HTTP 422:")) return "Please enter a valid email and a password (8+ characters).";
  if (msg.startsWith("HTTP 500:")) return "Server configuration error. Try again later.";
  return msg;
}

async function fetchPlatformRestrictions() {
  try {
    return await apiRequest("/auth/restrictions", "GET");
  } catch {
    return [];
  }
}

export const useAuthStore = create((set, get) => ({
  token: null,
  email: null,
  hydrated: false,
  isLoading: false,
  error: null,
  platformRestrictions: [],

  hydrate: () => {
    const token = localStorage.getItem("ea_token");
    const email = localStorage.getItem("ea_email");
    set({ token: token || null, email: email || null, hydrated: true });
    if (token) {
      fetchPlatformRestrictions().then((r) => set({ platformRestrictions: r }));
    }
  },

  setPlatformRestrictions: (restrictions) => set({ platformRestrictions: restrictions }),

  register: async (email, password) => {
    set({ isLoading: true, error: null });
    try {
      await apiRequest("/auth/register", "POST", { email, password });
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
      set({ token, email });
      const restrictions = await fetchPlatformRestrictions();
      set({ platformRestrictions: restrictions });
    } catch (e) {
      set({ error: humanizeAuthError(e) });
    } finally {
      set({ isLoading: false });
    }
  },

  googleLogin: async (credential) => {
    set({ isLoading: true, error: null });
    try {
      const tokenRes = await apiRequest("/auth/google", "POST", { credential });
      const token = tokenRes?.access_token ?? tokenRes?.token ?? null;
      if (!token) throw new Error("AUTH_RESPONSE_INVALID");
      localStorage.setItem("ea_token", token);
      const me = await apiRequest("/auth/me", "GET");
      localStorage.setItem("ea_email", me.email);
      set({ token, email: me.email });
      const restrictions = await fetchPlatformRestrictions();
      set({ platformRestrictions: restrictions });
    } catch (e) {
      set({ error: humanizeAuthError(e) });
    } finally {
      set({ isLoading: false });
    }
  },

  logout: () => {
    localStorage.removeItem("ea_token");
    localStorage.removeItem("ea_email");
    set({ token: null, email: null, hydrated: true, platformRestrictions: [] });
  }
}));
