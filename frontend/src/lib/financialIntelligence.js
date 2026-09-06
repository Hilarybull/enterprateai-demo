function toNumber(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function parsePaymentTerms(value, fallback = 30) {
  const num = parseInt(String(value || "").trim(), 10);
  return Number.isFinite(num) && num >= 0 ? num : fallback;
}

function daysSince(dateLike) {
  const ts = dateLike ? new Date(dateLike).getTime() : NaN;
  if (!Number.isFinite(ts)) return 0;
  return Math.max(0, Math.floor((Date.now() - ts) / (1000 * 60 * 60 * 24)));
}

function parseDate(dateLike) {
  const ts = dateLike ? new Date(dateLike).getTime() : NaN;
  return Number.isFinite(ts) ? new Date(ts) : null;
}

function addDays(dateLike, days) {
  const base = parseDate(dateLike) || new Date();
  const next = new Date(base);
  next.setDate(next.getDate() + Math.max(0, Number(days || 0)));
  return next;
}

function startOfMonth(dateLike = new Date()) {
  const date = parseDate(dateLike) || new Date();
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function monthOffsetFromCurrent(dateLike) {
  const date = parseDate(dateLike);
  if (!date) return 0;
  const current = startOfMonth(new Date());
  const target = startOfMonth(date);
  return (target.getFullYear() - current.getFullYear()) * 12 + (target.getMonth() - current.getMonth());
}

function emptySchedule(months = 12) {
  return Array.from({ length: months }, () => 0);
}

function addToSchedule(schedule, dateLike, amount) {
  const numeric = toNumber(amount);
  if (!numeric) return;
  const index = clamp(monthOffsetFromCurrent(dateLike), 0, schedule.length - 1);
  schedule[index] = Number((schedule[index] + numeric).toFixed(2));
}

function effectiveDueDate(item, fallbackTermsDays) {
  return item?.due_date || addDays(item?.issued_at || item?.created_at || item?.updated_at, parsePaymentTerms(fallbackTermsDays, 30)).toISOString();
}

function normaliseStatus(value, fallback = "pending") {
  return String(value || fallback).trim().toLowerCase();
}

function observedMonths(items) {
  const dates = items
    .map((item) => {
      const ts = new Date(item?.paid_at || item?.issued_at || item?.incurred_at || item?.created_at || item?.updated_at || "").getTime();
      return Number.isFinite(ts) ? ts : null;
    })
    .filter((value) => value != null);
  if (!dates.length) return 1;
  const earliest = Math.min(...dates);
  const latest = Math.max(...dates, Date.now());
  const days = Math.max(1, Math.ceil((latest - earliest) / (1000 * 60 * 60 * 24)));
  return Math.max(1, Math.min(12, Number((days / 30).toFixed(2))));
}

export function getProductSalesPrice(product) {
  if (!product) return 0;
  const base = toNumber(product.base_price);
  const discount = toNumber(product.discount);
  const freight = toNumber(product.freight_cost);
  return Math.max(0, base - discount + freight);
}

export function getProductCostOfSales(product) {
  return Math.max(0, toNumber(product?.cost_of_sales));
}

function getRecordProductIds(item) {
  if (Array.isArray(item?.product_ids) && item.product_ids.length) return item.product_ids;
  if (item?.product_id) return [item.product_id];
  return [];
}

function isPendingWithinTerms(item, termsDays) {
  const status = normaliseStatus(item?.status);
  if (status === "paid" || status === "signed") return false;
  if (item?.due_date) {
    const due = parseDate(item.due_date);
    if (!due) return true;
    return due.getTime() >= Date.now();
  }
  return daysSince(item?.created_at || item?.updated_at) <= parsePaymentTerms(termsDays);
}

function remainingTermDays(item, termsDays) {
  if (item?.due_date) {
    const due = parseDate(item.due_date);
    if (!due) return parsePaymentTerms(termsDays);
    return Math.ceil((due.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  }
  return parsePaymentTerms(termsDays) - daysSince(item?.created_at || item?.updated_at);
}

function isApproachingTermExpiry(item, termsDays) {
  const remaining = remainingTermDays(item, termsDays);
  return remaining > 0 && remaining <= Math.max(3, Math.ceil(parsePaymentTerms(termsDays) * 0.2));
}

function dedupeByScenario(recommendations) {
  const seen = new Set();
  return recommendations.filter((item) => {
    const key = `${item.scenario_template_id}:${item.reason_code}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeRiskItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    const title = String(item?.title || "").trim().toLowerCase();
    const detail = String(item?.detail || "").trim().toLowerCase().replace(/\s+/g, " ");
    const key = title === "validation risk"
      ? `${title}::${detail}`
      : `${String(item?.reason_code || "").trim()}::${title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function toRiskRecommendation(risk) {
  switch (risk.reason_code) {
    case "NEGATIVE_MARGIN":
      return {
        scenario_template_id: "tmpl_price_increase",
        title: "Test a price increase or margin reset",
        subtitle: "Your current margin is under pressure. Check whether pricing or cost changes restore profit.",
      };
    case "LOW_RUNWAY":
      return {
        scenario_template_id: "tmpl_payment_delay",
        title: "Stress-test cash timing",
        subtitle: "Model delayed collections and tighter cash conditions before runway gets shorter.",
      };
    case "CLIENT_CONCENTRATION_HIGH":
      return {
        scenario_template_id: "tmpl_client_loss",
        title: "Simulate loss of your largest client",
        subtitle: "See the downside if your biggest customer slows or leaves.",
      };
    case "CAPACITY_OVERLOAD":
      return {
        scenario_template_id: "tmpl_hire_staff",
        title: "Model adding delivery capacity",
        subtitle: "Check whether hiring or contractor support eases delivery risk safely.",
      };
    case "OVERDUE_RECEIVABLES":
      return {
        scenario_template_id: "tmpl_payment_delay",
        title: "Model delayed customer payments",
        subtitle: "Your receivables are slipping past terms. Test the cash impact before it worsens.",
      };
    case "PAYABLE_PRESSURE":
      return {
        scenario_template_id: "tmpl_cost_increase",
        title: "Review cost pressure scenario",
        subtitle: "Payables are stacking up. Measure whether current expense load is sustainable.",
      };
    case "RECEIVABLES_APPROACHING_DUE":
      return {
        scenario_template_id: "tmpl_payment_delay",
        title: "Test near-due receivables",
        subtitle: "Some receivables are close to payment-term expiry. Model the cash effect if they slip.",
      };
    case "PAYABLES_APPROACHING_DUE":
      return {
        scenario_template_id: "tmpl_cost_increase",
        title: "Test near-due payables",
        subtitle: "Some payables are close to term expiry. Check whether cash can absorb them on time.",
      };
    case "NO_ACTIVE_REVENUE":
      return {
        scenario_template_id: "tmpl_revenue_drop",
        title: "Run a baseline demand stress test",
        subtitle: "No revenue is landing yet. Use a quick scenario to understand downside exposure.",
      };
    default:
      return {
        scenario_template_id: "tmpl_revenue_drop",
        title: "Run a downside scenario",
        subtitle: "Use a quick simulation to test how resilient the business is right now.",
      };
  }
}

export function buildFinancialIntelligence({ catalogue, financials, validation, inputs, fxRates = {}, displayCurrencyIso = "GBP" }) {
  // Convert an amount from itemCurrencyIso to the workspace display currency using fxRates
  function toWs(amount, itemCurrencyRaw) {
    const num = Number(amount) || 0;
    if (!itemCurrencyRaw) return num;
    const iso = (String(itemCurrencyRaw).match(/\(([A-Z]{3})\)\s*$/) || String(itemCurrencyRaw).match(/^([A-Z]{3})$/i) || [])[1]?.toUpperCase() || String(itemCurrencyRaw).toUpperCase();
    if (!iso || iso === displayCurrencyIso) return num;
    const rate = fxRates[iso];
    return rate ? num * rate : num;
  }
  const serviceValidation =
    validation?.serviceValidation ||
    (validation?.scores && validation?.metrics && validation?.outcome ? validation : null);
  const businessValidation =
    validation?.businessValidation ||
    (serviceValidation ? null : validation);

  const products = Array.isArray(catalogue?.products) ? catalogue.products.filter((item) => !item?.archived) : [];
  const customers = Array.isArray(catalogue?.customers) ? catalogue.customers.filter((item) => !item?.archived) : [];
  const vendors = Array.isArray(catalogue?.vendors) ? catalogue.vendors.filter((item) => !item?.archived) : [];
  const invoices = Array.isArray(financials?.invoices) ? financials.invoices.filter((item) => !item?.archived) : [];
  const quotes = Array.isArray(financials?.quotes || financials?.quotations)
    ? (financials.quotes || financials.quotations).filter((item) => !item?.archived)
    : [];
  const expenses = Array.isArray(financials?.expenses) ? financials.expenses.filter((item) => !item?.archived) : [];
  const contracts = Array.isArray(financials?.contracts) ? financials.contracts.filter((item) => !item?.archived) : [];

  const customerMap = new Map(customers.map((item) => [item.id, item]));
  const productMap = new Map(products.map((item) => [item.id, item]));
  const pendingReceivablesSchedule = emptySchedule();
  const pendingPayablesSchedule = emptySchedule();

  const paidInvoices = invoices.filter((item) => normaliseStatus(item.status) === "paid");
  const deliveredInvoices = invoices.filter((item) => normaliseStatus(item.status) === "delivered");
  const pendingInvoices = invoices.filter((item) => normaliseStatus(item.status) !== "paid");
  const paidExpenses = expenses.filter((item) => normaliseStatus(item.status) === "paid");
  const pendingExpenses = expenses.filter((item) => normaliseStatus(item.status) !== "paid");
  const signedContracts = contracts.filter((item) => normaliseStatus(item.status) === "signed");
  const salesContracts = signedContracts.filter((item) => normaliseStatus(item.contract_type, "sales") !== "purchase");
  const purchaseContracts = signedContracts.filter((item) => normaliseStatus(item.contract_type, "sales") === "purchase");

  const pendingInvoiceWithinTerms = pendingInvoices.filter((item) => {
    const customer = customerMap.get(item.customer_id);
    return isPendingWithinTerms(item, customer?.payment_terms || item.payment_terms);
  });
  const pendingInvoiceApproachingDue = pendingInvoiceWithinTerms.filter((item) => {
    const customer = customerMap.get(item.customer_id);
    return isApproachingTermExpiry(item, customer?.payment_terms || item.payment_terms);
  });
  const overduePendingInvoices = pendingInvoices.filter((item) => {
    const customer = customerMap.get(item.customer_id);
    return !isPendingWithinTerms(item, customer?.payment_terms || item.payment_terms);
  });
  const pendingExpenseWithinTerms = pendingExpenses.filter((item) => {
    const vendorTerms = item.payment_terms || 30;
    return isPendingWithinTerms(item, vendorTerms);
  });
  const pendingExpenseApproachingDue = pendingExpenseWithinTerms.filter((item) => {
    const vendorTerms = item.payment_terms || 30;
    return isApproachingTermExpiry(item, vendorTerms);
  });
  const overduePendingExpenses = pendingExpenses.filter((item) => {
    const vendorTerms = item.payment_terms || 30;
    return !isPendingWithinTerms(item, vendorTerms);
  });

  // Revenue = grand total from paid + delivered (accrual basis), converted to workspace currency
  const totalInvoiceRevenue = [...paidInvoices, ...deliveredInvoices].reduce((sum, item) => sum + toWs(toNumber(item.total_amount || item.subtotal_amount), item.currency || item.source_currency), 0);
  const totalInvoiceCostOfSales = paidInvoices.reduce((sum, item) => {
    if (item.cost_of_sales != null) return sum + toNumber(item.cost_of_sales);
    const lineItemCos = Array.isArray(item.line_items) ? item.line_items.reduce((s, li) => s + (Number(li.qty) || 1) * toNumber(li.cost_of_sales), 0) : 0;
    if (lineItemCos > 0) return sum + lineItemCos;
    const productIds = getRecordProductIds(item);
    if (!productIds.length) {
      const product = productMap.get(item.product_id);
      return sum + getProductCostOfSales(product) * Math.max(1, toNumber(item.quantity || 1));
    }
    const perUnitCost = productIds.reduce((running, productId) => running + getProductCostOfSales(productMap.get(productId)), 0);
    return sum + perUnitCost * Math.max(1, toNumber(item.quantity || 1));
  }, 0);
  const totalOperationalExpenses = paidExpenses.reduce((sum, item) => sum + toWs(toNumber(item.price || item.amount || item.total_amount), item.currency || item.source_currency), 0);

  function receivedAmt(inv) {
    if (inv.payments && inv.payments.length > 0) {
      return inv.payments.reduce((s, p) => s + toNumber(p.amount), 0);
    }
    if (inv.payment_type === "partial" && inv.paid_amount != null) return toNumber(inv.paid_amount);
    return toNumber(inv.total_amount || inv.subtotal_amount || 0);
  }

  // Build a full month-by-month breakdown: { "YYYY-MM": total }
  // field can be a string key, a function(item) => number, or omitted for total_amount
  function buildMonthlyBreakdown(items, field) {
    const byMonth = {};
    for (const item of items) {
      const raw = item?.paid_at || item?.issued_at || item?.incurred_at || item?.created_at || item?.updated_at;
      if (!raw) continue;
      const d = new Date(raw);
      if (!Number.isFinite(d.getTime())) continue;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const rawVal = typeof field === "function" ? field(item) : field ? toNumber(item[field]) : toNumber(item.total_amount || item.subtotal_amount);
      const val = toWs(rawVal, item.currency || item.source_currency);
      byMonth[key] = Number(((byMonth[key] || 0) + val).toFixed(2));
    }
    return byMonth;
  }

  // Revenue for the month = most recent calendar month's grand total from paid + delivered
  function mostRecentMonthTotal(items, field) {
    const byMonth = buildMonthlyBreakdown(items, field);
    const keys = Object.keys(byMonth).sort();
    if (!keys.length) return 0;
    return byMonth[keys[keys.length - 1]] || 0;
  }

  const earnedInvoices = [...paidInvoices, ...deliveredInvoices];
  const invoiceRevenue = Number(mostRecentMonthTotal(earnedInvoices).toFixed(2));
  const invoiceCostOfSales = Number(mostRecentMonthTotal(earnedInvoices, (inv) => {
    if (inv.cost_of_sales != null) return toNumber(inv.cost_of_sales);
    return Array.isArray(inv.line_items) ? inv.line_items.reduce((s, li) => s + (Number(li.qty) || 1) * toNumber(li.cost_of_sales), 0) : 0;
  }).toFixed(2));
  const operationalExpenses = Number(mostRecentMonthTotal(paidExpenses, (e) => toNumber(e.price || e.amount || e.total_amount)).toFixed(2));
  const contractRevenue = 0;
  const contractCostOfSales = 0;
  const contractPurchases = 0;

  pendingInvoices.forEach((item) => {
    const customer = customerMap.get(item.customer_id);
    addToSchedule(
      pendingReceivablesSchedule,
      effectiveDueDate(item, customer?.payment_terms || item.payment_terms || 30),
      item.total_amount
    );
  });
  salesContracts.forEach((item) => {
    const contractTotal = toNumber(item.price);
    // Deduct all linked invoices (paid or pending) to avoid double-counting
    const linkedTotal = invoices
      .filter((inv) => inv.contract_id === item.id)
      .reduce((sum, inv) => sum + toNumber(inv.total_amount), 0);
    const uninvoiced = Math.max(0, contractTotal - linkedTotal);
    if (uninvoiced > 0) {
      addToSchedule(
        pendingReceivablesSchedule,
        effectiveDueDate(item, item.payment_terms || 30),
        uninvoiced
      );
    }
  });
  pendingExpenses.forEach((item) => {
    addToSchedule(
      pendingPayablesSchedule,
      effectiveDueDate(item, item.payment_terms || 30),
      item.price
    );
  });
  purchaseContracts.forEach((item) => {
    const contractTotal = toNumber(item.price);
    const linkedTotal = invoices
      .filter((inv) => inv.contract_id === item.id)
      .reduce((sum, inv) => sum + toNumber(inv.total_amount), 0);
    const uninvoiced = Math.max(0, contractTotal - linkedTotal);
    if (uninvoiced > 0) {
      addToSchedule(
        pendingPayablesSchedule,
        effectiveDueDate(item, item.payment_terms || 30),
        uninvoiced
      );
    }
  });

  const recognisedRevenue = invoiceRevenue;
  const recognisedCostOfSales = invoiceCostOfSales;
  const recognisedExpenses = operationalExpenses;
  const businessValidationRevenue = toNumber(businessValidation?.metrics?.revenue_monthly);
  const businessValidationCostOfSales = toNumber(businessValidation?.metrics?.cost_of_sales_monthly);
  const businessValidationCosts = toNumber(businessValidation?.metrics?.costs_monthly);
  const businessValidationExpenses = Math.max(0, businessValidationCosts - businessValidationCostOfSales);
  const serviceValidationRevenue = toNumber(serviceValidation?.metrics?.monthly_revenue);
  const serviceValidationCostOfSales = toNumber(serviceValidation?.metrics?.monthly_variable_cost);
  const serviceValidationExpenses = toNumber(serviceValidation?.metrics?.monthly_fixed_cost);
  const validationRevenueContribution = businessValidationRevenue + serviceValidationRevenue;
  const validationCostOfSalesContribution = businessValidationCostOfSales + serviceValidationCostOfSales;
  const validationExpensesContribution = businessValidationExpenses + serviceValidationExpenses;
  const validationTotalCostsContribution = validationCostOfSalesContribution + validationExpensesContribution;
  const effectiveRevenue = recognisedRevenue > 0 ? recognisedRevenue : validationRevenueContribution;
  const effectiveCostOfSales = recognisedCostOfSales > 0 ? recognisedCostOfSales : validationCostOfSalesContribution;
  const effectiveExpenses = recognisedExpenses > 0 ? recognisedExpenses : validationExpensesContribution;
  const effectiveTotalCosts = effectiveExpenses + effectiveCostOfSales;
  const simulationRevenue = effectiveRevenue;
  const simulationCostOfSales = effectiveCostOfSales;
  const simulationExpenses = effectiveExpenses;
  const simulationTotalCosts = simulationExpenses + simulationCostOfSales;
  const netProfit = simulationRevenue - simulationTotalCosts;

  const customerRevenueMap = new Map();
  const customerNameMap = new Map();
  paidInvoices.forEach((item) => {
    const key = item.customer_id || item.customer_name || "unknown";
    customerRevenueMap.set(key, toNumber(customerRevenueMap.get(key)) + toNumber(item.total_amount));
    if (!customerNameMap.has(key)) {
      customerNameMap.set(key, item.customer_name || customerMap.get(item.customer_id)?.name || "Largest client");
    }
  });
  const largestCustomerEntry = [...customerRevenueMap.entries()].sort((a, b) => toNumber(b[1]) - toNumber(a[1]))[0] || null;
  const largestCustomerRevenue = largestCustomerEntry ? toNumber(largestCustomerEntry[1]) : 0;
  const topClientSharePct = recognisedRevenue > 0 ? clamp((largestCustomerRevenue / recognisedRevenue) * 100, 0, 100) : null;
  const largestClient =
    largestCustomerEntry && topClientSharePct != null
      ? {
        id: largestCustomerEntry[0],
        name: customerNameMap.get(largestCustomerEntry[0]) || "Largest client",
        share: Number(topClientSharePct.toFixed(2)),
      }
      : null;

  const paymentTermsDays = customers.length
    ? Math.round(customers.reduce((sum, item) => sum + parsePaymentTerms(item.payment_terms), 0) / customers.length)
    : null;
  const uninvoicedContractBalance = salesContracts.reduce((sum, item) => {
    const contractTotal = toNumber(item.price);
    const linkedTotal = invoices
      .filter((inv) => inv.contract_id === item.id)
      .reduce((s, inv) => s + toNumber(inv.total_amount), 0);
    return sum + Math.max(0, contractTotal - linkedTotal);
  }, 0);
  // Receivables = grand total owed (what customers will actually pay)
  const openingAccrualBalance = Number(
    (deliveredInvoices.reduce((sum, item) => sum + toNumber(item.total_amount || item.subtotal_amount), 0) + uninvoicedContractBalance).toFixed(2)
  );
  const startingCash = Math.max(0, toNumber(inputs?.starting_cash));
  const runwayMonths = netProfit >= 0 ? 999 : Math.max(0, startingCash / Math.max(Math.abs(netProfit), 1));
  const utilization = businessValidation?.metrics?.capacity?.utilization;
  const capacityUtilisationPct =
    typeof utilization === "number"
      ? clamp(utilization * 100, 0, 10000)
      : businessValidation?.metrics?.capacity?.utilization_pct ?? serviceValidation?.metrics?.capacity_utilisation ?? null;

  const riskItems = [];
  const pushRisk = (risk) => riskItems.push(risk);

  if (topClientSharePct != null && topClientSharePct >= 40) {
    pushRisk({
      reason_code: "CLIENT_CONCENTRATION_HIGH",
      severity: topClientSharePct >= 60 ? "high" : "medium",
      title: "Client concentration risk",
      detail: `Your largest client contributes about ${Math.round(topClientSharePct)}% of recognised revenue.`,
    });
  }
  if (capacityUtilisationPct != null && capacityUtilisationPct >= 85) {
    pushRisk({
      reason_code: "CAPACITY_OVERLOAD",
      severity: capacityUtilisationPct >= 95 ? "high" : "medium",
      title: "Capacity overload",
      detail: `Current delivery utilisation is around ${Math.round(capacityUtilisationPct)}%.`,
    });
  }
  if (effectiveRevenue > 0 && netProfit < 0) {
    pushRisk({
      reason_code: "NEGATIVE_MARGIN",
      severity: "high",
      title: "Negative margin",
      detail: `Accrued monthly profit is about ${Math.round(netProfit).toLocaleString()}.`,
    });
  }
  if (runwayMonths < 3) {
    pushRisk({
      reason_code: "LOW_RUNWAY",
      severity: runwayMonths < 2 ? "high" : "medium",
      title: "Low cash runway",
      detail: `Current runway is about ${runwayMonths.toFixed(1)} months.`,
    });
  }
  if (overduePendingInvoices.length) {
    pushRisk({
      reason_code: "OVERDUE_RECEIVABLES",
      severity: "high",
      title: "Receivables are overdue",
      detail: `${overduePendingInvoices.length} pending invoice${overduePendingInvoices.length > 1 ? "s are" : " is"} outside payment terms.`,
    });
  }
  if (pendingInvoiceApproachingDue.length) {
    pushRisk({
      reason_code: "RECEIVABLES_APPROACHING_DUE",
      severity: "medium",
      title: "Receivables approaching due date",
      detail: `${pendingInvoiceApproachingDue.length} pending invoice${pendingInvoiceApproachingDue.length > 1 ? "s are" : " is"} close to payment-term expiry.`,
    });
  }
  if (overduePendingExpenses.length) {
    pushRisk({
      reason_code: "PAYABLE_PRESSURE",
      severity: "medium",
      title: "Payables are overdue",
      detail: `${overduePendingExpenses.length} expense${overduePendingExpenses.length > 1 ? "s are" : " is"} past expected payment timing.`,
    });
  }
  if (pendingExpenseApproachingDue.length) {
    pushRisk({
      reason_code: "PAYABLES_APPROACHING_DUE",
      severity: "low",
      title: "Payables approaching due date",
      detail: `${pendingExpenseApproachingDue.length} payable item${pendingExpenseApproachingDue.length > 1 ? "s are" : " is"} close to term expiry.`,
    });
  }
  const accrualsTotal = Number(openingAccrualBalance.toFixed(2));
  const startingCashVal = Number(startingCash.toFixed(2));

  if (startingCashVal > 0 && accrualsTotal > 0) {
    const exposureRatio = accrualsTotal / startingCashVal;
    if (exposureRatio >= 1.0) {
      pushRisk({
        reason_code: "HIGH_RECEIVABLE_EXPOSURE",
        severity: "high",
        title: "Critical receivable exposure",
        detail: `Outstanding receivables (${Math.round(accrualsTotal).toLocaleString()}) exceed your current cash balance.`,
      });
    } else if (exposureRatio >= 0.5) {
      pushRisk({
        reason_code: "MODERATE_RECEIVABLE_EXPOSURE",
        severity: "medium",
        title: "Significant receivable exposure",
        detail: `Outstanding receivables represent over 50% of your current cash balance.`,
      });
    }
  }

  if (!paidInvoices.length && !salesContracts.length && validationRevenueContribution <= 0) {
    pushRisk({
      reason_code: "NO_ACTIVE_REVENUE",
      severity: "medium",
      title: "No active revenue flow",
      detail: "There are no paid revenue items feeding the current revenue picture yet.",
    });
  }
  if (!products.length) {
    pushRisk({
      reason_code: "NO_PRODUCTS",
      severity: "medium",
      title: "No products or services saved",
      detail: "Add products or services so pricing, cost of sales, and contracts stay connected.",
    });
  }

  const validationReasons = Array.from(
    new Set(
      [
        ...(Array.isArray(businessValidation?.reasons) ? businessValidation.reasons.slice(0, 2) : []),
        ...(Array.isArray(serviceValidation?.risk_flags) ? serviceValidation.risk_flags.slice(0, 2).map((flag) => String(flag).replaceAll("_", " ")) : []),
      ]
        .map((reason) => String(reason || "").trim())
        .filter(Boolean)
    )
  );
  validationReasons.forEach((reason, index) => {
    pushRisk({
      reason_code: `VALIDATION_${index + 1}`,
      severity: "medium",
      title: "Validation risk",
      detail: String(reason),
    });
  });

  const dedupedRiskItems = dedupeRiskItems(riskItems);

  const recommendations = dedupeByScenario(
    dedupedRiskItems
      .filter((item) => !String(item.reason_code || "").startsWith("VALIDATION_") || validationReasons.length <= 1)
      .map((item) => ({
        reason_code: item.reason_code,
        severity: item.severity,
        ...toRiskRecommendation(item),
      }))
  ).sort((a, b) => {
    const weight = { high: 0, medium: 1, low: 2 };
    return (weight[a.severity] ?? 3) - (weight[b.severity] ?? 3);
  });

  return {
    products,
    customers,
    vendors,
    invoices,
    quotes,
    expenses,
    contracts,
    paidInvoices,
    pendingInvoices,
    paidExpenses,
    pendingExpenses,
    pendingInvoiceWithinTerms,
    pendingInvoiceApproachingDue,
    pendingExpenseWithinTerms,
    pendingExpenseApproachingDue,
    overduePendingInvoices,
    overduePendingExpenses,
    totalRevenue: effectiveRevenue,
    accruals: openingAccrualBalance,
    accruedRevenue: openingAccrualBalance,
    accruedExpenses: effectiveExpenses,
    accruedCostOfSales: effectiveCostOfSales,
    monthlyRevenueRunRate: simulationRevenue,
    monthlyExpensesRunRate: simulationExpenses,
    monthlyCostOfSalesRunRate: simulationCostOfSales,
    totalCosts: effectiveTotalCosts,
    netProfit,
    topClientSharePct,
    runwayMonths,
    paymentTermsDays,
    capacityUtilisationPct,
    largestClient,
    recommendations,
    riskItems: dedupedRiskItems,
    stateSnapshot: {
      revenue_monthly: Math.max(0, Number(simulationRevenue.toFixed(2))),
      expenses_monthly: Math.max(0, Number(simulationExpenses.toFixed(2))),
      cost_of_sales_monthly: Math.max(0, Number(simulationCostOfSales.toFixed(2))),
      costs_monthly: Math.max(0, Number(simulationTotalCosts.toFixed(2))),
      accrued_revenue_total: Math.max(0, Number(openingAccrualBalance.toFixed(2))),
      accrued_expenses_total: Math.max(0, Number(effectiveExpenses.toFixed(2))),
      accrued_cost_of_sales_total: Math.max(0, Number(effectiveCostOfSales.toFixed(2))),
      starting_cash: startingCash,
      top_client_share_pct: topClientSharePct != null ? Number(topClientSharePct.toFixed(2)) : null,
      capacity_utilisation_pct: capacityUtilisationPct != null ? Number(capacityUtilisationPct.toFixed(2)) : null,
      payment_terms_days: paymentTermsDays,
      sales_cycle_days: businessValidation?.metrics?.sales_cycle_days ?? null,
      clients_count: customerRevenueMap.size || customers.length || null,
      approaching_receivables_count: pendingInvoiceApproachingDue.length,
      overdue_receivables_count: overduePendingInvoices.length,
      approaching_payables_count: pendingExpenseApproachingDue.length,
      overdue_payables_count: overduePendingExpenses.length,
      validation_revenue_monthly: Math.max(0, Number(validationRevenueContribution.toFixed(2))),
      validation_expenses_monthly: Math.max(0, Number(validationExpensesContribution.toFixed(2))),
      validation_cost_of_sales_monthly: Math.max(0, Number(validationCostOfSalesContribution.toFixed(2))),
      validation_total_costs_monthly: Math.max(0, Number(validationTotalCostsContribution.toFixed(2))),
      pending_receivables_schedule: pendingReceivablesSchedule,
      pending_payables_schedule: pendingPayablesSchedule,
      opening_accrual_balance: openingAccrualBalance,
      revenue_by_month: buildMonthlyBreakdown(earnedInvoices),
      cost_of_sales_by_month: buildMonthlyBreakdown(paidInvoices, (inv) => {
        const total = toNumber(inv.total_amount || inv.subtotal_amount || 0);
        const received = receivedAmt(inv);
        const lineItemCos = Array.isArray(inv.line_items) ? inv.line_items.reduce((s, i) => s + (Number(i.qty) || 1) * toNumber(i.cost_of_sales), 0) : 0;
        const cos = toNumber(inv.cost_of_sales || lineItemCos);
        const ratio = total > 0 ? received / total : 1;
        return cos * ratio;
      }),
      receivables_by_month: buildMonthlyBreakdown(
        [
          ...deliveredInvoices,
          ...paidInvoices.filter((inv) => receivedAmt(inv) < toNumber(inv.total_amount || inv.subtotal_amount || 0)),
        ],
        (inv) => {
          const status = String(inv.status || "").toLowerCase();
          if (status === "delivered") return toNumber(inv.total_amount || inv.subtotal_amount);
          return Math.max(0, toNumber(inv.total_amount || inv.subtotal_amount || 0) - receivedAmt(inv));
        }
      ),
      expenses_by_month: buildMonthlyBreakdown(paidExpenses, (e) => toNumber(e.price || e.amount || e.total_amount)),
    },
  };
}
