import Button from "../../../components/Button";
import InlineAlert from "../../../components/InlineAlert";
import InfoTip from "../../../components/InfoTip";
import SectionCard from "../../../components/SectionCard";
import Spinner from "../../../components/Spinner";
import { classNames } from "../utils";

export default function ActivityStep({
  businessDescription,
  setBusinessDescription,
  sicSuggestions,
  sicSelected,
  loading,
  error,
  onGenerate,
  onToggleSic
}) {
  return (
    <SectionCard
      title="Business Activity"
      subtitle="Describe what your company will do. We will suggest SIC codes for you to choose from."
      headerRight={<InfoTip text="SIC codes are 5-digit activity codes used in Companies House registration." />}
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <div className="ea-label">Business description *</div>
          <textarea
            className="ea-input min-h-[120px]"
            value={businessDescription}
            onChange={(e) => setBusinessDescription(e.target.value)}
            placeholder="Describe what your company does (min 20 characters)."
            maxLength={500}
          />
          <div className="mt-1 text-xs text-slate-500">{businessDescription.trim().length}/500 characters (minimum 20)</div>

          <div className="mt-3 flex items-center gap-2">
            <Button variant="secondary" disabled={loading || businessDescription.trim().length < 20} onClick={onGenerate}>
              {loading ? <Spinner size={16} /> : null}
              Generate SIC codes
            </Button>
            {sicSelected.length ? (
              <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700 ring-1 ring-brand-200">
                Selected {sicSelected.length}/4
              </span>
            ) : null}
          </div>
          {error ? (
            <div className="mt-3">
              <InlineAlert kind="error" message={error} />
            </div>
          ) : null}

          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            <div className="font-semibold text-slate-900">What are SIC codes?</div>
            <div className="mt-1">
              SIC (Standard Industrial Classification) codes describe your business activities. Companies House requires up to 4 SIC codes in your registration.
            </div>
          </div>
        </div>

        <div>
          <div className="text-sm font-semibold text-slate-900">Suggested SIC codes</div>
          <div className="mt-1 text-xs text-slate-500">Select exactly 4 codes (we show up to 6 options).</div>
          <div className="mt-3 space-y-2">
            {(sicSuggestions || []).length ? (
              sicSuggestions.map((s) => {
                const checked = sicSelected.includes(s.code);
                const disabled = !checked && sicSelected.length >= 4;
                return (
                  <label
                    key={s.code}
                    className={classNames(
                      "flex cursor-pointer items-start gap-3 rounded-2xl border bg-white p-4",
                      checked ? "border-brand-300 ring-2 ring-brand-100" : "border-slate-200",
                      disabled ? "opacity-60" : ""
                    )}
                  >
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => onToggleSic(s.code)}
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900">
                        {s.code} <span className="font-medium text-slate-600">• {s.title}</span>
                      </div>
                    </div>
                  </label>
                );
              })
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
                Enter a description and click “Generate SIC codes”.
              </div>
            )}
          </div>
        </div>
      </div>
    </SectionCard>
  );
}
