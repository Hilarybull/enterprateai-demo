import { Link } from "react-router-dom";
import logoUrl from "../enterprate-logo.png";
import { useAuthStore } from "../store/auth";
import "./essentials.css";

// The CTAs land on Financials (quotations, contracts, invoices, receipts).
const OPS_PATH = "/financials";
const SIGNUP_PATH = `/login?signup=1&next=${encodeURIComponent(OPS_PATH)}`;

const STEPS = [
  { n: "01", title: "Create a quotation", body: "Add the customer, service and price once. Your information is ready for the next document." },
  { n: "02", title: "Convert, don’t retype", body: "Turn the quotation into a contract or invoice while keeping the important details in place." },
  { n: "03", title: "Close the loop", body: "When the invoice is paid, create the receipt and keep a clear record of the transaction." },
];

const TOOLS = [
  { k: "Q", title: "Sales quotations", body: "Send clear, professional prices to prospective customers." },
  { k: "C", title: "Contracts", body: "Turn agreed work into a structured business document." },
  { k: "I", title: "Invoices", body: "Bill customers using details already captured." },
  { k: "R", title: "Receipts", body: "Confirm payments and complete the document trail." },
  { k: "M", title: "Marketplace", body: "Showcase your services and improve your visibility to customers." },
];

const SIGNALS = [
  { label: "Sales activity", value: "Connected" },
  { label: "Business records", value: "Organised" },
  { label: "Decision intelligence", value: "Ready to grow" },
];

function DocIcon() {
  return (
    <svg className="ess-doc" viewBox="0 0 36 41" width="36" height="41" aria-hidden="true">
      <rect x="1.25" y="1.25" width="33.5" height="38.5" rx="5" fill="#f8faff" stroke="#1f6ae0" strokeWidth="2.5" />
      <rect x="9" y="13" width="18.5" height="2.5" rx="1.25" fill="#dc3f52" />
      <rect x="9" y="20" width="18.5" height="2.5" rx="1.25" fill="#c1cde1" />
      <rect x="9" y="27" width="18.5" height="2.5" rx="1.25" fill="#c1cde1" />
    </svg>
  );
}

function FlowArrow() {
  return (
    <svg className="ess-mock-arrow" viewBox="0 0 26 12" width="26" height="12" aria-hidden="true">
      <path d="M1 6h23.5M19.2 1.4 24.6 6l-5.4 4.6" fill="none" stroke="#5fa3f7" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Eyebrow({ children }) {
  return (
    <div className="ess-eyebrow">
      <span className="ess-eyebrow-dash" />
      <span>{children}</span>
    </div>
  );
}

export default function EssentialsPage() {
  const token = useAuthStore((s) => s.token);
  const ctaPath = token ? OPS_PATH : SIGNUP_PATH;

  function scrollToWorkflow(e) {
    e.preventDefault();
    document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="ess">
      <header className="ess-header">
        <div className="ess-container ess-header-inner">
          <Link to="/" aria-label="EnterprateAI home">
            <img src={logoUrl} alt="EnterprateAI" className="ess-logo" />
          </Link>
          <Link to={ctaPath} className="ess-btn ess-btn-primary ess-btn-header">
            Start using it free
          </Link>
        </div>
      </header>

      <section className="ess-hero">
        <div className="ess-ring" aria-hidden="true" />
        <div className="ess-container ess-hero-grid">
          <div className="ess-hero-copy">
            <Eyebrow>Essential business tools</Eyebrow>
            <h1 className="ess-h1">
              Stop paying for the basics. Start running your business
              <span className="ess-h1-accent">
                <span className="ess-h1-accent-text">for free.</span>
              </span>
            </h1>
            <p className="ess-lead">
              Create sales quotations, contracts, invoices and receipts, then reuse the same customer and pricing data
              instead of entering it again and again.
            </p>
            <div className="ess-hero-actions">
              <Link to={ctaPath} className="ess-btn ess-btn-primary">
                Create your free account
              </Link>
              <a href="#how-it-works" onClick={scrollToWorkflow} className="ess-btn ess-btn-secondary">
                See how it works
              </a>
            </div>
            <p className="ess-hero-note">
              <strong>Free essential tools</strong> for small businesses, freelancers and service providers.
            </p>
          </div>

          <div className="ess-mock-wrap">
            <div className="ess-mock">
              <div className="ess-mock-head">
                <div className="ess-mock-title">Your business documents, connected</div>
                <div className="ess-pill">Free to use</div>
              </div>
              <div className="ess-mock-grid">
                <div className="ess-doc-card">
                  <DocIcon />
                  <div className="ess-doc-title">Sales quotation</div>
                  <div className="ess-doc-sub">Create once</div>
                </div>
                <FlowArrow />
                <div className="ess-doc-card">
                  <DocIcon />
                  <div className="ess-doc-title">Invoice or contract</div>
                  <div className="ess-doc-sub">Convert in a few clicks</div>
                </div>
                <div className="ess-doc-card">
                  <DocIcon />
                  <div className="ess-doc-title">Paid invoice</div>
                  <div className="ess-doc-sub">Record payment</div>
                </div>
                <FlowArrow />
                <div className="ess-doc-card">
                  <DocIcon />
                  <div className="ess-doc-title">Receipt</div>
                  <div className="ess-doc-sub">Ready to share</div>
                </div>
              </div>
              <div className="ess-mock-note">
                <strong>Enter details once.</strong> Carry the same customer, product and pricing information through the
                workflow.
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="how-it-works" className="ess-section ess-workflow">
        <div className="ess-container">
          <Eyebrow>One simple workflow</Eyebrow>
          <h2 className="ess-h2">From first quote to final receipt</h2>
          <p className="ess-sub">Keep each customer journey connected, without rebuilding the same document from scratch.</p>
          <div className="ess-steps">
            {STEPS.map((s) => (
              <div key={s.n} className="ess-step">
                <span className="ess-step-n" aria-hidden="true">{s.n}</span>
                <h3 className="ess-step-title">{s.title}</h3>
                <p className="ess-step-body">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="ess-section ess-included">
        <div className="ess-container">
          <Eyebrow>Included free</Eyebrow>
          <h2 className="ess-h2">Everything you need to look professional</h2>
          <p className="ess-sub">Start with the essential tools your business uses every day.</p>
          <div className="ess-tools">
            {TOOLS.map((t) => (
              <div key={t.k} className="ess-tool">
                <span className="ess-tool-chip">{t.k}</span>
                <h3 className="ess-tool-title">{t.title}</h3>
                <p className="ess-tool-body">{t.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="ess-section ess-market">
        <div className="ess-container">
          <div className="ess-market-row">
            <div className="ess-profile-card">
              <div className="ess-profile-top">
                <span className="ess-avatar">SB</span>
                <div className="ess-profile-text">
                  <div className="ess-profile-name">Your business profile</div>
                  <div className="ess-profile-meta">Services • Portfolio • Contact</div>
                </div>
                <span className="ess-visible">Visible</span>
              </div>
              <div className="ess-profile-tiles">
                <div className="ess-tile">
                  <div className="ess-tile-big">1 profile</div>
                  <div className="ess-tile-small">to showcase your services</div>
                </div>
                <div className="ess-tile">
                  <div className="ess-tile-big">More reach</div>
                  <div className="ess-tile-small">through Marketplace visibility</div>
                </div>
              </div>
            </div>
            <div className="ess-market-copy">
              <Eyebrow>Beyond paperwork</Eyebrow>
              <h2 className="ess-h2">Use the Marketplace to be discovered</h2>
              <p className="ess-sub ess-market-sub">
                Create your business presence, showcase what you offer and make it easier for potential customers to find
                you, all within the same platform.
              </p>
              <Link to="/marketplace" className="ess-btn ess-btn-primary ess-btn-market">
                Join the Marketplace
              </Link>
            </div>
          </div>

          <div className="ess-grow">
            <div className="ess-grow-copy">
              <h2 className="ess-grow-title">Free tools today. Better business intelligence as you grow.</h2>
              <p className="ess-grow-body">
                EnterprateAI brings your business activity together so you can build a clearer picture of performance,
                risks and opportunities over time.
              </p>
            </div>
            <div className="ess-signals">
              {SIGNALS.map((s) => (
                <div key={s.label} className="ess-signal">
                  <span>{s.label}</span>
                  <strong>{s.value}</strong>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="ess-cta">
        <div className="ess-container ess-cta-inner">
          <h2 className="ess-cta-title">Save money. Save time. Run your business with less friction.</h2>
          <p className="ess-cta-sub">Start creating your essential business documents for free with EnterprateAI.</p>
          <Link to={ctaPath} className="ess-btn ess-btn-primary ess-btn-cta">
            Start free at EnterprateAI
          </Link>
        </div>
      </section>

      <footer className="ess-footer">
        <div className="ess-container ess-footer-inner">
          <span>© EnterprateAI. Business essentials, connected.</span>
          <span className="ess-footer-url">www.enterprate.ai</span>
        </div>
      </footer>
    </div>
  );
}
