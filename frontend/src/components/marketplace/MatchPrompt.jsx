import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { answerPossibleDuplicate, claimableBusinesses, getMarketplaceProfile } from "../../lib/directory";

// "We found a Marketplace profile that may be your business": shown while a business is being
// set up, and again when its company number or website changes. It never blocks anything: the
// business is created or saved either way.

/** Looks for an existing profile once there is a name and a company number or website. */
export function useBusinessMatch({ name, companyNumber, website }, enabled = true) {
  const [match, setMatch] = useState(null);
  useEffect(() => {
    const n = (name || "").trim(), c = (companyNumber || "").trim(), w = (website || "").trim();
    if (!enabled || n.length < 2 || !(c || w)) { setMatch(null); return undefined; }
    let live = true;
    const t = setTimeout(() => {
      claimableBusinesses({ name: n, company_number: c, website: w })
        .then((r) => { if (live) setMatch((r.items || [])[0] || null); })
        .catch(() => { if (live) setMatch(null); });      // the check is a help, never a hurdle
    }, 600);
    return () => { live = false; clearTimeout(t); };
  }, [name, companyNumber, website, enabled]);
  return match;
}

const CHOICES = [["claim", "Claim and link it (recommended)"], ["not_mine", "This isn't my business"], ["later", "Decide later"]];

/** `choice`: "claim" | "not_mine" | "later" | null. The answer is acted on by whoever shows the prompt. */
export default function MatchPrompt({ match, choice, onChoice, compact = false }) {
  if (!match) return null;
  return (
    <fieldset className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-left dark:border-emerald-900 dark:bg-emerald-950/40">
      <legend className="sr-only">An existing Marketplace profile may be your business</legend>
      <p className="text-sm text-slate-800 dark:text-slate-100">
        We found a Marketplace profile that may be your business: <span className="font-semibold">{match.name}</span>{match.location ? `, ${match.location}` : ""}.
      </p>
      {!compact && <p className="mt-0.5 text-[12px] text-slate-600 dark:text-slate-300">Linking it means your business appears once. You'll be asked to show that you manage it.</p>}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
        {CHOICES.map(([key, label]) => (
          <label key={key} className="flex items-center gap-1.5 text-[13px] font-medium text-slate-700 dark:text-slate-200">
            <input type="radio" name="marketplace-match" checked={choice === key} onChange={() => onChoice(key)} />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** For a business that already exists (workspace settings): the server says which profiles may be
 *  it, leaving out any its owner already said aren't theirs. Checked again whenever the company
 *  number or website changes. Each answer is acted on at once. */
export function SavedBusinessMatch({ businessId, companyNumber, website }) {
  const navigate = useNavigate();
  const [match, setMatch] = useState(null);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    setHidden(false);
    if (!businessId || !(companyNumber || website)) { setMatch(null); return undefined; }
    let live = true;
    getMarketplaceProfile(businessId).then((r) => { if (live) setMatch((r.possible_duplicates || [])[0] || null); }).catch(() => { if (live) setMatch(null); });
    return () => { live = false; };
  }, [businessId, companyNumber, website]);
  if (!match || hidden) return null;
  const choose = (choice) => {
    if (choice === "claim") navigate(`/marketplace/claim/${match.slug}?source=signup_match&business=${businessId}`);
    else if (choice === "not_mine") answerPossibleDuplicate(businessId, match.id).then(() => setMatch(null)).catch(() => setHidden(true));
    else setHidden(true);
  };
  return <div className="mb-4"><MatchPrompt match={match} choice={null} onChoice={choose} compact /></div>;
}
