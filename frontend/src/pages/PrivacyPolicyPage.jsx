import { Link } from "react-router-dom";

const EFFECTIVE_DATE = "8 July 2026";
const COMPANY = "Enterprate AI Ltd";
const EMAIL = "legal@enterprate.ai";
const SITE = "https://enterprate.ai";

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-white text-slate-800">
      {/* Nav */}
      <header className="border-b border-slate-100 px-6 py-4">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <Link to="/" className="text-lg font-bold tracking-tight text-slate-900">
            EnterprateAI
          </Link>
          <Link to="/legal/terms" className="text-sm text-slate-500 hover:text-slate-700">
            Terms of Service →
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-14">
        <h1 className="mb-2 text-3xl font-bold text-slate-900">Privacy Policy</h1>
        <p className="mb-10 text-sm text-slate-500">Effective date: {EFFECTIVE_DATE}</p>

        <Section title="1. Who we are">
          <p>
            {COMPANY} ("Enterprate", "we", "us", "our") operates the EnterprateAI platform available
            at {SITE}. We are committed to protecting your personal data and complying with applicable
            data-protection law, including the UK GDPR and the Data Protection Act 2018.
          </p>
          <p className="mt-2">
            Questions? Email us at <a href={`mailto:${EMAIL}`} className="text-indigo-600 hover:underline">{EMAIL}</a>.
          </p>
        </Section>

        <Section title="2. Data we collect">
          <ul className="list-disc space-y-1 pl-5">
            <li><strong>Account data</strong> — name, email address, password (hashed), and company details you provide on sign-up.</li>
            <li><strong>Usage data</strong> — pages visited, features used, timestamps, and IP address, collected automatically.</li>
            <li><strong>Business data</strong> — invoices, expenses, catalogue entries, validation inputs, and simulation parameters you enter into the platform.</li>
            <li><strong>Integration data</strong> — OAuth tokens for third-party services (QuickBooks, Xero, Zoho CRM) you choose to connect. We store only the tokens needed to sync data; we do not store your third-party account credentials.</li>
            <li><strong>Payment data</strong> — processed by Stripe. We do not store full card numbers.</li>
            <li><strong>Communications</strong> — emails or support messages you send us.</li>
          </ul>
        </Section>

        <Section title="3. How we use your data">
          <ul className="list-disc space-y-1 pl-5">
            <li>To provide, operate, and improve the EnterprateAI platform.</li>
            <li>To generate AI-powered insights, validations, and simulations based on the data you provide.</li>
            <li>To sync data with third-party services at your direction (QuickBooks, Xero, Zoho CRM).</li>
            <li>To send transactional emails (account confirmation, invoices, alerts).</li>
            <li>To detect and prevent fraud, abuse, and security incidents.</li>
            <li>To comply with legal obligations.</li>
          </ul>
        </Section>

        <Section title="4. Legal basis (UK GDPR)">
          <ul className="list-disc space-y-1 pl-5">
            <li><strong>Contract</strong> — processing necessary to deliver the service you signed up for.</li>
            <li><strong>Legitimate interests</strong> — security monitoring, product improvement, and fraud prevention.</li>
            <li><strong>Consent</strong> — where you have explicitly opted in (e.g. marketing emails).</li>
            <li><strong>Legal obligation</strong> — where we are required to retain or disclose data by law.</li>
          </ul>
        </Section>

        <Section title="5. Third-party integrations">
          <p>
            When you connect a third-party service (QuickBooks, Xero, Zoho CRM), we receive and store
            OAuth access and refresh tokens on your behalf. These tokens are used solely to perform
            sync operations you initiate. You can disconnect any integration at any time from the
            platform, which permanently deletes the stored tokens.
          </p>
        </Section>

        <Section title="6. Data sharing">
          <p>We do not sell your personal data. We share data only with:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li><strong>Sub-processors</strong> — cloud infrastructure (Supabase, MongoDB Atlas), payment processing (Stripe), email delivery (SendGrid), and AI inference (Anthropic, Google, OpenAI). Each is bound by a data-processing agreement.</li>
            <li><strong>Legal authorities</strong> — where required by law, court order, or to protect our rights.</li>
            <li><strong>Business transfers</strong> — in the event of a merger or acquisition, data may be transferred to the acquiring entity under equivalent protections.</li>
          </ul>
        </Section>

        <Section title="7. Data retention">
          <p>
            We retain your data for as long as your account is active or as needed to provide services.
            After account deletion, personal data is purged within 30 days unless retention is required
            by law. Business data you have synced to third-party services remains under the policies of
            those services.
          </p>
        </Section>

        <Section title="8. Your rights">
          <p>Under UK GDPR you have the right to:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Access the personal data we hold about you.</li>
            <li>Correct inaccurate data.</li>
            <li>Request erasure ("right to be forgotten").</li>
            <li>Restrict or object to processing.</li>
            <li>Data portability (receive your data in a machine-readable format).</li>
            <li>Withdraw consent at any time (where processing is based on consent).</li>
          </ul>
          <p className="mt-2">
            To exercise any right, email <a href={`mailto:${EMAIL}`} className="text-indigo-600 hover:underline">{EMAIL}</a>. We will respond within 30 days.
          </p>
        </Section>

        <Section title="9. Cookies">
          <p>
            We use session cookies to keep you signed in and local storage for authentication tokens.
            We do not use advertising or tracking cookies. You can clear cookies at any time through
            your browser settings.
          </p>
        </Section>

        <Section title="10. Security">
          <p>
            All data is transmitted over HTTPS. Sensitive credentials (API keys, OAuth tokens) are
            stored encrypted at rest. We follow industry-standard security practices and conduct
            regular reviews.
          </p>
        </Section>

        <Section title="11. Changes to this policy">
          <p>
            We may update this policy from time to time. When we do, we will update the effective date
            above and notify you by email if the changes are material.
          </p>
        </Section>

        <Section title="12. Contact">
          <p>
            {COMPANY}<br />
            Email: <a href={`mailto:${EMAIL}`} className="text-indigo-600 hover:underline">{EMAIL}</a><br />
            Website: <a href={SITE} className="text-indigo-600 hover:underline">{SITE}</a>
          </p>
        </Section>
      </main>

      <footer className="border-t border-slate-100 px-6 py-6 text-center text-xs text-slate-400">
        © {new Date().getFullYear()} {COMPANY}. All rights reserved. &nbsp;·&nbsp;
        <Link to="/legal/terms" className="hover:underline">Terms of Service</Link>
      </footer>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-lg font-semibold text-slate-900">{title}</h2>
      <div className="text-sm leading-relaxed text-slate-600">{children}</div>
    </section>
  );
}
