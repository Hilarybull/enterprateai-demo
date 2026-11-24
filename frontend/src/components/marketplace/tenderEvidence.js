// Presentation only. Keep the original source keys and exact quotes in saved
// evaluations so evidence validation and audit references remain unchanged.
const tenderFields = {
  title: "Tender title", description: "Scope of work", eligibility: "Who can apply",
  award_criteria: "How bids are assessed", submission_instructions: "How to submit",
  procedure: "Procurement procedure", deadline: "Submission deadline", enquiry_deadline: "Enquiry deadline",
  contract_start: "Contract start date", contract_end: "Contract end date",
  contract_extension_end: "Possible extension end date", extension_description: "Contract extensions",
  region: "Contract location", industry: "Industry", category: "Contract type",
  amount: "Published value", currency: "Currency", sme_suitable: "SME suitability",
};
const profileFields = {
  company_name: "Business name", legal_name: "Registered business name", business_type: "Business type",
  primary_industry: "Main industry", secondary_industries: "Other industries", about_company: "About your business",
  year_established: "Year established", company_size: "Team size", employee_count: "Number of employees",
  country: "Country", city: "City", state_or_region: "Region", monthly_revenue_range: "Monthly revenue",
  operating_stage: "Business stage", delivery_model: "How you deliver your services",
  certifications: "Certifications", accreditations: "Accreditations", service_areas: "Areas you serve", experience: "Experience",
};
const choiceLabels = {
  business_type: { sole_trader: "Sole trader", partnership: "Partnership", limited_company: "Limited company", llp: "LLP", non_profit: "Non-profit", startup: "Startup" },
  operating_stage: { idea: "Idea stage", pre_launch: "Preparing to launch", pre_revenue: "Pre-revenue", early_revenue: "Early revenue", operating: "Operating", growing: "Growing", growth: "Growing", scaling: "Scaling", mature: "Mature", established: "Established" },
  delivery_model: { manual: "Manual / service-led", hybrid: "Hybrid", automated: "Automated", digital: "Digital / automated", productised: "Productised service" },
  category: { goods: "Goods", services: "Services", works: "Works" },
};

export function evidenceLabel(source) {
  if (Object.hasOwn(tenderFields, source)) return tenderFields[source];
  const profile = /^workspace_profile\.([a-z_]+)$/.exec(source || "");
  if (profile) return profileFields[profile[1]] ? `Your business profile · ${profileFields[profile[1]]}` : "Your business profile";
  const service = /^workspace_profile\.services\.(\d+)\.(service_name|service_category|service_description)$/.exec(source || "");
  if (service) return `Your services · Service ${service[1]} · ${{ service_name: "Name", service_category: "Category", service_description: "Description" }[service[2]]}`;
  const product = /^financials\.products\.(\d+)\.(name|category|description)$/.exec(source || "");
  if (product) return `Your catalogue · Product ${product[1]} · ${{ name: "Name", category: "Category", description: "Description" }[product[2]]}`;
  return source?.startsWith("workspace_profile.") || source?.startsWith("financials.") ? "Your business information" : "Tender notice";
}

export function evidenceValue(reference, notice = {}) {
  const raw = String(reference.quote ?? "");
  const field = String(reference.source || "").split(".").at(-1);
  const known = choiceLabels[field]?.[raw];
  if (known) return known;
  if (reference.source?.startsWith("workspace_profile.")) {
    try {
      const values = JSON.parse(raw);
      if (Array.isArray(values) && values.every(value => ["string", "number"].includes(typeof value))) return values.join(", ");
    } catch { /* Most evidence is ordinary text rather than a saved list. */ }
    if (["business_type", "primary_industry", "operating_stage", "delivery_model"].includes(field) && /^[a-z]+(?:_[a-z]+)+$/.test(raw)) {
      return raw.replaceAll("_", " ").replace(/^./, first => first.toUpperCase());
    }
  }
  if (field === "company_size") {
    if (raw === "solo" || raw === "1") return "1 person";
    if (/^\d+\s*[-–]\s*\d+$/.test(raw)) return raw.replace(/\s*[-–]\s*/, "–") + " people";
    if (/^\d+\+$/.test(raw)) return raw + " people";
  }
  if (field === "sme_suitable" && ["true", "false"].includes(raw)) return raw === "true" ? "Suitable for SMEs" : "Not marked suitable for SMEs";
  if (["deadline", "enquiry_deadline", "contract_start", "contract_end", "contract_extension_end"].includes(field) && /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(raw)) {
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) return new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium", ...(raw.includes("T") ? { timeStyle: "short" } : {}), timeZone: "Europe/London",
    }).format(date) + (raw.includes("T") ? " (UK time)" : "");
  }
  if (field === "amount" && /^-?\d+(?:\.\d+)?$/.test(raw)) {
    try {
      return new Intl.NumberFormat("en-GB", /^[A-Z]{3}$/.test(notice.currency || "") ? { style: "currency", currency: notice.currency } : {}).format(Number(raw));
    } catch { /* Fall back to the original evidence if a currency is unavailable. */ }
  }
  return raw;
}
