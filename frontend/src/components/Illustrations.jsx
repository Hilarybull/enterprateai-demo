export function IllustrationCard({ title, subtitle, children, className = "" }) {
  return (
    <div className={`ea-card overflow-hidden border-slate-200 bg-white ${className}`}>
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">{title}</div>
          {subtitle ? <div className="mt-0.5 text-xs text-slate-500">{subtitle}</div> : null}
        </div>
      </div>
      <div className="bg-gradient-to-br from-brand-50 via-white to-brand-100 px-4 py-4">
        {children}
      </div>
    </div>
  );
}

export function CatalogueIllustration() {
  return (
    <svg viewBox="0 0 320 180" className="h-44 w-full" fill="none">
      <rect x="8" y="18" width="120" height="144" rx="16" fill="#F1F5FF" stroke="#CBD5F5" />
      <rect x="24" y="38" width="88" height="10" rx="5" fill="#7C8FF7" />
      <rect x="24" y="58" width="64" height="8" rx="4" fill="#CBD5F5" />
      <rect x="24" y="78" width="80" height="8" rx="4" fill="#CBD5F5" />
      <rect x="24" y="98" width="48" height="8" rx="4" fill="#CBD5F5" />
      <rect x="24" y="120" width="80" height="26" rx="13" fill="#4F46E5" opacity="0.12" />

      <rect x="152" y="26" width="160" height="128" rx="18" fill="#FFFFFF" stroke="#E2E8F0" />
      <rect x="170" y="50" width="118" height="10" rx="5" fill="#0F172A" opacity="0.08" />
      <rect x="170" y="72" width="78" height="8" rx="4" fill="#94A3B8" opacity="0.5" />
      <rect x="170" y="92" width="108" height="8" rx="4" fill="#94A3B8" opacity="0.5" />
      <rect x="170" y="112" width="90" height="8" rx="4" fill="#94A3B8" opacity="0.5" />
      <circle cx="278" cy="122" r="16" fill="#8B5CF6" opacity="0.18" />
      <path d="M270 122l6 6 12-14" stroke="#8B5CF6" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function FinancialIllustration() {
  return (
    <svg viewBox="0 0 320 180" className="h-44 w-full" fill="none">
      <rect x="18" y="24" width="284" height="132" rx="18" fill="#FFFFFF" stroke="#E2E8F0" />
      <rect x="36" y="46" width="86" height="12" rx="6" fill="#4F46E5" opacity="0.18" />
      <rect x="36" y="68" width="60" height="8" rx="4" fill="#CBD5F5" />
      <rect x="36" y="88" width="96" height="8" rx="4" fill="#CBD5F5" />
      <rect x="36" y="108" width="70" height="8" rx="4" fill="#CBD5F5" />
      <rect x="36" y="128" width="90" height="8" rx="4" fill="#CBD5F5" />

      <path d="M154 130l20-26 24 18 26-36 24 20 24-30" stroke="#22C55E" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="154" cy="130" r="4" fill="#22C55E" />
      <circle cx="174" cy="104" r="4" fill="#22C55E" />
      <circle cx="198" cy="122" r="4" fill="#22C55E" />
      <circle cx="224" cy="86" r="4" fill="#22C55E" />
      <circle cx="248" cy="106" r="4" fill="#22C55E" />
      <circle cx="272" cy="76" r="4" fill="#22C55E" />

      <rect x="206" y="46" width="84" height="40" rx="12" fill="#0F172A" opacity="0.06" />
      <rect x="218" y="60" width="48" height="8" rx="4" fill="#0F172A" opacity="0.25" />
    </svg>
  );
}

export function BlueprintIllustration() {
  return (
    <svg viewBox="0 0 320 180" className="h-44 w-full" fill="none">
      <rect x="20" y="20" width="120" height="140" rx="16" fill="#EEF2FF" stroke="#C7D2FE" />
      <rect x="36" y="44" width="84" height="10" rx="5" fill="#6366F1" opacity="0.5" />
      <rect x="36" y="66" width="64" height="8" rx="4" fill="#C7D2FE" />
      <rect x="36" y="84" width="72" height="8" rx="4" fill="#C7D2FE" />
      <rect x="36" y="102" width="54" height="8" rx="4" fill="#C7D2FE" />
      <rect x="36" y="124" width="70" height="8" rx="4" fill="#C7D2FE" />

      <rect x="160" y="36" width="140" height="108" rx="16" fill="#FFFFFF" stroke="#E2E8F0" />
      <rect x="176" y="56" width="100" height="10" rx="5" fill="#0F172A" opacity="0.08" />
      <rect x="176" y="78" width="84" height="8" rx="4" fill="#94A3B8" opacity="0.5" />
      <rect x="176" y="96" width="70" height="8" rx="4" fill="#94A3B8" opacity="0.5" />
      <rect x="176" y="114" width="92" height="8" rx="4" fill="#94A3B8" opacity="0.5" />
      <circle cx="274" cy="112" r="12" fill="#F59E0B" opacity="0.2" />
      <path d="M268 112l4 4 8-10" stroke="#F59E0B" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
