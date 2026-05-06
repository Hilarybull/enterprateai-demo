import { Navigate, Route, Routes } from "react-router-dom";
import { useEffect } from "react";
import { useAuthStore } from "./store/auth";
import { useWorkspaceStore } from "./store/workspace";
import Layout from "./components/Layout";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import ValidationWizardPage from "./pages/ValidationWizardPage";
import ResultsPage from "./pages/ResultsPage";
import SimulationPage from "./pages/SimulationPage";
import BlueprintPage from "./pages/BlueprintPage";
import RegistrationPage from "./pages/RegistrationPage";
import CataloguePage from "./pages/CataloguePage";
import FinancialsPage from "./pages/FinancialsPage";
import NotFoundPage from "./pages/NotFoundPage";
import SharedBlueprintPage from "./pages/SharedBlueprintPage";
import TeamPage from "./pages/TeamPage";
import JoinPage from "./pages/JoinPage";
import AdminPage from "./pages/AdminPage";

function Protected({ children }) {
  const token = useAuthStore((s) => s.token);
  const hydrated = useAuthStore((s) => s.hydrated);
  if (!hydrated) return null;
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
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
  }, [authHydrated, email, resetForUser]);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/share/:token" element={<SharedBlueprintPage />} />
      <Route path="/join/:token" element={<JoinPage />} />
      <Route
        path="/"
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="validation" element={<ValidationWizardPage />} />
        <Route path="results" element={<ResultsPage />} />
        <Route path="simulation" element={<SimulationPage />} />
        <Route path="blueprint" element={<BlueprintPage />} />
        <Route path="registration" element={<RegistrationPage />} />
        <Route path="catalogue" element={<CataloguePage />} />
        <Route path="financials" element={<FinancialsPage />} />
        <Route path="team" element={<TeamPage />} />
      </Route>
      <Route
        path="ent-admin"
        element={
          <Protected>
            <AdminPage />
          </Protected>
        }
      />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
