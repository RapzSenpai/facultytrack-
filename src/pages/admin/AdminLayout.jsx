import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  UserCircle2,
  GraduationCap,
  CalendarDays,
  FileText,
  ClipboardList,
  ClipboardCheck,
  BookOpen,
  BarChart3,
  Menu,
  LogOut,
  ChevronRight,
  ShieldCheck,
  Activity,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useScopedAdmin } from "../../hooks/useScopedAdmin";
import { useSuperScope } from "../../context/SuperScopeContext";
import { supabase } from "../../config/supabase";
import logo from "../../assets/logo.jpg";
import NotificationBell from "../../components/notifications/NotificationBell";

// Phase 7 [Req 10]: the Program Assignments page is super-admin-only;
// RLS enforces the same rule server-side.
const isSuperAdmin = (userProfile) => userProfile?.role === "super_admin";

const navSections = [
  {
    id: "main",
    items: [
      { key: "dashboard", label: "Dashboard", path: "/admin/dashboard", icon: LayoutDashboard },
    ],
  },
  {
    id: "system-users",
    label: "SYSTEM USERS",
    isFallback: true,
    items: [
      { key: "faculty", label: "Faculty", path: "/admin/faculty", icon: Users },
      { key: "student", label: "Student", path: "/admin/student", icon: UserCircle2 },
      { key: "approvals", label: "Approvals", path: "/admin/approvals", icon: ShieldCheck },
    ],
  },
  {
    id: "academic-setup",
    label: "ACADEMIC SETUP",
    isFallback: true,
    items: [
      { key: "department", label: "Curriculum & Sections", path: "/admin/department", icon: GraduationCap },
      { key: "subject", label: "All Subjects", path: "/admin/subject", icon: BookOpen, scopedHide: true },
      { key: "class-assignment", label: "Class Assignment", path: "/admin/class-assignment", icon: ClipboardList },
      { key: "academic-year", label: "Evaluation Period", path: "/admin/academic-year", icon: CalendarDays },
      { key: "questionnaire", label: "Questionnaire", path: "/admin/questionnaire", icon: FileText },
    ],
  },
  {
    id: "evaluation-management",
    label: "EVALUATION & REPORTS",
    isFallback: true,
    items: [
      { key: "subject-corrections", label: "Subject Corrections", path: "/admin/subject-corrections", icon: ClipboardCheck },
      { key: "moderation", label: "Moderation & Priority", path: "/admin/moderation", icon: ClipboardCheck },
      { key: "release-management", label: "Release Management", path: "/admin/release-management", icon: ClipboardCheck, scopedOnly: true },
      { key: "report", label: "Evaluation Report", path: "/admin/report", icon: FileText },
    ],
  },
  {
    id: "oversight",
    label: "OVERSIGHT",
    items: [
      { key: "program-assignments", label: "Program Assignments", path: "/admin/program-assignments", icon: UserCircle2, superOnly: true },
      { key: "reports", label: "Reports & Export", path: "/admin/reports", icon: FileText, superOnly: true },
      { key: "analytics", label: "Analytics", path: "/admin/analytics", icon: BarChart3, superOnly: true },
      { key: "release-management-super", label: "Release Management", path: "/admin/release-management", icon: ClipboardCheck, superOnly: true },
    ],
  },
];

function AdminLayoutInner({ title, children }) {
  const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth > 768);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const navigate = useNavigate();
  const location = useLocation();
  const { logout, userProfile } = useAuth();
  const superAdmin = isSuperAdmin(userProfile);
  const { inScopeName, loading: scopeLoading } = useScopedAdmin();

  useEffect(() => {
    const fetchPending = async () => {
      try {
        const [fRes, sRes] = await Promise.all([
          supabase.from('users').select('id, status, department').eq('role', 'faculty'),
          supabase.from('users').select('id, status, department').eq('role', 'student'),
        ]);
        // D9 backstop: scoped admins count only their programs
        // (RLS already filters server-side).
        const inScope = (d) => superAdmin || inScopeName(d);
        const fPending = (fRes.data || []).filter(u => u.status === 'pending' && inScope(u.department)).length;
        const sPending = (sRes.data || []).filter(u => u.status === 'pending' && inScope(u.department)).length;
        setPendingCount(fPending + sPending);
      } catch (err) {
        console.error("Failed to fetch pending counts:", err);
      }
    };
    if (!scopeLoading) fetchPending();
  }, [location.pathname, scopeLoading, superAdmin, inScopeName]);

  // Fix orientation change: reset sidebar state based on actual window width
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth > 768) {
        setMobileOpen(false);
        setSidebarOpen(true);
      } else {
        setSidebarOpen(false);
        setMobileOpen(false);
      }
    };
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const handleBurger = () => {
    if (window.innerWidth <= 768) {
      setMobileOpen((v) => !v);
    } else {
      setSidebarOpen((v) => !v);
    }
  };

  const handleNavClick = (path) => {
    setMobileOpen(false);
    navigate(path);
  };

  const isActive = (path) => location.pathname === path;

  const userFullName = userProfile?.fullName || "Admin";
  const { scopeDeptId, setScopeDeptId, departments: scopeDepts } = useSuperScope();
  const scopeDeptName = scopeDepts.find((d) => d.id === scopeDeptId)?.name || "";

  return (
    <div className={`ad ${sidebarOpen ? "ad--open" : ""} ${mobileOpen ? "ad--mobile-open" : ""}`}>
      {/* SIDEBAR */}
      <aside className="ad-sidebar">
        <div className="ad-brand">
          <div className="ad-logo">
            <img src={logo} alt="FacultyTrack Logo" style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scale(1.5)" }} />
          </div>
          <div className="ad-brandInfo">
            <div className="ad-brandTitle">FacultyTrack</div>
            <div className="ad-brandSub">Faculty Evaluation System</div>
          </div>
        </div>

        {/* Super program picker: scopes fallback Admin Tools only.
            Oversight + Dashboard + Release stay global. Default All. */}
        {/* Super program picker */}
        {superAdmin && sidebarOpen && (
          <div style={{ padding: "10px 14px 6px" }}>
            <div className="ad-menuLabel" style={{ marginBottom: "6px" }}>Viewing</div>
            <div style={{ position: "relative" }}>
              <select
                style={{
                  width: "100%",
                  padding: "8px 30px 8px 12px",
                  borderRadius: "8px",
                  border: "1px solid rgba(255, 255, 255, 0.15)",
                  background: "rgba(255, 255, 255, 0.08)",
                  color: "#ffffff",
                  fontSize: "13px",
                  fontWeight: 500,
                  outline: "none",
                  cursor: "pointer",
                  appearance: "none",
                  WebkitAppearance: "none",
                  transition: "all 0.2s ease",
                }}
                value={scopeDeptId}
                onChange={(e) => setScopeDeptId(e.target.value)}
                title="Filter views to a specific program"
              >
                <option value="" style={{ background: "#0f172a", color: "#ffffff" }}>All Programs</option>
                {scopeDepts.map((d) => (
                  <option key={d.id} value={d.id} style={{ background: "#0f172a", color: "#ffffff" }}>
                    {d.name}
                  </option>
                ))}
              </select>
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{
                  position: "absolute",
                  right: "12px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  pointerEvents: "none",
                  color: "rgba(255, 255, 255, 0.7)",
                }}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>
          </div>
        )}

        {superAdmin ? (
          <>
            {/* OVERVIEW */}
            <div>
              <div className="ad-menuLabel">OVERVIEW</div>
              <nav className="ad-nav">
                <button
                  className={`ad-link ${isActive("/admin/dashboard") ? "ad-link--active" : ""}`}
                  type="button"
                  onClick={() => handleNavClick("/admin/dashboard")}
                  title={!sidebarOpen ? "Dashboard" : undefined}
                >
                  <span className="ad-linkIcon"><LayoutDashboard size={18} /></span>
                  <span className="ad-linkText">Dashboard</span>
                </button>
                <button
                  className={`ad-link ${isActive("/admin/analytics") ? "ad-link--active" : ""}`}
                  type="button"
                  onClick={() => handleNavClick("/admin/analytics")}
                  title={!sidebarOpen ? "Analytics" : undefined}
                >
                  <span className="ad-linkIcon"><BarChart3 size={18} /></span>
                  <span className="ad-linkText">Analytics</span>
                </button>
                <button
                  className={`ad-link ${isActive("/admin/reports") ? "ad-link--active" : ""}`}
                  type="button"
                  onClick={() => handleNavClick("/admin/reports")}
                  title={!sidebarOpen ? "Reports & Export" : undefined}
                >
                  <span className="ad-linkIcon"><FileText size={18} /></span>
                  <span className="ad-linkText">Reports &amp; Export</span>
                </button>
              </nav>
            </div>

            {/* SYSTEM USERS */}
            <div>
              <div className="ad-menuLabel">SYSTEM USERS</div>
              <nav className="ad-nav">
                <button
                  className={`ad-link ${isActive("/admin/program-assignments") ? "ad-link--active" : ""}`}
                  type="button"
                  onClick={() => handleNavClick("/admin/program-assignments")}
                  title={!sidebarOpen ? "Program Heads" : undefined}
                >
                  <span className="ad-linkIcon"><UserCircle2 size={18} /></span>
                  <span className="ad-linkText">Program Heads</span>
                </button>
                <button
                  className={`ad-link ${isActive("/admin/faculty") ? "ad-link--active" : ""}`}
                  type="button"
                  onClick={() => handleNavClick("/admin/faculty")}
                  title={!sidebarOpen ? "Faculty" : undefined}
                >
                  <span className="ad-linkIcon"><Users size={18} /></span>
                  <span className="ad-linkText">Faculty</span>
                </button>
                <button
                  className={`ad-link ${isActive("/admin/student") ? "ad-link--active" : ""}`}
                  type="button"
                  onClick={() => handleNavClick("/admin/student")}
                  title={!sidebarOpen ? "Students" : undefined}
                >
                  <span className="ad-linkIcon"><UserCircle2 size={18} /></span>
                  <span className="ad-linkText">Students</span>
                </button>
                <button
                  className={`ad-link ${isActive("/admin/approvals") ? "ad-link--active" : ""}`}
                  type="button"
                  onClick={() => handleNavClick("/admin/approvals")}
                  title={!sidebarOpen ? "Pending Approvals" : undefined}
                >
                  <span className="ad-linkIcon"><ShieldCheck size={18} /></span>
                  <span className="ad-linkText">Pending Approvals</span>
                  {pendingCount > 0 && (
                    <span style={{
                      marginLeft: "auto",
                      background: isActive("/admin/approvals") ? "#1e3a5f" : "#f5c400",
                      color: isActive("/admin/approvals") ? "#fff" : "#1e3a5f",
                      padding: "2px 6px",
                      borderRadius: "12px",
                      fontSize: "10px",
                      fontWeight: "800",
                      display: (!sidebarOpen && !mobileOpen) ? "none" : "inline-flex"
                    }}>{pendingCount}</span>
                  )}
                </button>
              </nav>
            </div>

            {/* ACADEMIC SETUP */}
            <div>
              <div className="ad-menuLabel">ACADEMIC SETUP</div>
              <nav className="ad-nav">
                <button
                  className={`ad-link ${isActive("/admin/department") ? "ad-link--active" : ""}`}
                  type="button"
                  onClick={() => handleNavClick("/admin/department")}
                  title={!sidebarOpen ? "Curriculum & Sections" : undefined}
                >
                  <span className="ad-linkIcon"><GraduationCap size={18} /></span>
                  <span className="ad-linkText">Curriculum &amp; Sections</span>
                </button>
                <button
                  className={`ad-link ${isActive("/admin/academic-year") ? "ad-link--active" : ""}`}
                  type="button"
                  onClick={() => handleNavClick("/admin/academic-year")}
                  title={!sidebarOpen ? "Evaluation Periods" : undefined}
                >
                  <span className="ad-linkIcon"><CalendarDays size={18} /></span>
                  <span className="ad-linkText">Evaluation Periods</span>
                </button>
                <button
                  className={`ad-link ${isActive("/admin/questionnaire") ? "ad-link--active" : ""}`}
                  type="button"
                  onClick={() => handleNavClick("/admin/questionnaire")}
                  title={!sidebarOpen ? "Questionnaire" : undefined}
                >
                  <span className="ad-linkIcon"><FileText size={18} /></span>
                  <span className="ad-linkText">Questionnaire</span>
                </button>
                <button
                  className={`ad-link ${isActive("/admin/class-assignment") ? "ad-link--active" : ""}`}
                  type="button"
                  onClick={() => handleNavClick("/admin/class-assignment")}
                  title={!sidebarOpen ? "Class Assignments" : undefined}
                >
                  <span className="ad-linkIcon"><ClipboardList size={18} /></span>
                  <span className="ad-linkText">Class Assignments</span>
                </button>
              </nav>
            </div>

            {/* SYSTEM */}
            <div>
              <div className="ad-menuLabel">SYSTEM</div>
              <nav className="ad-nav">
                <button
                  className={`ad-link ${isActive("/admin/monitor") ? "ad-link--active" : ""}`}
                  type="button"
                  onClick={() => handleNavClick("/admin/monitor")}
                  title={!sidebarOpen ? "System Monitor & Audit" : undefined}
                >
                  <span className="ad-linkIcon"><Activity size={18} /></span>
                  <span className="ad-linkText">System Monitor &amp; Audit</span>
                </button>
              </nav>
            </div>
          </>
        ) : (
          navSections.map((section) => {
            const visibleItems = section.items.filter(
              (item) => (!item.superOnly || superAdmin) && (!item.scopedHide || superAdmin) && (!item.scopedOnly || !superAdmin)
            );
            if (visibleItems.length === 0) return null;

            return (
              <div key={section.id}>
                {section.label && <div className="ad-menuLabel">{section.label}</div>}
                <nav className="ad-nav">
                  {visibleItems.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.key}
                        className={`ad-link ${isActive(item.path) ? "ad-link--active" : ""}`}
                        type="button"
                        onClick={() => handleNavClick(item.path)}
                        title={!sidebarOpen ? item.label : undefined}
                      >
                        <span className="ad-linkIcon"><Icon size={18} /></span>
                        <span className="ad-linkText">{item.label}</span>
                        {item.key === "approvals" && pendingCount > 0 && (
                          <span style={{
                            marginLeft: "auto",
                            background: isActive(item.path) ? "#1e3a5f" : "#f5c400",
                            color: isActive(item.path) ? "#fff" : "#1e3a5f",
                            padding: "2px 6px",
                            borderRadius: "12px",
                            fontSize: "10px",
                            fontWeight: "800",
                            display: (!sidebarOpen && !mobileOpen) ? "none" : "inline-flex"
                          }}>{pendingCount}</span>
                        )}
                      </button>
                    );
                  })}
                </nav>
              </div>
            );
          })
        )}

        {/* Sidebar Footer User Card */}
        <div className="ad-userFooterCard">
          <div
            className="ad-userFooterHeader"
            onClick={() => navigate("/admin/profile")}
            title={!sidebarOpen ? `${userFullName} (${superAdmin ? "SUPER ADMIN" : "ADMIN"})` : undefined}
          >
            {!sidebarOpen && (
              <div className="ad-userAvatar">
                {(() => {
                  const name = userFullName;
                  const parts = name.trim().split(" ");
                  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
                  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
                })()}
              </div>
            )}
            <div className="ad-userFooterInfo">
              <div className="ad-userFooterName">{userFullName}</div>
              <div className="ad-userFooterSub">{superAdmin ? "SUPER ADMIN" : "ADMIN"}</div>
            </div>
          </div>
        </div>
      </aside>

      {/* OVERLAY (mobile) */}
      <button
        type="button"
        className="ad-overlay"
        aria-label="Close sidebar"
        onClick={() => setMobileOpen(false)}
      />

      {/* MAIN */}
      <main className="ad-main">
        <header className="ad-topbar">
          <div className="ad-topLeft">
            <button
              type="button"
              className="ad-burger"
              aria-label="Toggle sidebar"
              onClick={handleBurger}
            >
              <Menu size={20} />
            </button>
            <div className="ad-breadcrumb"><span>{title}</span></div>
            {superAdmin && scopeDeptId && (
              <button
                type="button"
                onClick={() => setScopeDeptId("")}
                title="Clear program scope (back to All Programs)"
                style={{ marginLeft: "10px", fontSize: "12px", fontWeight: 800, color: "#1e3a5f", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: "999px", padding: "4px 12px", cursor: "pointer" }}
              >
                Viewing: {scopeDeptName || "…"} ✕
              </button>
            )}
          </div>

          <div className="ad-topRight" style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <NotificationBell />
            <div className="ad-userDropdown">
              <button
                className="ad-topUser"
                onClick={() => setDropdownOpen((v) => !v)}
                type="button"
              >
                <div className="ad-topAvatar"><Users size={18} /></div>
                <span className="ad-topUserName">{userFullName}</span>
                <svg
                  width="16" height="16" viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" strokeWidth="2"
                  className={`ad-drop ${dropdownOpen ? "ad-drop--open" : ""}`}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>

              {dropdownOpen && (
                <div className="ad-dropdownMenu">
                  <button
                    type="button"
                    className="ad-dropdownItem"
                    onClick={() => { setDropdownOpen(false); navigate("/admin/profile"); }}
                  >
                    <Users size={16} />
                    My Profile
                  </button>
                  <div className="ad-dropdownDivider" />
                  <button
                    className="ad-dropdownItem ad-dropdownItem--logout"
                    type="button"
                    onClick={handleLogout}
                  >
                    <LogOut size={16} />
                    Logout
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {children}


      </main>
    </div>
  );
}

export default function AdminLayout(props) {
  // SuperScopeProvider lives in App.jsx (SuperScopeGate) so page-level
  // useSuperScope() calls — which run ABOVE this component — can read it.
  return <AdminLayoutInner {...props} />;
}
