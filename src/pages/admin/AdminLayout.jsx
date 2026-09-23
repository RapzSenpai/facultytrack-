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
  Menu,
  LogOut,
  ChevronRight,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../config/supabase";
import logo from "../../assets/logo.jpg";

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
      { key: "program-assignments", label: "Program Assignments", path: "/admin/program-assignments", icon: UserCircle2, superOnly: true },
    ],
  },
  {
    id: "manage-evaluation",
    label: "MANAGE EVALUATION",
    items: [
      { key: "department", label: "Curriculum & Sections", path: "/admin/department", icon: GraduationCap },
      { key: "subject", label: "All Subjects", path: "/admin/subject", icon: BookOpen },
      { key: "class-assignment", label: "Class Assignment", path: "/admin/class-assignment", icon: ClipboardList },
      { key: "academic-year", label: "Academic Year", path: "/admin/academic-year", icon: CalendarDays },
      { key: "subject-corrections", label: "Subject Corrections", path: "/admin/subject-corrections", icon: ClipboardCheck },
      { key: "release-management", label: "Release Management", path: "/admin/release-management", icon: ClipboardCheck },
      { key: "moderation", label: "Moderation & Priority", path: "/admin/moderation", icon: ClipboardCheck },
      { key: "questionnaire", label: "Questionnaire", path: "/admin/questionnaire", icon: FileText },
      { key: "report", label: "Evaluation Report", path: "/admin/report", icon: FileText },
      { key: "ai-analyst", label: "AI Analyst", path: "/admin/ai-analyst", icon: Sparkles },
    ],
  },
];

export default function AdminLayout({ title, children }) {
  const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth > 768);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const navigate = useNavigate();
  const location = useLocation();
  const { logout, userProfile } = useAuth();
  const superAdmin = isSuperAdmin(userProfile);

  useEffect(() => {
    const fetchPending = async () => {
      try {
        const [fRes, sRes] = await Promise.all([
          supabase.from('users').select('id, status').eq('role', 'faculty'),
          supabase.from('users').select('id, status').eq('role', 'student'),
        ]);
        const fPending = (fRes.data || []).filter(u => u.status === 'pending').length;
        const sPending = (sRes.data || []).filter(u => u.status === 'pending').length;
        setPendingCount(fPending + sPending);
      } catch (err) {
        console.error("Failed to fetch pending counts:", err);
      }
    };
    fetchPending();
  }, [location.pathname]);

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

        {navSections.map((section) => (
          <div key={section.id}>
            {section.label && <div className="ad-menuLabel">{section.label}</div>}
            <nav className="ad-nav">
              {section.items.filter((item) => !item.superOnly || superAdmin).map((item) => {
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
        ))}

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

          <div className="ad-topRight">
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
