import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "../components/Button";
import InlineAlert from "../components/InlineAlert";
import Input from "../components/Input";
import PageHeader from "../components/PageHeader";
import SectionCard from "../components/SectionCard";
import SegmentedTabs from "../components/SegmentedTabs";
import WorkspacePrompt from "../components/WorkspacePrompt";
import { CatalogueIllustration, IllustrationCard } from "../components/Illustrations";
import { apiRequest } from "../api/client";
import { useWorkspaceStore } from "../store/workspace";

export default function CataloguePage() {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const setWorkspaceId = useWorkspaceStore((s) => s.setWorkspaceId);
  const setWorkspaceName = useWorkspaceStore((s) => s.setWorkspaceName);
  const navigate = useNavigate();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [catalogueIntegrations, setCatalogueIntegrations] = useState({
    crm: { hubspot: "not_connected", salesforce: "not_connected", zoho_crm: "not_connected" },
    inventory: { shopify: "not_connected", woo_commerce: "not_connected", square: "not_connected" }
  });
  const ARCHIVE_WARNING_DAYS = 60;
  const ARCHIVE_EXPIRE_DAYS = 90;

  const [editingProductId, setEditingProductId] = useState(null);
  const [editingCustomerId, setEditingCustomerId] = useState(null);
  const [editingVendorId, setEditingVendorId] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");

  const [productForm, setProductForm] = useState({
    name: "",
    type: "service",
    base_price: "",
    discount: "",
    freight_cost: ""
  });
  const [customerForm, setCustomerForm] = useState({
    name: "",
    address: "",
    payment_terms: "14",
    industry: ""
  });
  const [vendorForm, setVendorForm] = useState({
    name: "",
    address: "",
    payment_terms: "14",
    industry: "",
    product_type: "product",
    product_name: "",
    price: ""
  });

  const paymentTermOptions = ["7", "14", "30", "45", "60", "90", "Other"];
  const INDUSTRY_OPTIONS = [
    "IT",
    "Marketing",
    "Consulting",
    "Accounting",
    "Legal",
    "HR",
    "Design",
    "Sales",
    "Operations",
    "Customer Support",
    "Healthcare",
    "Education",
    "Construction",
    "Other"
  ];
  const customerIndustryCategory = INDUSTRY_OPTIONS.includes(customerForm.industry)
    ? customerForm.industry
    : customerForm.industry
      ? "Other"
      : "";

  function CardIcon({ tone = "bg-brand-50 text-brand-600", children }) {
    return (
      <div className={`flex h-9 w-9 items-center justify-center rounded-2xl ${tone}`}>
        {children}
      </div>
    );
  }

  function daysSince(date) {
    const ts = date ? new Date(date).getTime() : NaN;
    if (!Number.isFinite(ts)) return 0;
    return Math.floor((Date.now() - ts) / (1000 * 60 * 60 * 24));
  }

  function normalizeHeader(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  function parseCsv(text) {
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) return { headers: [], rows: [] };
    const rawHeaders = lines[0].split(",").map((h) => h.trim());
    const headers = rawHeaders.map(normalizeHeader);
    const rows = lines.slice(1).map((line) => {
      const cells = line.split(",").map((cell) => cell.trim().replace(/^"|"$/g, ""));
      const row = {};
      headers.forEach((header, idx) => {
        row[header] = cells[idx] ?? "";
      });
      return row;
    });
    return { headers, rows };
  }

  function coercePaymentTerms(value) {
    const num = parseInt(String(value || "").trim(), 10);
    if (!Number.isFinite(num) || num <= 0) return "14";
    return String(num);
  }

  async function handleProductImport(file) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("Upload a CSV file for products.");
      return;
    }
    const text = await file.text();
    const { rows } = parseCsv(text);
    if (!rows.length) {
      setError("No rows found in the product CSV.");
      return;
    }
    const next = [...products];
    rows.forEach((row) => {
      const name = row.product_name || row.name || "";
      const type = row.product_type || row.type || "service";
      const basePrice = row.base_price || row.price || "";
      if (!name || !String(basePrice).trim()) return;
      next.unshift({
        id: crypto.randomUUID(),
        name: String(name).trim(),
        type: String(type).trim() === "product" ? "product" : "service",
        base_price: Number(basePrice || 0),
        discount: Number(row.discount || 0),
        freight_cost: Number(row.freight_cost || row.freight || 0),
        archived: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    });
    setProducts(next);
    await persist({ products: next, customers, vendors });
  }

  async function handleCustomerImport(file) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("Upload a CSV file for customers.");
      return;
    }
    const text = await file.text();
    const { rows } = parseCsv(text);
    if (!rows.length) {
      setError("No rows found in the customer CSV.");
      return;
    }
    const next = [...customers];
    rows.forEach((row) => {
      const name = row.customer_name || row.name || "";
      if (!name) return;
      next.unshift({
        id: crypto.randomUUID(),
        name: String(name).trim(),
        address: String(row.address || "").trim(),
        payment_terms: coercePaymentTerms(row.payment_terms),
        industry: String(row.industry || "").trim(),
        archived: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    });
    setCustomers(next);
    await persist({ products, customers: next, vendors });
  }

  async function handleVendorImport(file) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("Upload a CSV file for vendors.");
      return;
    }
    const text = await file.text();
    const { rows } = parseCsv(text);
    if (!rows.length) {
      setError("No rows found in the vendor CSV.");
      return;
    }
    const next = [...vendors];
    rows.forEach((row) => {
      const name = row.vendor_name || row.name || "";
      const productName = row.product_name || "";
      const price = row.price || "";
      if (!name || !productName || !String(price).trim()) return;
      next.unshift({
        id: crypto.randomUUID(),
        name: String(name).trim(),
        address: String(row.address || "").trim(),
        payment_terms: coercePaymentTerms(row.payment_terms),
        industry: String(row.industry || "").trim(),
        product_type: String(row.product_type || "product").trim() === "service" ? "service" : "product",
        product_name: String(productName).trim(),
        price: Number(price || 0),
        archived: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    });
    setVendors(next);
    await persist({ products, customers, vendors: next });
  }

  if (!workspaceId) {
    return <WorkspacePrompt />;
  }

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const ws = await apiRequest("/validation/me", "GET");
        if (!alive || !ws) return;
        setWorkspaceId(ws.id || workspaceId);
        setWorkspaceName(ws.name || null);
        const cat = ws?.data?.catalogue || {};
        const integ = ws?.data?.integrations || {};
        const nextProducts = Array.isArray(cat.products) ? cat.products : [];
        const nextCustomers = Array.isArray(cat.customers) ? cat.customers : [];
        const nextVendors = Array.isArray(cat.vendors) ? cat.vendors : [];
        setProducts(nextProducts);
        setCustomers(nextCustomers);
        setVendors(nextVendors);
        setCatalogueIntegrations({
          crm: {
            hubspot: integ?.catalogue?.crm?.hubspot || "not_connected",
            salesforce: integ?.catalogue?.crm?.salesforce || "not_connected",
            zoho_crm: integ?.catalogue?.crm?.zoho_crm || "not_connected"
          },
          inventory: {
            shopify: integ?.catalogue?.inventory?.shopify || "not_connected",
            woo_commerce: integ?.catalogue?.inventory?.woo_commerce || "not_connected",
            square: integ?.catalogue?.inventory?.square || "not_connected"
          }
        });
      } catch (e) {
        if (String(e?.message || "").includes("HTTP 404")) return;
        setError(e instanceof Error ? e.message : "Failed to load catalogue");
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    return () => {
      alive = false;
    };
  }, [workspaceId, setWorkspaceId, setWorkspaceName]);

  useEffect(() => {
    if (!workspaceId) return;
    const normalizeArchivedAt = (list) =>
      list.map((item) => {
        if (!item.archived) return item;
        if (item.archived_at) return item;
        return { ...item, archived_at: item.updated_at || item.created_at || new Date().toISOString() };
      });
    const stripExpired = (list) => {
      const remaining = list.filter((item) => {
        if (!item.archived) return true;
        const age = daysSince(item.archived_at || item.updated_at || item.created_at);
        return age < ARCHIVE_EXPIRE_DAYS;
      });
      return remaining;
    };
    const nextProducts = stripExpired(normalizeArchivedAt(products));
    const nextCustomers = stripExpired(normalizeArchivedAt(customers));
    const nextVendors = stripExpired(normalizeArchivedAt(vendors));
    const changed =
      nextProducts.length !== products.length ||
      nextCustomers.length !== customers.length ||
      nextVendors.length !== vendors.length ||
      nextProducts.some((p, i) => p.archived_at !== products[i]?.archived_at) ||
      nextCustomers.some((c, i) => c.archived_at !== customers[i]?.archived_at) ||
      nextVendors.some((v, i) => v.archived_at !== vendors[i]?.archived_at);
    if (changed) {
      setProducts(nextProducts);
      setCustomers(nextCustomers);
      setVendors(nextVendors);
      persist({ products: nextProducts, customers: nextCustomers, vendors: nextVendors });
    }
  }, [workspaceId, products, customers, vendors]);

  async function persist(next) {
    await apiRequest("/validation/me", "PATCH", { data: { catalogue: next } });
  }
  async function persistCatalogueIntegrations(next) {
    await apiRequest("/validation/me", "PATCH", { data: { integrations: { catalogue: next } } });
  }

  function resetProductForm() {
    setProductForm({ name: "", type: "service", base_price: "", discount: "", freight_cost: "" });
    setEditingProductId(null);
  }
  function resetCustomerForm() {
    setCustomerForm({ name: "", address: "", payment_terms: "14", industry: "" });
    setEditingCustomerId(null);
  }
  function resetVendorForm() {
    setVendorForm({
      name: "",
      address: "",
      payment_terms: "14",
      industry: "",
      product_type: "product",
      product_name: "",
      price: ""
    });
    setEditingVendorId(null);
  }

  async function upsertProduct() {
    if (!productForm.name.trim() || !String(productForm.base_price).trim()) {
      setError("Product name and base price are required.");
      return;
    }
    setError(null);
    const next = products.map((p) => ({ ...p }));
    const payload = {
      id: editingProductId || crypto.randomUUID(),
      name: productForm.name.trim(),
      type: productForm.type,
      base_price: Number(productForm.base_price || 0),
      discount: Number(productForm.discount || 0),
      freight_cost: Number(productForm.freight_cost || 0),
      archived: false,
      updated_at: new Date().toISOString()
    };
    if (editingProductId) {
      const idx = next.findIndex((p) => p.id === editingProductId);
      if (idx >= 0) next[idx] = { ...next[idx], ...payload };
    } else {
      next.unshift({ ...payload, created_at: new Date().toISOString() });
    }
    setProducts(next);
    await persist({ products: next, customers, vendors });
    resetProductForm();
  }

  async function upsertCustomer() {
    if (!customerForm.name.trim()) {
      setError("Customer name is required.");
      return;
    }
    setError(null);
    const next = customers.map((c) => ({ ...c }));
    const payload = {
      id: editingCustomerId || crypto.randomUUID(),
      name: customerForm.name.trim(),
      address: customerForm.address.trim(),
      payment_terms: coercePaymentTerms(customerForm.payment_terms),
      industry: customerForm.industry.trim(),
      archived: false,
      updated_at: new Date().toISOString()
    };
    if (editingCustomerId) {
      const idx = next.findIndex((c) => c.id === editingCustomerId);
      if (idx >= 0) next[idx] = { ...next[idx], ...payload };
    } else {
      next.unshift({ ...payload, created_at: new Date().toISOString() });
    }
    setCustomers(next);
    await persist({ products, customers: next, vendors });
    resetCustomerForm();
  }

  async function upsertVendor() {
    if (!vendorForm.name.trim() || !vendorForm.product_name.trim() || !String(vendorForm.price).trim()) {
      setError("Vendor name, product name, and price are required.");
      return;
    }
    setError(null);
    const next = vendors.map((v) => ({ ...v }));
    const payload = {
      id: editingVendorId || crypto.randomUUID(),
      name: vendorForm.name.trim(),
      address: vendorForm.address.trim(),
      payment_terms: coercePaymentTerms(vendorForm.payment_terms),
      industry: vendorForm.industry.trim(),
      product_type: vendorForm.product_type,
      product_name: vendorForm.product_name.trim(),
      price: Number(vendorForm.price || 0),
      archived: false,
      updated_at: new Date().toISOString()
    };
    if (editingVendorId) {
      const idx = next.findIndex((v) => v.id === editingVendorId);
      if (idx >= 0) next[idx] = { ...next[idx], ...payload };
    } else {
      next.unshift({ ...payload, created_at: new Date().toISOString() });
    }
    setVendors(next);
    await persist({ products, customers, vendors: next });
    resetVendorForm();
  }

  async function archiveEntity(kind, id) {
    const mutator = (list) =>
      list.map((it) =>
        it.id === id
          ? { ...it, archived: true, archived_at: new Date().toISOString(), updated_at: new Date().toISOString() }
          : it
      );
    const nextProducts = kind === "products" ? mutator(products) : products;
    const nextCustomers = kind === "customers" ? mutator(customers) : customers;
    const nextVendors = kind === "vendors" ? mutator(vendors) : vendors;
    setProducts(nextProducts);
    setCustomers(nextCustomers);
    setVendors(nextVendors);
    await persist({ products: nextProducts, customers: nextCustomers, vendors: nextVendors });
  }

  async function restoreEntity(kind, id) {
    const mutator = (list) =>
      list.map((it) =>
        it.id === id ? { ...it, archived: false, archived_at: null, updated_at: new Date().toISOString() } : it
      );
    const nextProducts = kind === "products" ? mutator(products) : products;
    const nextCustomers = kind === "customers" ? mutator(customers) : customers;
    const nextVendors = kind === "vendors" ? mutator(vendors) : vendors;
    setProducts(nextProducts);
    setCustomers(nextCustomers);
    setVendors(nextVendors);
    await persist({ products: nextProducts, customers: nextCustomers, vendors: nextVendors });
  }

  async function deleteEntity(kind, id) {
    const filterer = (list) => list.filter((it) => it.id !== id);
    const nextProducts = kind === "products" ? filterer(products) : products;
    const nextCustomers = kind === "customers" ? filterer(customers) : customers;
    const nextVendors = kind === "vendors" ? filterer(vendors) : vendors;
    setProducts(nextProducts);
    setCustomers(nextCustomers);
    setVendors(nextVendors);
    await persist({ products: nextProducts, customers: nextCustomers, vendors: nextVendors });
  }

  const activeProducts = useMemo(() => products.filter((p) => !p.archived), [products]);
  const activeCustomers = useMemo(() => customers.filter((c) => !c.archived), [customers]);
  const activeVendors = useMemo(() => vendors.filter((v) => !v.archived), [vendors]);
  const archivedProducts = useMemo(() => products.filter((p) => p.archived), [products]);
  const archivedCustomers = useMemo(() => customers.filter((c) => c.archived), [customers]);
  const archivedVendors = useMemo(() => vendors.filter((v) => v.archived), [vendors]);

  const hasArchiveWarning = useMemo(() => {
    const list = [...archivedProducts, ...archivedCustomers, ...archivedVendors];
    return list.some((item) => daysSince(item.archived_at || item.updated_at || item.created_at) >= ARCHIVE_WARNING_DAYS);
  }, [archivedProducts, archivedCustomers, archivedVendors]);

  const catalogueIntegrationMeta = {
    hubspot: { label: "HubSpot", note: "Sync customer records and lifecycle data." },
    salesforce: { label: "Salesforce", note: "Connect accounts and contact lists." },
    zoho_crm: { label: "Zoho CRM", note: "Pull contacts and company profiles." },
    shopify: { label: "Shopify", note: "Sync products and inventory." },
    woo_commerce: { label: "WooCommerce", note: "Import products and stock levels." },
    square: { label: "Square", note: "Sync catalog and item pricing." }
  };

  const catalogueLogos = {
    hubspot: { label: "HS", className: "bg-orange-100 text-orange-700" },
    salesforce: { label: "SF", className: "bg-sky-100 text-sky-700" },
    zoho_crm: { label: "ZC", className: "bg-red-100 text-red-700" },
    shopify: { label: "SH", className: "bg-emerald-100 text-emerald-700" },
    woo_commerce: { label: "WC", className: "bg-violet-100 text-violet-700" },
    square: { label: "SQ", className: "bg-slate-100 text-slate-700" }
  };

  function statusBadge(status) {
    if (status === "connected") return { label: "Connected", tone: "emerald" };
    if (status === "pending") return { label: "Pending", tone: "amber" };
    return { label: "Not connected", tone: "slate" };
  }

  function CatalogueLogo({ type }) {
    const meta = catalogueLogos[type] || { label: type?.slice(0, 2) || "IN", className: "bg-slate-100 text-slate-600" };
    return (
      <div className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold ${meta.className}`}>
        {meta.label}
      </div>
    );
  }

  async function updateCatalogueIntegration(section, key) {
    const current = catalogueIntegrations?.[section]?.[key] || "not_connected";
    const nextStatus = current === "connected" ? "not_connected" : "connected";
    const next = {
      ...catalogueIntegrations,
      [section]: { ...catalogueIntegrations[section], [key]: nextStatus }
    };
    setCatalogueIntegrations(next);
    await persistCatalogueIntegrations(next);
  }

  return (
    <div>
      <PageHeader
        title="Catalogue"
        description="Manage products, customers, and suppliers for reuse across invoices and documents."
        badge={{ text: "Beta", tone: "slate" }}
      />

      {error ? (
        <div className="mt-4">
          <InlineAlert kind="error" message={error} />
        </div>
      ) : null}
      {hasArchiveWarning ? (
        <div className="mt-4">
          <InlineAlert kind="warn" message="Archived items older than 60 days will expire after 90 days. Review the archive list to restore or delete them." />
        </div>
      ) : null}

      <div className="mt-6">
        <SegmentedTabs
          value={activeTab}
          onChange={setActiveTab}
          options={[
            { value: "overview", label: "Overview" },
            { value: "products", label: "Products" },
            { value: "customers", label: "Customers" },
            { value: "vendors", label: "Vendors" }
          ]}
        />
      </div>

      {activeTab === "overview" ? (
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <SectionCard
            title="Products & services"
            subtitle="Revenue-generating items in your catalogue."
            icon={
              <CardIcon>
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 3h12l3 5-3 5H6L3 8l3-5Z" />
                  <path d="M6 13v8h12v-8" />
                </svg>
              </CardIcon>
            }
          >
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs text-slate-500">Active products</div>
              <div className="text-2xl font-semibold text-slate-900">{activeProducts.length}</div>
              <div className="mt-2 text-xs text-slate-500">Add products or services to price invoices and contracts.</div>
              <div className="mt-3">
                <Button variant="secondary" onClick={() => setActiveTab("products")}>
                  Manage products
                </Button>
              </div>
            </div>
          </SectionCard>
          <SectionCard
            title="Customers"
            subtitle="Who you bill and their terms."
            icon={
              <CardIcon tone="bg-sky-50 text-sky-600">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M16 11a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z" />
                  <path d="M4 21a8 8 0 0 1 16 0" />
                </svg>
              </CardIcon>
            }
          >
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs text-slate-500">Active customers</div>
              <div className="text-2xl font-semibold text-slate-900">{activeCustomers.length}</div>
              <div className="mt-2 text-xs text-slate-500">Keep payment terms updated for accurate cashflow models.</div>
              <div className="mt-3">
                <Button variant="secondary" onClick={() => setActiveTab("customers")}>
                  Manage customers
                </Button>
              </div>
            </div>
          </SectionCard>
          <SectionCard
            title="Vendors"
            subtitle="Your suppliers and cost sources."
            icon={
              <CardIcon tone="bg-amber-50 text-amber-600">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 7h13l5 5v5H3V7Z" />
                  <path d="M16 7v5h5" />
                  <circle cx="7" cy="17" r="1.5" />
                  <circle cx="17" cy="17" r="1.5" />
                </svg>
              </CardIcon>
            }
          >
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs text-slate-500">Active vendors</div>
              <div className="text-2xl font-semibold text-slate-900">{activeVendors.length}</div>
              <div className="mt-2 text-xs text-slate-500">Track supplier pricing and payment terms in one place.</div>
              <div className="mt-3">
                <Button variant="secondary" onClick={() => setActiveTab("vendors")}>
                  Manage vendors
                </Button>
              </div>
            </div>
          </SectionCard>

          <IllustrationCard
            title="Catalogue map"
            subtitle="A quick visual of how products, customers, and vendors connect."
            className="lg:col-span-3"
          >
            <CatalogueIllustration />
          </IllustrationCard>

          <SectionCard
            title="Catalogue integrations"
            subtitle="Connect CRM and inventory tools to keep your catalogue in sync."
            className="lg:col-span-3"
            icon={
              <CardIcon tone="bg-emerald-50 text-emerald-600">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M7 7h10v10H7z" />
                  <path d="M3 12h4M17 12h4M12 3v4M12 17v4" />
                </svg>
              </CardIcon>
            }
          >
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="text-xs font-semibold text-slate-600">CRM systems</div>
                <div className="mt-3 space-y-2">
                  {["hubspot", "salesforce", "zoho_crm"].map((key) => {
                    const meta = catalogueIntegrationMeta[key];
                    const badge = statusBadge(catalogueIntegrations.crm[key]);
                    return (
                      <div key={key} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-slate-200 p-3">
                        <div className="flex min-w-0 items-start gap-3">
                          <CatalogueLogo type={key} />
                          <div>
                            <div className="text-sm font-semibold text-slate-900">{meta.label}</div>
                            <div className="text-xs text-slate-500">{meta.note}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                              badge.tone === "emerald"
                                ? "bg-emerald-50 text-emerald-700"
                                : badge.tone === "amber"
                                  ? "bg-amber-50 text-amber-700"
                                  : "bg-slate-100 text-slate-600"
                            }`}
                          >
                            {badge.label}
                          </span>
                          <Button variant="secondary" onClick={() => updateCatalogueIntegration("crm", key)}>
                            {catalogueIntegrations.crm[key] === "connected" ? "Disconnect" : "Connect"}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="text-xs font-semibold text-slate-600">Inventory & commerce</div>
                <div className="mt-3 space-y-2">
                  {["shopify", "woo_commerce", "square"].map((key) => {
                    const meta = catalogueIntegrationMeta[key];
                    const badge = statusBadge(catalogueIntegrations.inventory[key]);
                    return (
                      <div key={key} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-slate-200 p-3">
                        <div className="flex min-w-0 items-start gap-3">
                          <CatalogueLogo type={key} />
                          <div>
                            <div className="text-sm font-semibold text-slate-900">{meta.label}</div>
                            <div className="text-xs text-slate-500">{meta.note}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                              badge.tone === "emerald"
                                ? "bg-emerald-50 text-emerald-700"
                                : badge.tone === "amber"
                                  ? "bg-amber-50 text-amber-700"
                                  : "bg-slate-100 text-slate-600"
                            }`}
                          >
                            {badge.label}
                          </span>
                          <Button variant="secondary" onClick={() => updateCatalogueIntegration("inventory", key)}>
                            {catalogueIntegrations.inventory[key] === "connected" ? "Disconnect" : "Connect"}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </SectionCard>
        </div>
      ) : null}

      {activeTab !== "overview" ? (
      <div className="mt-6">
        {activeTab === "products" ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <SectionCard
          title="Products & Services"
          subtitle="Define what you sell and its pricing."
          className="lg:col-span-2"
          icon={
            <CardIcon>
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 3h12l3 5-3 5H6L3 8l3-5Z" />
                <path d="M6 13v8h12v-8" />
              </svg>
            </CardIcon>
          }
        >
          <div className="grid grid-cols-1 gap-3">
            <div>
              <div className="ea-label">Product / Service name *</div>
              <Input value={productForm.name} onChange={(e) => setProductForm((p) => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <div className="ea-label">Type</div>
                <select
                  className="ea-input"
                  value={productForm.type}
                  onChange={(e) => setProductForm((p) => ({ ...p, type: e.target.value }))}
                >
                  <option value="product">Product</option>
                  <option value="service">Service</option>
                </select>
              </div>
              <div>
                <div className="ea-label">Base price *</div>
                <Input
                  type="number"
                  min="0"
                  value={productForm.base_price}
                  onChange={(e) => setProductForm((p) => ({ ...p, base_price: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <div className="ea-label">Discount (optional)</div>
                <Input
                  type="number"
                  min="0"
                  value={productForm.discount}
                  onChange={(e) => setProductForm((p) => ({ ...p, discount: e.target.value }))}
                />
              </div>
              <div>
                <div className="ea-label">Freight cost (optional)</div>
                <Input
                  type="number"
                  min="0"
                  value={productForm.freight_cost}
                  onChange={(e) => setProductForm((p) => ({ ...p, freight_cost: e.target.value }))}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={upsertProduct}>{editingProductId ? "Update product" : "Add product"}</Button>
              {editingProductId ? (
                <Button variant="secondary" onClick={resetProductForm}>
                  Cancel
                </Button>
              ) : null}
            </div>
          </div>
          <div className="mt-5 border-t border-slate-200 pt-4">
            <div className="text-xs font-semibold text-slate-600">Import products (CSV)</div>
            <input
              className="mt-2 text-xs text-slate-600"
              type="file"
              accept=".csv"
              onChange={(e) => handleProductImport(e.target.files?.[0])}
            />
            <div className="mt-1 text-xs text-slate-500">Headers: product_name, product_type, base_price, discount, freight_cost.</div>
          </div>
        </SectionCard>

        <SectionCard
          title="Active products"
          subtitle="Your current live products and services."
          className="lg:col-span-3"
          icon={
            <CardIcon tone="bg-indigo-50 text-indigo-600">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 7h8M8 12h8M8 17h5" />
                <path d="M5 3h14v18H5z" />
              </svg>
            </CardIcon>
          }
        >
            <div className="mt-2 space-y-2 max-h-72 overflow-auto pr-1">
              {activeProducts.length ? (
                activeProducts.map((p) => (
                  <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900">{p.name}</div>
                      <div className="text-xs text-slate-500">
                        {p.type} • Base {p.base_price} • Discount {p.discount || 0} • Freight {p.freight_cost || 0}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setEditingProductId(p.id);
                          setProductForm({
                            name: p.name,
                            type: p.type,
                            base_price: String(p.base_price ?? ""),
                            discount: String(p.discount ?? ""),
                            freight_cost: String(p.freight_cost ?? "")
                          });
                        }}
                      >
                        Edit
                      </Button>
                      <Button variant="ghost" onClick={() => archiveEntity("products", p.id)}>
                        Archive
                      </Button>
                      <Button variant="ghost" onClick={() => deleteEntity("products", p.id)}>
                        Delete
                      </Button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-slate-200 p-3 text-xs text-slate-500">
                  No active products yet.
                </div>
              )}
            </div>
        </SectionCard>
        <SectionCard
          title="Archived products"
          subtitle="Restore or delete items in archive."
          className="lg:col-span-5"
          icon={
            <CardIcon tone="bg-slate-100 text-slate-600">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 7h16" />
                <path d="M6 7l1 12h10l1-12" />
                <path d="M9 7V5h6v2" />
              </svg>
            </CardIcon>
          }
        >
          <div className="mt-2 space-y-2 max-h-60 overflow-auto pr-1">
            {archivedProducts.length ? (
              archivedProducts.map((p) => {
                const age = daysSince(p.archived_at || p.updated_at || p.created_at);
                const expiring = Math.max(0, ARCHIVE_EXPIRE_DAYS - age);
                return (
                  <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900">{p.name}</div>
                      <div className="text-xs text-slate-500">
                        Archived {age} days ago • Expires in {expiring} days
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="secondary" onClick={() => restoreEntity("products", p.id)}>
                        Activate
                      </Button>
                      <Button variant="ghost" onClick={() => deleteEntity("products", p.id)}>
                        Delete
                      </Button>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 p-3 text-xs text-slate-500">
                No archived products.
              </div>
            )}
          </div>
        </SectionCard>
        </div>
        ) : null}

        {activeTab === "customers" ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <SectionCard
          title="Customers"
          subtitle="Define who you bill and their payment terms."
          className="lg:col-span-2"
          icon={
            <CardIcon tone="bg-sky-50 text-sky-600">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M16 11a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z" />
                <path d="M4 21a8 8 0 0 1 16 0" />
              </svg>
            </CardIcon>
          }
        >
          <div className="grid grid-cols-1 gap-3">
            <div>
              <div className="ea-label">Customer name *</div>
              <Input value={customerForm.name} onChange={(e) => setCustomerForm((c) => ({ ...c, name: e.target.value }))} />
            </div>
            <div>
              <div className="ea-label">Address</div>
              <Input value={customerForm.address} onChange={(e) => setCustomerForm((c) => ({ ...c, address: e.target.value }))} />
            </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <div className="ea-label">Payment terms (days)</div>
                  <select
                    className="ea-input"
                    value={paymentTermOptions.includes(customerForm.payment_terms) ? customerForm.payment_terms : "Other"}
                    onChange={(e) =>
                      setCustomerForm((c) => ({
                        ...c,
                        payment_terms: e.target.value === "Other" ? "" : e.target.value
                      }))
                    }
                  >
                    {paymentTermOptions.map((term) => (
                      <option key={term} value={term}>
                        {term === "Other" ? "Other" : `${term} days`}
                      </option>
                    ))}
                  </select>
                  {!paymentTermOptions.includes(customerForm.payment_terms) && (
                    <Input
                      className="mt-2"
                      type="text"
                      inputMode="numeric"
                      placeholder="Enter days"
                      value={customerForm.payment_terms}
                      onChange={(e) => setCustomerForm((c) => ({ ...c, payment_terms: e.target.value }))}
                    />
                  )}
                  <div className="mt-1 text-xs text-slate-500">Choose a term or select Other to enter a custom value.</div>
                </div>
              <div>
                <div className="ea-label">Industry</div>
                <select
                  className="ea-input"
                  value={customerIndustryCategory}
                  onChange={(e) =>
                    setCustomerForm((c) => ({
                      ...c,
                      industry: e.target.value === "Other" ? "" : e.target.value
                    }))
                  }
                >
                  <option value="" disabled>
                    Select industry
                  </option>
                  {INDUSTRY_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
                {customerIndustryCategory === "Other" ? (
                  <Input
                    value={customerForm.industry}
                    onChange={(e) => setCustomerForm((c) => ({ ...c, industry: e.target.value }))}
                    placeholder="Type industry"
                    className="mt-2"
                  />
                ) : null}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={upsertCustomer}>{editingCustomerId ? "Update customer" : "Add customer"}</Button>
              {editingCustomerId ? (
                <Button variant="secondary" onClick={resetCustomerForm}>
                  Cancel
                </Button>
              ) : null}
            </div>
          </div>
          <div className="mt-5 border-t border-slate-200 pt-4">
            <div className="text-xs font-semibold text-slate-600">Import customers (CSV)</div>
            <input
              className="mt-2 text-xs text-slate-600"
              type="file"
              accept=".csv"
              onChange={(e) => handleCustomerImport(e.target.files?.[0])}
            />
            <div className="mt-1 text-xs text-slate-500">Headers: customer_name, address, payment_terms, industry.</div>
          </div>
        </SectionCard>

        <SectionCard
          title="Active customers"
          subtitle="Clients you currently bill."
          className="lg:col-span-3"
          icon={
            <CardIcon tone="bg-indigo-50 text-indigo-600">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 3v6l3-3" />
                <path d="M6 21a6 6 0 0 1 12 0" />
                <circle cx="12" cy="9" r="3" />
              </svg>
            </CardIcon>
          }
        >
            <div className="mt-2 space-y-2 max-h-72 overflow-auto pr-1">
              {activeCustomers.length ? (
                activeCustomers.map((c) => (
                  <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900">{c.name}</div>
                      <div className="text-xs text-slate-500">
                        {c.industry || "Industry"} • {c.payment_terms} days • {c.address || "Address on file"}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setEditingCustomerId(c.id);
                          setCustomerForm({
                            name: c.name,
                            address: c.address || "",
                            payment_terms: String(c.payment_terms || "14"),
                            industry: c.industry || ""
                          });
                        }}
                      >
                        Edit
                      </Button>
                      <Button variant="ghost" onClick={() => archiveEntity("customers", c.id)}>
                        Archive
                      </Button>
                      <Button variant="ghost" onClick={() => deleteEntity("customers", c.id)}>
                        Delete
                      </Button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-slate-200 p-3 text-xs text-slate-500">
                  No active customers yet.
                </div>
              )}
            </div>
        </SectionCard>
        <SectionCard
          title="Archived customers"
          subtitle="Restore or delete items in archive."
          className="lg:col-span-5"
          icon={
            <CardIcon tone="bg-slate-100 text-slate-600">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 7h16" />
                <path d="M6 7l1 12h10l1-12" />
                <path d="M9 7V5h6v2" />
              </svg>
            </CardIcon>
          }
        >
          <div className="mt-2 space-y-2 max-h-60 overflow-auto pr-1">
            {archivedCustomers.length ? (
              archivedCustomers.map((c) => {
                const age = daysSince(c.archived_at || c.updated_at || c.created_at);
                const expiring = Math.max(0, ARCHIVE_EXPIRE_DAYS - age);
                return (
                  <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900">{c.name}</div>
                      <div className="text-xs text-slate-500">
                        Archived {age} days ago • Expires in {expiring} days
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="secondary" onClick={() => restoreEntity("customers", c.id)}>
                        Activate
                      </Button>
                      <Button variant="ghost" onClick={() => deleteEntity("customers", c.id)}>
                        Delete
                      </Button>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 p-3 text-xs text-slate-500">
                No archived customers.
              </div>
            )}
          </div>
        </SectionCard>
        </div>
        ) : null}

        {activeTab === "vendors" ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <SectionCard
          title="Vendors"
          subtitle="Capture suppliers and cost sources."
          className="lg:col-span-2"
          icon={
            <CardIcon tone="bg-amber-50 text-amber-600">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 7h13l5 5v5H3V7Z" />
                <path d="M16 7v5h5" />
              </svg>
            </CardIcon>
          }
        >
          <div className="grid grid-cols-1 gap-3">
            <div>
              <div className="ea-label">Vendor name *</div>
              <Input value={vendorForm.name} onChange={(e) => setVendorForm((v) => ({ ...v, name: e.target.value }))} />
            </div>
            <div>
              <div className="ea-label">Address</div>
              <Input value={vendorForm.address} onChange={(e) => setVendorForm((v) => ({ ...v, address: e.target.value }))} />
            </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <div className="ea-label">Payment terms (days)</div>
                  <select
                    className="ea-input"
                    value={paymentTermOptions.includes(vendorForm.payment_terms) ? vendorForm.payment_terms : "Other"}
                    onChange={(e) =>
                      setVendorForm((v) => ({
                        ...v,
                        payment_terms: e.target.value === "Other" ? "" : e.target.value
                      }))
                    }
                  >
                    {paymentTermOptions.map((term) => (
                      <option key={term} value={term}>
                        {term === "Other" ? "Other" : `${term} days`}
                      </option>
                    ))}
                  </select>
                  {!paymentTermOptions.includes(vendorForm.payment_terms) && (
                    <Input
                      className="mt-2"
                      type="text"
                      inputMode="numeric"
                      placeholder="Enter days"
                      value={vendorForm.payment_terms}
                      onChange={(e) => setVendorForm((v) => ({ ...v, payment_terms: e.target.value }))}
                    />
                  )}
                </div>
              <div>
                <div className="ea-label">Industry</div>
                <Input value={vendorForm.industry} onChange={(e) => setVendorForm((v) => ({ ...v, industry: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <div className="ea-label">Product type</div>
                <select
                  className="ea-input"
                  value={vendorForm.product_type}
                  onChange={(e) => setVendorForm((v) => ({ ...v, product_type: e.target.value }))}
                >
                  <option value="product">Product</option>
                  <option value="service">Service</option>
                </select>
              </div>
              <div>
                <div className="ea-label">Product / Service name *</div>
                <Input value={vendorForm.product_name} onChange={(e) => setVendorForm((v) => ({ ...v, product_name: e.target.value }))} />
              </div>
            </div>
            <div>
              <div className="ea-label">Price *</div>
              <Input type="number" min="0" value={vendorForm.price} onChange={(e) => setVendorForm((v) => ({ ...v, price: e.target.value }))} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={upsertVendor}>{editingVendorId ? "Update vendor" : "Add vendor"}</Button>
              {editingVendorId ? (
                <Button variant="secondary" onClick={resetVendorForm}>
                  Cancel
                </Button>
              ) : null}
            </div>
          </div>
          <div className="mt-5 border-t border-slate-200 pt-4">
            <div className="text-xs font-semibold text-slate-600">Import vendors (CSV)</div>
            <input
              className="mt-2 text-xs text-slate-600"
              type="file"
              accept=".csv"
              onChange={(e) => handleVendorImport(e.target.files?.[0])}
            />
            <div className="mt-1 text-xs text-slate-500">
              Headers: vendor_name, address, payment_terms, industry, product_type, product_name, price.
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Active vendors"
          subtitle="Suppliers you currently rely on."
          className="lg:col-span-3"
          icon={
            <CardIcon tone="bg-indigo-50 text-indigo-600">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 12h16" />
                <path d="M4 8h16" />
                <path d="M4 16h16" />
              </svg>
            </CardIcon>
          }
        >
            <div className="mt-2 space-y-2 max-h-72 overflow-auto pr-1">
              {activeVendors.length ? (
                activeVendors.map((v) => (
                  <div key={v.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900">{v.name}</div>
                      <div className="text-xs text-slate-500">
                        {v.product_name} • {v.product_type} • {v.payment_terms} days • {v.price}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setEditingVendorId(v.id);
                          setVendorForm({
                            name: v.name,
                            address: v.address || "",
                            payment_terms: String(v.payment_terms || "14"),
                            industry: v.industry || "",
                            product_type: v.product_type || "product",
                            product_name: v.product_name || "",
                            price: String(v.price ?? "")
                          });
                        }}
                      >
                        Edit
                      </Button>
                      <Button variant="ghost" onClick={() => archiveEntity("vendors", v.id)}>
                        Archive
                      </Button>
                      <Button variant="ghost" onClick={() => deleteEntity("vendors", v.id)}>
                        Delete
                      </Button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-slate-200 p-3 text-xs text-slate-500">
                  No active vendors yet.
                </div>
              )}
            </div>
        </SectionCard>
        <SectionCard
          title="Archived vendors"
          subtitle="Restore or delete items in archive."
          className="lg:col-span-5"
          icon={
            <CardIcon tone="bg-slate-100 text-slate-600">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 7h16" />
                <path d="M6 7l1 12h10l1-12" />
                <path d="M9 7V5h6v2" />
              </svg>
            </CardIcon>
          }
        >
          <div className="mt-2 space-y-2 max-h-60 overflow-auto pr-1">
            {archivedVendors.length ? (
              archivedVendors.map((v) => {
                const age = daysSince(v.archived_at || v.updated_at || v.created_at);
                const expiring = Math.max(0, ARCHIVE_EXPIRE_DAYS - age);
                return (
                  <div key={v.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900">{v.name}</div>
                      <div className="text-xs text-slate-500">
                        Archived {age} days ago • Expires in {expiring} days
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="secondary" onClick={() => restoreEntity("vendors", v.id)}>
                        Activate
                      </Button>
                      <Button variant="ghost" onClick={() => deleteEntity("vendors", v.id)}>
                        Delete
                      </Button>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 p-3 text-xs text-slate-500">
                No archived vendors.
              </div>
            )}
          </div>
        </SectionCard>
        </div>
        ) : null}
      </div>
      ) : null}

      <div className="mt-6">
        <div className="text-xs text-slate-500">{loading ? "Syncing catalogue..." : "Catalogue saved to workspace."}</div>
      </div>
    </div>
  );
}

