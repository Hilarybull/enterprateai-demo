import { useEffect } from "react";
import { Link } from "react-router-dom";
import logoUrl from "../enterprate-logo.png";

export default function TermsOfServicePage() {
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
            <Link to="/legal/privacy" className="hover:text-slate-700">Privacy Policy</Link>
            <Link to="/legal/disclaimer" className="hover:text-slate-700">Disclaimer</Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-14">
        <h1 className="mb-1 text-3xl font-bold text-slate-900">Terms of Service</h1>
        <p className="mb-1 text-sm text-slate-500">Effective date: 1st January 2026</p>
        <p className="mb-1 text-sm text-slate-500">Website: www.enterprate.ai</p>
        <p className="mb-1 text-sm text-slate-500">Company: Enterprate Limited</p>
        <p className="mb-10 text-sm text-slate-500">Contact email: <a href="mailto:admin@enterprate.ai" className="text-indigo-600 hover:underline">admin@enterprate.ai</a></p>

        <S title="1. Introduction">
          <p>These Terms of Service govern your access to and use of EnterprateAI, including our website, platform, software, tools, marketplace features, document generation features, decision intelligence tools, simulations, reports, and related services.</p>
          <p className="mt-2">By creating an account, accessing EnterprateAI, starting a trial, purchasing a subscription, or using any part of the platform, you agree to these Terms.</p>
          <p className="mt-2">If you do not agree to these Terms, you must not use EnterprateAI.</p>
        </S>

        <S title="2. About EnterprateAI">
          <p>EnterprateAI is a decision intelligence platform designed to help small businesses input business data once and use it to generate business plans, proposals, invoices, quotations, marketplace listings, simulations, risk insights, and growth opportunities.</p>
          <p className="mt-2">EnterprateAI may include features such as:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Business planning;</li>
            <li>Proposal generation;</li>
            <li>Sales letter generation;</li>
            <li>Invoice and quotation generation;</li>
            <li>Product, customer, and vendor records;</li>
            <li>Marketplace listings;</li>
            <li>RFQ-related workflows;</li>
            <li>Idea validation;</li>
            <li>Scenario simulation;</li>
            <li>Risk identification;</li>
            <li>Fragility Index;</li>
            <li>Adaptive Scenario Intelligence;</li>
            <li>AI-assisted narratives and reports.</li>
          </ul>
          <p className="mt-2">EnterprateAI is intended to support business decision-making. It does not replace professional advice.</p>
        </S>

        <S title="3. Who may use EnterprateAI">
          <p>You may use EnterprateAI if you are legally able to enter into a binding agreement and you comply with these Terms.</p>
          <p className="mt-2">If you use EnterprateAI on behalf of a company, organisation, or other legal entity, you confirm that you have authority to accept these Terms on behalf of that entity.</p>
          <p className="mt-2">You must not use EnterprateAI if you are prohibited from doing so under applicable law.</p>
        </S>

        <S title="4. Account registration">
          <p>To use certain features, you may need to create an account.</p>
          <p className="mt-2">You agree to provide accurate, current, and complete information when registering and to keep your account details updated.</p>
          <p className="mt-2">You are responsible for maintaining the confidentiality of your login details and for all activity under your account.</p>
          <p className="mt-2">You must notify us immediately if you suspect unauthorised access to your account.</p>
        </S>

        <S title="5. Free trial">
          <p>We may offer a free trial, including a 14-day free trial, to eligible users.</p>
          <p className="mt-2">Trial access may be limited by time, features, usage volume, or plan type.</p>
          <p className="mt-2">At the end of a trial, access may stop unless you choose a paid plan.</p>
          <p className="mt-2">If payment details are required before a trial starts, we will explain whether the trial automatically converts into a paid subscription and how to cancel before being charged.</p>
          <p className="mt-2">We reserve the right to amend, withdraw, or refuse trial access where we reasonably suspect misuse, duplicate accounts, fraud, or abuse of the trial offer.</p>
        </S>

        <S title="6. Subscription plans and payment">
          <p>Some features of EnterprateAI may require a paid subscription.</p>
          <p className="mt-2">Subscription fees, billing periods, plan features, limits, and renewal terms will be shown on the pricing page or checkout page before purchase.</p>
          <p className="mt-2">By purchasing a subscription, you authorise us or our payment provider to charge the applicable fees.</p>
          <p className="mt-2">Unless otherwise stated, subscriptions renew automatically until cancelled.</p>
          <p className="mt-2">You are responsible for ensuring your billing details are accurate and up to date.</p>
          <p className="mt-2">If payment fails, we may suspend or restrict access to paid features until payment is received.</p>
        </S>

        <S title="7. Cancellations">
          <p>You may cancel your subscription through your account settings, billing portal, or by contacting us at <a href="mailto:support@enterprate.ai" className="text-indigo-600 hover:underline">support@enterprate.ai</a>.</p>
          <p className="mt-2">Cancellation will usually take effect at the end of the current billing period unless otherwise stated.</p>
          <p className="mt-2">You will continue to have access to paid features until the end of the paid billing period, unless your access is suspended for breach of these Terms.</p>
        </S>

        <S title="8. Refunds">
          <p>Unless required by law or expressly stated otherwise, subscription payments are non-refundable once a billing period has started.</p>
          <p className="mt-2">If you believe you have been charged in error, contact us at <a href="mailto:support@enterprate.ai" className="text-indigo-600 hover:underline">support@enterprate.ai</a>.</p>
          <p className="mt-2">Where consumer cancellation rights apply, we will comply with applicable law.</p>
        </S>

        <S title="9. Use of the platform">
          <p>You agree to use EnterprateAI only for lawful business purposes and in accordance with these Terms.</p>
          <p className="mt-2">You must not:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Use EnterprateAI for illegal, fraudulent, harmful, misleading, or abusive activity;</li>
            <li>Attempt to gain unauthorised access to the platform or other users' accounts;</li>
            <li>Interfere with the security, availability, or performance of the platform;</li>
            <li>Upload malicious code, viruses, or harmful files;</li>
            <li>Copy, scrape, reverse engineer, or misuse the platform;</li>
            <li>Use the platform to infringe the rights of others;</li>
            <li>Upload data you do not have permission to use;</li>
            <li>Use generated outputs to mislead customers, investors, regulators, or third parties;</li>
            <li>Resell, sublicense, or commercially exploit EnterprateAI without written permission.</li>
          </ul>
          <p className="mt-2">We may suspend or terminate access if we reasonably believe you have breached these Terms.</p>
        </S>

        <S title="10. User data and responsibility">
          <p>You are responsible for the business data, customer data, vendor data, financial data, operational data, documents, prompts, files, text, listings, and other content you input into EnterprateAI.</p>
          <p className="mt-2">You confirm that you have the necessary rights, permissions, and lawful basis to upload, process, and use any data you provide through the platform.</p>
          <p className="mt-2">You are responsible for reviewing and verifying any output generated by EnterprateAI before using it.</p>
        </S>

        <S title="11. Customer, vendor, and third-party data">
          <p>If you upload or input personal data relating to customers, suppliers, contacts, employees, contractors, or other third parties, you are responsible for ensuring that your use of that data complies with applicable data protection laws.</p>
          <p className="mt-2">You must not upload sensitive, unlawful, confidential, or third-party data unless you have the right to do so.</p>
          <p className="mt-2">Our handling of personal data is explained in our <Link to="/legal/privacy" className="text-indigo-600 hover:underline">Privacy Policy</Link>.</p>
        </S>

        <S title="12. AI-assisted outputs and decision intelligence">
          <p>EnterprateAI may use structured rules, calculations, data models, AI-assisted features, and decision intelligence logic to generate outputs.</p>
          <p className="mt-2">Outputs may include business plans, proposals, quotations, invoices, simulations, risk indicators, recommendations, insights, reports, and written narratives.</p>
          <p className="mt-2">You understand and agree that:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Outputs may not always be complete, accurate, current, or suitable for your specific circumstances;</li>
            <li>Outputs should be reviewed before use;</li>
            <li>Outputs are decision-support tools only;</li>
            <li>You remain responsible for all business decisions made using the platform;</li>
            <li>You should obtain professional advice where appropriate.</li>
          </ul>
        </S>

        <S title="13. No professional advice">
          <p>EnterprateAI does not provide legal, tax, accounting, financial, investment, immigration, regulatory, or professional advice.</p>
          <p className="mt-2">Any content, report, recommendation, simulation, or output generated by EnterprateAI is provided for general business decision-support purposes only.</p>
          <p className="mt-2">You should consult a qualified professional before making decisions that may have legal, financial, tax, regulatory, employment, investment, or compliance consequences.</p>
        </S>

        <S title="14. Simulations and risk insights">
          <p>Scenario simulations, risk insights, Fragility Index outputs, Adaptive Scenario Intelligence, viability scores, survival scores, stability scores, growth scores, and related outputs are based on the information provided by the user and the assumptions used by the platform.</p>
          <p className="mt-2">They are not guarantees of future performance, profitability, viability, funding success, sales, customer behaviour, or business outcomes.</p>
          <p className="mt-2">Actual results may differ due to market conditions, execution, customer behaviour, competition, regulation, cost changes, data quality, and other factors outside our control.</p>
        </S>

        <S title="15. Marketplace features">
          <p>EnterprateAI may allow users to publish products, services, business profiles, or marketplace listings.</p>
          <p className="mt-2">If you publish a listing, you are responsible for ensuring that the listing is accurate, lawful, complete, and not misleading.</p>
          <p className="mt-2">We do not guarantee that marketplace listings will generate leads, sales, enquiries, RFQs, visibility, revenue, or business opportunities.</p>
          <p className="mt-2">We may remove, hide, reject, or moderate listings that breach these Terms, appear misleading, infringe rights, or create risk for the platform or users.</p>
        </S>

        <S title="16. Invoices, quotations, contracts, and documents">
          <p>EnterprateAI may help generate invoices, quotations, contracts, proposals, business plans, sales letters, and other documents.</p>
          <p className="mt-2">You are responsible for reviewing all documents before sending, signing, publishing, submitting, or relying on them.</p>
          <p className="mt-2">Generated documents may require professional review and may not be suitable for all legal, tax, accounting, commercial, or regulatory purposes.</p>
          <p className="mt-2">We are not responsible for errors caused by incorrect user input, incomplete information, or failure to review outputs.</p>
        </S>

        <S title="17. User content ownership">
          <p>You retain ownership of the business data, documents, prompts, files, listings, and content you submit to EnterprateAI.</p>
          <p className="mt-2">By using the platform, you grant Enterprate Limited a limited licence to host, store, process, transmit, display, and use your content only as necessary to provide, maintain, secure, and improve the service, comply with law, and support your use of the platform.</p>
          <p className="mt-2">We do not claim ownership of your business data.</p>
        </S>

        <S title="18. EnterprateAI intellectual property">
          <p>EnterprateAI, including the platform, software, interface, workflows, designs, databases, models, engines, scoring logic, algorithms, text, graphics, trademarks, branding, and other materials, is owned by or licensed to Enterprate Limited.</p>
          <p className="mt-2">You must not copy, reproduce, modify, distribute, sell, lease, reverse engineer, or create derivative works from EnterprateAI except as permitted by law or with our written permission.</p>
        </S>

        <S title="19. Feedback">
          <p>If you provide feedback, suggestions, ideas, or recommendations about EnterprateAI, you allow us to use them without restriction or payment to you. This helps us improve the platform.</p>
        </S>

        <S title="20. Availability and changes to the service">
          <p>We aim to provide a reliable service, but we do not guarantee that EnterprateAI will always be available, uninterrupted, secure, or error-free.</p>
          <p className="mt-2">We may update, modify, suspend, remove, or discontinue features from time to time. We may perform maintenance, introduce improvements, or change functionality where necessary.</p>
        </S>

        <S title="21. Third-party services and integrations">
          <p>EnterprateAI may integrate with or link to third-party services, including payment processors, analytics tools, email providers, accounting tools, CRM tools, hosting providers, or other business systems.</p>
          <p className="mt-2">Your use of third-party services may be subject to separate terms and privacy policies.</p>
          <p className="mt-2">We are not responsible for third-party services, outages, errors, data handling, or content.</p>
        </S>

        <S title="22. Data protection">
          <p>Our processing of personal data is governed by our <Link to="/legal/privacy" className="text-indigo-600 hover:underline">Privacy Policy</Link>.</p>
          <p className="mt-2">By using EnterprateAI, you acknowledge that we may process personal data in accordance with our Privacy Policy.</p>
          <p className="mt-2">You are responsible for ensuring that any personal data you upload or input into the platform is collected and used lawfully.</p>
        </S>

        <S title="23. Confidentiality">
          <p>Each party may receive confidential information from the other.</p>
          <p className="mt-2">You agree not to disclose confidential information obtained through EnterprateAI except where permitted by law or with permission.</p>
          <p className="mt-2">We will take reasonable steps to protect your confidential business information, subject to our Privacy Policy and these Terms.</p>
        </S>

        <S title="24. Security">
          <p>We use reasonable technical and organisational measures to protect the platform. However, no online service can be guaranteed completely secure.</p>
          <p className="mt-2">You are responsible for using strong passwords, protecting access credentials, managing authorised users, and notifying us of suspected security incidents.</p>
        </S>

        <S title="25. Suspension and termination">
          <p>We may suspend or terminate your account or access to EnterprateAI if:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>You breach these Terms;</li>
            <li>Payment is overdue;</li>
            <li>Your use creates legal, security, operational, or reputational risk;</li>
            <li>We suspect fraud, misuse, or unauthorised activity;</li>
            <li>We are required to do so by law;</li>
            <li>We discontinue the service.</li>
          </ul>
          <p className="mt-2">You may stop using EnterprateAI at any time. Termination does not affect any rights or obligations that arose before termination.</p>
        </S>

        <S title="26. Data after termination">
          <p>After your account is closed or terminated, we may delete, archive, or retain data in accordance with our Privacy Policy, legal obligations, backup processes, and legitimate business needs.</p>
          <p className="mt-2">You should export or download any important data before closing your account where export functionality is available.</p>
        </S>

        <S title="27. Disclaimers">
          <p>EnterprateAI is provided on an "as is" and "as available" basis.</p>
          <p className="mt-2">We do not guarantee that:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>The platform will meet all your requirements;</li>
            <li>Outputs will be accurate, complete, current, or suitable;</li>
            <li>Simulations will predict actual outcomes;</li>
            <li>Risk scores will identify every risk;</li>
            <li>Marketplace listings will generate sales or enquiries;</li>
            <li>Documents will be legally or commercially sufficient;</li>
            <li>The platform will be uninterrupted, secure, or error-free.</li>
          </ul>
          <p className="mt-2">Nothing in these Terms excludes liability where it would be unlawful to do so.</p>
        </S>

        <S title="28. Limitation of liability">
          <p>To the maximum extent permitted by law, Enterprate Limited will not be liable for:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Loss of profits;</li>
            <li>Loss of revenue;</li>
            <li>Loss of business;</li>
            <li>Loss of goodwill;</li>
            <li>Loss of opportunity;</li>
            <li>Loss of anticipated savings;</li>
            <li>Loss or corruption of data;</li>
            <li>Indirect or consequential loss;</li>
            <li>Decisions made based on platform outputs;</li>
            <li>Third-party actions or services.</li>
          </ul>
          <p className="mt-2">Our total liability arising out of or relating to the service will be limited to the amount you paid to us for the service in the 12 months before the claim arose, unless the law requires otherwise.</p>
          <p className="mt-2">Nothing in these Terms limits or excludes liability for death or personal injury caused by negligence, fraud, fraudulent misrepresentation, or any liability that cannot legally be limited or excluded.</p>
        </S>

        <S title="29. Indemnity">
          <p>You agree to indemnify and hold Enterprate Limited harmless from claims, losses, damages, liabilities, costs, and expenses arising from:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Your breach of these Terms;</li>
            <li>Your misuse of EnterprateAI;</li>
            <li>Content or data you upload;</li>
            <li>Your infringement of third-party rights;</li>
            <li>Your unlawful use of customer, vendor, employee, or third-party data;</li>
            <li>Your use of outputs in a misleading, unlawful, or harmful way.</li>
          </ul>
        </S>

        <S title="30. Changes to these Terms">
          <p>We may update these Terms from time to time. Where changes are material, we will take reasonable steps to notify users, such as by email, platform notice, or website update.</p>
          <p className="mt-2">The updated Terms will apply from the effective date shown. If you continue using EnterprateAI after the updated Terms take effect, you agree to the updated Terms.</p>
        </S>

        <S title="31. Governing law and jurisdiction">
          <p>These Terms are governed by the laws of England and Wales.</p>
          <p className="mt-2">The courts of England and Wales will have exclusive jurisdiction over disputes arising from or relating to these Terms, unless applicable consumer law gives you the right to bring proceedings elsewhere.</p>
        </S>

        <S title="32. Contact us">
          <p>If you have questions about these Terms, contact us at:</p>
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
        <Link to="/legal/privacy" className="hover:underline">Privacy Policy</Link>&nbsp;·&nbsp;
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
