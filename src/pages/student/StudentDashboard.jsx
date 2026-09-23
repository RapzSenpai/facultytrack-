import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../config/supabase";
import { isAssignmentMatch } from "../../utils/assignmentMatch";
import {
  Calendar,
  Check,
  Clock,
  Users,
  ChevronRight,
  Info,
  ArrowRight,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import StudentLayout from "./StudentLayout";

export default function StudentDashboard() {
  const [stats, setStats] = useState({ total: 0, evaluated: 0, pending: 0, open: 0 });
  const [activeYear, setActiveYear] = useState(null);
  const [loading, setLoading] = useState(true);
  const [recentActivity, setRecentActivity] = useState([]);

  const [assignedFaculty, setAssignedFaculty] = useState([]);
  const [submissionsData, setSubmissionsData] = useState(new Map());

  // Phase 3 [Req 2 / D5]: in-app subject-list correction requests.
  const [showReportIssue, setShowReportIssue] = useState(false);
  const [reportMessage, setReportMessage] = useState("");
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState("");
  const [myRequests, setMyRequests] = useState([]);

  const { currentUser, userProfile } = useAuth();
  const navigate = useNavigate();

  const dept = userProfile?.department || userProfile?.dept || "—";
  const yearLevel = userProfile?.yearLevel || userProfile?.year || "—";
  const section = userProfile?.section || "—";

  useEffect(() => {
    if (!currentUser || !userProfile) return;

    const studentDept = userProfile.department || userProfile.dept || "";
    const studentYear = userProfile.yearLevel || userProfile.year || "";
    const studentSection = userProfile.section || "";

    (async () => {
      try {
        const [assignmentsRes, submissionsRes, yearsRes, enrollmentRes] = await Promise.all([
          supabase.from("class_assignments").select("*"),
          supabase.from("evaluations").select("*").eq("student_id", currentUser.id),
          supabase.from("academic_years").select("*"),
          supabase.from("student_enrollments")
            .select("confirmed_assignments, excluded_assignments, enrollment_kind, academic_year, semester")
            .eq("student_id", currentUser.id),
        ]);

        const assignments = (assignmentsRes.data || []).map((a) => ({
          id: a.id,
          facultyId: a.faculty_id,
          facultyName: a.faculty_name,
          subjectCode: a.subject_code,
          subjectName: a.subject_name,
          department: a.department,
          yearLevel: a.year_level,
          section: a.section,
          semester: a.semester,
          academicYear: a.academic_year,
        }));

        const submissions = (submissionsRes.data || []).map((s) => ({
          assignmentId: s.assignment_id,
          ratings: s.ratings,
          comment: s.comment,
          submittedAt: s.submitted_at,
        }));

        const years = (yearsRes.data || []).map((y) => ({
          id: y.id,
          year: y.year,
          semester: y.semester,
          startDate: y.start_date,
          endDate: y.end_date,
          status: y.status,
        }));

        const active = years.find((y) => (y.status || "").toLowerCase().trim() === "on-going") || null;
        setActiveYear(active);

        const subMap = new Map();
        submissions.forEach((s) => {
          subMap.set(s.assignmentId, s);
        });
        setSubmissionsData(subMap);

        if (!active) {
          setStats({ total: 0, evaluated: 0, pending: 0, open: 0 });
          setAssignedFaculty([]);
          return;
        }

        const activeAssignments = assignments.filter(
          (a) => a.academicYear === active.year && a.semester === active.semester
        );

        // Admin per-student overrides (Phase 3): same semantics as
        // the submit-evaluation Edge Function — an admin/exception
        // list governs fully, otherwise section match ∪ confirmed
        // minus excluded.
        const enrollment = (enrollmentRes.data || []).find(
          (r) => r.academic_year === active.year && r.semester === active.semester
        ) || null;
        const confirmedSet = new Set(enrollment?.confirmed_assignments || []);
        const excludedSet = new Set(enrollment?.excluded_assignments || []);
        const isAdminList =
          enrollment?.enrollment_kind === "admin" ||
          enrollment?.enrollment_kind === "exception";

        // Automatic matching: directly match the student's department, year, and section
        // (exact normalized equality — mirrors the server gate).
        const matchedFaculty = activeAssignments
          .filter((a) => {
            if (excludedSet.has(a.id)) return false;
            if (isAdminList) return confirmedSet.has(a.id);
            if (confirmedSet.has(a.id)) return true;
            return isAssignmentMatch(a, studentDept, studentYear, studentSection);
          })
          .map((a) => {
            const subData = subMap.get(a.id);
            return {
              assignmentId: a.id,
              facultyId: a.facultyId,
              name: a.facultyName || null,
              subject: `${a.subjectCode} - ${a.subjectName}`,
              subjectCode: a.subjectCode,
              dept: a.department,
              year: a.yearLevel,
              section: a.section,
              status: subData ? "submitted" : "pending",
              submittedAt: subData?.submittedAt || null,
            };
          });

        setAssignedFaculty(matchedFaculty);

        const evaluatedCount = matchedFaculty.filter((f) => f.status === "submitted").length;
        const openCount = matchedFaculty.filter((f) => f.status === "pending" && f.name).length;
        setStats({
          total: matchedFaculty.length,
          evaluated: evaluatedCount,
          pending: matchedFaculty.length - evaluatedCount,
          open: openCount,
        });

        // Recent activity feed from submitted evaluations
        const activities = [];
        subMap.forEach((sub, assignmentId) => {
          const match = assignments.find((a) => a.id === assignmentId);
          const ts = sub.submittedAt;
          const date = ts ? new Date(ts) : null;
          activities.push({
            type: "submitted",
            label: "Submitted evaluation",
            detail: match ? `${match.subjectCode || ""} (${match.subjectName || ""})` : "Evaluation",
            date,
          });
        });

        activities.sort((a, b) => {
          if (!a.date && !b.date) return 0;
          if (!a.date) return 1;
          if (!b.date) return -1;
          return b.date - a.date;
        });
        setRecentActivity(activities.slice(0, 5));
      } catch (err) {
        console.error("StudentDashboard fetch error:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, [currentUser, userProfile]);

  const displayName = userProfile?.fullName || "Student";
  const firstName = displayName.split(" ")[0];

  const loadMyRequests = async () => {
    if (!currentUser) return;
    const { data } = await supabase
      .from("subject_correction_requests")
      .select("id, message, status, resolution_note, created_at")
      .eq("student_id", currentUser.id)
      .order("created_at", { ascending: false });
    setMyRequests(data || []);
  };

  useEffect(() => {
    loadMyRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  const submitCorrectionRequest = async () => {
    const message = reportMessage.trim();
    if (!message) {
      setReportError("Please describe the issue with your subject list.");
      return;
    }
    setReportBusy(true);
    setReportError("");
    try {
      const { error } = await supabase.from("subject_correction_requests").insert({
        student_id: currentUser.id,
        message,
      });
      if (error) throw error;
      setReportMessage("");
      setShowReportIssue(false);
      await loadMyRequests();
    } catch (err) {
      setReportError(err.message || "Could not submit your request. Please try again.");
    } finally {
      setReportBusy(false);
    }
  };

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  const ayEndDate = activeYear?.endDate ? new Date(activeYear.endDate + "T23:59:59") : null;
  const isEvaluationOpen =
    !loading && activeYear !== null && (!ayEndDate || now <= ayEndDate);

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
          <div className="se-tableCard sdb-subjectsCard">
            <div className="se-tableHeader">
              <div>
                <h3 className="se-tableTitle">Assigned Subjects & Teachers</h3>
                <p className="se-tableHint">
                  These are your assigned subjects and teachers for this semester.
                </p>
              </div>
            </div>

            <div className="se-tableWrap">
              <table className="sd-table">
                <thead>
                  <tr>
                    <th>FACULTY NAME</th>
                    <th>SUBJECT</th>
                    <th>SECTION</th>
                    <th style={{ textAlign: "right" }}>ACTION</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan="4" style={{ textAlign: "center", padding: "40px", color: "#9ca3af" }}>
                        Loading assigned subjects...
                      </td>
                    </tr>
                  ) : assignedFaculty.length === 0 ? (
                    <tr>
                      <td colSpan="4" style={{ textAlign: "center", padding: "40px", color: "#9ca3af" }}>
                        No subjects assigned for your section ({dept} {yearLevel} - Section {section}) this semester.
                      </td>
                    </tr>
                  ) : (
                    assignedFaculty.map((item) => (
                      <tr key={item.assignmentId}>
                        <td>
                          <div className="sd-avatarCell">
                            <div className="sd-avatar sd-avatar--blue">
                              {(item.name || "??").substring(0, 2).toUpperCase()}
                            </div>
                            <div className="sd-cellLines">
                              <span className="sd-cellPrimary">{item.name || "— No faculty assigned"}</span>
                              <span className="sd-cellSecondary">Faculty Member</span>
                            </div>
                          </div>
                        </td>
                        <td className="sd-engagement">{item.subject}</td>
                        <td>
                          <span className="se-sectionBadge">
                            {item.dept} {item.year} - {item.section}
                          </span>
                        </td>
                        <td className="sd-tableActions" style={{ justifyContent: "flex-end" }}>
                          {item.status === "submitted" ? (
                            <span className="sdb-assignedBadge" title="Already evaluated">
                              <CheckCircle2 size={13} />
                              <span>Evaluated</span>
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="sdb-evaluatePillBtn"
                              onClick={() =>
                                navigate(
                                  `/student/evaluate?facultyId=${encodeURIComponent(item.facultyId || "")}&assignmentId=${encodeURIComponent(item.assignmentId || "")}`
                                )
                              }
                            >
                              Evaluate
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="se-enrollmentFooter">
              <p className="se-enrollmentNote">
                <Info size={14} />
                Click "Evaluate" or go to Evaluate Teacher to submit your evaluations.
              </p>
              <div className="sdb-footerActions">
                <button
                  type="button"
                  className="sdb-reportIssueBtn"
                  onClick={() => setShowReportIssue(true)}
                >
                  <AlertCircle size={14} />
                  <span>Report Subject Issue</span>
                </button>
                <button
                  type="button"
                  className="sdb-viewEvaluationsBtn"
                  onClick={() => navigate("/student/evaluate")}
                >
                  <span>Go to Evaluate Teacher</span>
                  <ArrowRight size={14} />
                </button>
              </div>
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
                ) : (
                  <span className="sdb-statusBadge sdb-statusBadge--closed">CLOSED</span>
                )}
              </div>
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

      {/* Phase 3: report a wrong subject list; admin resolves it. */}
      {showReportIssue && (
        <div className="se-modal" role="dialog" aria-modal="true">
          <div className="se-modalOverlay" onClick={() => setShowReportIssue(false)} />
          <div className="se-modalContent" style={{ maxWidth: "520px" }}>
            <div className="se-modalHeader">
              <div>
                <h3 className="se-modalTitle">Report Subject Issue</h3>
                <p className="se-modalSubtitle" style={{ margin: "4px 0 0", fontSize: "13px", color: "#6b7280" }}>
                  Wrong subject or teacher on your list? Tell your admin — they will correct it.
                </p>
              </div>
              <button type="button" className="se-modalClose" onClick={() => setShowReportIssue(false)}>
                ✕
              </button>
            </div>
            <div className="se-modalBody">
              <textarea
                value={reportMessage}
                onChange={(e) => setReportMessage(e.target.value)}
                rows={4}
                maxLength={1000}
                placeholder="Example: I am in BSIT 2-A but I see subjects for BSIT 2-B…"
                style={{ width: "100%", padding: "10px 12px", borderRadius: "8px", border: "1px solid #e5e7eb", fontSize: "14px", resize: "vertical" }}
              />
              {reportError && (
                <p style={{ color: "#dc2626", fontSize: "13px", margin: "8px 0 0" }}>{reportError}</p>
              )}
              {myRequests.length > 0 && (
                <div style={{ marginTop: "16px" }}>
                  <h4 style={{ fontSize: "13px", fontWeight: 700, color: "#374151", marginBottom: "8px" }}>
                    My reports
                  </h4>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "220px", overflowY: "auto" }}>
                    {myRequests.map((r) => (
                      <div key={r.id} style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: "8px", padding: "10px 12px", fontSize: "13px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", alignItems: "center" }}>
                          <span style={{ fontWeight: 600, textTransform: "capitalize", color: r.status === "new" ? "#d97706" : r.status === "resolved" ? "#16a34a" : "#6b7280" }}>
                            {r.status}
                          </span>
                          <span style={{ color: "#9ca3af", fontSize: "12px" }}>
                            {r.created_at ? new Date(r.created_at).toLocaleDateString() : ""}
                          </span>
                        </div>
                        <p style={{ margin: "6px 0 0", color: "#374151" }}>{r.message}</p>
                        {r.resolution_note && (
                          <p style={{ margin: "6px 0 0", color: "#16a34a" }}>Admin: {r.resolution_note}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="se-modalFooter">
              <button type="button" className="se-modalBtn se-modalBtn--cancel" onClick={() => setShowReportIssue(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="se-modalBtn se-modalBtn--submit"
                onClick={submitCorrectionRequest}
                disabled={reportBusy}
              >
                {reportBusy ? "Sending..." : "Send Report"}
              </button>
            </div>
          </div>
        </div>
      )}
    </StudentLayout>
  );
}
