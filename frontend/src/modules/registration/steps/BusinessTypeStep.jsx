import InlineAlert from "../../../components/InlineAlert";
import SectionCard from "../../../components/SectionCard";
import Spinner from "../../../components/Spinner";
import EntityTypeCard from "../components/EntityTypeCard";

export default function BusinessTypeStep({ entityTypes, loading, error, selectedEntityKey, onSelectEntityKey }) {
  return (
    <SectionCard
      title="Business Type"
      subtitle="Choose the legal structure that best fits your business needs."
      headerRight={entityTypes?.updated_year ? <span className="text-xs font-semibold text-slate-500">Fees updated {entityTypes.updated_year}</span> : null}
    >
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <Spinner size={16} />
          Loading entity types...
        </div>
      ) : error ? (
        <InlineAlert kind="error" message={error} />
      ) : (
        <div className="space-y-6">
          {(entityTypes?.groups || []).map((g) => (
            <div key={g.title} className="space-y-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">{g.title}</div>
                {g.subtitle ? <div className="mt-1 text-xs text-slate-500">{g.subtitle}</div> : null}
              </div>
              <div className="grid grid-cols-1 gap-4">
                {(g.items || []).map((it) => (
                  <EntityTypeCard key={it.key} item={it} selected={it.key === selectedEntityKey} onSelect={() => onSelectEntityKey(it.key)} />
                ))}
              </div>
            </div>
          ))}

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            <div className="font-semibold text-slate-900">Recommendation for most entrepreneurs</div>
            <div className="mt-1">
              If you want credibility, limited liability protection, and room to grow,{" "}
              <span className="font-semibold text-slate-900">Private Company Limited by Shares (Ltd)</span> is the most popular choice for UK businesses.
            </div>
          </div>
        </div>
      )}
    </SectionCard>
  );
}

