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

function normaliseStatus(value, fallback = "pending") {
  return String(value || fallback).trim().toLowerCase();
}

function observedMonths(items) {
  const dates = items
    .map((item) => {
      const ts = new Date(item?.created_at || item?.updated_at || item?.issued_at || "").getTime();
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

function isPendingWithinTerms(item, termsDays) {
  const status = normaliseStatus(item?.status);
  if (status === "paid" || status === "signed") return false;
  return daysSince(item?.created_at || item?.updated_at) <= parsePaymentTerms(termsDays);
}

function remainingTermDays(item, termsDays) {
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

export function buildFinancialIntelligence({ catalogue, financials, validation, inputs }) {
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

  const paidInvoices = invoices.filter((item) => normaliseStatus(item.status) === "paid");
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

  const invoiceRevenue = [...paidInvoices, ...pendingInvoiceWithinTerms].reduce((sum, item) => sum + toNumber(item.total_amount), 0);
  const invoiceCostOfSales = [...paidInvoices, ...pendingInvoiceWithinTerms].reduce((sum, item) => {
    if (item.cost_of_sales != null) return sum + toNumber(item.cost_of_sales);
    const product = productMap.get(item.product_id);
    return sum + getProductCostOfSales(product) * Math.max(1, toNumber(item.quantity || 1));
  }, 0);
  const operationalExpenses = [...paidExpenses, ...pendingExpenseWithinTerms].reduce((sum, item) => sum + toNumber(item.price), 0);
  const contractRevenue = salesContracts.reduce((sum, item) => sum + toNumber(item.price), 0);
  const contractCostOfSales = salesContracts.reduce((sum, item) => {
    if (item.cost_of_sales != null) return sum + toNumber(item.cost_of_sales);
    const product = productMap.get(item.product_id);
    return sum + getProductCostOfSales(product);
  }, 0);
  const contractPurchases = purchaseContracts.reduce((sum, item) => sum + toNumber(item.price), 0);

  const accruedRevenue = invoiceRevenue + contractRevenue;
  const accruedCostOfSales = invoiceCostOfSales + contractCostOfSales;
  const accruedExpenses = operationalExpenses + contractPurchases;
  const totalCosts = accruedExpenses + accruedCostOfSales;
  const fallbackRevenue = toNumber(validation?.metrics?.revenue_monthly);
  const fallbackCosts = toNumber(validation?.metrics?.costs_monthly);
  const fallbackCostOfSales = toNumber(validation?.metrics?.cost_of_sales_monthly);
  const effectiveRevenue = accruedRevenue > 0 ? accruedRevenue : fallbackRevenue;
  const effectiveCostOfSales = accruedCostOfSales > 0 ? accruedCostOfSales : fallbackCostOfSales;
  const effectiveExpenses = accruedExpenses > 0 ? accruedExpenses : Math.max(0, fallbackCosts - effectiveCostOfSales);
  const effectiveTotalCosts = effectiveExpenses + effectiveCostOfSales;
  const financialActivityMonths = observedMonths([
    ...paidInvoices,
    ...pendingInvoiceWithinTerms,
    ...paidExpenses,
    ...pendingExpenseWithinTerms,
    ...salesContracts,
    ...purchaseContracts,
  ]);
  const derivedRevenueRunRate = financialActivityMonths > 0 ? effectiveRevenue / financialActivityMonths : effectiveRevenue;
  const derivedCostOfSalesRunRate = financialActivityMonths > 0 ? effectiveCostOfSales / financialActivityMonths : effectiveCostOfSales;
  const derivedExpensesRunRate = financialActivityMonths > 0 ? effectiveExpenses / financialActivityMonths : effectiveExpenses;
  const simulationRevenue = fallbackRevenue > 0 ? fallbackRevenue : derivedRevenueRunRate;
  const simulationCostOfSales = fallbackCostOfSales > 0 ? fallbackCostOfSales : derivedCostOfSalesRunRate;
  const simulationExpenses = fallbackCosts > 0 ? Math.max(0, fallbackCosts - simulationCostOfSales) : derivedExpensesRunRate;
  const simulationTotalCosts = simulationExpenses + simulationCostOfSales;
  const netProfit = simulationRevenue - simulationTotalCosts;

  const customerRevenueMap = new Map();
  const customerNameMap = new Map();
  [...paidInvoices, ...pendingInvoiceWithinTerms].forEach((item) => {
    const key = item.customer_id || item.customer_name || "unknown";
    customerRevenueMap.set(key, toNumber(customerRevenueMap.get(key)) + toNumber(item.total_amount));
    if (!customerNameMap.has(key)) {
      customerNameMap.set(key, item.customer_name || customerMap.get(item.customer_id)?.name || "Largest client");
    }
  });
  salesContracts.forEach((item) => {
    const key = item.counterparty_id || item.counterparty_name || "unknown";
    customerRevenueMap.set(key, toNumber(customerRevenueMap.get(key)) + toNumber(item.price));
    if (!customerNameMap.has(key)) {
      customerNameMap.set(key, item.counterparty_name || customerMap.get(item.counterparty_id)?.name || "Largest client");
    }
  });
  const largestCustomerEntry = [...customerRevenueMap.entries()].sort((a, b) => toNumber(b[1]) - toNumber(a[1]))[0] || null;
  const largestCustomerRevenue = largestCustomerEntry ? toNumber(largestCustomerEntry[1]) : 0;
  const topClientSharePct = effectiveRevenue > 0 ? clamp((largestCustomerRevenue / effectiveRevenue) * 100, 0, 100) : null;
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
  const startingCash = Math.max(0, toNumber(inputs?.starting_cash));
  const runwayMonths = netProfit >= 0 ? 999 : Math.max(0, startingCash / Math.max(Math.abs(netProfit), 1));
  const utilization = validation?.metrics?.capacity?.utilization;
  const capacityUtilisationPct =
    typeof utilization === "number" ? clamp(utilization * 100, 0, 10000) : validation?.metrics?.capacity?.utilization_pct ?? null;

  const riskItems = [];
  const pushRisk = (risk) => riskItems.push(risk);

  if (topClientSharePct != null && topClientSharePct >= 40) {
    pushRisk({
      reason_code: "CLIENT_CONCENTRATION_HIGH",
      severity: topClientSharePct >= 60 ? "high" : "medium",
      title: "Client concentration risk",
      detail: `Your largest client contributes about ${Math.round(topClientSharePct)}% of accrued revenue.`,
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
  if (!paidInvoices.length && !pendingInvoiceWithinTerms.length && !salesContracts.length) {
    pushRisk({
      reason_code: "NO_ACTIVE_REVENUE",
      severity: "medium",
      title: "No active revenue flow",
      detail: "There are no paid or in-term receivables feeding the current revenue picture.",
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

  const validationReasons = Array.isArray(validation?.reasons) ? validation.reasons.slice(0, 4) : [];
  validationReasons.forEach((reason, index) => {
    pushRisk({
      reason_code: `VALIDATION_${index + 1}`,
      severity: "medium",
      title: "Validation risk",
      detail: String(reason),
    });
  });

  const recommendations = dedupeByScenario(
    riskItems
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
    accruedRevenue: effectiveRevenue,
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
    riskItems,
    stateSnapshot: {
      revenue_monthly: Math.max(0, Number(simulationRevenue.toFixed(2))),
      expenses_monthly: Math.max(0, Number(simulationExpenses.toFixed(2))),
      cost_of_sales_monthly: Math.max(0, Number(simulationCostOfSales.toFixed(2))),
      costs_monthly: Math.max(0, Number(simulationTotalCosts.toFixed(2))),
      accrued_revenue_total: Math.max(0, Number(effectiveRevenue.toFixed(2))),
      accrued_expenses_total: Math.max(0, Number(effectiveExpenses.toFixed(2))),
      accrued_cost_of_sales_total: Math.max(0, Number(effectiveCostOfSales.toFixed(2))),
      starting_cash: startingCash,
      top_client_share_pct: topClientSharePct != null ? Number(topClientSharePct.toFixed(2)) : null,
      capacity_utilisation_pct: capacityUtilisationPct != null ? Number(capacityUtilisationPct.toFixed(2)) : null,
      payment_terms_days: paymentTermsDays,
      sales_cycle_days: validation?.metrics?.sales_cycle_days ?? null,
      clients_count: customerRevenueMap.size || customers.length || null,
      approaching_receivables_count: pendingInvoiceApproachingDue.length,
      overdue_receivables_count: overduePendingInvoices.length,
      approaching_payables_count: pendingExpenseApproachingDue.length,
      overdue_payables_count: overduePendingExpenses.length,
    },
  };
}
