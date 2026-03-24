import Input from "../../../components/Input";
import SectionCard from "../../../components/SectionCard";

export default function AddressStep({ addressType, setAddressType, registeredAddress, setRegisteredAddress }) {
  return (
    <SectionCard title="Registered Address" subtitle="This is your company’s official address and will be public. It must be a UK physical address.">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <div className="ea-label">Address type</div>
          <select value={addressType} onChange={(e) => setAddressType(e.target.value)} className="ea-input">
            <option value="home">Home address</option>
            <option value="office">Office address</option>
            <option value="virtual">Virtual office</option>
          </select>
          <div className="mt-4">
            <div className="ea-label">Full address *</div>
            <Input value={registeredAddress} onChange={(e) => setRegisteredAddress(e.target.value)} placeholder="UK address including postcode" />
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          <div className="font-semibold text-slate-900">Privacy notice</div>
          <div className="mt-1">
            Your registered address will be publicly visible and searchable on Companies House. If you use your home address, consider a virtual office service for privacy.
          </div>
        </div>
      </div>
    </SectionCard>
  );
}

