import { useEffect } from "react";
import { Link } from "react-router-dom";
import logoUrl from "../enterprate-logo.png";

export default function PrivacyPolicyPage() {
  useEffect(() => {
    document.body.style.overflow = "auto";
    return () => { document.body.style.overflow = ""; };
  }, []);

  return (
    <div className="min-h-screen bg-white text-slate-800">
      <header className="sticky top-0 z-50 border-b border-slate-100 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <Link to="/"><img src={logoUrl} alt="EnterprateAI" className="h-7 w-auto" /></Link>
          <div className="flex gap-4 text-sm text-slate-500">
            <Link to="/legal/terms" className="hover:text-slate-700">Terms of Service</Link>
            <Link to="/legal/disclaimer" className="hover:text-slate-700">Disclaimer</Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-14">
        <h1 className="mb-1 text-3xl font-bold text-slate-900">Privacy Policy</h1>
        <p className="mb-1 text-sm text-slate-500">Effective date: 1st January 2026</p>
        <p className="mb-1 text-sm text-slate-500">Website: www.enterprate.ai</p>
        <p className="mb-1 text-sm text-slate-500">Company: Enterprate Limited</p>
        <p className="mb-10 text-sm text-slate-500">Contact email: <a href="mailto:admin@enterprate.ai" className="text-indigo-600 hover:underline">admin@enterprate.ai</a></p>

        <S title="1. Introduction">
          <p>Enterprate Limited operates EnterprateAI, a decision intelligence platform designed to help small businesses input business data once and use it to generate business plans, proposals, quotations, invoices, marketplace listings, simulations, risk insights, and growth opportunities.</p>
          <p className="mt-2">This Privacy Policy explains how we collect, use, store, share, and protect personal data when you visit our website, join our waiting list, create an account, use EnterprateAI, contact us, or interact with our services.</p>
          <p className="mt-2">We are committed to handling personal data responsibly, transparently, and in accordance with applicable UK data protection laws, including the UK GDPR and the Data Protection Act 2018.</p>
        </S>

        <S title="2. Who we are">
          <p>EnterprateAI is operated by Enterprate Limited, a UK company.</p>
          <p className="mt-2">For data protection purposes, Enterprate Limited is the controller of personal data we collect and process in connection with our website, platform, marketing, customer support, account management, and business operations.</p>
          <p className="mt-2">You can contact us about this Privacy Policy or your data protection rights at: <a href="mailto:admin@enterprate.ai" className="text-indigo-600 hover:underline">admin@enterprate.ai</a></p>
        </S>

        <S title="3. Personal data we collect">
          <p className="mb-2">We may collect and process the following categories of personal data.</p>
          <p className="font-medium">Account and identity information</p>
          <p className="mt-1">This may include your name, business name, job title, email address, phone number, country, login details, and account preferences.</p>
          <p className="mt-3 font-medium">Business information</p>
          <p className="mt-1">This may include information about your business, products, services, customers, suppliers, pricing, revenue assumptions, cost assumptions, business plans, proposals, invoices, quotations, marketplace listings, and other business records you choose to enter into EnterprateAI.</p>
          <p className="mt-3 font-medium">Financial and operational information</p>
          <p className="mt-1">This may include business revenue, expenses, cashflow assumptions, cost structure, capacity information, customer concentration, vendor information, payment terms, contracts, and other information used to generate insights, simulations, reports, and recommendations.</p>
          <p className="mt-3 font-medium">Customer and vendor records</p>
          <p className="mt-1">If you use EnterprateAI to manage customer or vendor records, invoices, quotations, contracts, or marketplace activities, you may upload or input personal data relating to your customers, suppliers, contacts, or business partners. You are responsible for ensuring you have a lawful basis to upload or input such data into EnterprateAI.</p>
          <p className="mt-3 font-medium">Marketing and waiting list information</p>
          <p className="mt-1">If you join our waiting list, request early access, download content, complete a form, or subscribe to updates, we may collect your name, email address, business details, and communication preferences.</p>
          <p className="mt-3 font-medium">Payment and billing information</p>
          <p className="mt-1">If you purchase a paid plan, we may process billing details, subscription status, invoice details, payment references, and transaction records. Payment card details may be processed by our payment provider and not stored directly by us.</p>
          <p className="mt-3 font-medium">Technical and usage information</p>
          <p className="mt-1">We may collect information about how you access and use our website and platform, including IP address, browser type, device information, pages visited, features used, date and time of access, error logs, and usage analytics.</p>
          <p className="mt-3 font-medium">Communications information</p>
          <p className="mt-1">If you contact us by email, form, chat, phone, social media, or other channels, we may collect your contact details and the content of your communication.</p>
        </S>

        <S title="4. How we collect personal data">
          <p>We collect personal data when:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>You visit our website;</li>
            <li>You join our waiting list;</li>
            <li>You create an account;</li>
            <li>You use EnterprateAI;</li>
            <li>You input business, customer, vendor, financial, or operational data;</li>
            <li>You request a trial, demo, or subscription;</li>
            <li>You contact us;</li>
            <li>You respond to surveys or feedback requests;</li>
            <li>You interact with our emails, adverts, or social media pages;</li>
            <li>Our systems automatically collect usage and technical data.</li>
          </ul>
          <p className="mt-2">We may also receive data from third-party tools or integrations where you choose to connect them to EnterprateAI.</p>
        </S>

        <S title="5. How we use personal data">
          <p>We use personal data to:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Provide access to EnterprateAI;</li>
            <li>Create and manage user accounts;</li>
            <li>Generate business plans, proposals, invoices, quotations, reports, simulations, and insights;</li>
            <li>Provide decision intelligence, risk analysis, fragility insights, and growth recommendations;</li>
            <li>Manage marketplace listings and related workflows;</li>
            <li>Process subscriptions, payments, billing, and account administration;</li>
            <li>Provide customer support;</li>
            <li>Improve our platform, features, security, and user experience;</li>
            <li>Communicate service updates, product changes, and important notices;</li>
            <li>Send marketing communications where permitted;</li>
            <li>Invite waiting list users to trials or early access;</li>
            <li>Monitor performance, usage, errors, and security;</li>
            <li>Prevent fraud, misuse, unauthorised access, or illegal activity;</li>
            <li>Comply with legal, tax, accounting, regulatory, and contractual obligations.</li>
          </ul>
        </S>

        <S title="6. Our lawful basis for processing">
          <p className="font-medium">Contract</p>
          <p className="mt-1">We process personal data where necessary to provide EnterprateAI, manage your account, deliver platform features, provide support, and administer subscriptions.</p>
          <p className="mt-3 font-medium">Legitimate interests</p>
          <p className="mt-1">We may process personal data for our legitimate business interests, including improving our service, securing our platform, responding to enquiries, managing business relationships, understanding usage, developing new features, and contacting business users about relevant services. Where we rely on legitimate interests, we balance our interests against your rights and freedoms.</p>
          <p className="mt-3 font-medium">Consent</p>
          <p className="mt-1">We rely on consent where required, including for certain marketing communications, optional cookies, analytics, or where you have clearly opted in to receive updates. You can withdraw consent at any time.</p>
          <p className="mt-3 font-medium">Legal obligation</p>
          <p className="mt-1">We may process personal data where necessary to comply with legal obligations, including tax, accounting, regulatory, security, and data protection obligations.</p>
        </S>

        <S title="7. Marketing communications">
          <p>If you join our waiting list, request updates, download resources, or sign up for early access, we may contact you about EnterprateAI, including product updates, trial invitations, launch announcements, and relevant offers.</p>
          <p className="mt-2">You can opt out of marketing communications at any time by clicking the unsubscribe link in our emails or contacting us at <a href="mailto:admin@enterprate.ai" className="text-indigo-600 hover:underline">admin@enterprate.ai</a>.</p>
          <p className="mt-2">We will not sell your personal data to third parties for marketing purposes.</p>
        </S>

        <S title="8. Cookies and similar technologies">
          <p>Our website may use cookies and similar technologies to operate the website, remember preferences, understand usage, improve performance, and support marketing or analytics.</p>
          <p className="mt-2">Some cookies are necessary for the website to work. Others, such as analytics or marketing cookies, may require your consent.</p>
          <p className="mt-2">You can manage cookies through your browser settings or our cookie banner where available.</p>
        </S>

        <S title="9. AI, automation, and decision intelligence">
          <p>EnterprateAI may use structured rules, deterministic calculations, analytics, and AI-assisted features to generate outputs such as business plans, proposals, simulations, risk insights, recommendations, and reports.</p>
          <p className="mt-2">These outputs are designed to support decision-making, not replace human judgement. We do not intend EnterprateAI outputs to be treated as legal, financial, tax, investment, accounting, or professional advice. Users remain responsible for reviewing outputs before relying on them.</p>
        </S>

        <S title="10. Sharing personal data">
          <p>We may share personal data with trusted service providers who help us operate EnterprateAI and our business, including:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Hosting and cloud infrastructure providers;</li>
            <li>Database and storage providers;</li>
            <li>Payment processors;</li>
            <li>Email and communication providers;</li>
            <li>Analytics and monitoring providers;</li>
            <li>Customer support tools;</li>
            <li>Security and fraud-prevention providers;</li>
            <li>Professional advisers, such as accountants, lawyers, or auditors;</li>
            <li>Regulators, public authorities, or law enforcement where legally required.</li>
          </ul>
          <p className="mt-2">We require service providers to handle personal data securely and only for agreed purposes. We do not sell personal data.</p>
        </S>

        <S title="11. International transfers">
          <p>Some of our service providers may process personal data outside the United Kingdom. Where personal data is transferred internationally, we will take appropriate steps to protect it, such as using recognised safeguards, adequacy regulations, standard contractual clauses, or other lawful transfer mechanisms where required.</p>
        </S>

        <S title="12. How long we keep personal data">
          <p>We keep personal data only for as long as reasonably necessary for the purposes described in this Privacy Policy. Typical retention periods may include:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Account data: for as long as your account remains active and for a reasonable period afterwards;</li>
            <li>Billing and transaction records: generally up to 6 years for tax and accounting purposes;</li>
            <li>Support messages: for as long as needed to manage enquiries and improve service;</li>
            <li>Waiting list and marketing data: until you unsubscribe or we no longer need it;</li>
            <li>Platform usage records: for a reasonable period for security, analytics, and service improvement;</li>
            <li>Business records entered into the platform: for as long as your account remains active, unless deleted earlier.</li>
          </ul>
          <p className="mt-2">We may retain limited records where necessary to comply with legal obligations, resolve disputes, enforce agreements, prevent fraud, or maintain suppression lists for marketing opt-outs.</p>
        </S>

        <S title="13. Data security">
          <p>We take reasonable technical and organisational measures to protect personal data against unauthorised access, loss, misuse, alteration, disclosure, or destruction. These measures may include access controls, authentication, encryption where appropriate, secure hosting, monitoring, backups, and internal data handling controls.</p>
          <p className="mt-2">However, no system can be guaranteed to be completely secure. Users are responsible for keeping login details confidential and notifying us of any suspected unauthorised access.</p>
        </S>

        <S title="14. Your data protection rights">
          <p>Depending on the circumstances, you may have the right to:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Access the personal data we hold about you;</li>
            <li>Request correction of inaccurate or incomplete data;</li>
            <li>Request deletion of your personal data;</li>
            <li>Request restriction of processing;</li>
            <li>Object to processing based on legitimate interests;</li>
            <li>Withdraw consent where processing is based on consent;</li>
            <li>Request data portability;</li>
            <li>Object to direct marketing;</li>
            <li>Complain to the UK Information Commissioner's Office.</li>
          </ul>
          <p className="mt-2">To exercise your rights, contact us at <a href="mailto:admin@enterprate.ai" className="text-indigo-600 hover:underline">admin@enterprate.ai</a>. We may need to verify your identity before responding to your request.</p>
        </S>

        <S title="15. Complaints">
          <p>If you have concerns about how we handle your personal data, please contact us first so we can try to resolve the matter.</p>
          <p className="mt-2">You also have the right to complain to the UK Information Commissioner's Office: <a href="https://www.ico.org.uk" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">www.ico.org.uk</a></p>
        </S>

        <S title="16. Children's privacy">
          <p>EnterprateAI is intended for business users and is not directed at children. We do not knowingly collect personal data from children. If we become aware that we have collected personal data from a child without appropriate authority, we will take steps to delete it.</p>
        </S>

        <S title="17. Third-party links">
          <p>Our website or platform may contain links to third-party websites, tools, or services. We are not responsible for the privacy practices, content, or security of third-party websites. You should review the privacy policies of any third-party services you use.</p>
        </S>

        <S title="18. Changes to this Privacy Policy">
          <p>We may update this Privacy Policy from time to time to reflect changes in our services, legal obligations, technology, or business operations. The updated version will be posted on our website with a revised effective date.</p>
        </S>

        <S title="19. Contact us">
          <p>For questions about this Privacy Policy or how we handle personal data, contact:</p>
          <p className="mt-2">
            Enterprate Limited<br />
            London, United Kingdom<br />
            Email: <a href="mailto:admin@enterprate.ai" className="text-indigo-600 hover:underline">admin@enterprate.ai</a><br />
            Website: <a href="https://www.enterprate.ai" className="text-indigo-600 hover:underline">www.enterprate.ai</a>
          </p>
        </S>
      </main>

      <footer className="border-t border-slate-100 px-6 py-6 text-center text-xs text-slate-400">
        © {new Date().getFullYear()} Enterprate Limited. All rights reserved.&nbsp;·&nbsp;
        <Link to="/legal/terms" className="hover:underline">Terms of Service</Link>&nbsp;·&nbsp;
        <Link to="/legal/disclaimer" className="hover:underline">Disclaimer</Link>
      </footer>
    </div>
  );
}

function S({ title, children }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-lg font-semibold text-slate-900">{title}</h2>
      <div className="text-sm leading-relaxed text-slate-600">{children}</div>
    </section>
  );
}
