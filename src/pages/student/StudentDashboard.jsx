import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useStudentAssignments } from "../../hooks/useStudentAssignments";
import { periodEndPassed, isPeriodActive, periodNotStarted } from "../../utils/periodStatus";
import {
  Calendar,
  Check,
  Clock,
  Users,
  ChevronRight,
  Lock,
} from "lucide-react";
import StudentLayout from "./StudentLayout";

const INSTRUCTIONS_COL1 = [
  {
    step: 1,
    title: "Check the evaluation period",
    text: "Look at the Academic Period card. You can only evaluate when the status is OPEN.",
  },
  {
    step: 2,
    title: "Go to Evaluate Teacher",
    text: "Open it from the sidebar and choose a subject and teacher from your list.",
  },
  {
    step: 3,
    title: "Read the rating scale",
    text: "Understand what each rating means before you start.",
  },
  {
    step: 4,
    title: "Answer every rating item",
    text: "Rate your actual experience this semester.",
  },
];

const INSTRUCTIONS_COL2 = [
  {
    step: 5,
    title: "Add a respectful comment",
    text: "Optional. Be specific and constructive. No names or personal attacks.",
  },
  {
    step: 6,
    title: "Review and submit",
    text: "Each teacher can be evaluated only once, and submissions are final.",
  },
  {
    step: 7,
    title: "Something missing or wrong?",
    text: "Open My Reports and tell your admin what needs correcting.",
  },
  {
    step: 8,
    title: "Track your reports",
    text: "See the status and admin replies in My Reports.",
  },
];

export default function StudentDashboard() {
  const { currentUser, userProfile } = useAuth();
  const { stats, activeYear, loading } = useStudentAssignments(currentUser, userProfile);
  const navigate = useNavigate();

  const dept = userProfile?.department || userProfile?.dept || "—";

  const displayName = userProfile?.fullName || "Student";
  const firstName = displayName.split(" ")[0];

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  const isPeriodEnded = activeYear ? periodEndPassed(activeYear, now) : false;
  const isPeriodScheduled = activeYear ? periodNotStarted(activeYear, now) : false;
  const isEvaluationOpen =
    !loading && activeYear !== null && isPeriodActive(activeYear, now);

  const evalProgress =
    stats.total > 0 ? Math.round((stats.evaluated / stats.total) * 100) : 0;

  const METRIC_CARDS = [
    {
      key: "assigned",
      label: "ASSIGNED",
      sublabel: "Total evaluations assigned",
      value: stats.total,
      icon: <Users size={22} />,
      color: "sdb-metric--blue",
    },
    {
      key: "open",
      label: "OPEN NOW",
      sublabel: "Evaluations available",
      value: stats.open,
      icon: <Clock size={22} />,
      color: "sdb-metric--yellow",
    },
    {
      key: "pending",
      label: "PENDING",
      sublabel: "Not yet submitted",
      value: stats.pending,
      icon: <Calendar size={22} />,
      color: "sdb-metric--purple",
    },
    {
      key: "completed",
      label: "COMPLETED",
      sublabel: "Successfully submitted",
      value: stats.evaluated,
      icon: <Check size={22} />,
      color: "sdb-metric--green",
    },
  ];

  return (
    <StudentLayout breadcrumb="Dashboard">
      <div className="sdb-welcomeCard">
        <div className="sdb-welcomeText">
          <h2 className="sdb-welcomeTitle">
            {greeting}, {firstName}!
          </h2>
          <p className="sdb-welcomeSub">Let's complete your faculty evaluations this semester.</p>
        </div>
        <div className="sdb-welcomeActions">
          <button
            type="button"
            className="sdb-startBtn"
            onClick={() => navigate("/student/evaluate")}
          >
            Evaluate Now <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="sdb-metrics">
        {METRIC_CARDS.map((card) => (
          <div key={card.key} className={`sdb-metricCard ${card.color}`}>
            <div className="sdb-metricTop">
              <span className="sdb-metricLabel">{card.label}</span>
              <span className="sdb-metricIcon">{card.icon}</span>
            </div>
            <div className="sdb-metricValue">{loading ? "—" : card.value}</div>
            <div className="sdb-metricSub">{card.sublabel}</div>
          </div>
        ))}
      </div>

      <div className="sdb-middleGrid">
        <div>
          <div className="se-tableCard sdb-instructionsCard">
            <div className="sdb-instrCardHeader">
              <h3 className="sdb-instrCardTitle">How to use FacultyTrack</h3>
              <p className="sdb-instrCardSubtitle">
                Follow these steps to complete your faculty evaluations.
              </p>
            </div>

            <div className="sdb-instrColumns">
              <div className="sdb-instrCol">
                {INSTRUCTIONS_COL1.map((item) => (
                  <div key={item.step} className="sdb-instrItem">
                    <span className="sdb-instrNum">{item.step}</span>
                    <div className="sdb-instrBody">
                      <span className="sdb-instrTitle">{item.title}</span>
                      <span className="sdb-instrText">{item.text}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="sdb-instrCol">
                {INSTRUCTIONS_COL2.map((item) => (
                  <div key={item.step} className="sdb-instrItem">
                    <span className="sdb-instrNum">{item.step}</span>
                    <div className="sdb-instrBody">
                      <span className="sdb-instrTitle">{item.title}</span>
                      <span className="sdb-instrText">{item.text}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="sdb-anonBanner">
              <Lock size={15} className="sdb-anonIcon" />
              <span>Your evaluation is anonymous. Teachers never see who submitted it.</span>
            </div>
          </div>
        </div>

        <div className="sdb-sideCol">
          <div className="sdb-card">
            <div className="sdb-cardHeader">
              <Calendar size={18} className="sdb-cardHeaderIcon" />
              <h3 className="sdb-cardTitle">Academic period</h3>
            </div>
            <div className="sdb-periodList">
              <div className="sdb-periodRow">
                <span className="sdb-periodLabel">Current Semester</span>
                <span className="sdb-periodValue">
                  {activeYear ? activeYear.semester : "—"}
                </span>
              </div>
              <div className="sdb-periodRow">
                <span className="sdb-periodLabel">Academic Year</span>
                <span className="sdb-periodValue">
                  {activeYear ? activeYear.year : "—"}
                </span>
              </div>
              <div className="sdb-periodRow">
                <span className="sdb-periodLabel">Evaluation Status</span>
                {loading ? (
                  <span className="sdb-statusBadge">—</span>
                ) : isEvaluationOpen ? (
                  <span className="sdb-statusBadge sdb-statusBadge--open">OPEN</span>
                ) : isPeriodScheduled ? (
                  <span className="sdb-statusBadge" style={{ background: '#eff6ff', color: '#1e40af', border: '1px solid #bfdbfe' }}>
                    SCHEDULED
                  </span>
                ) : isPeriodEnded ? (
                  <span className="sdb-statusBadge sdb-statusBadge--closed" title={`Deadline ended (${activeYear?.endDate || activeYear?.end_date})`}>
                    CLOSED (DEADLINE PASSED)
                  </span>
                ) : (
                  <span className="sdb-statusBadge sdb-statusBadge--closed">CLOSED</span>
                )}
              </div>
              {activeYear && isPeriodScheduled && (
                <p style={{ margin: "6px 0 0", fontSize: "11px", color: "#2563eb", lineHeight: "1.35" }}>
                  Evaluation period opens on {activeYear.startDate || activeYear.start_date}.
                </p>
              )}
              {activeYear && isPeriodEnded && (
                <p style={{ margin: "6px 0 0", fontSize: "11px", color: "#64748b", lineHeight: "1.35" }}>
                  Evaluation period closed on {activeYear.endDate || activeYear.end_date}.
                </p>
              )}
              {!loading && !activeYear && (
                <div style={{ margin: "10px 0 0", padding: "10px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "8px", fontSize: "11.5px", color: "#991b1b", lineHeight: "1.4" }}>
                  <strong>⚠️ No academic period loaded for your program ({dept || "Not set"}).</strong>
                  <div style={{ marginTop: "4px" }}>
                    The on-going academic period was created under <strong>BSIT</strong>. If your account program is not BSIT, or if your program is stored as full text, please ask your admin to update your program in <em>Student Management</em> or run Migration 031 in the Supabase SQL editor.
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="sdb-card">
            <div className="sdb-cardHeader">
              <Clock size={18} className="sdb-cardHeaderIcon" />
              <h3 className="sdb-cardTitle">Evaluation progress</h3>
            </div>
            <div className="sdb-progressWrap">
              <div className="sdb-progressBar">
                <div
                  className="sdb-progressFill"
                  style={{ width: loading ? "0%" : `${evalProgress}%` }}
                />
              </div>
              <span className="sdb-progressPct">{loading ? "—" : `${evalProgress}%`}</span>
            </div>
            <p className="sdb-progressText">
              {loading ? "Loading..." : `${stats.evaluated} of ${stats.total} evaluations completed`}
            </p>
            <button
              type="button"
              className="sdb-viewAllLink"
              onClick={() => navigate("/student/evaluate")}
            >
              View my evaluations <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>
    </StudentLayout>
  );
}
