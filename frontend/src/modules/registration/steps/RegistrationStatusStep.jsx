import SectionCard from "../../../components/SectionCard";
import Input from "../../../components/Input";

export default function RegistrationStatusStep({
  status,
  setStatus,
  registrationNumber,
  setRegistrationNumber,
  registrationDate,
  setRegistrationDate,
  notes,
  setNotes,
  checkName,
  setCheckName,
  checkResult,
  checkLoading,
  checkError,
  onCheck
}) {
  const isVerified = checkResult?.exact_matches?.length > 0;
  return (
    <SectionCard
      title="Registration status"
      subtitle="Let us know when your business is officially registered so we can use real records in your workspace."
    >
      <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Check Companies House</div>
        <div className="mt-2 grid gap-3 md:grid-cols-[1fr_auto]">
          <Input
            placeholder="Enter company name to verify"
            value={checkName}
            onChange={(e) => setCheckName(e.target.value)}
          />
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-300"
            disabled={checkLoading || !checkName.trim()}
            onClick={onCheck}
          >
            {checkLoading ? "Checking..." : "Check registration"}
          </button>
        </div>
        {checkError ? <div className="mt-2 text-xs font-semibold text-rose-600">{checkError}</div> : null}
        {checkResult ? (
          <div className="mt-2 text-xs font-semibold text-slate-600">
            {isVerified ? "Company found in Companies House records." : "No exact match found yet."}
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Status</div>
          <div className="flex flex-wrap gap-2">
            {[
              { key: "not_started", label: "Not started" },
              { key: "in_progress", label: "In progress" },
              { key: "registered", label: "Registered" }
            ].map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setStatus(item.key)}
                className={
                  "rounded-full border px-4 py-2 text-xs font-semibold transition " +
                  (status === item.key
                    ? "border-brand-300 bg-brand-50 text-brand-800"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300")
                }
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <Input
            label="Registration number"
            placeholder="e.g. 12345678"
            value={registrationNumber}
            onChange={(e) => setRegistrationNumber(e.target.value)}
          />
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Registration date</div>
            <input
              type="date"
              className="ea-input mt-2"
              value={registrationDate}
              onChange={(e) => setRegistrationDate(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="mt-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Notes (optional)</div>
        <textarea
          className="ea-input mt-2 min-h-[110px]"
          placeholder="Any extra context we should know (e.g. company number pending approval)."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
    </SectionCard>
  );
}
