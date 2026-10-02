import { Link, useLocation, useNavigate } from "react-router-dom";
import { ShieldCheck, Mail, MapPin, Clock, ArrowUpRight } from "lucide-react";
import logo from "../assets/Logo (3).png";

export default function Footer() {
  const location = useLocation();
  const navigate = useNavigate();

  const handleScrollTo = (sectionId) => {
    if (location.pathname === "/") {
      const el = document.getElementById(sectionId);
      if (el) {
        el.scrollIntoView({ behavior: "smooth" });
        return;
      }
    }
    navigate(`/#${sectionId}`);
  };

  return (
    <footer className="ft-footer-main" role="contentinfo">
      <div className="container">
        {/* Main 4-Column Grid */}
        <div className="ft-footer-grid">
          {/* Column 1: Institutional Brand & Mission */}
          <div className="ft-footer-col ft-footer-col--brand">
            <div className="ft-footer-brand">
              <img src={logo} alt="CCTC Logo" className="ft-footer-logo" />
              <div>
                <h3 className="ft-footer-title">FacultyTrack</h3>
                <span className="ft-footer-subtitle">Consolatrix College of Toledo City</span>
              </div>
            </div>

            <p className="ft-footer-desc">
              Fostering instructional excellence through honest, confidential, and constructive feedback.
            </p>

            <div className="ft-footer-trust-badge">
              <ShieldCheck size={18} className="ft-trust-icon" aria-hidden="true" />
              <div className="ft-trust-text">
                <strong>100% Confidential</strong>
                <span>Student submissions are strictly anonymous</span>
              </div>
            </div>
          </div>

          {/* Column 2: Navigation & Sections */}
          <div className="ft-footer-col">
            <h4 className="ft-footer-heading">Navigation</h4>
            <ul className="ft-footer-links">
              <li>
                <button
                  type="button"
                  onClick={() => {
                    if (location.pathname === "/") {
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    } else {
                      navigate("/");
                    }
                  }}
                  className="ft-footer-link"
                >
                  Home
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => handleScrollTo("why-section")}
                  className="ft-footer-link"
                >
                  Why FacultyTrack
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => handleScrollTo("how-it-works")}
                  className="ft-footer-link"
                >
                  How It Works
                </button>
              </li>
              <li>
                <Link to="/login" className="ft-footer-link">
                  Evaluation Guidelines
                </Link>
              </li>
            </ul>
          </div>

          {/* Column 3: Portals & Access */}
          <div className="ft-footer-col">
            <h4 className="ft-footer-heading">Access Portals</h4>
            <ul className="ft-footer-links">
              <li>
                <Link to="/login" className="ft-footer-link">
                  Student Portal <ArrowUpRight size={13} className="ft-link-arrow" />
                </Link>
              </li>
              <li>
                <Link to="/login" className="ft-footer-link">
                  Faculty Dashboard <ArrowUpRight size={13} className="ft-link-arrow" />
                </Link>
              </li>
              <li>
                <Link to="/login" className="ft-footer-link">
                  Administrator Login <ArrowUpRight size={13} className="ft-link-arrow" />
                </Link>
              </li>
              <li>
                <Link to="/register" className="ft-footer-link">
                  Create an Account <ArrowUpRight size={13} className="ft-link-arrow" />
                </Link>
              </li>
            </ul>
          </div>

          {/* Column 4: Campus Support & Location */}
          <div className="ft-footer-col">
            <h4 className="ft-footer-heading">Campus & Support</h4>
            <ul className="ft-footer-contact-list">
              <li className="ft-contact-item">
                <MapPin size={16} className="ft-contact-icon" aria-hidden="true" />
                <span>Toledo City, Cebu 6038, Philippines</span>
              </li>
              <li className="ft-contact-item">
                <Mail size={16} className="ft-contact-icon" aria-hidden="true" />
                <a href="mailto:support@cctc.edu.ph" className="ft-contact-link">
                  support@cctc.edu.ph
                </a>
              </li>
              <li className="ft-contact-item">
                <Clock size={16} className="ft-contact-icon" aria-hidden="true" />
                <span>Mon – Fri: 8:00 AM – 5:00 PM PHT</span>
              </li>
            </ul>

            <div className="ft-footer-approval-notice">
              <strong>Account Activation Note:</strong>
              <span>New registrations are reviewed and verified by the school administrator prior to dashboard access.</span>
            </div>
          </div>
        </div>

        {/* Bottom Legal & Live System Status */}
        <div className="ft-footer-bottom">
          <p className="ft-footer-copy">
            &copy; {new Date().getFullYear()} FacultyTrack — Consolatrix College of Toledo City. All rights reserved.
          </p>

          <div className="ft-footer-status-pill">
            <span className="ft-status-pulse-dot" aria-hidden="true" />
            <span>System Operational &bull; A.Y. 2025–2026</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
