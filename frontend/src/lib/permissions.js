export const MODULES = [
  { key: "dashboard", label: "Dashboard", subtitle: "Overview & analytics" },
  { key: "validation", label: "Idea Validation", subtitle: "Validate business ideas" },
  { key: "blueprint", label: "Business Blueprints", subtitle: "Plans & documents" },
  { key: "simulation", label: "Simulation", subtitle: "What-if scenarios" },
  { key: "catalogue", label: "Catalogue", subtitle: "Products & offers" },
  { key: "financials", label: "Financials", subtitle: "Invoicing & tracking" },
  // { key: "registration", label: "Business Registration", subtitle: "Legal & compliance" },
];

export const FEATURES = {
  dashboard: [
    { key: "view_dashboard", label: "View Dashboard" },
  ],
  validation: [
    { key: "evaluate_idea", label: "Evaluate Business Idea" },
    { key: "service_validation", label: "Service Idea Validation" },
  ],
  blueprint: [
    { key: "business_plan", label: "Business Plan" },
    { key: "business_proposal", label: "Business Proposals" },
    { key: "sales_letter", label: "Sales Letter" },
  ],
  simulation: [
    { key: "run_simulation", label: "Run Simulation" },
    { key: "scenario_intelligence", label: "Scenario Intelligence" },
    { key: "risk_detection", label: "Risk Detection" },
    { key: "recommendations", label: "Recommendations" },
  ],
  catalogue: [
    { key: "view_catalogue", label: "View Catalogue" },
    { key: "manage_products", label: "Manage Products" },
    { key: "manage_customers", label: "Customers" },
    { key: "manage_vendors", label: "Vendors" },
  ],
  financials: [
    { key: "view_financials", label: "View Financials" },
    { key: "invoices", label: "Invoices" },
    { key: "quotations", label: "Quotations" },
    { key: "expenses", label: "Expenses" },
    { key: "contracts", label: "Contracts" },
    { key: "export_reports", label: "Export Reports" },
  ],
  registration: [
    { key: "registration_guide", label: "Registration Guide" },
    { key: "name_check", label: "Company Name Check" },
    { key: "sic_codes", label: "SIC Code Lookup" },
  ],
};

export function describePermissions(permissionType, permissions) {
  if (!permissions) return "No access";
  if (permissionType === "module") {
    const mods = permissions.modules || [];
    if (mods.length === 0) return "No modules";
    if (mods.length === MODULES.length) return "All modules";
    return mods
      .map((k) => MODULES.find((m) => m.key === k)?.label || k)
      .join(", ");
  }
  const feats = permissions.features || {};
  const total = Object.values(feats).reduce((s, arr) => s + (arr?.length || 0), 0);
  if (total === 0) return "No features";
  return `${total} feature${total !== 1 ? "s" : ""} across ${Object.keys(feats).length} module${Object.keys(feats).length !== 1 ? "s" : ""}`;
}

/**
 * Returns true if the given specific feature is accessible under the permission set.
 * Module-level grants → all features within that module are accessible.
 * Feature-level grants → only explicitly listed features are accessible.
 */
export function hasFeatureAccess(moduleKey, featureKey, permissionType, permissions) {
  if (!permissions || !permissionType) return false;
  if (permissionType === "module") {
    return (permissions.modules || []).includes(moduleKey);
  }
  return ((permissions.features || {})[moduleKey] || []).includes(featureKey);
}

/**
 * Returns true if the given module is accessible under the permission set.
 */
export function hasModuleAccess(moduleKey, permissionType, permissions) {
  if (!permissions || !permissionType) return false;
  if (permissionType === "module") {
    return (permissions.modules || []).includes(moduleKey);
  }
  // feature-based: module is accessible if at least one feature in it is granted
  const feats = permissions.features || {};
  return (feats[moduleKey] || []).length > 0;
}

/**
 * Returns true if an admin has blocked the entire module for this user platform-wide.
 */
export function isPlatformModuleRestricted(moduleKey, platformRestrictions) {
  return (platformRestrictions || []).some(
    (r) => r.module_key === moduleKey && !r.feature_key
  );
}

/**
 * Returns true if an admin has blocked this specific feature (or its entire module) platform-wide.
 */
export function isPlatformFeatureRestricted(moduleKey, featureKey, platformRestrictions) {
  return (platformRestrictions || []).some(
    (r) => r.module_key === moduleKey && (!r.feature_key || r.feature_key === featureKey)
  );
}

/**
 * Returns a structured summary of what is granted, grouped by module.
 * [{ moduleKey, moduleLabel, features: [{key, label}] | "all" }]
 */
export function getGrantedSummary(permissionType, permissions) {
  if (!permissions) return [];
  if (permissionType === "module") {
    return (permissions.modules || []).map((k) => {
      const mod = MODULES.find((m) => m.key === k);
      return { moduleKey: k, moduleLabel: mod?.label || k, features: "all" };
    });
  }
  const feats = permissions.features || {};
  return Object.entries(feats)
    .filter(([, arr]) => arr && arr.length > 0)
    .map(([modKey, featKeys]) => {
      const mod = MODULES.find((m) => m.key === modKey);
      const modFeatures = FEATURES[modKey] || [];
      return {
        moduleKey: modKey,
        moduleLabel: mod?.label || modKey,
        features: featKeys.map((fk) => ({
          key: fk,
          label: modFeatures.find((f) => f.key === fk)?.label || fk,
        })),
      };
    });
}
