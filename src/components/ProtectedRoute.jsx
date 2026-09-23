import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

/**
 * Wraps a route and redirects to /login if:
 *  - user is not authenticated
 *  - user role doesn't match the required role prop
 */
export default function ProtectedRoute({ children, role }) {
  const { currentUser, userProfile } = useAuth();

  if (!currentUser) return <Navigate to="/login" replace />;

  // Block unapproved or inactive accounts
  if (userProfile?.status === "pending") {
    return <Navigate to="/pending-approval" replace />;
  }
  if (userProfile && userProfile.status !== "active") {
    return <Navigate to="/login" replace />;
  }

  // Phase 7: super_admin passes every admin gate [Req 10].
  const effectiveRole = userProfile?.role === "super_admin" ? "admin" : userProfile?.role;
  if (role && effectiveRole && effectiveRole !== role) {
    // Authenticated but wrong section: send users home to their own
    // dashboard instead of /login (which would loop back here).
    const home =
      effectiveRole === "student"
        ? "/student/dashboard"
        : effectiveRole === "faculty"
          ? "/faculty/dashboard"
          : effectiveRole === "admin"
            ? "/admin/dashboard"
            : "/";
    return <Navigate to={home} replace />;
  }

  return children;
}
