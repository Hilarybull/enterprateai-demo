import SectionCard from "../../../components/SectionCard";
import CopyField from "../components/CopyField";

export default function SummaryStep({ summary, companiesHouseLink }) {
  return (
    <SectionCard title="Your Summary" subtitle="Copy-paste guide for your Companies House registration.">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <CopyField label="Company Name" value={summary.company_name} />
        <CopyField label="Entity Type" value={summary.entity_type} />
        <CopyField label="Registration Fee" value={summary.registration_fee} />
        <CopyField label="SIC Codes (copy all)" value={summary.sic_codes} />
        <CopyField label="Business Description" value={summary.business_description} />
        <CopyField label="Registered Office Address" value={summary.registered_address} />
        <CopyField label="Address Type" value={summary.address_type} />
        <CopyField label="Director Name" value={summary.director_name} />
        <CopyField label="Director DOB" value={summary.director_dob} />
        <CopyField label="Director Nationality" value={summary.director_nationality} />
        <CopyField label="Director Occupation" value={summary.director_occupation} />
        <CopyField label="Director Residential Address" value={summary.director_residential_address} />
      </div>

      <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
        <div className="font-semibold text-slate-900">Start registration on GOV.UK</div>
        <a className="mt-1 inline-flex font-semibold text-brand-700 hover:underline" href={companiesHouseLink} target="_blank" rel="noreferrer">
          Open Companies House registration
        </a>
      </div>
    </SectionCard>
  );
}

