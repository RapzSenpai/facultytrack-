    import { useState } from "react";
    import { useNavigate } from "react-router-dom";
    import logo from "../assets/logo.jpg";

    export default function Navbar() {
      const navigate = useNavigate();
      const [isOpen, setIsOpen] = useState(false);

      const toggleMenu = () => setIsOpen(!isOpen);

      const handleNav = (path) => {
        setIsOpen(false);
        navigate(path);
      };
      return (
        <>
          <nav className="navbar-custom">
            <div className="container">
              <div className="d-flex justify-content-between align-items-center w-100 position-relative">
                <div className="ft-brand" onClick={() => handleNav("/")} style={{ display: "flex", alignItems: "center", gap: "12px", cursor: "pointer" }}>
                  <div className="navbar-logo-container">
                    <img src={logo} alt="Logo" style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scale(1.5)" }} />
                  </div>
                  <h1 className="navbar-brand-custom">FacultyTrack</h1>
                </div>

                <button className="navbar-toggler" onClick={toggleMenu} aria-label="Toggle navigation">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    {isOpen ? (
                      <>
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                      </>
                    ) : (
                      <>
                        <line x1="3" y1="12" x2="21" y2="12"></line>
                        <line x1="3" y1="6" x2="21" y2="6"></line>
                        <line x1="3" y1="18" x2="21" y2="18"></line>
                      </>
                    )}
                  </svg>
                </button>

                <div className={`nav-menu-container ${isOpen ? "active" : ""}`}>
                  <span className="nav-link-custom" onClick={() => handleNav("/")}>
                    Home
                  </span>
                  <button className="btn-login" onClick={() => handleNav("/login")}>
                    Login
                  </button>
                  <button
                    className="btn-login btn-register"
                    onClick={() => handleNav("/register")}
                  >
                    Register
                  </button>
                </div>
              </div>
            </div>
          </nav>


        </>
      );
    }
