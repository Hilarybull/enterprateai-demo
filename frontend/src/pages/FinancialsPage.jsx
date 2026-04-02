import { useEffect, useMemo, useState } from "react";
import { useRef } from "react";
import { useNavigate } from "react-router-dom";
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

export default function FinancialsPage() {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const workspaceName = useWorkspaceStore((s) => s.workspaceName);
  const currency = useWorkspaceStore((s) => s.currency);
  const setWorkspaceId = useWorkspaceStore((s) => s.setWorkspaceId);
  const setWorkspaceName = useWorkspaceStore((s) => s.setWorkspaceName);
  const navigate = useNavigate();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

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
  const ARCHIVE_WARNING_DAYS = 60;
  const ARCHIVE_EXPIRE_DAYS = 90;

  const [invoiceForm, setInvoiceForm] = useState({
    invoice_id: "",
    customer_id: "",
    product_id: "",
    quantity: "1"
  });
  const [quoteForm, setQuoteForm] = useState({
    quotation_id: "",
    customer_id: "",
    product_id: "",
    quantity: "1",
    validity_days: "30"
  });
  const [expenseForm, setExpenseForm] = useState({
    vendor_id: "",
    item: "",
    price: "",
    cost_type: "variable"
  });
  const [contractForm, setContractForm] = useState({
    contract_type: "sales",
    counterparty_id: "",
    product_id: "",
    price: "",
    payment_terms: "",
    discount: "",
    freight: "",
    start_date: "",
    end_date: "",
    status: "pending"
  });

  function CardIcon({ tone = "bg-brand-50 text-brand-600", children }) {
    return (
      <div className={`flex h-9 w-9 items-center justify-center rounded-2xl ${tone}`}>
        {children}
      </div>
    );
  }

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
  }, [workspaceId, setWorkspaceId, setWorkspaceName]);

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

  const integrationLogos = {
    quickbooks: { label: "QB", className: "bg-emerald-100 text-emerald-700" },
    sap: { label: "SAP", className: "bg-blue-100 text-blue-700" },
    zoho_books: { label: "ZB", className: "bg-amber-100 text-amber-700" },
    zoho_crm: { label: "ZC", className: "bg-red-100 text-red-700" },
    hubspot: { label: "HS", className: "bg-orange-100 text-orange-700" },
    salesforce: { label: "SF", className: "bg-sky-100 text-sky-700" }
  };

  function statusBadge(status) {
    if (status === "connected") return { label: "Connected", tone: "emerald" };
    if (status === "pending") return { label: "Pending", tone: "amber" };
    return { label: "Not connected", tone: "slate" };
  }

  function IntegrationLogo({ type }) {
    const meta = integrationLogos[type] || { label: type?.slice(0, 2) || "IN", className: "bg-slate-100 text-slate-600" };
    return (
      <div className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold ${meta.className}`}>
        {meta.label}
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

  function formatMoney(value) {
    return formatCurrency(Number(value || 0), currency || "GBP");
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

  function buildInvoiceHtml(invoice, customer, product) {
    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Invoice ${invoice?.id || ""}</title>
  <style>
    body{font-family:Arial, sans-serif; color:#0f172a; padding:32px;}
    .header{display:flex; justify-content:space-between; align-items:flex-start;}
    .muted{color:#64748b; font-size:12px;}
    .card{border:1px solid #e2e8f0; border-radius:12px; padding:16px; margin-top:16px;}
    table{width:100%; border-collapse:collapse; margin-top:16px;}
    th,td{border-bottom:1px solid #e2e8f0; padding:10px; text-align:left; font-size:13px;}
    th{text-transform:uppercase; letter-spacing:.05em; font-size:11px; color:#64748b;}
    .right{text-align:right;}
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h2>${workspaceName || "EnterprateAI"}</h2>
      <div class="muted">Invoice</div>
    </div>
    <div class="right">
      <div class="muted">Invoice ID</div>
      <div>${invoice?.id || ""}</div>
      <div class="muted" style="margin-top:8px;">Status</div>
      <div>${invoice?.status || "pending"}</div>
    </div>
  </div>
  <div class="card">
    <div class="muted">Bill to</div>
    <div><strong>${customer?.name || "Customer"}</strong></div>
    <div class="muted">${customer?.address || "Address on file"}</div>
    <div class="muted" style="margin-top:6px;">Payment terms: ${customer?.payment_terms || "14"} days</div>
  </div>
  <table>
    <thead>
      <tr><th>Item</th><th class="right">Qty</th><th class="right">Unit</th><th class="right">Total</th></tr>
    </thead>
    <tbody>
      <tr>
        <td>${product?.name || invoice?.product_name || "Product / Service"}</td>
        <td class="right">${invoice?.quantity || 0}</td>
        <td class="right">${formatMoney(invoice?.unit_price || 0)}</td>
        <td class="right"><strong>${formatMoney(invoice?.total_amount || 0)}</strong></td>
      </tr>
    </tbody>
  </table>
  <div class="muted" style="margin-top:16px;">Thank you for your business.</div>
</body>
</html>`;
  }

  function buildQuoteHtml(quote, customer, product) {
    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Quotation ${quote?.id || ""}</title>
  <style>
    body{font-family:Arial, sans-serif; color:#0f172a; padding:32px;}
    .header{display:flex; justify-content:space-between; align-items:flex-start;}
    .muted{color:#64748b; font-size:12px;}
    .card{border:1px solid #e2e8f0; border-radius:12px; padding:16px; margin-top:16px;}
    table{width:100%; border-collapse:collapse; margin-top:16px;}
    th,td{border-bottom:1px solid #e2e8f0; padding:10px; text-align:left; font-size:13px;}
    th{text-transform:uppercase; letter-spacing:.05em; font-size:11px; color:#64748b;}
    .right{text-align:right;}
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h2>${workspaceName || "EnterprateAI"}</h2>
      <div class="muted">Sales quotation</div>
    </div>
    <div class="right">
      <div class="muted">Quotation ID</div>
      <div>${quote?.id || ""}</div>
      <div class="muted" style="margin-top:8px;">Status</div>
      <div>${quote?.status || "draft"}</div>
    </div>
  </div>
  <div class="card">
    <div class="muted">Prepared for</div>
    <div><strong>${customer?.name || "Customer"}</strong></div>
    <div class="muted">${customer?.address || "Address on file"}</div>
    <div class="muted" style="margin-top:6px;">Payment terms: ${customer?.payment_terms || "14"} days</div>
  </div>
  <table>
    <thead>
      <tr><th>Item</th><th class="right">Qty</th><th class="right">Unit</th><th class="right">Total</th></tr>
    </thead>
    <tbody>
      <tr>
        <td>${product?.name || quote?.product_name || "Product / Service"}</td>
        <td class="right">${quote?.quantity || 0}</td>
        <td class="right">${formatMoney(quote?.unit_price || 0)}</td>
        <td class="right"><strong>${formatMoney(quote?.total_amount || 0)}</strong></td>
      </tr>
    </tbody>
  </table>
  <div class="muted" style="margin-top:16px;">This quotation is valid for ${quote?.validity_days || 30} days unless otherwise stated.</div>
</body>
</html>`;
  }

  async function downloadPdfFile(html, filename) {
    const { default: html2pdf } = await import("html2pdf.js");
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    await html2pdf()
      .set({
        filename,
        margin: 10,
        html2canvas: { scale: 2 },
        jsPDF: { unit: "pt", format: "a4" }
      })
      .from(container)
      .save();
    document.body.removeChild(container);
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

  function sendInvoice(invoice, customer) {
    const subject = encodeURIComponent(`Invoice ${invoice?.id || ""}`);
    const body = encodeURIComponent(
      `Hi ${customer?.name || ""},\n\nPlease find your invoice ${invoice?.id || ""} attached. Let us know if you have any questions.\n\nThank you.`
    );
    window.location.href = `mailto:${""}?subject=${subject}&body=${body}`;
  }

  function sendQuote(quote, customer) {
    const subject = encodeURIComponent(`Quotation ${quote?.id || ""}`);
    const body = encodeURIComponent(
      `Hi ${customer?.name || ""},\n\nPlease find your quotation ${quote?.id || ""} attached. Let us know if you have any questions.\n\nThank you.`
    );
    window.location.href = `mailto:${""}?subject=${subject}&body=${body}`;
  }

  function resetInvoiceForm() {
    setInvoiceForm({ invoice_id: "", customer_id: "", product_id: "", quantity: "1" });
    setEditingInvoiceId(null);
  }

  function resetQuoteForm() {
    setQuoteForm({ quotation_id: "", customer_id: "", product_id: "", quantity: "1", validity_days: "30" });
    setEditingQuoteId(null);
  }

  function resetExpenseForm() {
    setExpenseForm({ vendor_id: "", item: "", price: "", cost_type: "variable" });
    setEditingExpenseId(null);
  }

  function resetContractForm() {
    setContractForm({
      contract_type: "sales",
      counterparty_id: "",
      product_id: "",
      price: "",
      payment_terms: "",
      discount: "",
      freight: "",
      start_date: "",
      end_date: "",
      status: "pending"
    });
    setEditingContractId(null);
  }

  async function upsertInvoice() {
    if (!invoiceForm.customer_id || !invoiceForm.product_id) {
      setError("Invoice must reference a customer and product.");
      return;
    }
    const qty = Number(invoiceForm.quantity || 0);
    if (!Number.isFinite(qty) || qty <= 0) {
      setError("Quantity must be a positive number.");
      return;
    }
    setError(null);
    const customer = resolveCustomer(invoiceForm.customer_id);
    const product = resolveProduct(invoiceForm.product_id);
    const unitPrice = getProductPrice(product);
    const total = Number((unitPrice * qty).toFixed(2));
    const next = invoices.map((i) => ({ ...i }));
    const payload = {
      id: editingInvoiceId || crypto.randomUUID(),
      invoice_id: String(invoiceForm.invoice_id || "").trim(),
      customer_id: customer?.id || invoiceForm.customer_id,
      customer_name: customer?.name || String(invoiceForm.customer_id || "").trim(),
      product_id: product?.id || invoiceForm.product_id,
      product_name: product?.name || String(invoiceForm.product_id || "").trim(),
      quantity: qty,
      unit_price: unitPrice,
      total_amount: total,
      status: editingInvoiceId ? next.find((i) => i.id === editingInvoiceId)?.status || "pending" : "pending",
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
    if (!quoteForm.customer_id || !quoteForm.product_id) {
      setError("Quotation must reference a customer and product.");
      return;
    }
    const qty = Number(quoteForm.quantity || 0);
    if (!Number.isFinite(qty) || qty <= 0) {
      setError("Quantity must be a positive number.");
      return;
    }
    setError(null);
    const customer = resolveCustomer(quoteForm.customer_id);
    const product = resolveProduct(quoteForm.product_id);
    const unitPrice = getProductPrice(product);
    const total = Number((unitPrice * qty).toFixed(2));
    const validity = Math.max(1, parseInt(String(quoteForm.validity_days || "30"), 10) || 30);
    const next = quotes.map((q) => ({ ...q }));
    const payload = {
      id: editingQuoteId || crypto.randomUUID(),
      quotation_id: String(quoteForm.quotation_id || "").trim(),
      customer_id: customer?.id || quoteForm.customer_id,
      customer_name: customer?.name || String(quoteForm.customer_id || "").trim(),
      product_id: product?.id || quoteForm.product_id,
      product_name: product?.name || String(quoteForm.product_id || "").trim(),
      quantity: qty,
      unit_price: unitPrice,
      total_amount: total,
      validity_days: validity,
      status: editingQuoteId ? next.find((q) => q.id === editingQuoteId)?.status || "draft" : "draft",
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
    if (!contractForm.counterparty_id || !contractForm.product_id) {
      setError("Contract must reference a customer/vendor and product.");
      return;
    }
    const party =
      contractForm.contract_type === "sales"
        ? resolveCustomer(contractForm.counterparty_id)
        : resolveVendor(contractForm.counterparty_id);
    const product = resolveProduct(contractForm.product_id);
    const defaultPrice = getProductPrice(product);
    const rawPrice = contractForm.price !== "" ? Number(contractForm.price) : defaultPrice;
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
      product_id: product?.id || contractForm.product_id,
      product_name: product?.name || String(contractForm.product_id || "").trim(),
      price: Number(rawPrice.toFixed(2)),
      payment_terms: contractForm.payment_terms || "",
      discount: Number(contractForm.discount || 0),
      freight: Number(contractForm.freight || 0),
      start_date: contractForm.start_date || null,
      end_date: contractForm.end_date || null,
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
  const selectedProduct = resolveProduct(invoiceForm.product_id);
  const invoiceUnitPrice = getProductPrice(selectedProduct);
  const invoiceTotal = Number(((Number(invoiceForm.quantity || 0) || 0) * invoiceUnitPrice).toFixed(2));
  const selectedQuoteProduct = resolveProduct(quoteForm.product_id);
  const quoteUnitPrice = getProductPrice(selectedQuoteProduct);
  const quoteTotal = Number(((Number(quoteForm.quantity || 0) || 0) * quoteUnitPrice).toFixed(2));
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
                <div className="ea-label">Product / Service *</div>
              <Input
                list="financial-products"
                placeholder={activeProducts.length ? "Select or type product" : "Type product"}
                value={invoiceForm.product_id}
                onChange={(e) => setInvoiceForm((f) => ({ ...f, product_id: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <div className="ea-label">Quantity *</div>
                <Input
                  type="number"
                  min="1"
                  value={invoiceForm.quantity}
                  onChange={(e) => setInvoiceForm((f) => ({ ...f, quantity: e.target.value }))}
                />
              </div>
              <div>
                <div className="ea-label">Unit price (derived)</div>
                <Input value={formatMoney(invoiceUnitPrice)} disabled />
              </div>
            </div>
            <div>
              <div className="ea-label">Total amount</div>
              <Input value={formatMoney(invoiceTotal)} disabled />
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
                          {customer?.name || "Customer"} • {product?.name || "Product"}
                        </div>
                        <div className="text-xs text-slate-500">
                          Qty {inv.quantity} • Total {formatMoney(inv.total_amount)} • Status {inv.status}
                        </div>
                      </div>
                      <ActionMenu
                        items={[
                          {
                            label: "Edit",
                            onClick: () => {
                              setEditingInvoiceId(inv.id);
                                setInvoiceForm({
                                  invoice_id: inv.invoice_id || "",
                                  customer_id: inv.customer_name || inv.customer_id,
                                  product_id: inv.product_name || inv.product_id,
                                  quantity: String(inv.quantity || 1)
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
                        ]}
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
              <div className="ea-label">Product / Service *</div>
              <Input
                list="financial-products"
                placeholder={activeProducts.length ? "Select or type product" : "Type product"}
                value={quoteForm.product_id}
                onChange={(e) => setQuoteForm((f) => ({ ...f, product_id: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <div className="ea-label">Quantity *</div>
                <Input
                  type="number"
                  min="1"
                  value={quoteForm.quantity}
                  onChange={(e) => setQuoteForm((f) => ({ ...f, quantity: e.target.value }))}
                />
              </div>
              <div>
                <div className="ea-label">Unit price (derived)</div>
                <Input value={formatMoney(quoteUnitPrice)} disabled />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <div className="ea-label">Quotation validity (days)</div>
                <Input
                  type="number"
                  min="1"
                  value={quoteForm.validity_days}
                  onChange={(e) => setQuoteForm((f) => ({ ...f, validity_days: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <div className="ea-label">Total amount</div>
              <Input value={formatMoney(quoteTotal)} disabled />
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
                          {customer?.name || "Customer"} • {product?.name || "Product"}
                        </div>
                        <div className="text-xs text-slate-500">
                          Qty {quote.quantity} • Total {formatMoney(quote.total_amount)} • Status {quote.status || "draft"}
                        </div>
                      </div>
                      <ActionMenu
                        items={[
                          {
                            label: "Edit",
                            onClick: () => {
                              setEditingQuoteId(quote.id);
                                setQuoteForm({
                                  quotation_id: quote.quotation_id || "",
                                  customer_id: quote.customer_name || quote.customer_id,
                                  product_id: quote.product_name || quote.product_id,
                                  quantity: String(quote.quantity || 1),
                                  validity_days: String(quote.validity_days || "30")
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
                        ]}
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
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                          {exp.cost_type} • {formatMoney(exp.price)} • Status {exp.status}
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
                                cost_type: exp.cost_type || "variable"
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
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
              <div className="ea-label">Product / Service *</div>
              <Input
                list="financial-products"
                placeholder={activeProducts.length ? "Select or type product" : "Type product"}
                value={contractForm.product_id}
                onChange={(e) => {
                  const product = resolveProduct(e.target.value);
                  setContractForm((f) => ({
                    ...f,
                    product_id: product?.id || e.target.value,
                    price: product ? String(getProductPrice(product)) : f.price
                  }));
                }}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                <div className="ea-label">Payment terms (days)</div>
                <Input
                  type="number"
                  min="0"
                  value={contractForm.payment_terms}
                  onChange={(e) => setContractForm((f) => ({ ...f, payment_terms: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                          {product?.name || "Product"} • {formatMoney(contract.price)} • Status {contract.status}
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
                                product_id: contract.product_name || contract.product_id,
                                price: String(contract.price || ""),
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
            if (e.target === e.currentTarget) setPreviewInvoiceId(null);
          }}
        >
          <div className="ea-dialog w-full max-w-3xl max-h-[90vh] overflow-hidden bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <div className="text-sm font-semibold text-slate-900">Invoice preview</div>
                <div className="text-xs text-slate-600">Generated from your catalogue and invoice inputs.</div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  onClick={() => sendInvoice(previewInvoice, previewCustomer)}
                >
                  Send
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => downloadInvoice(previewInvoice, previewCustomer, previewProduct)}
                >
                  Download
                </Button>
                <button
                  type="button"
                  onClick={() => setPreviewInvoiceId(null)}
                  className="rounded-lg px-2 py-1 text-sm text-slate-600 hover:bg-slate-100"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="max-h-[calc(90vh-64px)] overflow-auto p-6 text-sm text-slate-700">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="text-lg font-semibold text-slate-900">{workspaceName || "EnterprateAI"}</div>
                  <div className="text-xs text-slate-500">Invoice</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-slate-500">Invoice ID</div>
                  <div className="text-sm font-semibold text-slate-900">{previewInvoice.id}</div>
                  <div className="mt-2 text-xs text-slate-500">Status</div>
                  <div className="text-sm font-semibold text-slate-900">{previewInvoice.status}</div>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-slate-200 p-3">
                  <div className="text-xs font-semibold text-slate-600">Bill to</div>
                  <div className="mt-2 text-sm font-semibold text-slate-900">{previewCustomer?.name || "Customer"}</div>
                  <div className="text-xs text-slate-500">{previewCustomer?.address || "Address on file"}</div>
                  <div className="mt-2 text-xs text-slate-500">Payment terms: {previewCustomer?.payment_terms || "14"} days</div>
                </div>
                <div className="rounded-xl border border-slate-200 p-3">
                  <div className="text-xs font-semibold text-slate-600">Invoice summary</div>
                  <div className="mt-2 text-xs text-slate-500">Total amount</div>
                  <div className="text-lg font-semibold text-slate-900">{formatMoney(previewInvoice.total_amount)}</div>
                </div>
              </div>

              <div className="mt-6 rounded-xl border border-slate-200">
                <div className="grid grid-cols-12 gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
                  <div className="col-span-6">Item</div>
                  <div className="col-span-2 text-right">Qty</div>
                  <div className="col-span-2 text-right">Unit</div>
                  <div className="col-span-2 text-right">Total</div>
                </div>
                <div className="grid grid-cols-12 gap-2 px-3 py-3 text-sm text-slate-700">
                  <div className="col-span-6">{previewProduct?.name || "Product / Service"}</div>
                  <div className="col-span-2 text-right">{previewInvoice.quantity}</div>
                  <div className="col-span-2 text-right">{formatMoney(previewInvoice.unit_price)}</div>
                  <div className="col-span-2 text-right font-semibold text-slate-900">{formatMoney(previewInvoice.total_amount)}</div>
                </div>
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
            if (e.target === e.currentTarget) setPreviewQuoteId(null);
          }}
        >
          <div className="ea-dialog w-full max-w-3xl max-h-[90vh] overflow-hidden bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <div className="text-sm font-semibold text-slate-900">Quotation preview</div>
                <div className="text-xs text-slate-600">Generated from your catalogue and quotation inputs.</div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  onClick={() => sendQuote(previewQuote, previewQuoteCustomer)}
                >
                  Send
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => downloadQuote(previewQuote, previewQuoteCustomer, previewQuoteProduct)}
                >
                  Download
                </Button>
                <button
                  type="button"
                  onClick={() => setPreviewQuoteId(null)}
                  className="rounded-lg px-2 py-1 text-sm text-slate-600 hover:bg-slate-100"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="max-h-[calc(90vh-64px)] overflow-auto p-6 text-sm text-slate-700">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="text-lg font-semibold text-slate-900">{workspaceName || "EnterprateAI"}</div>
                  <div className="text-xs text-slate-500">Sales quotation</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-slate-500">Quotation ID</div>
                  <div className="text-sm font-semibold text-slate-900">{previewQuote.id}</div>
                  <div className="mt-2 text-xs text-slate-500">Status</div>
                  <div className="text-sm font-semibold text-slate-900">{previewQuote.status || "draft"}</div>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-slate-200 p-3">
                  <div className="text-xs font-semibold text-slate-600">Prepared for</div>
                  <div className="mt-2 text-sm font-semibold text-slate-900">{previewQuoteCustomer?.name || "Customer"}</div>
                  <div className="text-xs text-slate-500">{previewQuoteCustomer?.address || "Address on file"}</div>
                  <div className="mt-2 text-xs text-slate-500">Payment terms: {previewQuoteCustomer?.payment_terms || "14"} days</div>
                </div>
                <div className="rounded-xl border border-slate-200 p-3">
                  <div className="text-xs font-semibold text-slate-600">Quotation summary</div>
                  <div className="mt-2 text-xs text-slate-500">Total amount</div>
                  <div className="text-lg font-semibold text-slate-900">{formatMoney(previewQuote.total_amount)}</div>
                </div>
              </div>

              <div className="mt-6 rounded-xl border border-slate-200">
                <div className="grid grid-cols-12 gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
                  <div className="col-span-6">Item</div>
                  <div className="col-span-2 text-right">Qty</div>
                  <div className="col-span-2 text-right">Unit</div>
                  <div className="col-span-2 text-right">Total</div>
                </div>
                <div className="grid grid-cols-12 gap-2 px-3 py-3 text-sm text-slate-700">
                  <div className="col-span-6">{previewQuoteProduct?.name || "Product / Service"}</div>
                  <div className="col-span-2 text-right">{previewQuote.quantity}</div>
                  <div className="col-span-2 text-right">{formatMoney(previewQuote.unit_price)}</div>
                  <div className="col-span-2 text-right font-semibold text-slate-900">{formatMoney(previewQuote.total_amount)}</div>
                </div>
              </div>

              <div className="mt-6 text-xs text-slate-500">
                This quotation is valid for {previewQuote.validity_days || 30} days unless otherwise stated.
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

