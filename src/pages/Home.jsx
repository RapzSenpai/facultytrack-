import { Link } from "react-router-dom";
import { ArrowRight, ShieldCheck, Clock, Lock } from "lucide-react";
import Navbar from "../components/Navbar.jsx";
import Footer from "../components/Footer.jsx";

import schoolBg from "../assets/school-bg.jpg";
import logo from "../assets/Logo (3).png";

const HOW_IT_WORKS = [
  {
    step: "01",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
    title: "Pick Your Instructor",
    desc: "Choose a teacher from your current subjects who you want to evaluate.",
  },
  {
    step: "02",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    ),
    title: "Share Your Ratings",
    desc: "Answer each item honestly based on your experience with the instructor in class.",
  },
  {
    step: "03",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" />
      </svg>
    ),
    title: "Send Your Response",
    desc: "Submit your evaluation securely. Your identity remains private throughout the process.",
  },
  {
    step: "04",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    ),
    title: "Strengthen Academic Quality",
    desc: "Your feedback helps faculty improve and contributes to a better learning environment for everyone.",
  },
];

const WHY_ITEMS = [
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      </svg>
    ),
    title: "Easy Evaluation",
    desc: "A clean, guided form makes it effortless for students to complete their evaluation in just a few minutes.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
    title: "Faculty Development",
    desc: "Meaningful feedback empowers instructors to reflect, improve, and deliver a higher quality of education.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
        <polyline points="22 4 12 14 7 9" />
      </svg>
    ),
    title: "Detailed Reports",
    desc: "Performance data is presented in clean reports, making it easy for administrators to track and review results.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    ),
    title: "Anonymous & Secure",
    desc: "All submissions are fully confidential, giving students the freedom to provide open and truthful feedback.",
  },
];

export default function Home() {
  return (
    <>
      <Navbar />

      {/* ── HERO ─────────────────────────────────────────────────── */}
      <section className="hero" style={{ backgroundImage: `url(${schoolBg})` }}>
        <div className="hero__overlay" />
        <div className="hero__vignette" />

        <div className="container hero__container">
          <div className="hero__grid">

            <div className="hero__left">
              <div className="hero__badge hero__badge--mobile">
                Consolatrix College of Toledo City
              </div>
              <h1 className="hero__title">
                Faculty Evaluation System
              </h1>
              <p className="hero__desc">
                Evaluate instructors honestly and help build a stronger academic community.
              </p>
              <div className="hero__actions">
                <Link className="hero__btn" to="/login">
                  Get Started <ArrowRight size={16} style={{ marginLeft: "6px" }} />
                </Link>
                <a className="hero__btn-ghost" href="#why-section">
                  Learn More
                </a>
              </div>
              <div className="hero__trust hero__trust--mobile">
                <span className="hero__trust-item"><ShieldCheck size={14} /> Anonymous</span>
                <span className="hero__trust-dot">•</span>
                <span className="hero__trust-item"><Lock size={14} /> Official Portal</span>
              </div>
            </div>

            <div className="hero__right">
              <div className="hero__logoWrap">
                <img className="hero__logo" src={logo} alt="School Logo" />
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* ── WHY USE FACULTYTRACK ─────────────────────────────────── */}
      <section className="why-section" id="why-section">
        <div className="container">
          <div className="why-header">
            <h2 className="why-title">
              Why Use <span>FacultyTrack?</span>
            </h2>
          </div>
          <div className="why-grid">
            {WHY_ITEMS.map((item) => (
              <div className="why-card" key={item.title}>
                <div className="why-card__icon-ring">
                  <div className="why-card__icon">{item.icon}</div>
                </div>
                <h3 className="why-card__title">{item.title}</h3>
                <p className="why-card__desc">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ─────────────────────────────────────────── */}
      <section className="how-section">
        <div className="container">
          <div className="section-header">
            <span className="section-tag">Simple Process</span>
            <h2 className="section-title">How It Works</h2>
            <p className="section-sub">
              Completing your evaluation is quick and easy. Just follow these four steps.
            </p>
          </div>
          <div className="how-grid">
            {HOW_IT_WORKS.map((item, i) => (
              <div className="how-card" key={item.step}>
                <div className="how-card__step">{item.step}</div>
                <div className="how-card__icon">{item.icon}</div>
                <h3 className="how-card__title">{item.title}</h3>
                <p className="how-card__desc">{item.desc}</p>
                {i < HOW_IT_WORKS.length - 1 && <div className="how-card__arrow">→</div>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA BANNER ───────────────────────────────────────────── */}
      <section className="cta-section">
        <div className="container cta-section__inner">
          <div className="cta-section__text">
            <h2 className="cta-section__title">Your Voice Shapes Better Education</h2>
            <p className="cta-section__sub">
              Each evaluation you submit gives faculty the insight they need to grow and makes school better for every student who comes after you.
            </p>
          </div>
          <div className="cta-section__right">
            <Link className="hero__btn cta-section__btn" to="/login">
              Start Evaluating
            </Link>
            <p className="cta-section__note">Takes less than 5 minutes</p>
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}