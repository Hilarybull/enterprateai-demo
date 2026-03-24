import PageHeader from "../components/PageHeader";
import SectionCard from "../components/SectionCard";

export default function CataloguePage() {
  return (
    <div>
      <PageHeader
        title="Catalogue"
        description="Manage your products/services catalogue (used by invoices and proposals)."
        badge={{ text: "Next", tone: "slate" }}
      />

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <SectionCard title="Items" subtitle="Create and manage catalogue items.">
          <div className="ea-muted">Coming next: CRUD items, pricing inputs, and reusable line items for invoices.</div>
        </SectionCard>
        <SectionCard title="Templates" subtitle="Use items inside blueprint documents.">
          <div className="ea-muted">Coming next: link catalogue items to invoice/proposal templates.</div>
        </SectionCard>
      </div>
    </div>
  );
}
