import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../config/supabase";
import FacultyLayout from "./FacultyLayout";
import { fetchFacultyReleaseStatus, setGradesSubmitted } from "../../utils/releaseStatus";

export default function FacultyDashboard() {
  const [overallRating, setOverallRating] = useState(null);
  const [totalResponses, setTotalResponses] = useState(null);
  const [activeYear, setActiveYear] = useState(null);
  const [loading, setLoading] = useState(true);
  // Phase 5: release gating + grades-submitted [D2/D3]
  const [releaseStatus, setReleaseStatus] = useState([]);
  const [gradeSaving, setGradeSaving] = useState(false);
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
      supabase.from('academic_years').select('*'),
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
          const active = years.find(y => (y.status || "").toLowerCase().trim() === "on-going") || years[0];
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

  // Phase 5 [D3]: toggle "grades submitted" for the active period.
  const handleToggleGrades = async () => {
    if (!activeYear || gradeSaving) return;
    const year = activeYear.year;
    const semester = activeYear.semester;
    const current = releaseStatus.find(
      (r) => r.academic_year === year && r.semester === semester,
    );
    const next = !(current?.grades_submitted ?? false);
    setGradeSaving(true);
    try {
      await setGradesSubmitted(currentUser.id, year, semester, next);
      setReleaseStatus((prev) =>
        prev.some((r) => r.academic_year === year && r.semester === semester)
          ? prev.map((r) =>
              r.academic_year === year && r.semester === semester
                ? { ...r, grades_submitted: next }
                : r,
            )
          : [
              ...prev,
              { academic_year: year, semester, grades_submitted: next, released: false, has_evaluations: true },
            ],
      );
    } catch (err) {
      console.error("Failed to update grades-submitted status:", err);
      alert("Could not update the grades-submitted status. Please try again.");
    } finally {
      setGradeSaving(false);
    }
  };

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
  const activeGradesSubmitted = activeStatus ? activeStatus.grades_submitted : false;

  return (
    <FacultyLayout breadcrumb="Dashboard">
      <section className="fd-content">
        <div className="fd-welcomeHeader">
          <div>
            <h2 className="fd-title">Welcome, {firstName}!</h2>
            <p className="fd-subtitle">Overview of your evaluation results for the current period</p>
          </div>
        </div>

        <div className="fd-periodCard">
          <div className="fd-periodLabel">CURRENT PERIOD</div>
          <div className="fd-periodTitle">
            {activeYear
              ? `Academic Year: ${activeYear.year} ${activeYear.semester}`
              : "Academic Year: —"}
          </div>
        </div>

        {/* Phase 5 [D4]: pending-release notice for the active period. */}
        {activeYear && !activeReleased && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              background: "#fffbeb",
              border: "1px solid #fcd34d",
              borderRadius: "10px",
              padding: "14px 18px",
              marginBottom: "20px",
              color: "#92400e",
              fontSize: "14px",
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>
              Results for {activeYear.year} {activeYear.semester} are not yet released. They will appear automatically once the admin approves the release.
            </span>
          </div>
        )}

        {/* Phase 5 [D3]: self-mark grades-submitted status. */}
        {activeYear && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "12px",
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              borderRadius: "10px",
              padding: "14px 18px",
              marginBottom: "20px",
            }}
          >
            <div>
              <div style={{ fontSize: "13px", fontWeight: 700, color: "#334155", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                GRADES SUBMITTED
              </div>
              <div style={{ fontSize: "13px", color: "#64748b", marginTop: "2px" }}>
                Mark your grades for {activeYear.year} {activeYear.semester} as submitted (admins see this status when scheduling the release).
              </div>
            </div>
            <button
              type="button"
              disabled={gradeSaving}
              onClick={handleToggleGrades}
              style={{
                padding: "8px 18px",
                borderRadius: "8px",
                border: "none",
                cursor: gradeSaving ? "wait" : "pointer",
                fontWeight: 700,
                fontSize: "13px",
                whiteSpace: "nowrap",
                background: activeGradesSubmitted ? "#16a34a" : "#1d4ed8",
                color: "#fff",
                opacity: gradeSaving ? 0.6 : 1,
              }}
            >
              {gradeSaving ? "Saving…" : activeGradesSubmitted ? "Submitted ✓" : "Mark as Submitted"}
            </button>
          </div>
        )}

        <div className="fd-statsGrid">
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
            </div>
            <div className="fd-statTitle">
              {activeReleased ? "Average evaluation score" : "Awaiting admin release"}
            </div>
          </div>

          <div className="fd-statCard">
            <div className="fd-statCard--header">
              <div className="fd-statLabel">ASSIGNED</div>
              <div className="fd-statIcon fd-statIcon--responses">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </div>
            </div>
            <div className="fd-statNum">{loading ? "—" : totalResponses ?? 0}</div>
            <div className="fd-statTitle">Total evaluations assigned</div>
          </div>
        </div>

        <div className="fd-tableCard">
          <div className="fd-tableHeader">
            <h3 className="fd-tableTitle">EVALUATION DETAILS</h3>
          </div>
          <div className="fd-tableWrap">
            <table className="ad-table">
              <thead>
                <tr>
                  <th>FACULTY NAME</th>
                  <th>REVIEW PERIOD</th>
                  <th style={{ textAlign: 'right' }}>STATUS</th>
                </tr>
              </thead>
              <tbody>
                {!loading && activeHasEvaluations && activeReleased && activeYear ? (
                  <tr>
                    <td>
                      <div className="ad-avatarCell">
                        <div className="ad-avatar ad-avatar--blue">
                          {(displayName || '??').substring(0, 2).toUpperCase()}
                        </div>
                        <div className="ad-cellLines">
                          <span className="ad-cellPrimary">{displayName}</span>
                          <span className="ad-cellSecondary">Faculty Member</span>
                        </div>
                      </div>
                    </td>
                    <td className="ad-engagement">{activeYear.semester} | {activeYear.year}</td>
                    <td className="ad-tableActions" style={{ justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        className="ad-actionBtn--approve"
                        onClick={() => navigate("/faculty/evaluations")}
                      >
                        View Result
                      </button>
                    </td>
                  </tr>
                ) : (
                  <tr>
                    <td colSpan="3" style={{ textAlign: "center", padding: "20px", color: "#9ca3af" }}>
                      {loading
                        ? "Loading..."
                        : !activeReleased
                          ? "Results for the current period are pending admin release."
                          : activeHasEvaluations
                            ? "No evaluations yet for the current period."
                            : "No evaluations yet for the current period."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </FacultyLayout>
  );
}
