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
  Sparkles,
  Activity,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useScopedAdmin } from "../../hooks/useScopedAdmin";
import { SuperScopeProvider, useSuperScope } from "../../context/SuperScopeContext";
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
    items: [
      { key: "faculty", label: "Faculty", path: "/admin/faculty", icon: Users },
      { key: "approvals", label: "Approvals", path: "/admin/approvals", icon: ShieldCheck },
      { key: "student", label: "Student", path: "/admin/student", icon: UserCircle2 },
    ],
  },
  {
    id: "oversight",
    label: "OVERSIGHT",
    items: [
      { key: "monitor", label: "System Monitor", path: "/admin/monitor", icon: Activity, superOnly: true },
      { key: "program-assignments", label: "Program Assignments", path: "/admin/program-assignments", icon: UserCircle2, superOnly: true },
      { key: "reports", label: "Reports & Export", path: "/admin/reports", icon: FileText, superOnly: true },
      { key: "analytics", label: "Analytics", path: "/admin/analytics", icon: BarChart3, superOnly: true },
    ],
  },
  {
    id: "release",
    label: "RELEASE",
    items: [
      { key: "release-management", label: "Release Management", path: "/admin/release-management", icon: ClipboardCheck },
    ],
  },
  {
    id: "manage-evaluation",
    label: "MANAGE EVALUATION",
    items: [
      { key: "department", label: "Curriculum & Sections", path: "/admin/department", icon: GraduationCap },
      { key: "subject", label: "All Subjects", path: "/admin/subject", icon: BookOpen, scopedHide: true },
      { key: "class-assignment", label: "Class Assignment", path: "/admin/class-assignment", icon: ClipboardList },
      { key: "academic-year", label: "Evaluation Period", path: "/admin/academic-year", icon: CalendarDays },
      { key: "subject-corrections", label: "Subject Corrections", path: "/admin/subject-corrections", icon: ClipboardCheck },
      { key: "moderation", label: "Moderation & Priority", path: "/admin/moderation", icon: ClipboardCheck },
      { key: "questionnaire", label: "Questionnaire", path: "/admin/questionnaire", icon: FileText },
      { key: "report", label: "Evaluation Report", path: "/admin/report", icon: FileText },
      { key: "ai-analyst", label: "AI Analyst", path: "/admin/ai-analyst", icon: Sparkles },
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
  // Fallback Admin Tools collapse for super (persisted, shut by default).
  const [fallbackOpen, setFallbackOpen] = useState(() => localStorage.getItem("superFallbackOpen") === "1");
  const toggleFallback = () => {
    setFallbackOpen((v) => {
      localStorage.setItem("superFallbackOpen", v ? "0" : "1");
      return !v;
    });
  };

  return (
    <div className={`ad ${sidebarOpen ? "ad--open" : ""} ${mobileOpen ? "ad--mobile-open" : ""}`}>
      {/* SIDEBAR */}
      <aside className="ad-sidebar">
        <div className="ad-brand">
          <div className="ad-logo" style={{ width: "56px", height: "56px", borderRadius: "50%", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", border: "none" }}>
            <img src={logo} alt="FacultyTrack Logo" style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scale(1.5)" }} />
          </div>
          <div className="ad-brandInfo">
            <div className="ad-brandTitle">FacultyTrack</div>
            <div className="ad-brandSub">Faculty Evaluation System</div>
          </div>
        </div>

        {/* Super program picker: scopes fallback Admin Tools only.
            Oversight + Dashboard + Release stay global. Default All. */}
        {superAdmin && (
          <div style={{ padding: "10px 14px 2px" }}>
            {sidebarOpen && (
              <div className="ad-menuLabel" style={{ marginBottom: "4px" }}>Viewing</div>
            )}
            <select
              className="ad-filterSelect"
              style={{ width: "100%" }}
              value={scopeDeptId}
              onChange={(e) => setScopeDeptId(e.target.value)}
              title="Scope fallback Admin Tools to a program (Oversight stays global)"
            >
              <option value="">All Programs</option>
              {scopeDepts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        )}

        {navSections.map((section) => {
          // Super: management screens collapse into a fallback group so
          // the sidebar stays oversight-focused. Admins see everything flat.
          const isFallbackSection = superAdmin && (section.id === "system-users" || section.id === "manage-evaluation");
          if (isFallbackSection) return null;
          return (
          <div key={section.id}>
            {section.label && <div className="ad-menuLabel">{section.label}</div>}
            <nav className="ad-nav">
              {section.items.filter((item) => (!item.superOnly || superAdmin) && (!item.scopedHide || superAdmin)).map((item) => {
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
        })}
        {/* Super fallback Admin Tools: same pages, collapsed by default. */}
        {superAdmin && (
          <div>
            <div className="ad-menuLabel">Fallback</div>
            <nav className="ad-nav">
              <button
                className="ad-link"
                type="button"
                onClick={toggleFallback}
                title={!sidebarOpen ? "Admin Tools" : undefined}
              >
                <span className="ad-linkIcon"><ChevronRight size={18} style={{ transform: fallbackOpen ? "rotate(90deg)" : "none" }} /></span>
                <span className="ad-linkText">Admin Tools</span>
              </button>
              {fallbackOpen && navSections
                .filter((s) => s.id === "system-users" || s.id === "manage-evaluation")
                .flatMap((s) => s.items)
                .map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.key}
                      className={`ad-link ${isActive(item.path) ? "ad-link--active" : ""}`}
                      type="button"
                      onClick={() => handleNavClick(item.path)}
                      title={!sidebarOpen ? item.label : undefined}
                      style={{ paddingLeft: "38px" }}
                    >
                      <span className="ad-linkIcon"><Icon size={16} /></span>
                      <span className="ad-linkText">{item.label}</span>
                    </button>
                  );
                })}
            </nav>
          </div>
        )}

        {/* Sidebar Footer User Card */}
        <div className="ad-userFooterCard">
          <div
            className="ad-userFooterHeader"
            onClick={() => navigate("/admin/profile")}
            title={!sidebarOpen ? `${userFullName} (ADMIN)` : undefined}
          >
            <div className="ad-userAvatar">
              {(() => {
                const name = userFullName;
                const parts = name.trim().split(" ");
                if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
                return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
              })()}
            </div>
            <div className="ad-userFooterInfo">
              <div className="ad-userFooterName">{userFullName}</div>
              <div className="ad-userFooterSub">ADMIN</div>
            </div>
          </div>
          <button
            type="button"
            className="ad-userLogoutBtn"
            onClick={handleLogout}
            title={!sidebarOpen ? "Log out" : undefined}
          >
            <LogOut size={16} />
            <span className="ad-userLogoutText">Log out</span>
          </button>
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
  const { userProfile } = useAuth();
  return (
    <SuperScopeProvider active={userProfile?.role === "super_admin"}>
      <AdminLayoutInner {...props} />
    </SuperScopeProvider>
  );
}
