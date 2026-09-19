import { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { Users, Menu, LogOut, ChevronDown, User, FileText, Home } from "lucide-react";
import logo from "../../assets/logo.jpg";

const NAV_ITEMS = [
  {
    path: "/faculty/dashboard",
    label: "Home",
    icon: <Home size={18} />,
  },
  {
    path: "/faculty/evaluations",
    label: "Evaluation Result",
    icon: <FileText size={18} />,
  },
  {
    path: "/faculty/profile",
    label: "My Profile",
    icon: <User size={18} />,
  },
];

export default function FacultyLayout({ children, breadcrumb }) {
  // Desktop: collapsed (icon-only 70px) vs expanded (260px)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // Mobile: overlay open/closed
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { userProfile, logout } = useAuth();

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const handleBurger = () => {
    if (window.innerWidth <= 768) {
      setMobileOpen((v) => !v);
    } else {
      setSidebarCollapsed((v) => !v);
    }
  };

  const handleNavClick = () => {
    setMobileOpen(false);
  };

  const displayName = userProfile?.fullName || "Faculty";
  const isActive = (path) => location.pathname === path;

  return (
    <div
      className={`fd ${sidebarCollapsed ? "fd--closed" : ""} ${mobileOpen ? "fd--open" : ""}`}
    >
      {/* SIDEBAR */}
      <aside className="fd-sidebar">
        <div className="fd-brand">
          <div className="fd-logo" style={{ width: "56px", height: "56px", borderRadius: "50%", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <img src={logo} alt="FacultyTrack Logo" style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scale(1.5)" }} />
          </div>
          <div className="fd-brandInfo">
            <div className="fd-brandTitle">FacultyTrack</div>
            <div className="fd-brandSub">Faculty Evaluation System</div>
          </div>
        </div>

        <nav className="fd-nav">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.path}
              className={`fd-link ${isActive(item.path) ? "fd-link--active" : ""}`}
              to={item.path}
              onClick={handleNavClick}
              title={sidebarCollapsed ? item.label : undefined}
            >
              <span className="fd-linkIcon">{item.icon}</span>
              <span className="fd-linkText">{item.label}</span>
            </Link>
          ))}
        </nav>

        {/* Sidebar Footer User Card */}
        <div className="fd-userFooterCard">
          <div
            className="fd-userFooterHeader"
            onClick={() => navigate("/faculty/profile")}
            title={sidebarCollapsed ? `${displayName} (FACULTY)` : undefined}
          >
            <div className="fd-userAvatar">
              {(() => {
                const parts = displayName.trim().split(" ");
                if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
                return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
              })()}
            </div>
            <div className="fd-userFooterInfo">
              <div className="fd-userFooterName">{displayName}</div>
              <div className="fd-userFooterSub">FACULTY</div>
            </div>
          </div>
          <button
            type="button"
            className="fd-userLogoutBtn"
            onClick={handleLogout}
            title={sidebarCollapsed ? "Log out" : undefined}
          >
            <LogOut size={16} />
            <span className="fd-userLogoutText">Log out</span>
          </button>
        </div>
      </aside>

      {/* OVERLAY (mobile) */}
      <button
        type="button"
        className="fd-overlay"
        aria-label="Close sidebar"
        onClick={() => setMobileOpen(false)}
      />

      {/* MAIN */}
      <main className="fd-main">
        <header className="fd-topbar">
          <div className="fd-topLeft">
            <button
              type="button"
              className="fd-burger"
              aria-label="Toggle sidebar"
              onClick={handleBurger}
            >
              <Menu size={20} />
            </button>
            <div className="fd-breadcrumb">
              <span>{breadcrumb}</span>
            </div>
          </div>

          <div className="fd-topRight">
            <div className="fd-userDropdown">
              <button
                className="fd-topUser"
                onClick={() => setDropdownOpen((v) => !v)}
                type="button"
              >
                <div className="fd-topAvatar"><Users size={18} /></div>
                <span className="fd-topUserName">{displayName}</span>
                <ChevronDown
                  size={16}
                  className={`fd-drop ${dropdownOpen ? "fd-drop--open" : ""}`}
                />
              </button>

              {dropdownOpen && (
                <div className="fd-dropdownMenu">
                  <Link
                    to="/faculty/profile"
                    className="fd-dropdownItem"
                    onClick={() => setDropdownOpen(false)}
                  >
                    <User size={16} />
                    My Profile
                  </Link>
                  <div className="fd-dropdownDivider" />
                  <button
                    className="fd-dropdownItem fd-dropdownItem--logout"
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

        <div className="fd-content">
          {children}
        </div>

        
      </main>
    </div>
  );
}
