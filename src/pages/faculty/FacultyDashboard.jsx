import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../config/supabase";
import FacultyLayout from "./FacultyLayout";
import { fetchFacultyReleaseStatus } from "../../utils/releaseStatus";
import {
  pickActivePeriod,
  isPeriodActive,
  periodNotStarted,
  periodEndPassed,
} from "../../utils/periodStatus";
import {
  Calendar,
  Award,
  MessageSquare,
  BookOpen,
  TrendingUp,
  ShieldCheck,
  ChevronRight,
  Clock,
  CheckCircle2,
  GraduationCap,
} from "lucide-react";

export default function FacultyDashboard() {
  const [overallRating, setOverallRating] = useState(null);
  const [totalResponses, setTotalResponses] = useState(null);
  const [activeYear, setActiveYear] = useState(null);
  const [loading, setLoading] = useState(true);
  const [assignedClasses, setAssignedClasses] = useState([]);
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
      supabase.from("faculty_evaluations_anon").select("*"),
      supabase.from("academic_years").select("*, departments(name)"),
      fetchFacultyReleaseStatus().catch(() => []),
      supabase.from("class_assignments").select("*"),
      supabase.from("questions").select("*"),
      supabase.from("criteria").select("*"),
    ])
      .then(([evalRes, yearRes, statusRows, classRes, questRes, critRes]) => {
        const rawEvals = evalRes.data || [];
        const years = yearRes.data || [];
        const statuses = statusRows || [];
        const classes = classRes.data || [];
        const rawQuestions = questRes.data || [];
        const criteria = critRes.data || [];

        const questions = rawQuestions.map((q) => ({
          ...q,
          criteriaId: q.criteria_id,
        }));

        setAssignedClasses(classes);

        // Exclude data from deleted academic periods
        const existingPeriodKeys = new Set(
          years.map((y) => `${y.year}__${y.semester}`)
        );

        const filteredStatuses = statuses.filter((s) =>
          existingPeriodKeys.has(`${s.academic_year}__${s.semester}`)
        );
        setReleaseStatus(filteredStatuses);

        const releasedKeys = new Set(
          filteredStatuses
            .filter((s) => s.released)
            .map((s) => `${s.academic_year}__${s.semester}`)
        );

        const active = pickActivePeriod(years, userProfile?.department);
        if (active) {
          setActiveYear({
            ...active,
            startDate: active.start_date,
            endDate: active.end_date,
          });
        } else {
          setActiveYear(null);
        }

        // Target the active period if picked, else fallback to latest period
        const targetYear = active?.year;
        const targetSemester = active?.semester;
        const targetKey = targetYear && targetSemester ? `${targetYear}__${targetSemester}` : null;
        const isTargetReleased = targetKey ? releasedKeys.has(targetKey) : false;

        const evals = rawEvals.map((e) => ({
          ...e,
          academicYear: e.academic_year,
        }));

        const periodEvals = evals.filter((e) => {
          if (targetYear && targetSemester) {
            return e.academicYear === targetYear && e.semester === targetSemester;
          }
          return existingPeriodKeys.has(`${e.academicYear}__${e.semester}`);
        });

        setTotalResponses(periodEvals.length);

        // Calculate institutional category-weighted rating matching FacultyEvalResult
        if (periodEvals.length > 0 && isTargetReleased) {
          const qScores = {};
          periodEvals.forEach((ev) => {
            Object.entries(ev.ratings || {}).forEach(([qId, score]) => {
              if (!qScores[qId]) qScores[qId] = [];
              qScores[qId].push(Number(score));
            });
          });

          const activeOrHistoricalCriteria = criteria.filter((c) => {
            const hasRatingsInPeriod = questions.some(
              (q) => q.criteriaId === c.id && qScores[q.id]?.length > 0
            );
            return hasRatingsInPeriod || c.enabled;
          });

          const categories = activeOrHistoricalCriteria
            .map((c) => {
              const cQuestions = questions.filter((q) => {
                if (q.criteriaId !== c.id) return false;
                if (periodEvals.length > 0) {
                  return qScores[q.id] && qScores[q.id].length > 0;
                }
                return q.is_active !== false;
              });
              const items = cQuestions.map((q) => {
                const scores = qScores[q.id] || [];
                return {
                  rating: scores.length
                    ? scores.reduce((a, b) => a + b, 0) / scores.length
                    : 0,
                };
              });
              return {
                id: c.id,
                rating: items.length
                  ? items.reduce((a, b) => a + b.rating, 0) / items.length
                  : 0,
                items,
              };
            })
            .filter((c) => c.items.length > 0);

          const finalOverall = categories.length
            ? categories.reduce((a, b) => a + b.rating, 0) / categories.length
            : null;

          setOverallRating(finalOverall);
        } else if (!isTargetReleased) {
          setOverallRating(null);
        } else {
          setOverallRating(null);
        }
      })
      .catch((err) => console.error("Faculty dashboard fetch error:", err))
      .finally(() => setLoading(false));
  }, [currentUser, userProfile?.department]);

  const displayName = userProfile?.fullName || "Faculty";
  const firstName = displayName.split(" ")[0];

  const now = new Date();
  const hour = now.getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  // Phase 5: status of the ACTIVE period for banner + card.
  const activeStatus = activeYear
    ? releaseStatus.find(
        (r) =>
          r.academic_year === activeYear.year &&
          r.semester === activeYear.semester
      )
    : null;
  const activeReleased = activeStatus ? activeStatus.released : false;

  // Active period timeline checks (consistent with Student & Admin dashboards)
  const isPeriodEnded = activeYear ? periodEndPassed(activeYear, now) : false;
  const isPeriodScheduled = activeYear
    ? periodNotStarted(activeYear, now)
    : false;
  const isEvaluationOpen =
    !loading && activeYear !== null && isPeriodActive(activeYear, now);

  // Filter assigned classes for the active period
  const normSem = (s) =>
    String(s || "")
      .toLowerCase()
      
      .replace(/[^a-z0-9]/g, "");
  const periodClasses = activeYear
    ? assignedClasses.filter((c) => {
        const matchY =
          !c.academic_year ||
          String(c.academic_year).trim() === String(activeYear.year).trim();
        const matchS =
          !c.semester || normSem(c.semester) === normSem(activeYear.semester);
        return matchY && matchS;
      })
    : assignedClasses;
  const activeClasses =
    periodClasses.length > 0 ? periodClasses : assignedClasses;

  // Phase 6 [D6]: neutral escalation notice — booleans only, from
  // the SECURITY DEFINER RPC. Never any comment content.
  const [escalation, setEscalation] = useState(null);
  useEffect(() => {
    if (!activeYear) return;
    let cancelled = false;
    supabase
      .rpc("get_faculty_escalation_status", {
        p_year: activeYear.year,
        p_semester: activeYear.semester,
      })
      .then(({ data }) => {
        if (!cancelled)
          setEscalation(Array.isArray(data) && data.length > 0 ? data[0] : null);
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
        {/* Modern Integrated Executive Header (Uniform with Admin & Student) */}
        <div className="fd-welcomeHeader">
          <div className="fd-welcomeText">
            <span className="fd-welcomeRolePill">
              <GraduationCap size={13} />
              {userProfile?.department
                ? `${userProfile.department} • Faculty Member`
                : "College Faculty"}
            </span>
            <h2 className="fd-title">
              {greeting}, <span className="fd-titleHighlight">{displayName}</span>!
            </h2>
            <p className="fd-subtitle">
              Overview of your teaching evaluation results and academic performance
            </p>
          </div>

          {/* Period Card matching Admin & Student header card */}
          <div className="fd-periodCard">
            <div className="fd-periodCardIcon">
              <Calendar size={22} />
            </div>
            <div className="fd-periodCardInfo">
              <span className="fd-periodCardLabel">Current Academic Period</span>
              <div className="fd-periodCardTitle">
                {activeYear
                  ? `${activeYear.year} • ${activeYear.semester}`
                  : "No Active Period"}
              </div>
              <div className="fd-periodCardStatus">
                Evaluation Status:{" "}
                {activeYear ? (
                  <span
                    className={`fd-statusBadge ${
                      activeReleased
                        ? "fd-statusBadge--released"
                        : isEvaluationOpen
                        ? "fd-statusBadge--open"
                        : isPeriodScheduled
                        ? "fd-statusBadge--scheduled"
                        : "fd-statusBadge--pending"
                    }`}
                  >
                    {activeReleased
                      ? "Results Released"
                      : isEvaluationOpen
                      ? "Evaluation Open"
                      : isPeriodScheduled
                      ? "Scheduled"
                      : "Pending Release"}
                  </span>
                ) : (
                  <span className="fd-statusBadge fd-statusBadge--closed">
                    Closed
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Phase 6 [D6]: neutral escalation banner */}
        {escalation?.has_escalation && (
          <div className="fd-alertBanner fd-alertBanner--escalation">
            <div className="fd-alertBannerIcon">
              <ShieldCheck size={20} color="#475569" />
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
              <Clock size={20} color="#d97706" />
            </div>
            <div>
              <strong style={{ color: "#78350f" }}>
                Pending Administrative Release:{" "}
              </strong>
              Student evaluations for the current period have closed. Numerical
              ratings and qualitative summaries will unlock immediately upon
              Dean / VPAA publication approval.
            </div>
          </div>
        )}

        {/* 4-Card Executive Stats Grid */}
        <div className="fd-statsGrid">
          {/* Card 1: Overall Rating (Blue) */}
          <div className="fd-statCard fd-statCard--rating">
            <div className="fd-statCard--header">
              <span className="fd-statLabel">Overall Rating</span>
              <div className="fd-statIcon fd-statIcon--rating">
                <Award size={19} />
              </div>
            </div>
            <div className="fd-statMainRow">
              <div className="fd-statNum">
                {loading
                  ? "—"
                  : activeReleased
                  ? overallRating !== null
                    ? overallRating.toFixed(1)
                    : "N/A"
                  : "Pending"}
                {activeReleased && overallRating !== null && (
                  <span className="fd-statScale">/ 5.0</span>
                )}
              </div>
            </div>
            <div className="fd-statTitle">
              {loading
                ? "Calculating ratings..."
                : activeReleased && overallRating !== null
                ? "Institutional performance standing"
                : "Awaiting administrative publication"}
            </div>
          </div>

          {/* Card 2: Student Forms (Green) */}
          <div className="fd-statCard fd-statCard--responses">
            <div className="fd-statCard--header">
              <span className="fd-statLabel">Student Evaluations</span>
              <div className="fd-statIcon fd-statIcon--responses">
                <MessageSquare size={19} />
              </div>
            </div>
            <div className="fd-statMainRow">
              <div className="fd-statNum">
                {loading ? "—" : totalResponses ?? 0}
              </div>
            </div>
            <div className="fd-statTitle">
              {loading
                ? "Loading forms..."
                : "Total student submissions recorded"}
            </div>
          </div>

          {/* Card 3: Teaching Load (Orange) */}
          <div className="fd-statCard fd-statCard--load">
            <div className="fd-statCard--header">
              <span className="fd-statLabel">Teaching Load</span>
              <div className="fd-statIcon fd-statIcon--load">
                <BookOpen size={19} />
              </div>
            </div>
            <div className="fd-statMainRow">
              <div className="fd-statNum">
                {loading ? "—" : activeClasses.length}
              </div>
            </div>
            <div className="fd-statTitle">
              {loading
                ? "Loading classes..."
                : "Class sections assigned this cycle"}
            </div>
          </div>

          {/* Card 4: Cycle Status (Purple) */}
          <div className="fd-statCard fd-statCard--period">
            <div className="fd-statCard--header">
              <span className="fd-statLabel">Cycle Status</span>
              <div className="fd-statIcon fd-statIcon--period">
                <TrendingUp size={19} />
              </div>
            </div>
            <div className="fd-statMainRow">
              <div className="fd-statNum fd-statNum--status">
                {loading
                  ? "—"
                  : activeReleased
                  ? "Published"
                  : "Pending"}
              </div>
            </div>
            <div className="fd-statTitle">
              {activeReleased
                ? "Results live & visible to faculty"
                : "Evaluation awaiting release approval"}
            </div>
          </div>
        </div>

        {/* Two-Tier Balanced Dashboard Layout */}
        <div className="fd-dashboardGrid">
          {/* Top Row: Current Evaluation Overview (Left) & Academic Period Details (Right) */}
          <div className="fd-overviewRow">
            {/* 1. Current Evaluation Overview Card */}
            <div className="fd-card fd-overviewProfileCard">
              <div className="fd-cardHeader">
                <h3 className="fd-cardTitle">Current Evaluation Overview</h3>
                <span className="fd-verifiedLoadBadge">
                  <CheckCircle2 size={13} />
                  Verified Teaching Load
                </span>
              </div>

              <div className="fd-profileOverviewBody">
                <div className="fd-overviewUserCell">
                  <div className="fd-overviewAvatar">
                    {(displayName || "FC").substring(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div className="fd-overviewName">{displayName}</div>
                    <div className="fd-overviewRole">
                      {userProfile?.department
                        ? `${userProfile.department} • Full-Time Faculty`
                        : "College Faculty Member"}
                    </div>
                  </div>
                </div>

                <div className="fd-overviewMiniGrid">
                  <div className="fd-overviewMiniCard">
                    <div className="fd-miniCardIcon fd-miniCardIcon--blue">
                      <BookOpen size={16} />
                    </div>
                    <div>
                      <span className="fd-miniCardLabel">Instructional Load</span>
                      <span className="fd-miniCardValue">
                        {loading
                          ? "—"
                          : `${activeClasses.length} Active ${
                              activeClasses.length === 1 ? "Section" : "Sections"
                            }`}
                      </span>
                    </div>
                  </div>
                  <div className="fd-overviewMiniCard">
                    <div className="fd-miniCardIcon fd-miniCardIcon--purple">
                      <GraduationCap size={16} />
                    </div>
                    <div>
                      <span className="fd-miniCardLabel">Department</span>
                      <span className="fd-miniCardValue">
                        {userProfile?.department || "General Faculty"}
                      </span>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  className="fd-overviewBtn fd-overviewBtn--full"
                  onClick={() => navigate("/faculty/evaluations")}
                >
                  <span>View Full Evaluation Breakdown</span>
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>

            {/* 2. Academic Period Details Card */}
            <div className="fd-card fd-periodDetailsCard">
              <div className="fd-cardHeader">
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  <Calendar size={18} className="fd-cardHeaderIcon" />
                  <h3 className="fd-cardTitle">Academic Period Details</h3>
                </div>
                {activeYear && (
                  <span className="fd-termPill">
                    {activeYear.year}
                  </span>
                )}
              </div>

              <div className="fd-periodRows">
                <div className="fd-periodRow">
                  <div className="fd-periodRowLeft">
                    <span className="fd-rowDot fd-rowDot--blue"></span>
                    <span className="fd-periodRowLabel">Current Semester</span>
                  </div>
                  <span className="fd-periodRowValue">
                    {activeYear ? activeYear.semester : "—"}
                  </span>
                </div>
                <div className="fd-periodRow">
                  <div className="fd-periodRowLeft">
                    <span className="fd-rowDot fd-rowDot--indigo"></span>
                    <span className="fd-periodRowLabel">Academic Year</span>
                  </div>
                  <span className="fd-periodRowValue">
                    {activeYear ? activeYear.year : "—"}
                  </span>
                </div>
                <div className="fd-periodRow">
                  <div className="fd-periodRowLeft">
                    <span className="fd-rowDot fd-rowDot--green"></span>
                    <span className="fd-periodRowLabel">Results Release</span>
                  </div>
                  <span
                    className={`fd-statusBadgeSmall ${
                      activeReleased
                        ? "fd-statusBadgeSmall--released"
                        : "fd-statusBadgeSmall--pending"
                    }`}
                  >
                    {activeReleased ? "✓ Published" : "⏳ Pending Release"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Bottom Full-Width Table: Assigned Teaching Sections */}
          <div className="fd-card fd-tableSectionCard">
            <div className="fd-cardHeader">
              <div>
                <h3 className="fd-cardTitle">Assigned Class Sections</h3>
                <p className="fd-cardSubtitle">
                  Classes under your instructional load for{" "}
                  {activeYear
                    ? `${activeYear.year} • ${activeYear.semester}`
                    : "this academic period"}
                  .
                </p>
              </div>
              <span className="fd-countBadge">
                {loading
                  ? "Loading..."
                  : `${activeClasses.length} ${
                      activeClasses.length === 1 ? "Section" : "Sections"
                    }`}
              </span>
            </div>

            <div className="fd-tableWrap">
              <table className="fd-table">
                <thead>
                  <tr>
                    <th>Subject Code</th>
                    <th>Subject Description</th>
                    <th>Section</th>
                    <th>Year Level</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td
                        colSpan="4"
                        style={{
                          textAlign: "center",
                          padding: "24px",
                          color: "#64748b",
                        }}
                      >
                        Loading class sections...
                      </td>
                    </tr>
                  ) : activeClasses.length > 0 ? (
                    activeClasses.map((cls, idx) => (
                      <tr key={cls.id || idx}>
                        <td>
                          <span className="fd-codePill">
                            {cls.subject_code || "N/A"}
                          </span>
                        </td>
                        <td style={{ fontWeight: 600 }}>
                          {cls.subject_name || "—"}
                        </td>
                        <td>
                          <span className="fd-sectionBadge">
                            {cls.section || "—"}
                          </span>
                        </td>
                        <td style={{ color: "#64748b" }}>
                          {cls.year_level || "—"}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        colSpan="4"
                        style={{
                          textAlign: "center",
                          padding: "28px 16px",
                          color: "#64748b",
                        }}
                      >
                        No class assignments registered for this period.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>
    </FacultyLayout>
  );
}
