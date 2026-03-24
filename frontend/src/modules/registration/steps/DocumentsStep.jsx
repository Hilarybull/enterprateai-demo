import SectionCard from "../../../components/SectionCard";

export default function DocumentsStep({
  ackNotAgent,
  setAckNotAgent,
  ackSelfRegister,
  setAckSelfRegister,
  modelArticlesLink
}) {
  return (
    <SectionCard title="Documents & Requirements" subtitle="Everything you will need to complete registration on Companies House.">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="text-sm font-semibold text-slate-900">Required documents</div>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-700">
            <li>Photo ID for each director (passport or driving licence)</li>
            <li>Proof of address for each director (dated within 3 months)</li>
            <li>Your chosen company name (verified as available)</li>
            <li>Registered office address (UK physical address)</li>
            <li>Up to 4 SIC codes describing your activities</li>
            <li>Director details (name, DOB, nationality, occupation, addresses)</li>
            <li>Share structure (e.g., 100 ordinary shares at £1 each)</li>
          </ul>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="text-sm font-semibold text-slate-900">Articles of Association</div>
          <div className="mt-2 text-sm text-slate-700">
            This is your company’s rulebook. For most new companies, the standard Model Articles are recommended.
          </div>
          <a className="mt-3 inline-flex text-sm font-semibold text-brand-700 hover:underline" href={modelArticlesLink} target="_blank" rel="noreferrer">
            View Model Articles on GOV.UK
          </a>

          <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-sm font-semibold text-slate-900">Please acknowledge</div>
            <label className="mt-3 flex items-start gap-3 text-sm text-slate-700">
              <input type="checkbox" className="mt-1 h-4 w-4" checked={ackNotAgent} onChange={(e) => setAckNotAgent(e.target.checked)} />
              <span>I understand that EnterprateAI is not a formation agent and does not register companies.</span>
            </label>
            <label className="mt-3 flex items-start gap-3 text-sm text-slate-700">
              <input type="checkbox" className="mt-1 h-4 w-4" checked={ackSelfRegister} onChange={(e) => setAckSelfRegister(e.target.checked)} />
              <span>I understand that I must complete the actual registration on the official Companies House website.</span>
            </label>
          </div>
        </div>
      </div>
    </SectionCard>
  );
}

