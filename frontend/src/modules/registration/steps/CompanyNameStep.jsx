import Button from "../../../components/Button";
import InlineAlert from "../../../components/InlineAlert";
import Input from "../../../components/Input";
import InfoTip from "../../../components/InfoTip";
import SectionCard from "../../../components/SectionCard";
import Spinner from "../../../components/Spinner";
import { classNames } from "../utils";

export default function CompanyNameStep({
  companyName,
  setCompanyName,
  altName1,
  setAltName1,
  altName2,
  setAltName2,
  nameCheck,
  loading,
  error,
  onCheck
}) {
  return (
    <SectionCard
      title="Company Name"
      subtitle="Your company name must be unique and follow Companies House naming rules."
      headerRight={<InfoTip text="We can check name availability using the Companies House database (when connected)." />}
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <div className="ea-label">Preferred Company Name *</div>
          <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="e.g., Sparkle Cleaning" />
          <div className="mt-3 flex items-center gap-2">
            <Button variant="secondary" disabled={loading || !companyName.trim()} onClick={onCheck}>
              {loading ? <Spinner size={16} /> : null}
              Check availability
            </Button>
            {nameCheck ? (
              <span
                className={classNames(
                  "rounded-full px-3 py-1 text-xs font-semibold ring-1",
                  nameCheck.available ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-rose-50 text-rose-700 ring-rose-200"
                )}
              >
                {nameCheck.available ? "Available" : "Not available"}
              </span>
            ) : null}
          </div>
          {error ? (
            <div className="mt-3">
              <InlineAlert kind="error" message={error} />
            </div>
          ) : null}
          {nameCheck && !nameCheck.available ? (
            <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
              This name appears to match an existing company. Consider choosing an alternative name.
              {nameCheck.similar?.length ? <div className="mt-2 text-xs text-rose-800/80">Similar: {nameCheck.similar.slice(0, 6).join(", ")}</div> : null}
            </div>
          ) : null}
        </div>

        <div>
          <div className="ea-label">Alternative Names (optional)</div>
          <div className="grid grid-cols-1 gap-3">
            <Input value={altName1} onChange={(e) => setAltName1(e.target.value)} placeholder="Alternative name 1" />
            <Input value={altName2} onChange={(e) => setAltName2(e.target.value)} placeholder="Alternative name 2" />
          </div>
          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            <div className="font-semibold text-slate-900">Naming rules</div>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
              <li>Must be unique (not too similar to existing companies)</li>
              <li>Cannot include restricted words (e.g., Bank, Royal) without permission</li>
              <li>Must end with Limited or Ltd (for most private limited companies)</li>
              <li>Cannot be offensive or misleading</li>
            </ul>
          </div>
        </div>
      </div>
    </SectionCard>
  );
}

