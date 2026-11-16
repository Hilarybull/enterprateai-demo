import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuthStore } from "../store/auth";
import { useWorkspaceStore } from "../store/workspace";
import { activateMarketplaceProfile, getMarketplaceProfile, suggestMarketplaceDescription, suggestMarketplaceServices, updateMarketplaceProfile, updateOpportunityPreferences } from "../lib/directory";
import logoUrl from "../enterprate-logo.png";

// The one-click claim link emailed to a business's listed address (the owner, 14 Nov): it verifies the email, signs the
// person in, hands them the profile and makes their workspace, then opens their profile. No claim or verification pages.
export default function MarketplaceClaimLinkPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const tokenLogin = useAuthStore((s) => s.tokenLogin);
  const started = useRef(false);
  const [problem, setProblem] = useState(null);      // { message, slug? }

  const finishClaim = useCallback(async (result) => {
    let setupFailed = false;
    if (result.business_id) {
      // A brand-new claimant has 50 welcome credits. Use the existing paid field-writing tools
      // to fill only missing copy, but keep publishing independent so a writing/provider error
      // cannot leave an otherwise claimed listing invisible.
      if (result.new_account) {
        let current = null;
        let description = "";
        const originalTags = [];
        let tags = [];
        try {
          current = await getMarketplaceProfile(result.business_id);
          description = current.profile?.description || "";
          originalTags.push(...(Array.isArray(current.profile?.service_tags) ? current.profile.service_tags : []));
          tags = [...originalTags];
        } catch {
          setupFailed = true;
        }
        if (current) {
          const draft = { description, service_area: current.profile?.service_area || "", service_tags: tags };
          if (!tags.length) {
            try {
              const services = await suggestMarketplaceServices(result.business_id, draft);
              tags = String(services.suggestion || "").split(",").map((tag) => tag.trim()).filter(Boolean);
              draft.service_tags = tags;
            } catch {
              setupFailed = true;
            }
          }
          if (description.trim().length < 20) {
            try {
              const about = await suggestMarketplaceDescription(result.business_id, draft);
              description = about.suggestion || description;
            } catch {
              setupFailed = true;
            }
          }
          if (description !== (current.profile?.description || "") || tags.join(",") !== originalTags.join(",")) {
            try {
              await updateMarketplaceProfile(result.business_id, { description, service_tags: tags }, current.profile?.revision, result.claim_id);
            } catch {
              setupFailed = true;
            }
          }
        }
      }
      // Publishing is attempted for every successful claim, including an existing account.
      try {
        await updateOpportunityPreferences(result.business_id, { enquiries: { enabled: true } }, result.claim_id);
      } catch {
        setupFailed = true;
      }
      try {
        await activateMarketplaceProfile(result.business_id, true);
      } catch {
        setupFailed = true;
      }
    }
    const query = new URLSearchParams({ welcome: "1" });
    if (result.new_account) query.set("set_password", "1");
    if (setupFailed) query.set("setup", "needed");
    navigate(`/marketplace/business/${encodeURIComponent(result.slug)}?${query}`, { replace: true });
  }, [navigate]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = params.get("token") || "";
    if (!token) { setProblem({ message: "This claim link is missing or incomplete. Open the link from the email again." }); return; }
    apiRequest("/auth/marketplace-claim-link", "POST", { token }, { timeoutMs: 60000 })
      .then(async (result) => {
        await tokenLogin(result.access_token, result.email);
        if (result.business_id) useWorkspaceStore.getState().setWorkspaceId(result.business_id);
        await finishClaim(result);
      })
      .catch((e) => {
        const detail = e?.data?.detail;
        const message = (typeof detail === "object" && detail?.message) || String(e?.message || "").replace(/^HTTP \d+:\s*/, "") || "This claim link couldn't be used.";
        setProblem({ message, slug: typeof detail === "object" ? detail?.slug : null });
      });
  }, [finishClaim, navigate, params, tokenLogin]);

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-slate-50 px-4 dark:bg-slate-950">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-xl sm:p-8 dark:border-slate-800 dark:bg-slate-900">
        <img src={logoUrl} alt="EnterprateAI" className="mx-auto mb-6 h-7 w-auto" />
        {!problem ? (
          <div role="status">
            <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
            <h1 className="mt-4 text-lg font-bold text-slate-900 dark:text-slate-100">Setting up your business</h1>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">We're confirming your email, handing you your profile and creating your workspace. This takes a few seconds.</p>
          </div>
        ) : (
          <>
            <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">This link can't be used</h1>
            <p role="alert" className="mt-2 text-sm text-slate-600 dark:text-slate-300">{problem.message}</p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
              {problem.slug && <Link to={`/marketplace/business/${encodeURIComponent(problem.slug)}`} className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700">Open the profile</Link>}
              <Link to="/login" className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200">Sign in</Link>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
