import { Navigate } from "react-router-dom";

export default function ProposalRequestsPage() {
  return <Navigate to="/marketplace?tab=requests" replace />;
}
