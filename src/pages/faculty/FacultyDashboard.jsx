import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../config/supabase";
import FacultyLayout from "./FacultyLayout";
import { fetchFacultyReleaseStatus } from "../../utils/releaseStatus";
import { pickActivePeriod } from "../../utils/periodStatus";

export default function FacultyDashboard() {
  const [overallRating, setOverallRating] = useState(null);
  const [totalResponses, setTotalResponses] = useState(null);
  const [activeYear, setActiveYear] = useState(null);
  const [loading, setLoading] = useState(true);
  // Phase 5: release gating [D2]
  const [releaseStatus, setReleaseStatus] = useState([]);
  const navigate = useNavigate();
  const { currentUser, userProfile } = useAuth();

  useEffect(() => {
    if (!currentUser) return;
    // Phase 4 anonymity: faculty read the identity-stripped view
    // (faculty_evaluations_anon — no student_id, base-table reads
    // are revoked). The view already scopes rows to the caller.
    // Phase 5: the view is now release-aware, so everything it
    // returns belongs to released periods by definition.
    Promise.all([
      supabase.from('faculty_evaluations_anon').select('*'),
      supabase.from('academic_years').select('*, departments(name)'),
      fetchFacultyReleaseStatus().catch(() => []),
    ])
      .then(([evalRes, yearRes, statusRows]) => {
        const evals = evalRes.data || [];
        const years = yearRes.data || [];
        setReleaseStatus(statusRows || []);

        const allScores = evals
          .flatMap(e => Object.values(e.ratings || {}).map(Number));
        setOverallRating(allScores.length ? allScores.reduce((a, b) => a + b, 0) / allScores.length : null);
        setTotalResponses(evals.length);

        if (years.length > 0) {
          const active = pickActivePeriod(years, userProfile?.department) || years[0];
          setActiveYear({
            ...active,
            startDate: active.start_date,
            endDate: active.end_date,
          });
        }
      })
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  }, [currentUser]);

  const displayName = userProfile?.fullName || "Faculty";
  const firstName = displayName.split(" ")[0];



  // Phase 5: status of the ACTIVE period for banner + card.
  const activeStatus = activeYear
    ? releaseStatus.find(
        (r) => r.academic_year === activeYear.year && r.semester === activeYear.semester,
      )
    : null;
  // Evaluations exist in the base table even when the period is not
  // yet released — surface the true participation signal via the
  // status view rather than counting released rows only.
  const activeHasEvaluations = activeStatus ? activeStatus.has_evaluations : overallRating !== null;
  const activeReleased = activeStatus ? activeStatus.released : false;


  // Phase 6 [D6]: neutral escalation notice — booleans only, from
  // the SECURITY DEFINER RPC. Never any comment content.
  const [escalation, setEscalation] = useState(null);
  useEffect(() => {
    if (!activeYear) return;
    let cancelled = false;
    supabase.rpc("get_faculty_escalation_status", {
      p_year: activeYear.year,
      p_semester: activeYear.semester,
    })
      .then(({ data }) => {
        if (!cancelled) setEscalation(Array.isArray(data) && data.length > 0 ? data[0] : null);
      })
      .catch(() => {
        if (!cancelled) setEscalation(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeYear]);

  const getPerformanceLabel = (rating) => {
    if (!rating) return "N/A";
    if (rating >= 4.5) return "Outstanding";
    if (rating >= 4.0) return "Excellent";
    if (rating >= 3.5) return "Very Good";
    if (rating >= 3.0) return "Good";
    return "Needs Improvement";
  };

  return (
    <FacultyLayout breadcrumb="Dashboard">
      <section className="fd-content">
        {/* Modern Integrated Executive Header */}
        <div className="fd-welcomeHeader">
          <div className="fd-welcomeText">
            <span className="fd-welcomeBadge">Faculty Portal</span>
            <h2 className="fd-title">Welcome back, {firstName}!</h2>
            <p className="fd-subtitle">Overview of your teaching evaluation results and academic performance</p>
          </div>
          <div className="fd-periodCard">
            <div className="fd-periodHeader">
              <span className={`fd-periodDot ${!activeReleased ? "fd-periodDot--pending" : ""}`} />
              <span className="fd-periodLabel">Active Evaluation Period</span>
            </div>
            <div className="fd-periodTitle">
              {activeYear ? `${activeYear.year} • ${activeYear.semester}` : "No Active Period"}
            </div>
            {activeYear && (
              <div className="fd-periodMeta">
                {activeReleased ? "✓ Results Released" : "⏳ Pending Admin Release"}
              </div>
            )}
          </div>
        </div>

        {/* Phase 6 [D6]: neutral escalation banner */}
        {escalation?.has_escalation && (
          <div className="fd-alertBanner fd-alertBanner--escalation">
            <div className="fd-alertBannerIcon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </div>
            <div>
              <strong style={{ color: "#1e293b" }}>Evaluation Notice: </strong>
              {escalation.all_resolved
                ? "A concern raised through the evaluation system has been reviewed and resolved by the administrator. No action is needed from you."
                : "A concern raised through the evaluation system is being reviewed by the administrator. You do not need to take any action."}
            </div>
          </div>
        )}

        {/* Phase 5 [D4]: pending-release notice for active period */}
        {activeYear && !activeReleased && (
          <div className="fd-alertBanner fd-alertBanner--warning">
            <div className="fd-alertBannerIcon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <div>
              <strong style={{ color: "#78350f" }}>Results Pending Release: </strong>
              Evaluation results for <strong>{activeYear.year} {activeYear.semester}</strong> are currently finalized in the system. They will automatically unlock and display here once approved and published by the administration.
            </div>
          </div>
        )}

        {/* 3-Card Executive Stats Grid */}
        <div className="fd-statsGrid">
          {/* Card 1: Overall Rating */}
          <div className="fd-statCard">
            <div className="fd-statCard--header">
              <div className="fd-statLabel">OVERALL RATING</div>
              <div className="fd-statIcon fd-statIcon--rating">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
              </div>
            </div>
            <div className="fd-statNum">
              {loading ? "—" : activeReleased ? (overallRating !== null ? overallRating.toFixed(1) : "N/A") : "Pending"}
              {activeReleased && overallRating !== null && (
                <span style={{ fontSize: "16px", color: "#94a3b8", fontWeight: 600, marginLeft: "4px" }}>/ 5.0</span>
              )}
            </div>
            <div className="fd-statTitle">
              {loading
                ? "Calculating ratings..."
                : activeReleased && overallRating !== null
                  ? `${getPerformanceLabel(overallRating)} performance standing`
                  : "Awaiting admin release approval"}
            </div>
          </div>

          {/* Card 2: Student Responses */}
          <div className="fd-statCard">
            <div className="fd-statCard--header">
              <div className="fd-statLabel">STUDENT RESPONSES</div>
              <div className="fd-statIcon fd-statIcon--responses">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </div>
            </div>
            <div className="fd-statNum">{loading ? "—" : totalResponses ?? 0}</div>
            <div className="fd-statTitle">Total evaluation forms submitted</div>
          </div>

          {/* Card 3: Release Status */}
          <div className="fd-statCard">
            <div className="fd-statCard--header">
              <div className="fd-statLabel">PERIOD STATUS</div>
              <div className="fd-statIcon fd-statIcon--period">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
              </div>
            </div>
            <div className="fd-statNum" style={{ fontSize: "24px", paddingTop: "6px", paddingBottom: "6px" }}>
              {loading ? "—" : activeReleased ? "Published" : "Pending"}
            </div>
            <div className="fd-statTitle">
              {activeReleased
                ? "Results are live and visible to faculty"
                : "Awaiting admin release publication"}
            </div>
          </div>
        </div>

        {/* Modern Active Period Overview Card */}
        <div className="fd-overviewCard">
          <div className="fd-overviewHeader">
            <h3 className="fd-overviewTitle">Current Evaluation Overview</h3>
            <span className="fd-criteriaPillMain" style={{ background: activeReleased ? "#dcfce7" : "#fef3c7", color: activeReleased ? "#15803d" : "#b45309" }}>
              {activeReleased ? "✓ Published" : "⏳ Pending Release"}
            </span>
          </div>

          <div className="fd-overviewGrid">
            {/* Faculty Info */}
            <div className="fd-overviewUserCell">
              <div className="fd-overviewAvatar">
                {(displayName || "FC").substring(0, 2).toUpperCase()}
              </div>
              <div>
                <div className="fd-overviewName">{displayName}</div>
                <div className="fd-overviewRole">{userProfile?.department ? `${userProfile.department} Department` : "Faculty Member"}</div>
              </div>
            </div>

            {/* Academic Period */}
            <div className="fd-overviewMetaBlock">
              <span className="fd-overviewMetaLabel">Evaluation Cycle</span>
              <span className="fd-overviewMetaValue">
                {activeYear ? `${activeYear.year} • ${activeYear.semester}` : "—"}
              </span>
            </div>

            {/* CTA Action */}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="fd-overviewBtn"
                onClick={() => navigate("/faculty/evaluations")}
              >
                <span>View Full Results</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </section>
    </FacultyLayout>
  );
}
