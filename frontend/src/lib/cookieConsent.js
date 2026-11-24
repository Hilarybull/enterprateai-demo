export const COOKIE_CONSENT_KEY = "ea_cookie_consent";

export function readCookieConsent() {
  try {
    const saved = JSON.parse(localStorage.getItem(COOKIE_CONSENT_KEY));
    return typeof saved?.analytics === "boolean" ? saved : null;
  } catch {
    return null;
  }
}

export function applyClarityConsent(preferences) {
  if (typeof window.clarity !== "function") return;
  const permission = preferences?.analytics === true ? "granted" : "denied";
  window.clarity("consentv2", {
    analytics_Storage: permission,
    ad_Storage: permission,
  });
}

export function saveCookieConsent(analytics) {
  const preferences = { operational: true, analytics };
  try { localStorage.setItem(COOKIE_CONSENT_KEY, JSON.stringify(preferences)); } catch {}
  applyClarityConsent(preferences);
}

export function resetCookieConsent() {
  try { localStorage.removeItem(COOKIE_CONSENT_KEY); } catch {}
  applyClarityConsent(null);
}

export function initializeClarity(projectId) {
  if (typeof window.clarity !== "function") {
    window.clarity = function (...args) {
      (window.clarity.q = window.clarity.q || []).push(args);
    };
  }
  applyClarityConsent(readCookieConsent());
  if (document.querySelector(`script[data-clarity-project="${projectId}"]`)) return;
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.clarity.ms/tag/${projectId}`;
  script.dataset.clarityProject = projectId;
  document.head.appendChild(script);
}
