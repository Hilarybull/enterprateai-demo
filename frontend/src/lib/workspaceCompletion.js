// How complete a workspace's profile is, from the same fields the sign-up setup asks for
// (the four steps: identity, about, location, what you offer). A skipped field is stored
// with a neutral default so the profile is valid; those defaults don't count as answers.

const GENERIC_NAMES = new Set(["", "my workspace", "my business", "unnamed"]);
// Defaults that are also real choices: only a default if setup recorded the field as skipped.
const CHOICE_DEFAULTS = { business_type: "startup", primary_industry: "other", operating_stage: "idea" };

const text = (v) => String(v ?? "").trim();

export const COMPLETION_FIELDS = [
  { key: "company_name", label: "Business name", step: "identity" },
  { key: "business_type", label: "Business type", step: "identity" },
  { key: "primary_industry", label: "Industry", step: "identity" },
  { key: "tagline", label: "Tagline", step: "about" },
  { key: "about_company", label: "Description", step: "about" },
  { key: "operating_stage", label: "Stage", step: "about" },
  { key: "company_size", label: "Team size", step: "about" },
  { key: "country", label: "Country", step: "location" },
  { key: "city", label: "City", step: "location" },
  { key: "phone_number", label: "Phone number", step: "location" },
  { key: "website", label: "Website", step: "location" },
  { key: "services", label: "A product or service", step: "services" },
];

function answered(key, profile, skipped) {
  const value = profile?.[key];
  if (key === "services") return Array.isArray(value) && value.some((s) => text(s?.service_name ?? s));
  const v = text(value);
  if (!v) return false;
  if (key === "company_name") return !GENERIC_NAMES.has(v.toLowerCase());
  if (key === "country" || key === "city") return v.toLowerCase() !== "not specified";
  if (key === "about_company") return !/is building its business with EnterprateAI\.$/.test(v);
  if (key in CHOICE_DEFAULTS) return !(skipped.has(key) && v === CHOICE_DEFAULTS[key]);
  return true;
}

/**
 * { percent, done, total, missing: [labels], level } for a workspace document's data,
 * or null when there is no workspace to measure.
 * level: "low" (<40%), "medium" (40-79%), "high" (80-99%), "complete" (100%).
 */
export function workspaceCompletion(data) {
  if (!data || typeof data !== "object") return null;
  const profile = data.workspace_profile || {};
  const skipped = new Set(data.onboarding?.defaulted_fields || []);
  const missing = COMPLETION_FIELDS.filter((f) => !answered(f.key, profile, skipped)).map((f) => f.label);
  const total = COMPLETION_FIELDS.length;
  const done = total - missing.length;
  const percent = Math.round((done / total) * 100);
  const level = percent >= 100 ? "complete" : percent >= 80 ? "high" : percent >= 40 ? "medium" : "low";
  return { percent, done, total, missing, level };
}
