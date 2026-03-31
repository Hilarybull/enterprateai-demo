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
  setNotes
}) {
  return (
    <SectionCard
      title="Registration status"
      subtitle="Let us know when your business is officially registered so we can use real records in your workspace."
    >
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
