import DialogHost from "./components/DialogHost";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Suspense, lazy, useEffect } from "react";
import { DemoTourProvider } from "./context/DemoTourContext";
import DemoTour from "./components/DemoTour";
import { apiRequest } from "./api/client";

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
    document.querySelector(".ea-scroll")?.scrollTo(0, 0);
  }, [pathname]);
  return null;
}
import { useAuthStore } from "./store/auth";
import { useWorkspaceStore } from "./store/workspace";
import Layout from "./components/Layout";
import LandingPage from "./pages/LandingPage";
import NewLandingPage from "./pages/NewLandingPage";
import EssentialsPage from "./pages/EssentialsPage";
import OnboardingPage from "./pages/OnboardingPage";
import AgentCentrePage from "./pages/AgentCentrePage";
import ToolLibraryPage from "./pages/ToolLibraryPage";
import ReadinessPage from "./pages/ReadinessPage";
import StartPage from "./pages/StartPage";
import AgentRunPage from "./pages/AgentRunPage";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import ValidationWizardPage from "./pages/ValidationWizardPage";
import ResultsPage from "./pages/ResultsPage";
import SimulationPage from "./pages/SimulationPage";
import BlueprintPage from "./pages/BlueprintPage";
import BusinessPlanPage from "./pages/LivePlanPage";
import RegistrationPage from "./pages/RegistrationPage";
import CataloguePage from "./pages/CataloguePage";
import InvoicePublicPage from "./pages/InvoicePublicPage";
import NotFoundPage from "./pages/NotFoundPage";
import SharedBlueprintPage from "./pages/SharedBlueprintPage";
import TeamPage from "./pages/TeamPage";
import JoinPage from "./pages/JoinPage";
import AdminPage from "./pages/AdminPage";
import PricingPage from "./pages/PricingPage";
import PricingSuccessPage from "./pages/PricingSuccessPage";
import MarketplacePage from "./pages/MarketplacePage";
import DirectoryProfilePage from "./pages/DirectoryProfilePage";
import ClaimFlowPage from "./pages/ClaimFlowPage";
import MarketplaceProfilePage, { ProfileSkeleton } from "./pages/MarketplaceProfilePage";
import { MarketplaceShell } from "./components/marketplace/MarketplaceHeader";
import MarketplaceModerationPage from "./pages/MarketplaceModerationPage";
import AccountPage from "./pages/AccountPage";

// Shares the large listings module with the Marketplace tabs, so it is loaded only when opened.
const ProposalRequestDetailPage = lazy(() => import("./pages/ProposalRequestDetailPage"));
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import IntegrationsPage from "./pages/IntegrationsPage";
import IntegrationsCallbackPage from "./pages/IntegrationsCallbackPage";
import VerifyEmailPage from "./pages/VerifyEmailPage";
import EmailPreferencesPage, { UnsubscribePage } from "./pages/EmailPreferencesPage";
import PrivacyPolicyPage from "./pages/PrivacyPolicyPage";
import TermsOfServicePage from "./pages/TermsOfServicePage";
import DisclaimerPage from "./pages/DisclaimerPage";
import CreditsPage from "./pages/CreditsPage";
import RequireWorkspace from "./components/RequireWorkspace";
import ErrorBoundary from "./components/ErrorBoundary";
import { ContentSkeleton, ShellSkeleton } from "./components/Skeleton";
import BusinessOperationsPage from "./pages/BusinessOperationsPage";
import ReferralPage from "./pages/ReferralPage";
import ReferralClickPage from "./pages/ReferralClickPage";
import BlogPage from "./pages/BlogPage";
import BlogArticlePage from "./pages/BlogArticlePage";
import ResearchPage from "./pages/ResearchPage";
import BookDemoPage from "./pages/BookDemoPage";
import CookieBanner from "./components/CookieBanner";

/** The page's earlier address (bookmarks, links in emails): the same page, with whatever was asked for. */
function OldMarketplaceProfile() {
  const { search, hash } = useLocation();
  return <Navigate to={{ pathname: "/marketplace/profile", search, hash }} replace />;
}

function Protected({ children }) {
  const token = useAuthStore((s) => s.token);
  const hydrated = useAuthStore((s) => s.hydrated);
  const connecting = useAuthStore((s) => s.connecting);
  if (!hydrated) {
    // First load: the shell with skeletons and a progress bar along the top, never a blank page.
    return <ShellSkeleton note={connecting ? "Still connecting to the server. Retrying…" : ""} />;
  }
  if (!token) {
    // Remember where they were going (an email link, a bookmark) so signing in lands there. Only paths inside the app.
    const here = `${window.location.pathname}${window.location.search}`;
    const next = here.startsWith("/") && !here.startsWith("//") && here !== "/" && !here.startsWith("/login") ? `?next=${encodeURIComponent(here)}` : "";
    return <Navigate to={`/login${next}`} replace />;
  }
  return <>{children}</>;
}

function PublicRoot() {
  return <LandingPage />;
}

export default function App() {
  const hydrate = useAuthStore((s) => s.hydrate);
  const authHydrated = useAuthStore((s) => s.hydrated);
  const email = useAuthStore((s) => s.email);
  const resetForUser = useWorkspaceStore((s) => s.resetForUser);
  useEffect(() => {
    hydrate();
  }, [hydrate]);
  useEffect(() => {
    if (!authHydrated) return;
    resetForUser(email);
    // Re-populate workspaceId immediately after clearing it so nav gate
    // doesn't fire on a refresh before any workspace-backed page loads.
    if (email) {
      useWorkspaceStore.getState().beginWorkspaceCheck();
      apiRequest("/workspace/profile", "GET")
        .then((data) => {
          if (data?.workspace_id) {
            useWorkspaceStore.getState().setWorkspaceId(data.workspace_id);
            if (data.profile?.company_name) {
              useWorkspaceStore.getState().setWorkspaceName(data.profile.company_name);
              useWorkspaceStore.getState().setWorkspaceCompanyName(data.profile.company_name);
            }
          }
        })
        .catch(() => {})
        .finally(() => useWorkspaceStore.getState().endWorkspaceCheck());
    }
  }, [authHydrated, email, resetForUser]);

  return (
    <DemoTourProvider>
      <ScrollToTop />
      <Routes>
      <Route path="/" element={<PublicRoot />} />
      <Route path="/home" element={<NewLandingPage />} />
      <Route path="/essentials" element={<EssentialsPage />} />
      <Route path="/onboarding" element={<Protected><OnboardingPage /></Protected>} />
      {/* A task begun on the homepage carries on here after sign-in, then opens the dashboard with the work on it. */}
      <Route path="/start/:sessionId" element={<Protected><StartPage /></Protected>} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/pricing" element={<PricingPage />} />
      <Route path="/pricing/success" element={<PricingSuccessPage />} />
      <Route path="/integrations/callback" element={<IntegrationsCallbackPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/email/unsubscribe" element={<UnsubscribePage />} />
      <Route path="/email/preferences" element={<EmailPreferencesPage />} />
      <Route path="/legal/privacy" element={<PrivacyPolicyPage />} />
      <Route path="/legal/terms" element={<TermsOfServicePage />} />
      <Route path="/legal/disclaimer" element={<DisclaimerPage />} />
      <Route path="/r/:code" element={<ReferralClickPage />} />
      <Route path="/book-demo" element={<BookDemoPage />} />
      <Route path="/blog" element={<BlogPage />} />
      <Route path="/blog/:slug" element={<BlogArticlePage />} />
      <Route path="/research" element={<ResearchPage />} />
      <Route path="/share/:token" element={<SharedBlueprintPage />} />
      <Route path="/invoice" element={<InvoicePublicPage />} />
      <Route path="/join/:token" element={<JoinPage />} />
      <Route
        path="/"
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="resume/:sessionId" element={<StartPage framed />} />
        <Route path="tools" element={<ToolLibraryPage />} />
        <Route path="funding" element={<RequireWorkspace><ErrorBoundary label="Funding Readiness"><ReadinessPage feature="funding" /></ErrorBoundary></RequireWorkspace>} />
        <Route path="funding/:subjectId" element={<RequireWorkspace><ErrorBoundary label="Funding Readiness"><ReadinessPage feature="funding" /></ErrorBoundary></RequireWorkspace>} />
        <Route path="launch" element={<RequireWorkspace><ErrorBoundary label="Launch Readiness"><ReadinessPage feature="launch" /></ErrorBoundary></RequireWorkspace>} />
        <Route path="launch/:subjectId" element={<RequireWorkspace><ErrorBoundary label="Launch Readiness"><ReadinessPage feature="launch" /></ErrorBoundary></RequireWorkspace>} />
        <Route path="agent" element={<RequireWorkspace><AgentCentrePage /></RequireWorkspace>} />
        <Route path="agent/runs/:runId" element={<RequireWorkspace><AgentRunPage /></RequireWorkspace>} />
        <Route path="validation" element={<ValidationWizardPage />} />
        <Route path="results" element={<ResultsPage />} />
        <Route path="simulation" element={<RequireWorkspace><SimulationPage /></RequireWorkspace>} />
        <Route path="blueprint" element={<RequireWorkspace><BlueprintPage /></RequireWorkspace>} />
        <Route path="business-plan" element={<RequireWorkspace><BusinessPlanPage /></RequireWorkspace>} />
        <Route path="live-plan" element={<Navigate to="/business-plan" replace />} />
        <Route path="registration" element={<RequireWorkspace><RegistrationPage /></RequireWorkspace>} />
        <Route path="catalogue" element={<RequireWorkspace><CataloguePage /></RequireWorkspace>} />
        <Route path="team" element={<TeamPage />} />
        <Route path="account" element={<AccountPage />} />
        <Route path="credits" element={<CreditsPage />} />
        <Route path="referrals" element={<ReferralPage />} />
        <Route path="operations" element={<RequireWorkspace><ErrorBoundary label="Business Operations"><BusinessOperationsPage /></ErrorBoundary></RequireWorkspace>} />
        <Route path="integrations" element={<IntegrationsPage />} />
      </Route>
      <Route path="marketplace-moderation" element={<MarketplaceModerationPage />} />
      <Route
        path="ent-admin"
        element={
          <Protected>
            <AdminPage />
          </Protected>
        }
      />
      <Route path="/marketplace" element={<MarketplacePage />} />
      <Route path="/marketplace/request/:requestId" element={<Suspense fallback={<div className="p-6"><ContentSkeleton label="this request" /></div>}><ProposalRequestDetailPage /></Suspense>} />
      {/* A business's own Marketplace settings live in the Marketplace, under its header, not in the dashboard. */}
      <Route path="/marketplace/profile" element={<Protected><MarketplaceShell><RequireWorkspace fallback={<ProfileSkeleton />}><ErrorBoundary label="Marketplace profile"><MarketplaceProfilePage /></ErrorBoundary></RequireWorkspace></MarketplaceShell></Protected>} />
      <Route path="/marketplace-profile" element={<OldMarketplaceProfile />} />
      <Route path="/marketplace/business/:slug" element={<ErrorBoundary label="Business profile"><DirectoryProfilePage /></ErrorBoundary>} />
      <Route path="/marketplace/claim/:slug" element={<ErrorBoundary label="Claim your business"><ClaimFlowPage /></ErrorBoundary>} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
    <DemoTour />
    <CookieBanner />
    <DialogHost />
    </DemoTourProvider>
  );
}
