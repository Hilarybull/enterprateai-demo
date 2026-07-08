import { Link } from "react-router-dom";

const EFFECTIVE_DATE = "8 July 2026";
const COMPANY = "Enterprate AI Ltd";
const EMAIL = "legal@enterprate.ai";
const SITE = "https://enterprate.ai";

export default function TermsOfServicePage() {
  return (
    <div className="min-h-screen bg-white text-slate-800">
      {/* Nav */}
      <header className="border-b border-slate-100 px-6 py-4">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <Link to="/" className="text-lg font-bold tracking-tight text-slate-900">
            EnterprateAI
          </Link>
          <Link to="/legal/privacy" className="text-sm text-slate-500 hover:text-slate-700">
            Privacy Policy →
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-14">
        <h1 className="mb-2 text-3xl font-bold text-slate-900">Terms of Service</h1>
        <p className="mb-10 text-sm text-slate-500">Effective date: {EFFECTIVE_DATE}</p>

        <Section title="1. Acceptance of terms">
          <p>
            By creating an account or using the EnterprateAI platform ("Service"), you agree to be
            bound by these Terms of Service ("Terms"). If you do not agree, do not use the Service.
            These Terms form a legally binding agreement between you and {COMPANY} ("Enterprate", "we",
            "us", "our").
          </p>
        </Section>

        <Section title="2. Description of service">
          <p>
            EnterprateAI is a business-intelligence and operations platform that provides tools for
            idea validation, financial modelling, simulation, catalogue management, invoicing, and
            third-party integrations. The Service includes AI-generated content produced on your
            behalf.
          </p>
        </Section>

        <Section title="3. Eligibility">
          <p>
            You must be at least 18 years old and have the authority to bind any organisation on
            whose behalf you use the Service. By agreeing to these Terms you represent that these
            conditions are met.
          </p>
        </Section>

        <Section title="4. Account responsibilities">
          <ul className="list-disc space-y-1 pl-5">
            <li>You are responsible for maintaining the confidentiality of your login credentials.</li>
            <li>You are responsible for all activity that occurs under your account.</li>
            <li>You must notify us immediately at <a href={`mailto:${EMAIL}`} className="text-indigo-600 hover:underline">{EMAIL}</a> if you suspect unauthorised access.</li>
            <li>You must provide accurate and complete information when registering.</li>
          </ul>
        </Section>

        <Section title="5. Acceptable use">
          <p>You agree not to:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Use the Service for any unlawful purpose or in violation of any regulations.</li>
            <li>Upload or transmit malicious code, viruses, or harmful data.</li>
            <li>Attempt to gain unauthorised access to any part of the Service or its infrastructure.</li>
            <li>Reverse-engineer, decompile, or disassemble any component of the Service.</li>
            <li>Resell, sublicense, or otherwise commercialise access to the Service without our prior written consent.</li>
            <li>Use automated tools to scrape, crawl, or extract data from the Service.</li>
          </ul>
        </Section>

        <Section title="6. Third-party integrations">
          <p>
            The Service may allow you to connect third-party platforms such as QuickBooks, Xero, and
            Zoho CRM. By connecting a third-party service, you authorise EnterprateAI to access and
            transmit data on your behalf in accordance with that service's terms. We are not
            responsible for the availability, accuracy, or policies of third-party services.
          </p>
        </Section>

        <Section title="7. AI-generated content">
          <p>
            The Service uses artificial intelligence to generate insights, validations, simulations,
            and other outputs. AI-generated content is provided for informational purposes only and
            does not constitute financial, legal, investment, or professional advice. You should
            conduct your own due diligence before making business decisions based on any output from
            the Service.
          </p>
        </Section>

        <Section title="8. Subscription and billing">
          <p>
            Certain features require a paid subscription. Subscriptions are billed in advance on a
            monthly or annual basis. All fees are non-refundable except where required by law.
            Pricing may change with 30 days' notice. If you cancel, you retain access until the end
            of your current billing period.
          </p>
        </Section>

        <Section title="9. Intellectual property">
          <p>
            The Service, including its software, design, trademarks, and documentation, is owned by
            {" "}{COMPANY} and protected by applicable intellectual property laws. These Terms do not
            grant you any rights in the Service beyond the limited licence to use it as described
            herein.
          </p>
          <p className="mt-2">
            You retain ownership of all data and content you upload to the Service. By uploading
            content you grant us a limited licence to process and display it solely to provide the
            Service to you.
          </p>
        </Section>

        <Section title="10. Data and privacy">
          <p>
            Our collection and use of your personal data is governed by our{" "}
            <Link to="/legal/privacy" className="text-indigo-600 hover:underline">Privacy Policy</Link>,
            which is incorporated into these Terms by reference.
          </p>
        </Section>

        <Section title="11. Disclaimer of warranties">
          <p>
            The Service is provided "as is" and "as available" without warranties of any kind, express
            or implied, including but not limited to warranties of merchantability, fitness for a
            particular purpose, or non-infringement. We do not warrant that the Service will be
            uninterrupted, error-free, or that any defects will be corrected.
          </p>
        </Section>

        <Section title="12. Limitation of liability">
          <p>
            To the maximum extent permitted by applicable law, {COMPANY} shall not be liable for any
            indirect, incidental, special, consequential, or punitive damages, or loss of profits,
            data, or goodwill arising from your use of the Service. Our total liability to you shall
            not exceed the amount you paid to us in the 12 months preceding the claim.
          </p>
        </Section>

        <Section title="13. Indemnification">
          <p>
            You agree to indemnify and hold harmless {COMPANY} and its officers, directors, employees,
            and agents from any claims, liabilities, damages, and expenses (including reasonable legal
            fees) arising from your use of the Service, your violation of these Terms, or your
            infringement of any third-party rights.
          </p>
        </Section>

        <Section title="14. Termination">
          <p>
            We may suspend or terminate your account at any time if we believe you have violated these
            Terms or if we discontinue the Service. You may close your account at any time from your
            account settings. On termination, your right to use the Service ceases immediately.
          </p>
        </Section>

        <Section title="15. Governing law">
          <p>
            These Terms are governed by the laws of England and Wales. Any disputes shall be subject
            to the exclusive jurisdiction of the courts of England and Wales.
          </p>
        </Section>

        <Section title="16. Changes to these terms">
          <p>
            We may update these Terms from time to time. We will notify you of material changes by
            email or by posting a notice in the platform. Continued use of the Service after changes
            take effect constitutes acceptance of the revised Terms.
          </p>
        </Section>

        <Section title="17. Contact">
          <p>
            {COMPANY}<br />
            Email: <a href={`mailto:${EMAIL}`} className="text-indigo-600 hover:underline">{EMAIL}</a><br />
            Website: <a href={SITE} className="text-indigo-600 hover:underline">{SITE}</a>
          </p>
        </Section>
      </main>

      <footer className="border-t border-slate-100 px-6 py-6 text-center text-xs text-slate-400">
        © {new Date().getFullYear()} {COMPANY}. All rights reserved. &nbsp;·&nbsp;
        <Link to="/legal/privacy" className="hover:underline">Privacy Policy</Link>
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
