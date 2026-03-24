import Button from "../../../components/Button";
import Input from "../../../components/Input";
import SectionCard from "../../../components/SectionCard";

export default function PeopleStep({ directors, onAddDirector, onRemoveDirector, onUpdateDirector }) {
  return (
    <SectionCard title="People Involved" subtitle="Provide director details you’ll need for Companies House registration.">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-900">Directors</div>
            <div className="mt-1 text-xs text-slate-500">At least one director required. Must be 16+ years old.</div>
          </div>
          <Button variant="secondary" onClick={onAddDirector}>
            + Add Director
          </Button>
        </div>

        <div className="space-y-4">
          {directors.map((d, idx) => (
            <div key={idx} className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-slate-900">Director {idx + 1}</div>
                {directors.length > 1 ? (
                  <button className="text-sm font-semibold text-rose-700 hover:underline" onClick={() => onRemoveDirector(idx)}>
                    Remove
                  </button>
                ) : null}
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <div className="ea-label">First Name *</div>
                  <Input value={d.first_name} onChange={(e) => onUpdateDirector(idx, "first_name", e.target.value)} />
                </div>
                <div>
                  <div className="ea-label">Last Name *</div>
                  <Input value={d.last_name} onChange={(e) => onUpdateDirector(idx, "last_name", e.target.value)} />
                </div>
                <div>
                  <div className="ea-label">Date of Birth *</div>
                  <Input type="date" value={d.dob} onChange={(e) => onUpdateDirector(idx, "dob", e.target.value)} />
                </div>
                <div>
                  <div className="ea-label">Nationality *</div>
                  <Input value={d.nationality} onChange={(e) => onUpdateDirector(idx, "nationality", e.target.value)} placeholder="Select nationality" />
                </div>
                <div>
                  <div className="ea-label">Occupation *</div>
                  <Input value={d.occupation} onChange={(e) => onUpdateDirector(idx, "occupation", e.target.value)} placeholder="e.g., Consultant" />
                </div>
                <div className="md:col-span-2">
                  <div className="ea-label">Residential Address *</div>
                  <Input value={d.residential_address} onChange={(e) => onUpdateDirector(idx, "residential_address", e.target.value)} placeholder="Full address including postcode" />
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          People with Significant Control (PSC): anyone who owns more than 25% of shares or has significant influence must be registered as a PSC.
        </div>
      </div>
    </SectionCard>
  );
}

