import { Navigate } from "react-router-dom";

// Marketplace moderation lives in the admin area. This old address forwards there; a moderator
// who isn't an administrator sees only the Marketplace section.
export default function MarketplaceModerationPage() {
  return <Navigate to="/ent-admin?section=marketplace" replace />;
}
