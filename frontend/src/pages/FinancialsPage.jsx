import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import html2pdf from "html2pdf.js";
import Button from "../components/Button";
import InlineAlert from "../components/InlineAlert";
import Input from "../components/Input";
import PageHeader from "../components/PageHeader";
import SectionCard from "../components/SectionCard";
import SegmentedTabs from "../components/SegmentedTabs";
import WorkspacePrompt from "../components/WorkspacePrompt";
import { FinancialIllustration, IllustrationCard } from "../components/Illustrations";
import { apiRequest } from "../api/client";
import { useWorkspaceStore } from "../store/workspace";
import { formatCurrency } from "../lib/format";
import { getProductCostOfSales, getProductSalesPrice } from "../lib/financialIntelligence";

function MultiProductDropdown({ products, selectedIds, onChange, placeholder = "Select products / services" }) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectedProducts = products.filter((product) => selectedIds.includes(product.id));
  const summary = selectedProducts.length ? selectedProducts.map((product) => product.name).join(", ") : placeholder;

  return (
    <div ref={dropdownRef} className="relative">
      <button type="button" onClick={() => setOpen((value) => !value)} className="ea-input flex w-full items-center justify-between text-left">
        <span className="truncate text-sm text-slate-700">{summary}</span>
        <svg
          className={`ml-2 h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </button>
      {open ? (
        <div className="absolute z-30 mt-1 w-full rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="max-h-56 space-y-1 overflow-y-auto p-2">
            {products.length ? products.map((product) => (
              <label key={product.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-xs text-slate-700 hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(product.id)}
                  onChange={() => {
                    const next = selectedIds.includes(product.id)
                      ? selectedIds.filter((id) => id !== product.id)
                      : [...selectedIds, product.id];
                    onChange(next);
                  }}
                  className="accent-brand-600"
                />
                <span>{product.name}</span>
              </label>
            )) : (
              <div className="px-3 py-2 text-xs text-slate-400">No products or services found.</div>
            )}
          </div>
          <div className="border-t border-slate-100 px-3 py-2 text-right">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg bg-slate-900 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-700"
            >
              Done
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ShareLinkPopup({ url, onClose }) {
  const inputRef = useRef(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { inputRef.current?.select(); }, []);
  async function handleCopy() {
    try { await navigator.clipboard.writeText(url); } catch {}
    try { inputRef.current?.select(); document.execCommand("copy"); } catch {}
    setCopied(true);
    setTimeout(onClose, 1200);
  }
  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center bg-black/30 sm:items-center" onClick={onClose}>
      <div className="relative mx-4 mb-6 w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl sm:mb-0" onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={onClose} className="absolute right-3 top-3 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4"><path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" /></svg>
        </button>
        <div className="mb-3 text-sm font-semibold text-slate-900">Share link ready</div>
        <div className="flex gap-2">
          <input
            ref={inputRef}
            readOnly
            value={url}
            className="ea-input min-w-0 flex-1 font-mono text-xs"
            onClick={() => inputRef.current?.select()}
          />
          <button
            type="button"
            onClick={handleCopy}
            className="shrink-0 rounded-xl bg-brand-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-brand-700"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-slate-400">Anyone with this link can view the document.</p>
      </div>
    </div>
  );
}

export default function FinancialsPage() {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const workspaceName = useWorkspaceStore((s) => s.workspaceName);
  const workspaceLogo = useWorkspaceStore((s) => s.workspaceLogo);
  const currency = useWorkspaceStore((s) => s.currency);
  const setWorkspaceId = useWorkspaceStore((s) => s.setWorkspaceId);
  const setWorkspaceName = useWorkspaceStore((s) => s.setWorkspaceName);
  const setWorkspaceLogo = useWorkspaceStore((s) => s.setWorkspaceLogo);
  const navigate = useNavigate();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [shareNotice, setShareNotice] = useState(null);
  const [shareLinkUrl, setShareLinkUrl] = useState(null);

  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [integrations, setIntegrations] = useState({
    financial: { quickbooks: "not_connected", sap: "not_connected", zoho_books: "not_connected" },
    crm: { zoho_crm: "not_connected", hubspot: "not_connected", salesforce: "not_connected" }
  });

  const [editingInvoiceId, setEditingInvoiceId] = useState(null);
  const [editingQuoteId, setEditingQuoteId] = useState(null);
  const [editingExpenseId, setEditingExpenseId] = useState(null);
  const [editingContractId, setEditingContractId] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [previewInvoiceId, setPreviewInvoiceId] = useState(null);
  const [previewQuoteId, setPreviewQuoteId] = useState(null);
  const [shareMenu, setShareMenu] = useState(null);
  const ARCHIVE_WARNING_DAYS = 60;
  const ARCHIVE_EXPIRE_DAYS = 90;

  const [invoiceForm, setInvoiceForm] = useState({
    invoice_id: "",
    customer_id: "",
    product_ids: [],
    items: [],
    issued_at: new Date().toISOString().slice(0, 10),
    due_date: "",
    subtotal_override: "",
    cost_of_sales_override: "",
  });
  const [quoteForm, setQuoteForm] = useState({
    quotation_id: "",
    customer_id: "",
    product_ids: [],
    items: [],
    validity_days: "30",
    issued_at: new Date().toISOString().slice(0, 10),
    due_date: "",
    subtotal_override: "",
    cost_of_sales_override: "",
  });
  const [expenseForm, setExpenseForm] = useState({
    vendor_id: "",
    item: "",
    price: "",
    cost_type: "variable",
    incurred_at: new Date().toISOString().slice(0, 10),
    due_date: ""
  });
  const [contractForm, setContractForm] = useState({
    contract_type: "sales",
    counterparty_id: "",
    product_ids: [],
    price: "",
    payment_terms: "",
    discount: "",
    freight: "",
    cost_of_sales: "",
    start_date: new Date().toISOString().slice(0, 10),
    end_date: "",
    due_date: "",
    status: "pending"
  });

  function todayInputValue() {
    return new Date().toISOString().slice(0, 10);
  }

  function CardIcon({ tone = "bg-brand-50 text-brand-600", children }) {
    return (
      <div className={`flex h-9 w-9 items-center justify-center rounded-2xl ${tone}`}>
        {children}
      </div>
    );
  }

  useEffect(() => {
    if (!shareMenu) return;
    function handleClick(event) {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-financial-share-menu]")) return;
      setShareMenu(null);
    }
    function handleResize() {
      setShareMenu(null);
    }
    document.addEventListener("mousedown", handleClick);
    window.addEventListener("resize", handleResize);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      window.removeEventListener("resize", handleResize);
    };
  }, [shareMenu]);

  function ActionMenu({ items }) {
    const [open, setOpen] = useState(false);
    const menuRef = useRef(null);

    useEffect(() => {
      if (!open) return;
      function handleClick(e) {
        if (!menuRef.current || menuRef.current.contains(e.target)) return;
        setOpen(false);
      }
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }, [open]);

    return (
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
          onClick={() => setOpen((v) => !v)}
          aria-label="More actions"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
            <circle cx="5" cy="12" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="19" cy="12" r="2" />
          </svg>
        </button>
        {open ? (
          <div className="absolute right-0 z-20 mt-2 w-44 rounded-xl border border-slate-200 bg-white p-1 text-sm shadow-lg">
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => {
                  setOpen(false);
                  item.onClick?.();
                }}
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs ${
                  item.tone === "danger"
                    ? "text-rose-600 hover:bg-rose-50"
                    : "text-slate-700 hover:bg-slate-100"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  function daysSince(date) {
    const ts = date ? new Date(date).getTime() : NaN;
    if (!Number.isFinite(ts)) return 0;
    return Math.floor((Date.now() - ts) / (1000 * 60 * 60 * 24));
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
        const fin = ws?.data?.financials || {};
        const integ = ws?.data?.integrations || {};
        setWorkspaceLogo(ws?.data?.workspace_profile?.logo_data_url || null);
        setProducts(Array.isArray(cat.products) ? cat.products : []);
        setCustomers(Array.isArray(cat.customers) ? cat.customers : []);
        setVendors(Array.isArray(cat.vendors) ? cat.vendors : []);
        setInvoices(Array.isArray(fin.invoices) ? fin.invoices : []);
        setQuotes(Array.isArray(fin.quotes) ? fin.quotes : []);
        setExpenses(Array.isArray(fin.expenses) ? fin.expenses : []);
        setContracts(Array.isArray(fin.contracts) ? fin.contracts : []);
        setIntegrations({
          financial: {
            quickbooks: integ?.financial?.quickbooks || "not_connected",
            sap: integ?.financial?.sap || "not_connected",
            zoho_books: integ?.financial?.zoho_books || "not_connected"
          },
          crm: {
            zoho_crm: integ?.crm?.zoho_crm || "not_connected",
            hubspot: integ?.crm?.hubspot || "not_connected",
            salesforce: integ?.crm?.salesforce || "not_connected"
          }
        });
      } catch (e) {
        if (String(e?.message || "").includes("HTTP 404")) return;
        setError(e instanceof Error ? e.message : "Failed to load financials");
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    return () => {
      alive = false;
    };
  }, [workspaceId, setWorkspaceId, setWorkspaceLogo, setWorkspaceName]);

  useEffect(() => {
    if (!workspaceId) return;
    const normalizeArchivedAt = (list) =>
      list.map((item) => {
        if (!item.archived) return item;
        if (item.archived_at) return item;
        return { ...item, archived_at: item.updated_at || item.created_at || new Date().toISOString() };
      });
    const stripExpired = (list) =>
      list.filter((item) => {
        if (!item.archived) return true;
        const age = daysSince(item.archived_at || item.updated_at || item.created_at);
        return age < ARCHIVE_EXPIRE_DAYS;
      });
    const nextInvoices = stripExpired(normalizeArchivedAt(invoices));
    const nextExpenses = stripExpired(normalizeArchivedAt(expenses));
    const nextContracts = stripExpired(normalizeArchivedAt(contracts));
    const changed =
      nextInvoices.length !== invoices.length ||
      nextExpenses.length !== expenses.length ||
      nextContracts.length !== contracts.length ||
      nextInvoices.some((i, idx) => i.archived_at !== invoices[idx]?.archived_at) ||
      nextExpenses.some((e, idx) => e.archived_at !== expenses[idx]?.archived_at) ||
      nextContracts.some((c, idx) => c.archived_at !== contracts[idx]?.archived_at);
    if (changed) {
      setInvoices(nextInvoices);
      setExpenses(nextExpenses);
      setContracts(nextContracts);
      persist({ invoices: nextInvoices, quotes, expenses: nextExpenses, contracts: nextContracts });
    }
  }, [workspaceId, invoices, quotes, expenses, contracts]);

  useEffect(() => {
    if (!workspaceId) return;
    const normalizeArchivedAt = (list) =>
      list.map((item) => {
        if (!item.archived) return item;
        if (item.archived_at) return item;
        return { ...item, archived_at: item.updated_at || item.created_at || new Date().toISOString() };
      });
    const stripExpired = (list) =>
      list.filter((item) => {
        if (!item.archived) return true;
        const age = daysSince(item.archived_at || item.updated_at || item.created_at);
        return age < ARCHIVE_EXPIRE_DAYS;
      });
    const nextQuotes = stripExpired(normalizeArchivedAt(quotes));
    const changed =
      nextQuotes.length !== quotes.length ||
      nextQuotes.some((q, idx) => q.archived_at !== quotes[idx]?.archived_at);
    if (changed) {
      setQuotes(nextQuotes);
      persist({ invoices, quotes: nextQuotes, expenses, contracts });
    }
  }, [workspaceId, invoices, quotes, expenses, contracts]);

  async function persist(next) {
    await apiRequest("/validation/me", "PATCH", { data: { financials: next } });
  }
  async function persistIntegrations(next) {
    await apiRequest("/validation/me", "PATCH", { data: { integrations: next } });
  }

  const activeProducts = useMemo(() => products.filter((p) => !p.archived), [products]);
  const activeCustomers = useMemo(() => customers.filter((c) => !c.archived), [customers]);
  const activeVendors = useMemo(() => vendors.filter((v) => !v.archived), [vendors]);

  const activeInvoices = useMemo(() => invoices.filter((i) => !i.archived), [invoices]);
  const activeQuotes = useMemo(() => quotes.filter((q) => !q.archived), [quotes]);
  const activeExpenses = useMemo(() => expenses.filter((e) => !e.archived), [expenses]);
  const activeContracts = useMemo(() => contracts.filter((c) => !c.archived), [contracts]);
  const archivedInvoices = useMemo(() => invoices.filter((i) => i.archived), [invoices]);
  const archivedQuotes = useMemo(() => quotes.filter((q) => q.archived), [quotes]);
  const archivedExpenses = useMemo(() => expenses.filter((e) => e.archived), [expenses]);
  const archivedContracts = useMemo(() => contracts.filter((c) => c.archived), [contracts]);

  const invoicePendingCount = useMemo(() => activeInvoices.filter((i) => i.status === "pending").length, [activeInvoices]);
  const invoicePaidCount = useMemo(() => activeInvoices.filter((i) => i.status === "paid").length, [activeInvoices]);
  const expensePendingCount = useMemo(() => activeExpenses.filter((e) => e.status === "pending").length, [activeExpenses]);
  const expensePaidCount = useMemo(() => activeExpenses.filter((e) => e.status === "paid").length, [activeExpenses]);
  const contractPendingCount = useMemo(() => activeContracts.filter((c) => c.status === "pending").length, [activeContracts]);
  const contractSignedCount = useMemo(() => activeContracts.filter((c) => c.status === "signed").length, [activeContracts]);

  const hasArchiveWarning = useMemo(() => {
    const list = [...archivedInvoices, ...archivedQuotes, ...archivedExpenses, ...archivedContracts];
    return list.some((item) => daysSince(item.archived_at || item.updated_at || item.created_at) >= ARCHIVE_WARNING_DAYS);
  }, [archivedInvoices, archivedQuotes, archivedExpenses, archivedContracts]);

  const integrationMeta = {
    quickbooks: { label: "QuickBooks", note: "Sync invoices, payments, and chart of accounts." },
    sap: { label: "SAP", note: "Connect enterprise finance workflows." },
    zoho_books: { label: "Zoho Books", note: "Bring invoice and expense data into EnterprateAI." },
    zoho_crm: { label: "Zoho CRM", note: "Sync contacts and deal pipelines." },
    hubspot: { label: "HubSpot", note: "Import CRM records and lifecycle stages." },
    salesforce: { label: "Salesforce", note: "Connect accounts, opportunities, and stages." }
  };

  function statusBadge(status) {
    if (status === "connected") return { label: "Connected", tone: "emerald" };
    if (status === "pending") return { label: "Pending", tone: "amber" };
    return { label: "Not connected", tone: "slate" };
  }

  function IntegrationLogo({ type }) {
    const icons = {
      quickbooks: (
        <svg viewBox="0 0 36 36" fill="none" className="h-9 w-9">
          <rect width="36" height="36" rx="9" fill="#2CA01C"/>
          <circle cx="16" cy="18" r="6" fill="none" stroke="white" strokeWidth="2.5"/>
          <path d="M22 18h6M25 15v6" stroke="white" strokeWidth="2" strokeLinecap="round"/>
        </svg>
      ),
      sap: (
        <svg viewBox="0 0 36 36" fill="none" className="h-9 w-9">
          <rect width="36" height="36" rx="9" fill="#009EDB"/>
          <text x="18" y="23" textAnchor="middle" fill="white" fontSize="11" fontWeight="bold" fontFamily="Arial, sans-serif" letterSpacing="1">SAP</text>
        </svg>
      ),
      zoho_books: (
        <svg viewBox="0 0 36 36" fill="none" className="h-9 w-9">
          <rect width="36" height="36" rx="9" fill="#E05C00"/>
          <text x="18" y="25" textAnchor="middle" fill="white" fontSize="17" fontWeight="bold" fontFamily="Arial, sans-serif">Z</text>
        </svg>
      ),
      zoho_crm: (
        <svg viewBox="0 0 36 36" fill="none" className="h-9 w-9">
          <rect width="36" height="36" rx="9" fill="#E42527"/>
          <text x="18" y="25" textAnchor="middle" fill="white" fontSize="17" fontWeight="bold" fontFamily="Arial, sans-serif">Z</text>
        </svg>
      ),
      hubspot: (
        <svg viewBox="0 0 36 36" fill="none" className="h-9 w-9">
          <rect width="36" height="36" rx="9" fill="#FF7A59"/>
          <circle cx="18" cy="13" r="4" fill="white"/>
          <rect x="16.5" y="17" width="3" height="5" rx="1.5" fill="white"/>
          <circle cx="25" cy="24" r="2.5" fill="white" opacity="0.85"/>
          <circle cx="11" cy="24" r="2.5" fill="white" opacity="0.85"/>
          <line x1="18" y1="19" x2="25" y2="24" stroke="white" strokeWidth="1.5"/>
          <line x1="18" y1="19" x2="11" y2="24" stroke="white" strokeWidth="1.5"/>
        </svg>
      ),
      salesforce: (
        <svg viewBox="0 0 36 36" fill="none" className="h-9 w-9">
          <rect width="36" height="36" rx="9" fill="#00A1E0"/>
          <path d="M9 23c0-2.8 1.8-5 4.5-5 .4 0 .8.1 1.1.2C15.3 16 17.3 14 20 14c1.8 0 3.4.8 4.5 2.1A4 4 0 0128 20.5a3.5 3.5 0 01-3.5 3.5H11a2 2 0 01-2-1z" fill="white"/>
        </svg>
      ),
    };
    const icon = icons[type];
    if (icon) return icon;
    return (
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-xs font-semibold text-slate-600">
        {String(type || "IN").slice(0, 2).toUpperCase()}
      </div>
    );
  }

  async function updateIntegration(section, key) {
    const current = integrations?.[section]?.[key] || "not_connected";
    const nextStatus = current === "connected" ? "not_connected" : "connected";
    const next = {
      ...integrations,
      [section]: { ...integrations[section], [key]: nextStatus }
    };
    setIntegrations(next);
    await persistIntegrations(next);
  }

  function getProductPrice(product) {
    if (!product) return 0;
    const base = Number(product.base_price || 0);
    const discount = Number(product.discount || 0);
    const freight = Number(product.freight_cost || 0);
    return Math.max(0, base - discount + freight);
  }

  function getProductDefaultCost(product) {
    return getProductCostOfSales(product);
  }

  function formatMoney(value) {
    return formatCurrency(Number(value || 0), currency || "GBP");
  }

  function formatPaymentTerms(value) {
    const str = String(value || "").trim();
    const num = parseInt(str, 10);
    if (str && Number.isFinite(num) && String(num) === str) return `${num} days`;
    return str || "Payment terms";
  }

  function renderDocBranding(subtitle, { forShare = false } = {}) {
    const logoSrc = !forShare && workspaceLogo && !workspaceLogo.startsWith("data:") ? workspaceLogo : null;
    return `
      <div class="brand-block">
        ${logoSrc ? `<img src="${logoSrc}" alt="Company logo" />` : ""}
        <h2>${workspaceName || "EnterprateAI"}</h2>
        <div class="muted">${subtitle}</div>
      </div>
    `;
  }


  function matchByName(list, value) {
    const needle = String(value || "").trim().toLowerCase();
    if (!needle) return null;
    return list.find((item) => String(item?.name || "").trim().toLowerCase() === needle) || null;
  }

  function resolveCustomer(ref, fallbackName) {
    if (!ref) return null;
    return activeCustomers.find((c) => c.id === ref) || matchByName(activeCustomers, ref) || (fallbackName ? { name: fallbackName } : null);
  }

  function resolveVendor(ref, fallbackName) {
    if (!ref) return null;
    return activeVendors.find((v) => v.id === ref) || matchByName(activeVendors, ref) || (fallbackName ? { name: fallbackName } : null);
  }

  function resolveProduct(ref, fallbackName) {
    if (!ref) return null;
    return activeProducts.find((p) => p.id === ref) || matchByName(activeProducts, ref) || (fallbackName ? { name: fallbackName } : null);
  }

  function resolveProducts(refs, fallbackNames = []) {
    const ids = Array.isArray(refs) ? refs : refs ? [refs] : [];
    const resolved = ids.map((ref) => resolveProduct(ref)).filter(Boolean);
    if (resolved.length) return resolved;
    return (Array.isArray(fallbackNames) ? fallbackNames : [])
      .map((name) => resolveProduct(name, name))
      .filter(Boolean);
  }

  function buildSelectedProductItems(productIds, quantity, unitPriceOverride, unitCostOverride) {
    const selectedProducts = resolveProducts(productIds);
    return selectedProducts.map((product) => ({
      product_id: product.id,
      product_name: product.name,
      quantity,
      unit_price: unitPriceOverride !== "" ? Number(unitPriceOverride || 0) : Number(getProductPrice(product)),
      unit_cost_of_sales: unitCostOverride !== "" ? Number(unitCostOverride || 0) : Number(getProductDefaultCost(product)),
    }));
  }

  function syncProductLineItems(selectedIds, existingItems = []) {
    const selectedProducts = resolveProducts(selectedIds);
    return selectedProducts.map((product) => {
      const existing = existingItems.find((item) => item?.product_id === product.id);
      return {
        product_id: product.id,
        product_name: product.name,
        quantity: Number(existing?.quantity || 1),
        unit_price: existing?.unit_price != null ? Number(existing.unit_price) : Number(getProductPrice(product)),
        unit_cost_of_sales: existing?.unit_cost_of_sales != null ? Number(existing.unit_cost_of_sales) : Number(getProductDefaultCost(product)),
      };
    });
  }

  function normalizeRecordItems(record) {
    if (Array.isArray(record?.items) && record.items.length) {
      return record.items.map((item) => ({
        product_id: item?.product_id || "",
        product_name: item?.product_name || "Product / Service",
        quantity: Number(item?.quantity || 1),
        unit_price: Number(item?.unit_price || 0),
        unit_cost_of_sales: Number(item?.unit_cost_of_sales || 0),
      }));
    }
    const productIds = Array.isArray(record?.product_ids) && record.product_ids.length
      ? record.product_ids
      : record?.product_id
        ? [record.product_id]
        : [];
    return buildSelectedProductItems(
      productIds,
      Number(record?.quantity || 1) || 1,
      record?.unit_price ?? "",
      record?.unit_cost_of_sales ?? ""
    );
  }

  function sumLineItemQuantity(items = []) {
    return items.reduce((sum, item) => sum + Math.max(0, Number(item?.quantity || 0)), 0);
  }

  function summariseProductNames(record) {
    if (Array.isArray(record?.product_names) && record.product_names.length) return record.product_names.join(", ");
    if (record?.product_name) return record.product_name;
    return "Product / Service";
  }

  function getDocumentGrandTotal(record) {
    const subtotal = Number(record?.subtotal_amount || 0);
    const costOfSales = Number(record?.cost_of_sales || 0);
    return Number((subtotal + costOfSales).toFixed(2));
  }

  function buildInvoiceHtml(invoice, customer, product) {
    const subtotal = Number(invoice?.subtotal_amount || 0);
    const grandTotal = getDocumentGrandTotal(invoice);
    const items = Array.isArray(invoice?.items) && invoice.items.length
      ? invoice.items
      : [{
          product_name: product?.name || invoice?.product_name || "Product / Service",
          quantity: invoice?.quantity || 0,
          unit_price: invoice?.unit_price || 0,
          subtotal_amount: subtotal,
        }];
    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8"/>
    <title>Invoice ${invoice?.invoice_id || invoice?.id || ""}</title>
  <style>
    *{color:#0f172a !important;}
    body{font-family:Inter, Arial, sans-serif; background:#ffffff; padding:32px; font-size:14px; line-height:1.5; -webkit-font-smoothing:antialiased;}
    .header{display:flex; justify-content:space-between; align-items:flex-start;}
    .brand-block{text-align:left;}
    .brand-block img{display:block; max-width:180px; max-height:72px; width:auto; height:auto; object-fit:contain; object-position:left center; margin:0 0 14px 0;}
    .brand-block h2{margin:0 0 4px;}
    .muted{color:#1f2937; font-size:12px;}
    .card{border:1px solid #e2e8f0; border-radius:12px; padding:16px; margin-top:16px;}
    table{width:100%; border-collapse:collapse; margin-top:16px;}
    th,td{border-bottom:1px solid #e2e8f0; padding:10px; text-align:left; font-size:13px;}
    th{text-transform:uppercase; letter-spacing:.05em; font-size:11px; color:#64748b;}
    .right{text-align:right;}
  </style>
</head>
<body>
  <div class="header">
    ${renderDocBranding("Invoice")}
      <div class="right">
        <div class="muted">Invoice ID</div>
        <div>${invoice?.invoice_id || invoice?.id || ""}</div>
      <div class="muted" style="margin-top:8px;">Status</div>
      <div>${invoice?.status || "pending"}</div>
    </div>
  </div>
  <div class="card">
    <div class="muted">Bill to</div>
    <div><strong>${customer?.name || "Customer"}</strong></div>
    ${customer?.address ? `<div class="muted">${customer.address}</div>` : ""}
    <div class="muted" style="margin-top:6px;">Payment terms: ${formatPaymentTerms(customer?.payment_terms)}</div>
    ${invoice?.due_date ? `<div class="muted" style="margin-top:6px;">Due date: ${new Date(invoice.due_date).toLocaleDateString()}</div>` : ""}
  </div>
  <table>
    <thead>
      <tr><th>Item</th><th class="right">Qty</th><th class="right">Unit</th><th class="right">Subtotal</th></tr>
    </thead>
    <tbody>
      ${items.map((item) => `
      <tr>
        <td>${item?.product_name || "Product / Service"}</td>
        <td class="right">${item?.quantity || 0}</td>
        <td class="right">${formatMoney(item?.unit_price || 0)}</td>
        <td class="right"><strong>${formatMoney(item?.subtotal_amount || ((Number(item?.unit_price || 0) * Number(item?.quantity || 0))))}</strong></td>
      </tr>
      `).join("")}
    </tbody>
  </table>
  <div class="card">
    <div style="display:flex; justify-content:space-between; gap:12px;"><span>Grand Total</span><strong>${formatMoney(grandTotal)}</strong></div>
  </div>
  <div class="muted" style="margin-top:16px;">Thank you for your business.</div>
</body>
</html>`;
  }

  function buildQuoteHtml(quote, customer, product) {
    const subtotal = Number(quote?.subtotal_amount || 0);
    const grandTotal = getDocumentGrandTotal(quote);
    const items = Array.isArray(quote?.items) && quote.items.length
      ? quote.items
      : [{
          product_name: product?.name || quote?.product_name || "Product / Service",
          quantity: quote?.quantity || 0,
          unit_price: quote?.unit_price || 0,
          subtotal_amount: subtotal,
        }];
    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8"/>
    <title>Quotation ${quote?.quotation_id || quote?.id || ""}</title>
  <style>
    *{color:#0f172a !important;}
    body{font-family:Inter, Arial, sans-serif; background:#ffffff; padding:32px; font-size:14px; line-height:1.5; -webkit-font-smoothing:antialiased;}
    .header{display:flex; justify-content:space-between; align-items:flex-start;}
    .brand-block{text-align:left;}
    .brand-block img{display:block; max-width:180px; max-height:72px; width:auto; height:auto; object-fit:contain; object-position:left center; margin:0 0 14px 0;}
    .brand-block h2{margin:0 0 4px;}
    .muted{color:#1f2937; font-size:12px;}
    .card{border:1px solid #e2e8f0; border-radius:12px; padding:16px; margin-top:16px;}
    table{width:100%; border-collapse:collapse; margin-top:16px;}
    th,td{border-bottom:1px solid #e2e8f0; padding:10px; text-align:left; font-size:13px;}
    th{text-transform:uppercase; letter-spacing:.05em; font-size:11px; color:#64748b;}
    .right{text-align:right;}
  </style>
</head>
<body>
  <div class="header">
    ${renderDocBranding("Sales quotation")}
      <div class="right">
        <div class="muted">Quotation ID</div>
        <div>${quote?.quotation_id || quote?.id || ""}</div>
      <div class="muted" style="margin-top:8px;">Status</div>
      <div>${quote?.status || "draft"}</div>
    </div>
  </div>
  <div class="card">
    <div class="muted">Prepared for</div>
    <div><strong>${customer?.name || "Customer"}</strong></div>
    ${customer?.address ? `<div class="muted">${customer.address}</div>` : ""}
    <div class="muted" style="margin-top:6px;">Payment terms: ${formatPaymentTerms(customer?.payment_terms)}</div>
    ${quote?.due_date ? `<div class="muted" style="margin-top:6px;">Due date: ${new Date(quote.due_date).toLocaleDateString()}</div>` : ""}
  </div>
  <table>
    <thead>
      <tr><th>Item</th><th class="right">Qty</th><th class="right">Unit</th><th class="right">Subtotal</th></tr>
    </thead>
    <tbody>
      ${items.map((item) => `
      <tr>
        <td>${item?.product_name || "Product / Service"}</td>
        <td class="right">${item?.quantity || 0}</td>
        <td class="right">${formatMoney(item?.unit_price || 0)}</td>
        <td class="right"><strong>${formatMoney(item?.subtotal_amount || ((Number(item?.unit_price || 0) * Number(item?.quantity || 0))))}</strong></td>
      </tr>
      `).join("")}
    </tbody>
  </table>
  <div class="card">
    <div style="display:flex; justify-content:space-between; gap:12px;"><span>Grand Total</span><strong>${formatMoney(grandTotal)}</strong></div>
  </div>
  <div class="muted" style="margin-top:16px;">This quotation is valid for ${quote?.validity_days || 30} days unless otherwise stated.</div>
</body>
</html>`;
  }

  function buildFinancialShareText(kind, record, customer, product) {
    const isInvoice = kind === "invoice";
    const reference = isInvoice
      ? record?.invoice_id || record?.id || "Draft invoice"
      : record?.quotation_id || record?.id || "Draft quotation";
    const grandTotal = getDocumentGrandTotal(record);
    const itemName = summariseProductNames(record) || product?.name || "Product / Service";
    return [
      `${isInvoice ? "Invoice" : "Quotation"} ${reference}`,
      `Customer: ${customer?.name || "Customer"}`,
      `Items: ${itemName}`,
      `Quantity: ${record?.quantity || 0}`,
      `Grand total: ${formatMoney(grandTotal)}`,
      `Status: ${record?.status || (isInvoice ? "pending" : "draft")}`,
      ...(record?.due_date ? [`Due date: ${new Date(record.due_date).toLocaleDateString()}`] : []),
    ].join("\n");
  }

  async function downloadPdfFile(html, filename) {
    try {
      const container = document.createElement("div");
      container.innerHTML = html;
      container.style.width = "210mm";
      container.style.padding = "12mm";
      container.style.boxSizing = "border-box";
      container.style.fontSize = "14px";
      container.style.lineHeight = "1.5";
      container.style.color = "#0f172a";
      container.style.background = "#ffffff";
      document.body.appendChild(container);
      await html2pdf()
        .set({
          filename,
          margin: [10, 10, 10, 10],
          pagebreak: { mode: ["css", "legacy", "avoid-all"] },
          image: { type: "jpeg", quality: 0.98 },
          html2canvas: {
            scale: 3,
            useCORS: true,
            windowWidth: 794,
            windowHeight: 1123,
            backgroundColor: "#ffffff",
            letterRendering: true
          },
          jsPDF: { unit: "pt", format: "a4", orientation: "portrait", compress: true }
        })
        .from(container)
        .save();
      document.body.removeChild(container);
    } catch (e) {
      setError("Unable to generate the PDF. Please refresh and try again.");
    }
  }

  function downloadInvoice(invoice, customer, product) {
    const html = buildInvoiceHtml(invoice, customer, product);
    const filename = `invoice-${invoice?.invoice_id || invoice?.id || "draft"}.pdf`;
    downloadPdfFile(html, filename);
  }

  function downloadQuote(quote, customer, product) {
    const html = buildQuoteHtml(quote, customer, product);
    const filename = `quotation-${quote?.quotation_id || quote?.id || "draft"}.pdf`;
    downloadPdfFile(html, filename);
  }

  async function createFinancialShareLink(kind, record, customer, product) {
    if (!record) return;
    setError(null);
    setShareNotice("Creating link...");
    try {
      const isInvoice = kind === "invoice";
      const titlePrefix = isInvoice ? "Invoice" : "Sales Quotation";
      const shareIdField = "share_document_id";
      const existingDocumentId = record?.[shareIdField] || null;
      let token = null;
      let documentId = existingDocumentId;

      if (existingDocumentId) {
        const shareRes = await apiRequest(
          `/blueprint/documents/${existingDocumentId}/share`,
          "POST",
          null,
          { timeoutMs: 120000 }
        );
        token = shareRes?.token;
      } else {
        const rawHtml = isInvoice ? buildInvoiceHtml(record, customer, product) : buildQuoteHtml(record, customer, product);
        const safeHtml = rawHtml.replace(/src="data:[^"]*"/g, 'src=""');
        const markdown = buildFinancialShareText(kind, record, customer, product);
        const res = await apiRequest("/blueprint/financial-documents/share", "POST", {
          document_id: null,
          type: isInvoice ? "invoice_template" : "sales_quotation",
          title: `${titlePrefix} — ${record?.invoice_id || record?.quotation_id || record?.id || workspaceName || "Document"}`,
          company_name: workspaceName || "EnterprateAI",
          workspace_id: workspaceId || null,
          document_markdown: markdown,
          document_html: safeHtml,
        }, { timeoutMs: 120000 });
        token = res?.token;
        documentId = res?.document_id;
      }

      if (!token || !documentId) throw new Error("Share link could not be created.");

      if (documentId !== record?.[shareIdField]) {
        if (isInvoice) {
          const nextInvoices = invoices.map((item) =>
            item.id === record.id ? { ...item, [shareIdField]: documentId } : item
          );
          setInvoices(nextInvoices);
          await persist({ invoices: nextInvoices, quotes, expenses, contracts });
        } else {
          const nextQuotes = quotes.map((item) =>
            item.id === record.id ? { ...item, [shareIdField]: documentId } : item
          );
          setQuotes(nextQuotes);
          await persist({ invoices, quotes: nextQuotes, expenses, contracts });
        }
      }

      const url = `${window.location.origin}/share/${token}`;
      setShareNotice(null);
      return url;
    } catch (e) {
      setShareNotice(null);
      setError(e instanceof Error ? e.message : "Share failed.");
      return null;
    }
  }

  async function shareFinancialDocument(kind, record, customer, product, mode = "copy") {
    const url = await createFinancialShareLink(kind, record, customer, product);
    if (!url) return;
    if (mode === "mail") {
      const isInvoice = kind === "invoice";
      const recipient = encodeURIComponent(customer?.email || "");
      const reference = isInvoice
        ? record?.invoice_id || record?.id || ""
        : record?.quotation_id || record?.id || "";
      const subject = encodeURIComponent(`${isInvoice ? "Invoice" : "Quotation"} ${reference}`);
      const body = encodeURIComponent(
        `Hi${customer?.name ? ` ${customer.name}` : ""},\n\nHere is your shared document link:\n${url}\n\nThank you.`
      );
      window.location.href = `mailto:${recipient}?subject=${subject}&body=${body}`;
      setShareNotice("Mail draft opened");
      setTimeout(() => setShareNotice(null), 1800);
      return;
    }
    setShareLinkUrl(url);
  }

  function addFinancialShareAction(items, kind, record, customer, product) {
    const shareItem = {
      label: "Share",
      onClick: async () => {
        await shareFinancialDocument(kind, record, customer, product, "copy");
      }
    };
    const deleteIndex = items.findIndex((item) => item?.tone === "danger" || item?.label === "Delete");
    if (deleteIndex === -1) return [...items, shareItem];
    return [...items.slice(0, deleteIndex), shareItem, ...items.slice(deleteIndex)];
  }

  function openShareMenu(event, kind, record, customer, product) {
    const rect = event.currentTarget.getBoundingClientRect();
    setShareMenu({
      key: `${kind}:${record?.id || ""}`,
      kind,
      record,
      customer,
      product,
      top: rect.bottom + 8,
      right: window.innerWidth - rect.right,
    });
  }

  function ShareDropdown({ kind, record, customer, product }) {
    const menuKey = `${kind}:${record?.id || ""}`;
    const isOpen = shareMenu?.key === menuKey;
    return (
      <div>
        <Button
          variant="secondary"
          onClick={(event) => {
            if (isOpen) {
              setShareMenu(null);
              return;
            }
            openShareMenu(event, kind, record, customer, product);
          }}
        >
          Share
        </Button>
      </div>
    );
  }

  function sendInvoice(invoice, customer) {
    const subject = encodeURIComponent(`Invoice ${invoice?.invoice_id || invoice?.id || ""}`);
    const body = encodeURIComponent(
      `Hi ${customer?.name || ""},\n\nPlease find your invoice ${invoice?.invoice_id || invoice?.id || ""} attached. Let us know if you have any questions.\n\nThank you.`
    );
    window.location.href = `mailto:${""}?subject=${subject}&body=${body}`;
  }

  function sendQuote(quote, customer) {
    const subject = encodeURIComponent(`Quotation ${quote?.quotation_id || quote?.id || ""}`);
    const body = encodeURIComponent(
      `Hi ${customer?.name || ""},\n\nPlease find your quotation ${quote?.quotation_id || quote?.id || ""} attached. Let us know if you have any questions.\n\nThank you.`
    );
    window.location.href = `mailto:${""}?subject=${subject}&body=${body}`;
  }

  function resetInvoiceForm() {
    setInvoiceForm({ invoice_id: "", customer_id: "", product_ids: [], items: [], issued_at: todayInputValue(), due_date: "", subtotal_override: "", cost_of_sales_override: "" });
    setEditingInvoiceId(null);
  }

  function resetQuoteForm() {
    setQuoteForm({ quotation_id: "", customer_id: "", product_ids: [], items: [], validity_days: "30", issued_at: todayInputValue(), due_date: "", subtotal_override: "", cost_of_sales_override: "" });
    setEditingQuoteId(null);
  }

  function resetExpenseForm() {
    setExpenseForm({ vendor_id: "", item: "", price: "", cost_type: "variable", incurred_at: todayInputValue(), due_date: "" });
    setEditingExpenseId(null);
  }

  function resetContractForm() {
    setContractForm({
      contract_type: "sales",
      counterparty_id: "",
      product_ids: [],
      price: "",
      payment_terms: "",
      discount: "",
      freight: "",
      cost_of_sales: "",
      start_date: todayInputValue(),
      end_date: "",
      due_date: "",
      status: "pending"
    });
    setEditingContractId(null);
  }

  function updateInvoiceSelectedProducts(nextIds) {
    setInvoiceForm((prev) => ({
      ...prev,
      product_ids: nextIds,
      items: syncProductLineItems(nextIds, Array.isArray(prev.items) ? prev.items : []),
    }));
  }

  function updateQuoteSelectedProducts(nextIds) {
    setQuoteForm((prev) => ({
      ...prev,
      product_ids: nextIds,
      items: syncProductLineItems(nextIds, Array.isArray(prev.items) ? prev.items : []),
    }));
  }

  function updateInvoiceItem(productId, field, value) {
    setInvoiceForm((prev) => ({
      ...prev,
      items: (Array.isArray(prev.items) ? prev.items : []).map((item) =>
        item.product_id === productId
          ? { ...item, [field]: field === "quantity" ? Math.max(0, Number(value || 0)) : Number(value || 0) }
          : item
      ),
    }));
  }

  function updateQuoteItem(productId, field, value) {
    setQuoteForm((prev) => ({
      ...prev,
      items: (Array.isArray(prev.items) ? prev.items : []).map((item) =>
        item.product_id === productId
          ? { ...item, [field]: field === "quantity" ? Math.max(0, Number(value || 0)) : Number(value || 0) }
          : item
      ),
    }));
  }

  async function upsertInvoice() {
    if (!invoiceForm.customer_id || !Array.isArray(invoiceForm.product_ids) || !invoiceForm.product_ids.length) {
      setError("Invoice must reference a customer and at least one product or service.");
      return;
    }
    setError(null);
    const customer = resolveCustomer(invoiceForm.customer_id);
    const lineItems = syncProductLineItems(invoiceForm.product_ids, Array.isArray(invoiceForm.items) ? invoiceForm.items : []);
    if (!lineItems.length) {
      setError("Select at least one product or service for this invoice.");
      return;
    }
    if (lineItems.some((item) => !Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0)) {
      setError("Each selected product or service must have a quantity greater than zero.");
      return;
    }
    const calcSubtotal = Number(lineItems.reduce((sum, item) => sum + (Number(item.unit_price || 0) * Number(item.quantity || 0)), 0).toFixed(2));
    const calcCostOfSales = Number(lineItems.reduce((sum, item) => sum + (Number(item.unit_cost_of_sales || 0) * Number(item.quantity || 0)), 0).toFixed(2));
    const subtotal = invoiceForm.subtotal_override !== "" ? Number(Number(invoiceForm.subtotal_override).toFixed(2)) : calcSubtotal;
    const totalCostOfSales = invoiceForm.cost_of_sales_override !== "" ? Number(Number(invoiceForm.cost_of_sales_override).toFixed(2)) : calcCostOfSales;
    const grandTotal = Number((subtotal + totalCostOfSales).toFixed(2));
    const totalQuantity = sumLineItemQuantity(lineItems);
    const next = invoices.map((i) => ({ ...i }));
    const payload = {
      id: editingInvoiceId || crypto.randomUUID(),
      invoice_id: String(invoiceForm.invoice_id || "").trim(),
      customer_id: customer?.id || invoiceForm.customer_id,
      customer_name: customer?.name || String(invoiceForm.customer_id || "").trim(),
      product_id: lineItems[0]?.product_id || invoiceForm.product_ids[0],
      product_ids: lineItems.map((item) => item.product_id),
      product_name: lineItems[0]?.product_name || "Product / Service",
      product_names: lineItems.map((item) => item.product_name),
      items: lineItems,
      quantity: totalQuantity,
      unit_price: lineItems.length === 1 ? Number(Number(lineItems[0]?.unit_price || 0).toFixed(2)) : null,
      unit_cost_of_sales: lineItems.length === 1 ? Number(Number(lineItems[0]?.unit_cost_of_sales || 0).toFixed(2)) : null,
      subtotal_amount: subtotal,
      cost_of_sales: totalCostOfSales,
      total_amount: grandTotal,
      status: editingInvoiceId ? next.find((i) => i.id === editingInvoiceId)?.status || "pending" : "pending",
      issued_at: invoiceForm.issued_at || null,
      due_date: invoiceForm.due_date || null,
      updated_at: new Date().toISOString()
    };
    if (editingInvoiceId) {
      const idx = next.findIndex((i) => i.id === editingInvoiceId);
      if (idx >= 0) next[idx] = { ...next[idx], ...payload };
    } else {
      next.unshift({ ...payload, created_at: new Date().toISOString() });
    }
    setInvoices(next);
    await persist({ invoices: next, quotes, expenses, contracts });
    resetInvoiceForm();
  }

  async function upsertQuote() {
    if (!quoteForm.customer_id || !Array.isArray(quoteForm.product_ids) || !quoteForm.product_ids.length) {
      setError("Quotation must reference a customer and at least one product or service.");
      return;
    }
    setError(null);
    const customer = resolveCustomer(quoteForm.customer_id);
    const lineItems = syncProductLineItems(quoteForm.product_ids, Array.isArray(quoteForm.items) ? quoteForm.items : []);
    if (!lineItems.length) {
      setError("Select at least one product or service for this quotation.");
      return;
    }
    if (lineItems.some((item) => !Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0)) {
      setError("Each selected product or service must have a quantity greater than zero.");
      return;
    }
    const calcSubtotal = Number(lineItems.reduce((sum, item) => sum + (Number(item.unit_price || 0) * Number(item.quantity || 0)), 0).toFixed(2));
    const calcCostOfSales = Number(lineItems.reduce((sum, item) => sum + (Number(item.unit_cost_of_sales || 0) * Number(item.quantity || 0)), 0).toFixed(2));
    const subtotal = quoteForm.subtotal_override !== "" ? Number(Number(quoteForm.subtotal_override).toFixed(2)) : calcSubtotal;
    const totalCostOfSales = quoteForm.cost_of_sales_override !== "" ? Number(Number(quoteForm.cost_of_sales_override).toFixed(2)) : calcCostOfSales;
    const grandTotal = Number((subtotal + totalCostOfSales).toFixed(2));
    const validity = Math.max(1, parseInt(String(quoteForm.validity_days || "30"), 10) || 30);
    const totalQuantity = sumLineItemQuantity(lineItems);
    const next = quotes.map((q) => ({ ...q }));
    const payload = {
      id: editingQuoteId || crypto.randomUUID(),
      quotation_id: String(quoteForm.quotation_id || "").trim(),
      customer_id: customer?.id || quoteForm.customer_id,
      customer_name: customer?.name || String(quoteForm.customer_id || "").trim(),
      product_id: lineItems[0]?.product_id || quoteForm.product_ids[0],
      product_ids: lineItems.map((item) => item.product_id),
      product_name: lineItems[0]?.product_name || "Product / Service",
      product_names: lineItems.map((item) => item.product_name),
      items: lineItems,
      quantity: totalQuantity,
      unit_price: lineItems.length === 1 ? Number(Number(lineItems[0]?.unit_price || 0).toFixed(2)) : null,
      unit_cost_of_sales: lineItems.length === 1 ? Number(Number(lineItems[0]?.unit_cost_of_sales || 0).toFixed(2)) : null,
      subtotal_amount: subtotal,
      cost_of_sales: totalCostOfSales,
      total_amount: grandTotal,
      validity_days: validity,
      status: editingQuoteId ? next.find((q) => q.id === editingQuoteId)?.status || "draft" : "draft",
      issued_at: quoteForm.issued_at || null,
      due_date: quoteForm.due_date || null,
      updated_at: new Date().toISOString()
    };
    if (editingQuoteId) {
      const idx = next.findIndex((q) => q.id === editingQuoteId);
      if (idx >= 0) next[idx] = { ...next[idx], ...payload };
    } else {
      next.unshift({ ...payload, created_at: new Date().toISOString() });
    }
    setQuotes(next);
    await persist({ invoices, quotes: next, expenses, contracts });
    resetQuoteForm();
  }

  async function upsertExpense() {
    if (!expenseForm.vendor_id || !expenseForm.item.trim()) {
      setError("Expense must reference a vendor and item.");
      return;
    }
    const price = Number(expenseForm.price || 0);
    if (!Number.isFinite(price) || price <= 0) {
      setError("Expense price must be a positive number.");
      return;
    }
    setError(null);
    const vendor = resolveVendor(expenseForm.vendor_id);
    const next = expenses.map((e) => ({ ...e }));
    const payload = {
      id: editingExpenseId || crypto.randomUUID(),
      vendor_id: vendor?.id || expenseForm.vendor_id,
      vendor_name: vendor?.name || String(expenseForm.vendor_id || "").trim(),
      item: expenseForm.item.trim(),
      price: Number(price.toFixed(2)),
      cost_type: expenseForm.cost_type,
      status: editingExpenseId ? next.find((e) => e.id === editingExpenseId)?.status || "pending" : "pending",
      incurred_at: expenseForm.incurred_at || null,
      due_date: expenseForm.due_date || null,
      updated_at: new Date().toISOString()
    };
    if (editingExpenseId) {
      const idx = next.findIndex((e) => e.id === editingExpenseId);
      if (idx >= 0) next[idx] = { ...next[idx], ...payload };
    } else {
      next.unshift({ ...payload, created_at: new Date().toISOString() });
    }
    setExpenses(next);
    await persist({ invoices, quotes, expenses: next, contracts });
    resetExpenseForm();
  }

  async function upsertContract() {
    if (!contractForm.counterparty_id || !Array.isArray(contractForm.product_ids) || !contractForm.product_ids.length) {
      setError("Contract must reference a customer/vendor and at least one product or service.");
      return;
    }
    const party =
      contractForm.contract_type === "sales"
        ? resolveCustomer(contractForm.counterparty_id)
        : resolveVendor(contractForm.counterparty_id);
    const selectedProducts = resolveProducts(contractForm.product_ids);
    const defaultPrice = selectedProducts.reduce((sum, product) => sum + getProductPrice(product), 0);
    const defaultCostOfSales = selectedProducts.reduce((sum, product) => sum + getProductDefaultCost(product), 0);
    const rawPrice = contractForm.price !== "" ? Number(contractForm.price) : defaultPrice;
    const rawCostOfSales = contractForm.cost_of_sales !== "" ? Number(contractForm.cost_of_sales) : defaultCostOfSales;
    if (!Number.isFinite(rawPrice) || rawPrice <= 0) {
      setError("Contract price must be a positive number.");
      return;
    }
    setError(null);
    const next = contracts.map((c) => ({ ...c }));
    const payload = {
      id: editingContractId || crypto.randomUUID(),
      contract_type: contractForm.contract_type,
      counterparty_id: party?.id || contractForm.counterparty_id,
      counterparty_name: party?.name || String(contractForm.counterparty_id || "").trim(),
      product_id: selectedProducts[0]?.id || contractForm.product_ids[0],
      product_ids: selectedProducts.map((product) => product.id),
      product_name: selectedProducts[0]?.name || "Product / Service",
      product_names: selectedProducts.map((product) => product.name),
      price: Number(rawPrice.toFixed(2)),
      cost_of_sales: Number((Number.isFinite(rawCostOfSales) ? rawCostOfSales : 0).toFixed(2)),
      payment_terms: contractForm.payment_terms || "",
      discount: Number(contractForm.discount || 0),
      freight: Number(contractForm.freight || 0),
      start_date: contractForm.start_date || null,
      end_date: contractForm.end_date || null,
      due_date: contractForm.due_date || null,
      status: editingContractId ? next.find((c) => c.id === editingContractId)?.status || "pending" : "pending",
      updated_at: new Date().toISOString()
    };
    if (editingContractId) {
      const idx = next.findIndex((c) => c.id === editingContractId);
      if (idx >= 0) next[idx] = { ...next[idx], ...payload };
    } else {
      next.unshift({ ...payload, created_at: new Date().toISOString() });
    }
    setContracts(next);
    await persist({ invoices, quotes, expenses, contracts: next });
    resetContractForm();
  }

  async function updateStatus(type, id, status) {
    if (type === "invoice") {
      const next = invoices.map((i) =>
        i.id === id ? { ...i, status, paid_at: status === "paid" ? new Date().toISOString() : null } : i
      );
      setInvoices(next);
      await persist({ invoices: next, quotes, expenses, contracts });
    }
    if (type === "expense") {
      const next = expenses.map((e) =>
        e.id === id ? { ...e, status, paid_at: status === "paid" ? new Date().toISOString() : null } : e
      );
      setExpenses(next);
      await persist({ invoices, quotes, expenses: next, contracts });
    }
    if (type === "contract") {
      const next = contracts.map((c) =>
        c.id === id ? { ...c, status, signed_at: status === "signed" ? new Date().toISOString() : null } : c
      );
      setContracts(next);
      await persist({ invoices, quotes, expenses, contracts: next });
    }
    if (type === "quote") {
      const next = quotes.map((q) => (q.id === id ? { ...q, status } : q));
      setQuotes(next);
      await persist({ invoices, quotes: next, expenses, contracts });
    }
  }

  async function archiveItem(type, id) {
    if (type === "invoice") {
      const next = invoices.map((i) =>
        i.id === id ? { ...i, archived: true, archived_at: new Date().toISOString(), updated_at: new Date().toISOString() } : i
      );
      setInvoices(next);
      await persist({ invoices: next, quotes, expenses, contracts });
    }
    if (type === "quote") {
      const next = quotes.map((q) =>
        q.id === id ? { ...q, archived: true, archived_at: new Date().toISOString(), updated_at: new Date().toISOString() } : q
      );
      setQuotes(next);
      await persist({ invoices, quotes: next, expenses, contracts });
    }
    if (type === "expense") {
      const next = expenses.map((e) =>
        e.id === id ? { ...e, archived: true, archived_at: new Date().toISOString(), updated_at: new Date().toISOString() } : e
      );
      setExpenses(next);
      await persist({ invoices, quotes, expenses: next, contracts });
    }
    if (type === "contract") {
      const next = contracts.map((c) =>
        c.id === id ? { ...c, archived: true, archived_at: new Date().toISOString(), updated_at: new Date().toISOString() } : c
      );
      setContracts(next);
      await persist({ invoices, quotes, expenses, contracts: next });
    }
  }

  async function restoreItem(type, id) {
    if (type === "invoice") {
      const next = invoices.map((i) =>
        i.id === id ? { ...i, archived: false, archived_at: null, updated_at: new Date().toISOString() } : i
      );
      setInvoices(next);
      await persist({ invoices: next, quotes, expenses, contracts });
    }
    if (type === "quote") {
      const next = quotes.map((q) =>
        q.id === id ? { ...q, archived: false, archived_at: null, updated_at: new Date().toISOString() } : q
      );
      setQuotes(next);
      await persist({ invoices, quotes: next, expenses, contracts });
    }
    if (type === "expense") {
      const next = expenses.map((e) =>
        e.id === id ? { ...e, archived: false, archived_at: null, updated_at: new Date().toISOString() } : e
      );
      setExpenses(next);
      await persist({ invoices, quotes, expenses: next, contracts });
    }
    if (type === "contract") {
      const next = contracts.map((c) =>
        c.id === id ? { ...c, archived: false, archived_at: null, updated_at: new Date().toISOString() } : c
      );
      setContracts(next);
      await persist({ invoices, quotes, expenses, contracts: next });
    }
  }

  async function deleteItem(type, id) {
    if (type === "invoice") {
      const next = invoices.filter((i) => i.id !== id);
      setInvoices(next);
      await persist({ invoices: next, quotes, expenses, contracts });
    }
    if (type === "quote") {
      const next = quotes.filter((q) => q.id !== id);
      setQuotes(next);
      await persist({ invoices, quotes: next, expenses, contracts });
    }
    if (type === "expense") {
      const next = expenses.filter((e) => e.id !== id);
      setExpenses(next);
      await persist({ invoices, quotes, expenses: next, contracts });
    }
    if (type === "contract") {
      const next = contracts.filter((c) => c.id !== id);
      setContracts(next);
      await persist({ invoices, quotes, expenses, contracts: next });
    }
  }

  const requiresCatalogue = !activeProducts.length || !activeCustomers.length || !activeVendors.length;
  const invoicePreviewItems = syncProductLineItems(invoiceForm.product_ids, Array.isArray(invoiceForm.items) ? invoiceForm.items : []);
  const invoiceSubtotal = Number(invoicePreviewItems.reduce((sum, item) => sum + (Number(item.unit_price || 0) * Number(item.quantity || 0)), 0).toFixed(2));
  const invoiceCostOfSalesTotal = Number(invoicePreviewItems.reduce((sum, item) => sum + (Number(item.unit_cost_of_sales || 0) * Number(item.quantity || 0)), 0).toFixed(2));
  const effectiveInvoiceSubtotal = invoiceForm.subtotal_override !== "" ? Number(invoiceForm.subtotal_override) : invoiceSubtotal;
  const effectiveInvoiceCostOfSales = invoiceForm.cost_of_sales_override !== "" ? Number(invoiceForm.cost_of_sales_override) : invoiceCostOfSalesTotal;
  const invoiceGrandTotal = Number((effectiveInvoiceSubtotal + effectiveInvoiceCostOfSales).toFixed(2));
  const quotePreviewItems = syncProductLineItems(quoteForm.product_ids, Array.isArray(quoteForm.items) ? quoteForm.items : []);
  const quoteSubtotal = Number(quotePreviewItems.reduce((sum, item) => sum + (Number(item.unit_price || 0) * Number(item.quantity || 0)), 0).toFixed(2));
  const quoteCostOfSalesTotal = Number(quotePreviewItems.reduce((sum, item) => sum + (Number(item.unit_cost_of_sales || 0) * Number(item.quantity || 0)), 0).toFixed(2));
  const effectiveQuoteSubtotal = quoteForm.subtotal_override !== "" ? Number(quoteForm.subtotal_override) : quoteSubtotal;
  const effectiveQuoteCostOfSales = quoteForm.cost_of_sales_override !== "" ? Number(quoteForm.cost_of_sales_override) : quoteCostOfSalesTotal;
  const quoteGrandTotal = Number((effectiveQuoteSubtotal + effectiveQuoteCostOfSales).toFixed(2));
  const previewInvoice = activeInvoices.find((inv) => inv.id === previewInvoiceId) || null;
  const previewCustomer = previewInvoice ? resolveCustomer(previewInvoice.customer_id, previewInvoice.customer_name) : null;
  const previewProduct = previewInvoice ? resolveProduct(previewInvoice.product_id, previewInvoice.product_name) : null;
  const previewQuote = activeQuotes.find((q) => q.id === previewQuoteId) || null;
  const previewQuoteCustomer = previewQuote ? resolveCustomer(previewQuote.customer_id, previewQuote.customer_name) : null;
  const previewQuoteProduct = previewQuote ? resolveProduct(previewQuote.product_id, previewQuote.product_name) : null;

  if (!workspaceId) {
    return <WorkspacePrompt />;
  }

  return (
    <div>
      <datalist id="financial-customers">
        {activeCustomers.map((c) => (
          <option key={c.id} value={c.name} />
        ))}
      </datalist>
      <datalist id="financial-products">
        {activeProducts.map((p) => (
          <option key={p.id} value={p.name} />
        ))}
      </datalist>
      <datalist id="financial-vendors">
        {activeVendors.map((v) => (
          <option key={v.id} value={v.name} />
        ))}
      </datalist>
      <PageHeader
        title="Financials"
        description="Track invoices, expenses, and contracts with live operational indicators."
        badge={{ text: "Live", tone: "emerald" }}
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
            { value: "invoices", label: "Invoices" },
            { value: "quotes", label: "Quotations" },
            { value: "expenses", label: "Expenses" },
            { value: "contracts", label: "Contracts" }
          ]}
        />
      </div>

      {activeTab === "overview" ? (
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SectionCard
          title="Operational snapshot"
          subtitle="Instant visibility into financial activity."
          className="h-full"
          icon={
            <CardIcon tone="bg-emerald-50 text-emerald-600">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 12h4l2 6 4-12 2 6h4" />
              </svg>
            </CardIcon>
          }
        >
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="text-xs text-slate-500">Pending invoices</div>
              <div className="text-lg font-semibold text-slate-900">{invoicePendingCount}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="text-xs text-slate-500">Paid invoices</div>
              <div className="text-lg font-semibold text-slate-900">{invoicePaidCount}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="text-xs text-slate-500">Pending vendor payments</div>
              <div className="text-lg font-semibold text-slate-900">{expensePendingCount}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="text-xs text-slate-500">Paid vendor payments</div>
              <div className="text-lg font-semibold text-slate-900">{expensePaidCount}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="text-xs text-slate-500">Pending contracts</div>
              <div className="text-lg font-semibold text-slate-900">{contractPendingCount}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="text-xs text-slate-500">Signed contracts</div>
              <div className="text-lg font-semibold text-slate-900">{contractSignedCount}</div>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Ready to invoice"
          subtitle="Your products, customers, and vendors are set."
          className="h-full"
          icon={
            <CardIcon tone="bg-sky-50 text-sky-600">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 7h16v10H4z" />
                <path d="M8 7V5h8v2" />
              </svg>
            </CardIcon>
          }
        >
          <div className="text-sm text-slate-600">
            You have {activeProducts.length} products, {activeCustomers.length} customers, and {activeVendors.length} vendors.
          </div>
          {requiresCatalogue ? (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
              Add at least one product, customer, and vendor in Catalogue to start creating invoices, expenses, and contracts.
            </div>
          ) : (
            <div className="mt-3 text-xs text-slate-500">You’re ready to create invoices, expenses, and contracts.</div>
          )}
        </SectionCard>

        <IllustrationCard
          title="Financial workflow"
          subtitle="Invoices, expenses, and contracts feeding your decision engine."
          className="h-full"
        >
          <FinancialIllustration />
        </IllustrationCard>

        <SectionCard
          title="Integrations"
          subtitle="Connect financial and CRM tools to keep your data in sync."
          className="h-full"
          icon={
            <CardIcon tone="bg-indigo-50 text-indigo-600">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M7 7h10v10H7z" />
                <path d="M3 12h4M17 12h4M12 3v4M12 17v4" />
              </svg>
            </CardIcon>
          }
        >
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs font-semibold text-slate-600">Financial tools</div>
              <div className="mt-3 space-y-2">
                {["quickbooks", "sap", "zoho_books"].map((key) => {
                  const meta = integrationMeta[key];
                  const badge = statusBadge(integrations.financial[key]);
                  return (
                    <div key={key} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-slate-200 p-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <IntegrationLogo type={key} />
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
                        <Button variant="secondary" onClick={() => updateIntegration("financial", key)}>
                          {integrations.financial[key] === "connected" ? "Disconnect" : "Connect"}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs font-semibold text-slate-600">CRM tools</div>
              <div className="mt-3 space-y-2">
                {["zoho_crm", "hubspot", "salesforce"].map((key) => {
                  const meta = integrationMeta[key];
                  const badge = statusBadge(integrations.crm[key]);
                  return (
                    <div key={key} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-slate-200 p-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <IntegrationLogo type={key} />
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
                        <Button variant="secondary" onClick={() => updateIntegration("crm", key)}>
                          {integrations.crm[key] === "connected" ? "Disconnect" : "Connect"}
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
        {activeTab === "invoices" ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <SectionCard
          title="Invoices"
          subtitle="Create invoices and mark them paid."
          className="lg:col-span-2"
          icon={
            <CardIcon tone="bg-violet-50 text-violet-600">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 4h12v16l-3-2-3 2-3-2-3 2V4z" />
                <path d="M9 8h6M9 12h6" />
              </svg>
            </CardIcon>
          }
        >
            <div className="grid grid-cols-1 gap-3">
              <div>
                <div className="ea-label">Invoice ID (optional)</div>
                <Input
                  placeholder="Enter invoice ID"
                  value={invoiceForm.invoice_id}
                  onChange={(e) => setInvoiceForm((f) => ({ ...f, invoice_id: e.target.value }))}
                />
              </div>
              <div>
                <div className="ea-label">Customer *</div>
                <Input
                  list="financial-customers"
                  placeholder={activeCustomers.length ? "Select or type customer" : "Type customer"}
                  value={invoiceForm.customer_id}
                  onChange={(e) => setInvoiceForm((f) => ({ ...f, customer_id: e.target.value }))}
                />
              </div>
              <div>
                <div className="ea-label">Products / Services *</div>
                <MultiProductDropdown
                  products={activeProducts}
                  selectedIds={Array.isArray(invoiceForm.product_ids) ? invoiceForm.product_ids : []}
                  onChange={updateInvoiceSelectedProducts}
                />
              </div>
              {invoicePreviewItems.length ? (
                <div className="space-y-3">
                  <div className="ea-label">Selected item details</div>
                  {invoicePreviewItems.map((item) => (
                    <div key={item.product_id} className="rounded-xl border border-slate-200 p-3">
                      <div className="mb-3 text-sm font-semibold text-slate-900">{item.product_name}</div>
                      <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-3">
                        <div>
                          <div className="ea-label">Quantity *</div>
                          <Input
                            type="number"
                            min="1"
                            value={String(item.quantity ?? 1)}
                            onChange={(e) => updateInvoiceItem(item.product_id, "quantity", e.target.value)}
                          />
                        </div>
                        <div>
                          <div className="ea-label">Unit price</div>
                          <Input
                            type="number"
                            min="0"
                            value={String(item.unit_price ?? 0)}
                            onChange={(e) => updateInvoiceItem(item.product_id, "unit_price", e.target.value)}
                          />
                        </div>
                        <div>
                          <div className="ea-label">Unit cost of sales</div>
                          <Input
                            type="number"
                            min="0"
                            value={String(item.unit_cost_of_sales ?? 0)}
                            onChange={(e) => updateInvoiceItem(item.product_id, "unit_cost_of_sales", e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
              <div>
                <div className="ea-label">Issued date</div>
                <Input type="date" value={invoiceForm.issued_at} onChange={(e) => setInvoiceForm((f) => ({ ...f, issued_at: e.target.value }))} />
              </div>
              <div>
                <div className="ea-label">Due date</div>
                <Input type="date" value={invoiceForm.due_date} onChange={(e) => setInvoiceForm((f) => ({ ...f, due_date: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
              <div>
                <div className="ea-label">Subtotal</div>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder={String(invoiceSubtotal)}
                  value={invoiceForm.subtotal_override}
                  onChange={(e) => setInvoiceForm((f) => ({ ...f, subtotal_override: e.target.value }))}
                />
                {invoiceForm.subtotal_override !== "" && (
                  <div className="mt-1 text-[11px] text-slate-400">Auto: {formatMoney(invoiceSubtotal)}</div>
                )}
              </div>
              <div>
                <div className="ea-label">Total cost of sales</div>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder={String(invoiceCostOfSalesTotal)}
                  value={invoiceForm.cost_of_sales_override}
                  onChange={(e) => setInvoiceForm((f) => ({ ...f, cost_of_sales_override: e.target.value }))}
                />
                {invoiceForm.cost_of_sales_override !== "" && (
                  <div className="mt-1 text-[11px] text-slate-400">Auto: {formatMoney(invoiceCostOfSalesTotal)}</div>
                )}
              </div>
            </div>
            <div>
              <div className="ea-label">Grand Total</div>
              <Input value={formatMoney(invoiceGrandTotal)} disabled />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={upsertInvoice}>{editingInvoiceId ? "Update invoice" : "Add invoice"}</Button>
              {editingInvoiceId ? (
                <Button variant="secondary" onClick={resetInvoiceForm}>
                  Cancel
                </Button>
              ) : null}
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Recent invoices"
          subtitle="Latest invoice activity."
          className="lg:col-span-3"
          icon={
            <CardIcon tone="bg-amber-50 text-amber-600">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 8v5l3 2" />
                <circle cx="12" cy="12" r="8" />
              </svg>
            </CardIcon>
          }
        >
            <div className="mt-2 space-y-2">
              {activeInvoices.length ? (
                activeInvoices.map((inv) => {
                  const customer = resolveCustomer(inv.customer_id, inv.customer_name);
                  const product = resolveProduct(inv.product_id, inv.product_name);
                  return (
                    <div key={inv.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-900">
                          {customer?.name || "Customer"} • {summariseProductNames(inv)}
                        </div>
                        <div className="text-xs text-slate-500">
                          Qty {inv.quantity} • Total {formatMoney(inv.total_amount)} • Due {inv.due_date ? new Date(inv.due_date).toLocaleDateString() : "Not set"} • Status {inv.status}
                        </div>
                      </div>
                      <ActionMenu
                        items={addFinancialShareAction([
                          {
                            label: "Edit",
                            onClick: () => {
                              setEditingInvoiceId(inv.id);
                              setInvoiceForm({
                                  invoice_id: inv.invoice_id || "",
                                  customer_id: inv.customer_name || inv.customer_id,
                                  product_ids: Array.isArray(inv.product_ids) && inv.product_ids.length ? inv.product_ids : inv.product_id ? [inv.product_id] : [],
                                  items: normalizeRecordItems(inv),
                                  issued_at: inv.issued_at || "",
                                  due_date: inv.due_date || "",
                                  subtotal_override: inv.subtotal_amount != null ? String(inv.subtotal_amount) : "",
                                  cost_of_sales_override: inv.cost_of_sales != null ? String(inv.cost_of_sales) : "",
                                });
                            }
                          },
                          {
                            label: inv.status === "paid" ? "Mark pending" : "Mark paid",
                            onClick: () => updateStatus("invoice", inv.id, inv.status === "paid" ? "pending" : "paid")
                          },
                          {
                            label: "View invoice",
                            onClick: () => setPreviewInvoiceId(inv.id)
                          },
                          {
                            label: "Archive",
                            onClick: () => archiveItem("invoice", inv.id)
                          },
                          {
                            label: "Delete",
                            tone: "danger",
                            onClick: () => deleteItem("invoice", inv.id)
                          }
                        ], "invoice", inv, customer, product)}
                      />
                    </div>
                  );
                })
              ) : (
                <div className="rounded-xl border border-dashed border-slate-200 p-3 text-xs text-slate-500">
                  No invoices yet. Add your first invoice above.
                </div>
              )}
            </div>
        </SectionCard>
        <SectionCard
          title="Archived invoices"
          subtitle="Restore or delete archived invoices."
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
            {archivedInvoices.length ? (
              archivedInvoices.map((inv) => {
                const customer = resolveCustomer(inv.customer_id, inv.customer_name);
                const age = daysSince(inv.archived_at || inv.updated_at || inv.created_at);
                const expiring = Math.max(0, ARCHIVE_EXPIRE_DAYS - age);
                return (
                  <div key={inv.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900">{customer?.name || "Customer"} • {formatMoney(inv.total_amount)}</div>
                      <div className="text-xs text-slate-500">Archived {age} days ago • Expires in {expiring} days</div>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="secondary" onClick={() => restoreItem("invoice", inv.id)}>Activate</Button>
                      <Button variant="ghost" onClick={() => deleteItem("invoice", inv.id)}>Delete</Button>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 p-3 text-xs text-slate-500">
                No archived invoices.
              </div>
            )}
          </div>
        </SectionCard>
        </div>
        ) : null}

        {activeTab === "quotes" ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <SectionCard
          title="Sales quotations"
          subtitle="Prepare customer-ready quotes before invoicing."
          className="lg:col-span-2"
          icon={
            <CardIcon tone="bg-indigo-50 text-indigo-600">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 4h14v16H5z" />
                <path d="M8 8h8M8 12h8M8 16h5" />
              </svg>
            </CardIcon>
          }
        >
            <div className="grid grid-cols-1 gap-3">
              <div>
                <div className="ea-label">Quotation ID (optional)</div>
                <Input
                  placeholder="Enter quotation ID"
                  value={quoteForm.quotation_id}
                  onChange={(e) => setQuoteForm((f) => ({ ...f, quotation_id: e.target.value }))}
                />
              </div>
              <div>
                <div className="ea-label">Customer *</div>
                <Input
                  list="financial-customers"
                  placeholder={activeCustomers.length ? "Select or type customer" : "Type customer"}
                  value={quoteForm.customer_id}
                  onChange={(e) => setQuoteForm((f) => ({ ...f, customer_id: e.target.value }))}
                />
              </div>
              <div>
                <div className="ea-label">Products / Services *</div>
                <MultiProductDropdown
                  products={activeProducts}
                  selectedIds={Array.isArray(quoteForm.product_ids) ? quoteForm.product_ids : []}
                  onChange={updateQuoteSelectedProducts}
                />
              </div>
              {quotePreviewItems.length ? (
                <div className="space-y-3">
                  <div className="ea-label">Selected item details</div>
                  {quotePreviewItems.map((item) => (
                    <div key={item.product_id} className="rounded-xl border border-slate-200 p-3">
                      <div className="mb-3 text-sm font-semibold text-slate-900">{item.product_name}</div>
                      <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-3">
                        <div>
                          <div className="ea-label">Quantity *</div>
                          <Input
                            type="number"
                            min="1"
                            value={String(item.quantity ?? 1)}
                            onChange={(e) => updateQuoteItem(item.product_id, "quantity", e.target.value)}
                          />
                        </div>
                        <div>
                          <div className="ea-label">Unit price</div>
                          <Input
                            type="number"
                            min="0"
                            value={String(item.unit_price ?? 0)}
                            onChange={(e) => updateQuoteItem(item.product_id, "unit_price", e.target.value)}
                          />
                        </div>
                        <div>
                          <div className="ea-label">Unit cost of sales</div>
                          <Input
                            type="number"
                            min="0"
                            value={String(item.unit_cost_of_sales ?? 0)}
                            onChange={(e) => updateQuoteItem(item.product_id, "unit_cost_of_sales", e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
              <div>
                <div className="ea-label">Quotation validity (days)</div>
                <Input
                  type="number"
                  min="1"
                  value={quoteForm.validity_days}
                  onChange={(e) => setQuoteForm((f) => ({ ...f, validity_days: e.target.value }))}
                />
              </div>
              <div>
                <div className="ea-label">Issued date</div>
                <Input type="date" value={quoteForm.issued_at} onChange={(e) => setQuoteForm((f) => ({ ...f, issued_at: e.target.value }))} />
              </div>
              <div>
                <div className="ea-label">Due date</div>
                <Input type="date" value={quoteForm.due_date} onChange={(e) => setQuoteForm((f) => ({ ...f, due_date: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
              <div>
                <div className="ea-label">Subtotal</div>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder={String(quoteSubtotal)}
                  value={quoteForm.subtotal_override}
                  onChange={(e) => setQuoteForm((f) => ({ ...f, subtotal_override: e.target.value }))}
                />
                {quoteForm.subtotal_override !== "" && (
                  <div className="mt-1 text-[11px] text-slate-400">Auto: {formatMoney(quoteSubtotal)}</div>
                )}
              </div>
              <div>
                <div className="ea-label">Total cost of sales</div>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder={String(quoteCostOfSalesTotal)}
                  value={quoteForm.cost_of_sales_override}
                  onChange={(e) => setQuoteForm((f) => ({ ...f, cost_of_sales_override: e.target.value }))}
                />
                {quoteForm.cost_of_sales_override !== "" && (
                  <div className="mt-1 text-[11px] text-slate-400">Auto: {formatMoney(quoteCostOfSalesTotal)}</div>
                )}
              </div>
            </div>
            <div>
              <div className="ea-label">Grand Total</div>
              <Input value={formatMoney(quoteGrandTotal)} disabled />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={upsertQuote}>{editingQuoteId ? "Update quotation" : "Add quotation"}</Button>
              {editingQuoteId ? (
                <Button variant="secondary" onClick={resetQuoteForm}>
                  Cancel
                </Button>
              ) : null}
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Recent quotations"
          subtitle="Drafts, sent quotes, and accepted proposals."
          className="lg:col-span-3"
          icon={
            <CardIcon tone="bg-amber-50 text-amber-600">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 8v5l3 2" />
                <circle cx="12" cy="12" r="8" />
              </svg>
            </CardIcon>
          }
        >
            <div className="mt-2 space-y-2">
              {activeQuotes.length ? (
                activeQuotes.map((quote) => {
                  const customer = resolveCustomer(quote.customer_id, quote.customer_name);
                  const product = resolveProduct(quote.product_id, quote.product_name);
                  return (
                    <div key={quote.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-900">
                          {customer?.name || "Customer"} • {summariseProductNames(quote)}
                        </div>
                        <div className="text-xs text-slate-500">
                          Qty {quote.quantity} • Total {formatMoney(quote.total_amount)} • Due {quote.due_date ? new Date(quote.due_date).toLocaleDateString() : "Not set"} • Status {quote.status || "draft"}
                        </div>
                      </div>
                      <ActionMenu
                        items={addFinancialShareAction([
                          {
                            label: "Edit",
                            onClick: () => {
                              setEditingQuoteId(quote.id);
                              setQuoteForm({
                                  quotation_id: quote.quotation_id || "",
                                  customer_id: quote.customer_name || quote.customer_id,
                                  product_ids: Array.isArray(quote.product_ids) && quote.product_ids.length ? quote.product_ids : quote.product_id ? [quote.product_id] : [],
                                  items: normalizeRecordItems(quote),
                                  validity_days: String(quote.validity_days || "30"),
                                  issued_at: quote.issued_at || "",
                                  due_date: quote.due_date || "",
                                  subtotal_override: quote.subtotal_amount != null ? String(quote.subtotal_amount) : "",
                                  cost_of_sales_override: quote.cost_of_sales != null ? String(quote.cost_of_sales) : "",
                                });
                            }
                          },
                          {
                            label: quote.status === "sent" ? "Mark draft" : "Mark sent",
                            onClick: () => updateStatus("quote", quote.id, quote.status === "sent" ? "draft" : "sent")
                          },
                          {
                            label: quote.status === "accepted" ? "Mark draft" : "Mark accepted",
                            onClick: () => updateStatus("quote", quote.id, quote.status === "accepted" ? "draft" : "accepted")
                          },
                          {
                            label: "View quotation",
                            onClick: () => setPreviewQuoteId(quote.id)
                          },
                          {
                            label: "Archive",
                            onClick: () => archiveItem("quote", quote.id)
                          },
                          {
                            label: "Delete",
                            tone: "danger",
                            onClick: () => deleteItem("quote", quote.id)
                          }
                        ], "quote", quote, customer, product)}
                      />
                    </div>
                  );
                })
              ) : (
                <div className="rounded-xl border border-dashed border-slate-200 p-3 text-xs text-slate-500">
                  No quotations yet. Add your first quote above.
                </div>
              )}
            </div>
        </SectionCard>
        <SectionCard
          title="Archived quotations"
          subtitle="Restore or delete archived quotations."
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
            {archivedQuotes.length ? (
              archivedQuotes.map((quote) => {
                const customer = resolveCustomer(quote.customer_id, quote.customer_name);
                const age = daysSince(quote.archived_at || quote.updated_at || quote.created_at);
                const expiring = Math.max(0, ARCHIVE_EXPIRE_DAYS - age);
                return (
                  <div key={quote.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900">{customer?.name || "Customer"} • {formatMoney(quote.total_amount)}</div>
                      <div className="text-xs text-slate-500">Archived {age} days ago • Expires in {expiring} days</div>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="secondary" onClick={() => restoreItem("quote", quote.id)}>Activate</Button>
                      <Button variant="ghost" onClick={() => deleteItem("quote", quote.id)}>Delete</Button>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 p-3 text-xs text-slate-500">
                No archived quotations.
              </div>
            )}
          </div>
        </SectionCard>
        </div>
        ) : null}

        {activeTab === "expenses" ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <SectionCard
          title="Expenses"
          subtitle="Track vendor payments and cost types."
          className="lg:col-span-2"
          icon={
            <CardIcon tone="bg-rose-50 text-rose-600">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 6h16v12H4z" />
                <path d="M8 10h8M8 14h5" />
              </svg>
            </CardIcon>
          }
        >
          <div className="grid grid-cols-1 gap-3">
            <div>
              <div className="ea-label">Vendor *</div>
              <Input
                list="financial-vendors"
                placeholder={activeVendors.length ? "Select or type vendor" : "Type vendor"}
                value={expenseForm.vendor_id}
                onChange={(e) => {
                  const value = e.target.value;
                  const vendor = resolveVendor(value);
                  setExpenseForm((f) => ({
                    ...f,
                    vendor_id: vendor?.id || value,
                    item: f.item || vendor?.product_name || "",
                    price: f.price || (vendor?.price ? String(vendor.price) : "")
                  }));
                }}
              />
            </div>
            <div>
              <div className="ea-label">Item *</div>
              <Input value={expenseForm.item} onChange={(e) => setExpenseForm((f) => ({ ...f, item: e.target.value }))} />
            </div>
            <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
              <div>
                <div className="ea-label">Cost type</div>
                <select
                  className="ea-input"
                  value={expenseForm.cost_type}
                  onChange={(e) => setExpenseForm((f) => ({ ...f, cost_type: e.target.value }))}
                >
                  <option value="fixed">Fixed</option>
                  <option value="variable">Variable</option>
                </select>
              </div>
              <div>
                <div className="ea-label">Price *</div>
                <Input
                  type="number"
                  min="0"
                  value={expenseForm.price}
                  onChange={(e) => setExpenseForm((f) => ({ ...f, price: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
              <div>
                <div className="ea-label">Incurred date</div>
                <Input type="date" value={expenseForm.incurred_at} onChange={(e) => setExpenseForm((f) => ({ ...f, incurred_at: e.target.value }))} />
              </div>
              <div>
                <div className="ea-label">Due date</div>
                <Input type="date" value={expenseForm.due_date} onChange={(e) => setExpenseForm((f) => ({ ...f, due_date: e.target.value }))} />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={upsertExpense}>{editingExpenseId ? "Update expense" : "Add expense"}</Button>
              {editingExpenseId ? (
                <Button variant="secondary" onClick={resetExpenseForm}>
                  Cancel
                </Button>
              ) : null}
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Recent expenses"
          subtitle="Latest vendor payments."
          className="lg:col-span-3"
          icon={
            <CardIcon tone="bg-amber-50 text-amber-600">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 8v5l3 2" />
                <circle cx="12" cy="12" r="8" />
              </svg>
            </CardIcon>
          }
        >
            <div className="mt-2 space-y-2">
              {activeExpenses.length ? (
                activeExpenses.map((exp) => {
                  const vendor = resolveVendor(exp.vendor_id, exp.vendor_name);
                  return (
                    <div key={exp.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-900">
                          {vendor?.name || "Vendor"} • {exp.item}
                        </div>
                        <div className="text-xs text-slate-500">
                          {exp.cost_type} • {formatMoney(exp.price)} • Due {exp.due_date ? new Date(exp.due_date).toLocaleDateString() : "Not set"} • Status {exp.status}
                        </div>
                      </div>
                      <ActionMenu
                        items={[
                          {
                            label: "Edit",
                            onClick: () => {
                              setEditingExpenseId(exp.id);
                              setExpenseForm({
                                vendor_id: exp.vendor_name || exp.vendor_id,
                                item: exp.item,
                                price: String(exp.price || ""),
                                cost_type: exp.cost_type || "variable",
                                incurred_at: exp.incurred_at || "",
                                due_date: exp.due_date || ""
                              });
                            }
                          },
                          {
                            label: exp.status === "paid" ? "Mark pending" : "Mark paid",
                            onClick: () => updateStatus("expense", exp.id, exp.status === "paid" ? "pending" : "paid")
                          },
                          {
                            label: "Archive",
                            onClick: () => archiveItem("expense", exp.id)
                          },
                          {
                            label: "Delete",
                            tone: "danger",
                            onClick: () => deleteItem("expense", exp.id)
                          }
                        ]}
                      />
                    </div>
                  );
                })
              ) : (
                <div className="rounded-xl border border-dashed border-slate-200 p-3 text-xs text-slate-500">
                  No expenses yet. Add your first expense above.
                </div>
              )}
            </div>
        </SectionCard>
        <SectionCard
          title="Archived expenses"
          subtitle="Restore or delete archived expenses."
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
            {archivedExpenses.length ? (
              archivedExpenses.map((exp) => {
                const vendor = resolveVendor(exp.vendor_id, exp.vendor_name);
                const age = daysSince(exp.archived_at || exp.updated_at || exp.created_at);
                const expiring = Math.max(0, ARCHIVE_EXPIRE_DAYS - age);
                return (
                  <div key={exp.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900">{vendor?.name || "Vendor"} • {exp.item}</div>
                      <div className="text-xs text-slate-500">Archived {age} days ago • Expires in {expiring} days</div>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="secondary" onClick={() => restoreItem("expense", exp.id)}>Activate</Button>
                      <Button variant="ghost" onClick={() => deleteItem("expense", exp.id)}>Delete</Button>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 p-3 text-xs text-slate-500">
                No archived expenses.
              </div>
            )}
          </div>
        </SectionCard>
        </div>
        ) : null}

        {activeTab === "contracts" ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <SectionCard
          title="Contracts"
          subtitle="Capture recurring revenue or cost obligations."
          className="lg:col-span-2"
          icon={
            <CardIcon tone="bg-blue-50 text-blue-600">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 4h12v16l-3-2-3 2-3-2-3 2V4z" />
                <path d="M9 8h6M9 12h6M9 16h4" />
              </svg>
            </CardIcon>
          }
        >
          <div className="grid grid-cols-1 gap-3">
            <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
              <div>
                <div className="ea-label">Contract type</div>
                <select
                  className="ea-input"
                  value={contractForm.contract_type}
                  onChange={(e) => setContractForm((f) => ({ ...f, contract_type: e.target.value }))}
                >
                  <option value="sales">Sales</option>
                  <option value="purchase">Purchase</option>
                </select>
              </div>
              <div>
                <div className="ea-label">{contractForm.contract_type === "sales" ? "Customer" : "Vendor"} *</div>
                <Input
                  list={contractForm.contract_type === "sales" ? "financial-customers" : "financial-vendors"}
                  placeholder={contractForm.contract_type === "sales" ? "Select or type customer" : "Select or type vendor"}
                  value={contractForm.counterparty_id}
                  onChange={(e) => {
                    const value = e.target.value;
                    const party =
                      contractForm.contract_type === "sales" ? resolveCustomer(value) : resolveVendor(value);
                    setContractForm((f) => ({
                      ...f,
                      counterparty_id: party?.id || value,
                      payment_terms: party?.payment_terms ? String(party.payment_terms) : f.payment_terms
                    }));
                  }}
                />
              </div>
            </div>
            <div>
              <div className="ea-label">Products / Services *</div>
              <MultiProductDropdown
                products={activeProducts}
                selectedIds={Array.isArray(contractForm.product_ids) ? contractForm.product_ids : []}
                onChange={(nextIds) => setContractForm((f) => ({ ...f, product_ids: nextIds }))}
              />
            </div>
            <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-3">
              <div>
                <div className="ea-label">Price *</div>
                <Input
                  type="number"
                  min="0"
                  value={contractForm.price}
                  onChange={(e) => setContractForm((f) => ({ ...f, price: e.target.value }))}
                />
              </div>
              <div>
                <div className="ea-label">Cost of sales</div>
                <Input
                  type="number"
                  min="0"
                  value={contractForm.cost_of_sales}
                  onChange={(e) => setContractForm((f) => ({ ...f, cost_of_sales: e.target.value }))}
                />
              </div>
              <div>
                <div className="ea-label">Payment terms (days)</div>
                <Input
                  type="number"
                  min="0"
                  value={contractForm.payment_terms}
                  onChange={(e) => setContractForm((f) => ({ ...f, payment_terms: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
              <div>
                <div className="ea-label">Discount</div>
                <Input
                  type="number"
                  min="0"
                  value={contractForm.discount}
                  onChange={(e) => setContractForm((f) => ({ ...f, discount: e.target.value }))}
                />
              </div>
              <div>
                <div className="ea-label">Freight</div>
                <Input
                  type="number"
                  min="0"
                  value={contractForm.freight}
                  onChange={(e) => setContractForm((f) => ({ ...f, freight: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
              <div>
                <div className="ea-label">Start date</div>
                <Input type="date" value={contractForm.start_date} onChange={(e) => setContractForm((f) => ({ ...f, start_date: e.target.value }))} />
              </div>
              <div>
                <div className="ea-label">End date</div>
                <Input type="date" value={contractForm.end_date} onChange={(e) => setContractForm((f) => ({ ...f, end_date: e.target.value }))} />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={upsertContract}>{editingContractId ? "Update contract" : "Add contract"}</Button>
              {editingContractId ? (
                <Button variant="secondary" onClick={resetContractForm}>
                  Cancel
                </Button>
              ) : null}
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Recent contracts"
          subtitle="Latest signed or pending contracts."
          className="lg:col-span-3"
          icon={
            <CardIcon tone="bg-amber-50 text-amber-600">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 8v5l3 2" />
                <circle cx="12" cy="12" r="8" />
              </svg>
            </CardIcon>
          }
        >
            <div className="mt-2 space-y-2">
              {activeContracts.length ? (
                activeContracts.map((contract) => {
                  const party =
                    contract.contract_type === "sales"
                      ? resolveCustomer(contract.counterparty_id, contract.counterparty_name)
                      : resolveVendor(contract.counterparty_id, contract.counterparty_name);
                  const product = resolveProduct(contract.product_id, contract.product_name);
                  return (
                    <div key={contract.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-900">
                          {contract.contract_type === "sales" ? "Sales" : "Purchase"} • {party?.name || "Partner"}
                        </div>
                        <div className="text-xs text-slate-500">
                          {summariseProductNames(contract)} • {formatMoney(contract.price)} • {contract.end_date ? `Ends ${new Date(contract.end_date).toLocaleDateString()}` : "No end date"} • Status {contract.status}
                        </div>
                      </div>
                      <ActionMenu
                        items={[
                          {
                            label: "Edit",
                            onClick: () => {
                              setEditingContractId(contract.id);
                              setContractForm({
                                contract_type: contract.contract_type || "sales",
                                counterparty_id: contract.counterparty_name || contract.counterparty_id,
                                product_ids: Array.isArray(contract.product_ids) && contract.product_ids.length ? contract.product_ids : contract.product_id ? [contract.product_id] : [],
                                price: String(contract.price || ""),
                                cost_of_sales: String(contract.cost_of_sales || ""),
                                payment_terms: String(contract.payment_terms || ""),
                                discount: String(contract.discount || ""),
                                freight: String(contract.freight || ""),
                                start_date: contract.start_date || "",
                                end_date: contract.end_date || "",
                                status: contract.status || "pending"
                              });
                            }
                          },
                          {
                            label: contract.status === "signed" ? "Mark pending" : "Mark signed",
                            onClick: () => updateStatus("contract", contract.id, contract.status === "signed" ? "pending" : "signed")
                          },
                          {
                            label: "Archive",
                            onClick: () => archiveItem("contract", contract.id)
                          },
                          {
                            label: "Delete",
                            tone: "danger",
                            onClick: () => deleteItem("contract", contract.id)
                          }
                        ]}
                      />
                    </div>
                  );
                })
              ) : (
                <div className="rounded-xl border border-dashed border-slate-200 p-3 text-xs text-slate-500">
                  No contracts yet. Add your first contract above.
                </div>
              )}
            </div>
        </SectionCard>
        <SectionCard
          title="Archived contracts"
          subtitle="Restore or delete archived contracts."
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
            {archivedContracts.length ? (
              archivedContracts.map((contract) => {
                const party =
                  contract.contract_type === "sales"
                    ? resolveCustomer(contract.counterparty_id, contract.counterparty_name)
                    : resolveVendor(contract.counterparty_id, contract.counterparty_name);
                const age = daysSince(contract.archived_at || contract.updated_at || contract.created_at);
                const expiring = Math.max(0, ARCHIVE_EXPIRE_DAYS - age);
                return (
                  <div key={contract.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900">
                        {contract.contract_type === "sales" ? "Sales" : "Purchase"} • {party?.name || "Partner"}
                      </div>
                      <div className="text-xs text-slate-500">Archived {age} days ago • Expires in {expiring} days</div>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="secondary" onClick={() => restoreItem("contract", contract.id)}>Activate</Button>
                      <Button variant="ghost" onClick={() => deleteItem("contract", contract.id)}>Delete</Button>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 p-3 text-xs text-slate-500">
                No archived contracts.
              </div>
            )}
          </div>
        </SectionCard>
        </div>
        ) : null}
      </div>
      ) : null}

      {previewInvoice ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setShareMenu(null);
              setPreviewInvoiceId(null);
            }
          }}
        >
          <div className="ea-dialog w-full max-w-3xl max-h-[90vh] overflow-hidden bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <div className="text-sm font-semibold text-slate-900">Invoice preview</div>
                <div className="text-xs text-slate-600">Generated from your catalogue and invoice inputs.</div>
              </div>
              <div className="flex items-center gap-2">
                <ShareDropdown kind="invoice" record={previewInvoice} customer={previewCustomer} product={previewProduct} />
                <Button
                  variant="secondary"
                  onClick={() => downloadInvoice(previewInvoice, previewCustomer, previewProduct)}
                >
                  Download
                </Button>
                <button
                  type="button"
                  onClick={() => {
                    setShareMenu(null);
                    setPreviewInvoiceId(null);
                  }}
                  className="rounded-lg px-2 py-1 text-sm text-slate-600 hover:bg-slate-100"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="max-h-[calc(90vh-64px)] overflow-auto p-6 text-sm text-slate-700">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex min-w-0 max-w-[240px] flex-col items-start">
                  {workspaceLogo ? (
                    <img src={workspaceLogo} alt="Company logo" className="mb-3 block h-auto max-h-20 w-auto max-w-full self-start object-contain object-left" />
                  ) : null}
                  <div className="text-lg font-semibold text-slate-900">{workspaceName || "EnterprateAI"}</div>
                  <div className="text-xs text-slate-500">Invoice</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-slate-500">Invoice ID</div>
                  <div className="text-sm font-semibold text-slate-900">{previewInvoice.invoice_id || previewInvoice.id}</div>
                  <div className="mt-2 text-xs text-slate-500">Status</div>
                  <div className="text-sm font-semibold text-slate-900">{previewInvoice.status}</div>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-slate-200 p-3">
                  <div className="text-xs font-semibold text-slate-600">Bill to</div>
                  <div className="mt-2 text-sm font-semibold text-slate-900">{previewCustomer?.name || "Customer"}</div>
                  {previewCustomer?.address ? <div className="text-xs text-slate-500">{previewCustomer.address}</div> : null}
                  <div className="mt-2 text-xs text-slate-500">Payment terms: {formatPaymentTerms(previewCustomer?.payment_terms)}</div>
                  {previewInvoice.due_date ? <div className="mt-1 text-xs text-slate-500">Due date: {new Date(previewInvoice.due_date).toLocaleDateString()}</div> : null}
                </div>
                <div className="rounded-xl border border-slate-200 p-3">
                  <div className="text-xs font-semibold text-slate-600">Invoice summary</div>
                  <div className="mt-2 text-xs text-slate-500">Grand Total</div>
                  <div className="text-lg font-semibold text-slate-900">{formatMoney(getDocumentGrandTotal(previewInvoice))}</div>
                </div>
              </div>

              <div className="mt-6 rounded-xl border border-slate-200">
                <div className="grid grid-cols-12 gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
                  <div className="col-span-6">Item</div>
                  <div className="col-span-2 text-right">Qty</div>
                  <div className="col-span-2 text-right">Unit</div>
                  <div className="col-span-2 text-right">Subtotal</div>
                </div>
                {(Array.isArray(previewInvoice.items) && previewInvoice.items.length ? previewInvoice.items : [{
                  product_name: previewProduct?.name || previewInvoice.product_name || "Product / Service",
                  quantity: previewInvoice.quantity,
                  unit_price: previewInvoice.unit_price,
                  subtotal_amount: previewInvoice.subtotal_amount,
                }]).map((item, index) => (
                  <div key={`${item.product_name || "item"}-${index}`} className="grid grid-cols-12 gap-2 px-3 py-3 text-sm text-slate-700">
                    <div className="col-span-6">{item.product_name || "Product / Service"}</div>
                    <div className="col-span-2 text-right">{item.quantity}</div>
                    <div className="col-span-2 text-right">{formatMoney(item.unit_price)}</div>
                    <div className="col-span-2 text-right font-semibold text-slate-900">{formatMoney(item.subtotal_amount || (Number(item.unit_price || 0) * Number(item.quantity || 0)))}</div>
                  </div>
                ))}
              </div>

              <div className="mt-6 text-xs text-slate-500">
                Thank you for your business. If you have questions about this invoice, contact us to update details.
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {previewQuote ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setShareMenu(null);
              setPreviewQuoteId(null);
            }
          }}
        >
          <div className="ea-dialog w-full max-w-3xl max-h-[90vh] overflow-hidden bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <div className="text-sm font-semibold text-slate-900">Quotation preview</div>
                <div className="text-xs text-slate-600">Generated from your catalogue and quotation inputs.</div>
              </div>
              <div className="flex items-center gap-2">
                <ShareDropdown kind="quote" record={previewQuote} customer={previewQuoteCustomer} product={previewQuoteProduct} />
                <Button
                  variant="secondary"
                  onClick={() => downloadQuote(previewQuote, previewQuoteCustomer, previewQuoteProduct)}
                >
                  Download
                </Button>
                <button
                  type="button"
                  onClick={() => {
                    setShareMenu(null);
                    setPreviewQuoteId(null);
                  }}
                  className="rounded-lg px-2 py-1 text-sm text-slate-600 hover:bg-slate-100"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="max-h-[calc(90vh-64px)] overflow-auto p-6 text-sm text-slate-700">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex min-w-0 max-w-[240px] flex-col items-start">
                  {workspaceLogo ? (
                    <img src={workspaceLogo} alt="Company logo" className="mb-3 block h-auto max-h-20 w-auto max-w-full self-start object-contain object-left" />
                  ) : null}
                  <div className="text-lg font-semibold text-slate-900">{workspaceName || "EnterprateAI"}</div>
                  <div className="text-xs text-slate-500">Sales quotation</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-slate-500">Quotation ID</div>
                  <div className="text-sm font-semibold text-slate-900">{previewQuote.quotation_id || previewQuote.id}</div>
                  <div className="mt-2 text-xs text-slate-500">Status</div>
                  <div className="text-sm font-semibold text-slate-900">{previewQuote.status || "draft"}</div>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 p-3">
                    <div className="text-xs font-semibold text-slate-600">Prepared for</div>
                    <div className="mt-2 text-sm font-semibold text-slate-900">{previewQuoteCustomer?.name || "Customer"}</div>
                    {previewQuoteCustomer?.address ? <div className="text-xs text-slate-500">{previewQuoteCustomer.address}</div> : null}
                    <div className="mt-2 text-xs text-slate-500">Payment terms: {formatPaymentTerms(previewQuoteCustomer?.payment_terms)}</div>
                    {previewQuote.due_date ? <div className="mt-1 text-xs text-slate-500">Due date: {new Date(previewQuote.due_date).toLocaleDateString()}</div> : null}
                  </div>
                <div className="rounded-xl border border-slate-200 p-3">
                  <div className="text-xs font-semibold text-slate-600">Quotation summary</div>
                  <div className="mt-2 text-xs text-slate-500">Grand Total</div>
                  <div className="text-lg font-semibold text-slate-900">{formatMoney(getDocumentGrandTotal(previewQuote))}</div>
                </div>
              </div>

              <div className="mt-6 rounded-xl border border-slate-200">
                <div className="grid grid-cols-12 gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
                  <div className="col-span-6">Item</div>
                  <div className="col-span-2 text-right">Qty</div>
                  <div className="col-span-2 text-right">Unit</div>
                  <div className="col-span-2 text-right">Subtotal</div>
                </div>
                {(Array.isArray(previewQuote.items) && previewQuote.items.length ? previewQuote.items : [{
                  product_name: previewQuoteProduct?.name || previewQuote.product_name || "Product / Service",
                  quantity: previewQuote.quantity,
                  unit_price: previewQuote.unit_price,
                  subtotal_amount: previewQuote.subtotal_amount,
                }]).map((item, index) => (
                  <div key={`${item.product_name || "item"}-${index}`} className="grid grid-cols-12 gap-2 px-3 py-3 text-sm text-slate-700">
                    <div className="col-span-6">{item.product_name || "Product / Service"}</div>
                    <div className="col-span-2 text-right">{item.quantity}</div>
                    <div className="col-span-2 text-right">{formatMoney(item.unit_price)}</div>
                    <div className="col-span-2 text-right font-semibold text-slate-900">{formatMoney(item.subtotal_amount || (Number(item.unit_price || 0) * Number(item.quantity || 0)))}</div>
                  </div>
                ))}
              </div>

              <div className="mt-6 text-xs text-slate-500">
                This quotation is valid for {previewQuote.validity_days || 30} days unless otherwise stated.
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {shareMenu ? (
        <div
          data-financial-share-menu
          className="fixed z-[120] min-w-[170px] rounded-2xl border border-slate-200 bg-white p-1 shadow-2xl"
          style={{ top: `${shareMenu.top}px`, right: `${Math.max(12, shareMenu.right)}px` }}
        >
          <button
            type="button"
            onClick={async () => {
              const { kind, record, customer, product } = shareMenu;
              setShareMenu(null);
              await shareFinancialDocument(kind, record, customer, product, "copy");
            }}
            className="block w-full rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
          >
            Copy link
          </button>
          <button
            type="button"
            onClick={async () => {
              const { kind, record, customer, product } = shareMenu;
              setShareMenu(null);
              await shareFinancialDocument(kind, record, customer, product, "mail");
            }}
            className="block w-full rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
          >
            Via mail
          </button>
        </div>
      ) : null}

      {shareNotice ? (
        <div className="fixed left-1/2 top-4 z-[130] -translate-x-1/2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-2xl">
          {shareNotice}
        </div>
      ) : null}

      {shareLinkUrl ? <ShareLinkPopup url={shareLinkUrl} onClose={() => setShareLinkUrl(null)} /> : null}
    </div>
  );
}

