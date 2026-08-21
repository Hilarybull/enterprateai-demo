import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";

export const TOUR_STEPS = [
  {
    key: "demo-intro",
    path: "/book-demo",
    navKey: null,
    icon: "account",
    selector: "[data-tour='book-demo-start']",
    title: "Start with a guided tour",
    description: "We’ll walk you through the demo first, then take you into the sandbox so you can explore with sample data.",
    hint: "Click Next to enter the sandbox tour.",
  },
  {
    key: "workspace",
    path: "/dashboard",
    navKey: null,
    icon: "workspace",
    selector: "[data-tour='workspace-panel']",
    title: "Your Workspace",
    description: "This is the heart of your account. Your business name, logo, and services live here and flow into every feature: invoices, blueprints, marketplace listings, and more.",
    hint: "Click the workspace card to open your full business profile.",
  },
  {
    key: "dashboard",
    path: "/dashboard",
    navKey: "dashboard",
    icon: "dashboard",
    selector: null,
    title: "Business Dashboard",
    description: "Your dashboard shows live revenue, cash balance, risk signals, and AI recommendations in one view. Every number is pulled directly from your invoices and catalogue.",
    hint: "Metrics update automatically as you add invoices and catalogue entries.",
  },
  {
    key: "validation",
    path: "/validation",
    navKey: "validation",
    icon: "validation",
    selector: null,
    title: "Idea Validation",
    description: "Describe any business concept and the AI scores it across market viability, competition, risks, and opportunities. Get a structured analysis before spending a single pound.",
    hint: "Type your business idea in the input field above and click Validate.",
  },
  {
    key: "validation-results",
    path: "/validation",
    navKey: "validation",
    icon: "validation",
    selector: null,
    title: "Validation Results",
    description: "Each validation produces a detailed report: an overall viability score, market sizing, competitive landscape, risk factors, and recommended next steps tailored to your idea.",
    hint: "After validating, scroll down to see the full scoring breakdown.",
  },
  {
    key: "simulation",
    path: "/simulation",
    navKey: "simulation",
    icon: "simulation",
    selector: "[data-tour='simulation-run-btn']",
    title: "Run a Scenario",
    description: "Click Run a scenario to test a business decision before committing to it. Choose from common scenarios like hiring staff, raising prices, or launching a promotion.",
    hint: "Click Run a scenario to start your first simulation.",
  },
  {
    key: "simulation-baseline",
    path: "/simulation",
    navKey: "simulation",
    icon: "simulation",
    selector: "[data-tour='simulation-baseline']",
    title: "Baseline Continuity",
    description: "This section always shows your 6-month baseline projection based on your current data. It models revenue, receivables, expenses, gross profit, and cash balance month by month if nothing changes.",
    hint: "Compare any new scenario against this baseline to see the real impact.",
  },
  {
    key: "blueprint",
    path: "/blueprint",
    navKey: "blueprint",
    icon: "blueprint",
    selector: null,
    title: "Business Blueprints",
    description: "Generate a professional business plan, investor proposal, or sales letter in seconds. Auto-populated from your workspace data. No blank pages, no repeated data entry.",
    hint: "Select a document type from the list to generate your first blueprint.",
  },
  {
    key: "registration",
    path: "/registration",
    navKey: "registration",
    icon: "registration",
    selector: null,
    title: "Business Registration",
    description: "Check company name availability, search the Companies House register, and get step-by-step formation guidance tailored to your business type and jurisdiction.",
    hint: "Search a company name or browse the formation checklist.",
  },
  {
    key: "catalogue",
    path: "/catalogue",
    navKey: "catalogue",
    icon: "catalogue",
    selector: null,
    title: "Product Catalogue",
    description: "Your single source of truth for products, services, customers, and vendors. Add a product once and it automatically flows into invoices, quotations, and marketplace listings.",
    hint: "Browse the tabs below to see your pre-loaded products, customers, and vendors.",
  },
  {
    key: "catalogue-products",
    path: "/catalogue",
    navKey: "catalogue",
    icon: "catalogue",
    selector: "[data-tour='catalogue-products-tab']",
    clickOnArrival: true,
    title: "Products Tab",
    description: "The Products tab lists every service or product you sell with its sell price, cost of sales, and margin. Products are reused across invoices and quotations so you never enter them twice.",
    hint: "Click Products to see the pre-loaded services and their pricing.",
  },
  {
    key: "catalogue-customers",
    path: "/catalogue",
    navKey: "catalogue",
    icon: "catalogue",
    selector: "[data-tour='catalogue-customers-tab']",
    clickOnArrival: true,
    title: "Customers Tab",
    description: "The Customers tab tracks every client: total invoices raised, revenue earned, and outstanding balances. Use it to understand who your most valuable customers are.",
    hint: "Click Customers to see the pre-loaded customer profiles and their revenue.",
  },
  {
    key: "financials",
    path: "/financials",
    navKey: "financials",
    icon: "financials",
    selector: null,
    title: "Financials Overview",
    description: "The overview tab shows your key financial KPIs at a glance: annual revenue, monthly run rate, cash position, receivables, and pending payables. All calculated live from your invoices.",
    hint: "Open the Invoices tab to see your sample invoices or create a new one.",
  },
  {
    key: "financials-invoices",
    path: "/financials",
    navKey: "financials",
    icon: "financials",
    selector: "[data-tour='financials-invoices-tab']",
    clickOnArrival: true,
    title: "Invoices Tab",
    description: "Create, send, and track invoices directly from this tab. Each invoice is linked to a customer and product from your catalogue. No manual re-entry, no formatting, ready to send in seconds.",
    hint: "Click Invoices to see the sample invoices or click the create button to build one.",
  },
  {
    key: "integrations",
    path: "/integrations",
    navKey: "integrations",
    icon: "integrations",
    selector: null,
    title: "Integrations",
    description: "Already using QuickBooks, Xero, Zoho CRM, or Stripe? Connect them in one click and import your existing data. No double-entry, no CSV exports, no manual uploads.",
    hint: "Select an integration to see the connection flow.",
  },
  {
    key: "marketplace-products",
    path: "/marketplace",
    navKey: "marketplace",
    icon: "marketplace",
    selector: "[data-tour='marketplace-products-tab']",
    clickOnArrival: true,
    title: "Products and Services",
    description: "The Products and Services tab lists all published products and services from businesses on the platform. Browse what other companies offer or search by category to find suppliers.",
    hint: "Click Products and Services to browse active listings.",
  },
  {
    key: "marketplace-businesses",
    path: "/marketplace",
    navKey: "marketplace",
    icon: "marketplace",
    selector: "[data-tour='marketplace-profiles-tab']",
    clickOnArrival: true,
    title: "Businesses Tab",
    description: "The Businesses tab shows company profiles published to the marketplace. Find partners, suppliers, or customers and send them a direct RFQ to start a conversation.",
    hint: "Click Businesses to browse published company profiles.",
  },
  {
    key: "marketplace",
    path: "/marketplace",
    navKey: "marketplace",
    icon: "marketplace",
    selector: "[data-tour='marketplace-list-btn']",
    title: "List My Business",
    description: "Click List My Business to publish your workspace profile to the marketplace. Once listed, buyers and partners can find your business, view your services, and send you quotation requests.",
    hint: "Click List My Business to start your listing.",
  },
  {
    key: "referrals",
    path: "/referrals",
    navKey: "referrals",
    icon: "referrals",
    selector: null,
    title: "Referrals",
    description: "Earn 5% commission on every subscription paid by businesses you refer. Share your unique link and track your earnings and conversions in real time.",
    hint: "Copy your referral link and start sharing.",
  },
  {
    key: "account",
    path: "/dashboard",
    navKey: null,
    icon: "account",
    selector: "[data-tour='nav-account']",
    title: "Your Profile",
    description: "Manage your account details, upload a profile photo, change your password, and control notification preferences. Access it any time from the header.",
    hint: "Click your avatar in the top right to open account settings.",
  },
];

const DemoTourContext = createContext(null);

function isDemo() {
  return localStorage.getItem("ea_email") === "demo";
}

export function DemoTourProvider({ children }) {
  const navigate = useNavigate();
  const [active, setActive] = useState(false);
  const [step, setStep] = useState(0);
  const [demoGate, setDemoGate] = useState(null); // { feature: string }
  const [showPostTour, setShowPostTour] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem("ea_tour_active") === "1") {
      setActive(true);
      setStep(Number(sessionStorage.getItem("ea_tour_step") || 0));
    }
  }, []);

  const startTour = useCallback(() => {
    setActive(true);
    setStep(0);
    setShowPostTour(false);
    sessionStorage.setItem("ea_tour_active", "1");
    sessionStorage.setItem("ea_tour_step", "0");
    sessionStorage.removeItem("ea_tour_done");
    navigate(TOUR_STEPS[0].path);
  }, [navigate]);

  const _endTour = useCallback((markDone = true) => {
    setActive(false);
    sessionStorage.removeItem("ea_tour_active");
    sessionStorage.removeItem("ea_tour_step");
    if (markDone) {
      sessionStorage.setItem("ea_tour_done", "1");
    }
    if (isDemo()) setShowPostTour(true);
  }, []);

  const next = useCallback(() => {
    const nextStep = step + 1;
    if (nextStep >= TOUR_STEPS.length) {
      _endTour(true);
    } else {
      setStep(nextStep);
      sessionStorage.setItem("ea_tour_step", String(nextStep));
      navigate(TOUR_STEPS[nextStep].path);
    }
  }, [step, navigate, _endTour]);

  const prev = useCallback(() => {
    const prevStep = Math.max(0, step - 1);
    setStep(prevStep);
    sessionStorage.setItem("ea_tour_step", String(prevStep));
    navigate(TOUR_STEPS[prevStep].path);
  }, [step, navigate]);

  const skip = useCallback(() => {
    _endTour(true);
  }, [_endTour]);

  const dismissPostTour = useCallback(() => setShowPostTour(false), []);

  const goToStep = useCallback((index) => {
    setStep(index);
    sessionStorage.setItem("ea_tour_step", String(index));
    navigate(TOUR_STEPS[index].path);
  }, [navigate]);

  const triggerDemoGate = useCallback((feature) => {
    if (isDemo()) {
      setDemoGate({ feature });
      return true;
    }
    return false;
  }, []);

  const closeDemoGate = useCallback(() => setDemoGate(null), []);

  return (
    <DemoTourContext.Provider value={{
      active,
      step,
      currentStep: TOUR_STEPS[step],
      steps: TOUR_STEPS,
      totalSteps: TOUR_STEPS.length,
      startTour,
      next,
      prev,
      skip,
      goToStep,
      demoGate,
      triggerDemoGate,
      closeDemoGate,
      showPostTour,
      dismissPostTour,
      isDemo: isDemo(),
    }}>
      {children}
    </DemoTourContext.Provider>
  );
}

export function useDemoTour() {
  return useContext(DemoTourContext);
}
