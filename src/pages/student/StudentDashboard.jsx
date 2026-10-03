import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../config/supabase";
import { isAssignmentMatch } from "../../utils/assignmentMatch";
import { pickActivePeriod } from "../../utils/periodStatus";
import { notifyAdminsForDepartment } from "../../utils/notifications";
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
  X,
  Send,
  FileText,
} from "lucide-react";
import StudentLayout from "./StudentLayout";

const ISSUE_CATEGORIES = [
  { id: "missing_subject", label: "Missing Subject", icon: "➕" },
  { id: "wrong_section", label: "Wrong Section", icon: "👥" },
  { id: "irregular", label: "Irregular Course", icon: "🔄" },
  { id: "duplicate", label: "Duplicate Subject", icon: "📑" },
  { id: "other", label: "Other", icon: "💬" },
];

export default function StudentDashboard() {
  const [stats, setStats] = useState({ total: 0, evaluated: 0, pending: 0, open: 0 });
  const [activeYear, setActiveYear] = useState(null);
  const [loading, setLoading] = useState(true);
  const [assignedFaculty, setAssignedFaculty] = useState([]);

  // Phase 3 [Req 2 / D5]: in-app subject-list correction requests.
  const [showReportIssue, setShowReportIssue] = useState(false);
  const [reportTab, setReportTab] = useState("submit"); // "submit" | "history"
  const [reportCategory, setReportCategory] = useState("missing_subject");
  const [reportSubjectId, setReportSubjectId] = useState("");
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
          supabase.from("academic_years").select("*, departments(name)"),
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

        const active = pickActivePeriod(years, studentDept) || null;
        setActiveYear(active);

        const subMap = new Map();
        submissions.forEach((s) => {
          subMap.set(s.assignmentId, s);
        });

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
              subject: a.subjectCode || a.subjectName || "—",
              subjectCode: a.subjectCode,
              subjectName: a.subjectName,
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
    const trimmed = reportMessage.trim();
    if (!trimmed) {
      setReportError("Please enter a description of the issue.");
      return;
    }
    if (trimmed.length < 10) {
      setReportError("Please provide a little more detail (at least 10 characters).");
      return;
    }

    setReportBusy(true);
    setReportError("");

    const categoryObj = ISSUE_CATEGORIES.find((c) => c.id === reportCategory) || ISSUE_CATEGORIES[0];
    const selectedSub = assignedFaculty.find((f) => f.assignmentId === reportSubjectId);
    const subDesc = selectedSub
      ? `${selectedSub.subjectCode || selectedSub.subjectName} (${selectedSub.name || "No faculty"})`
      : reportSubjectId === "not_listed"
      ? "Subject not listed"
      : "";

    const payloadMessage = `[${categoryObj.label}]${subDesc ? ` [${subDesc}]` : ""}: ${trimmed}`;

    try {
      const { error } = await supabase.from("subject_correction_requests").insert({
        student_id: currentUser.id,
        message: payloadMessage,
      });
      if (error) throw error;

      setReportMessage("");
      setReportSubjectId("");
      await loadMyRequests();
      setReportTab("history");

      // Notify administrators in real-time (department-scoped + super_admin)
      try {
        await notifyAdminsForDepartment({
          department: dept,
          departmentId: userProfile?.department_id || null,
          title: "New Subject Issue Reported",
          message: `${displayName} (${dept} ${yearLevel} - ${section}) reported: "${payloadMessage.substring(0, 80)}${payloadMessage.length > 80 ? "..." : ""}"`,
          type: "warning",
          link: "/admin/subject-corrections",
        });
      } catch (notifErr) {
        console.warn("Failed to notify admins of subject issue:", notifErr);
      }
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
                    <th style={{ textAlign: "right" }}>STATUS</th>
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
                        <td className="sd-engagement" title={item.subjectName || item.subjectCode}>{item.subjectCode || item.subject}</td>
                        <td>
                          <span className="se-sectionBadge">
                            {item.dept} {item.year} - {item.section}
                          </span>
                        </td>
                        <td className="sd-tableActions" style={{ textAlign: "right" }}>
                          {item.status === "submitted" ? (
                            <span className="sdb-assignedBadge" title="Already evaluated">
                              <CheckCircle2 size={13} />
                              <span>Evaluated</span>
                            </span>
                          ) : (
                            <span className="sdb-assignedBadge sdb-assignedBadge--pending" title="Not yet evaluated">
                              <Clock size={13} />
                              <span>Pending</span>
                            </span>
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
                Go to Evaluate Teacher to submit your evaluations.
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

      {/* Phase 3: Enhanced Subject Report Issue Modal */}
      {showReportIssue && (
        <div className="sri-modalOverlay" role="dialog" aria-modal="true" onClick={() => setShowReportIssue(false)}>
          <div className="sri-modalCard" onClick={(e) => e.stopPropagation()}>
            <div className="sri-header">
              <div className="sri-headerTitleRow">
                <div className="sri-headerIconBadge">
                  <FileText size={20} />
                </div>
                <div>
                  <h3 className="sri-headerTitle">Report Subject Issue</h3>
                </div>
              </div>
              <button
                type="button"
                className="sri-headerCloseBtn"
                onClick={() => setShowReportIssue(false)}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            <div className="sri-body">
              {/* Student Academic Profile Banner */}
              <div className="sri-profileBanner">
                <Info size={16} className="sri-profileBannerIcon" />
                <span>
                  Enrolled as: <strong>{dept}</strong> · <strong>{yearLevel}</strong> · <strong>Section {section}</strong>
                </span>
              </div>

              {/* Segmented Tab Navigation */}
              <div className="sri-tabNav">
                <button
                  type="button"
                  className={`sri-tabBtn ${reportTab === "submit" ? "sri-tabBtn--active" : ""}`}
                  onClick={() => setReportTab("submit")}
                >
                  Submit Issue
                </button>
                <button
                  type="button"
                  className={`sri-tabBtn ${reportTab === "history" ? "sri-tabBtn--active" : ""}`}
                  onClick={() => setReportTab("history")}
                >
                  My Reports
                  {myRequests.length > 0 && (
                    <span className="sri-tabBadge">{myRequests.length}</span>
                  )}
                </button>
              </div>

              {reportTab === "submit" ? (
                <>
                  {/* Category Chips */}
                  <div>
                    <label className="sri-label">Select Issue Category</label>
                    <div className="sri-chipsGrid">
                      {ISSUE_CATEGORIES.map((cat) => {
                        const isSelected = reportCategory === cat.id;
                        return (
                          <button
                            key={cat.id}
                            type="button"
                            className={`sri-chip ${isSelected ? "sri-chip--selected" : ""}`}
                            onClick={() => setReportCategory(cat.id)}
                          >
                            <span>{cat.icon}</span>
                            <span>{cat.label}</span>
                            {isSelected && <Check size={13} style={{ marginLeft: 2 }} />}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Affected Subject Selector */}
                  <div>
                    <label className="sri-label">Select Affected Subject (Optional)</label>
                    <select
                      className="sri-select"
                      value={reportSubjectId}
                      onChange={(e) => setReportSubjectId(e.target.value)}
                    >
                      <option value="">Choose a subject from your list…</option>
                      {assignedFaculty.map((f) => (
                        <option key={f.assignmentId} value={f.assignmentId}>
                          {f.subjectCode || f.subjectName} — {f.name || "No faculty assigned"}
                        </option>
                      ))}
                      <option value="not_listed">➕ Other / Subject missing from list</option>
                    </select>
                  </div>

                  {/* Issue Description Textarea */}
                  <div className="sri-textareaWrap">
                    <label className="sri-label">Issue Details</label>
                    <textarea
                      className="sri-textarea"
                      value={reportMessage}
                      onChange={(e) => setReportMessage(e.target.value)}
                      maxLength={1000}
                      rows={4}
                      placeholder={
                        reportCategory === "missing_subject"
                          ? "State which subject code and instructor you are missing from your enrolled curriculum..."
                          : reportCategory === "wrong_section"
                          ? "Describe the section discrepancy (e.g. I am in Section A, but see Section B subjects)..."
                          : reportCategory === "irregular"
                          ? "Specify the irregular or retake subject you need added to your evaluation list..."
                          : "Describe the issue with your subject list in detail..."
                      }
                    />
                    <div className="sri-textareaFooter">
                      <span>Please be specific so your admin can resolve it promptly.</span>
                      <span className="sri-charCounter">{reportMessage.length} / 1000</span>
                    </div>
                  </div>

                  {reportError && (
                    <div className="sri-errorAlert">
                      <AlertCircle size={15} style={{ flexShrink: 0 }} />
                      <span>{reportError}</span>
                    </div>
                  )}
                </>
              ) : (
                /* History Tab */
                <div className="sri-historyList">
                  {myRequests.length === 0 ? (
                    <div className="sri-emptyHistory">
                      <Clock size={36} className="sri-emptyHistoryIcon" />
                      <p style={{ margin: 0, fontWeight: 600 }}>No reports submitted yet</p>
                      <p style={{ margin: "4px 0 0", fontSize: "12.5px" }}>
                        Any subject issue you submit will appear here with admin updates.
                      </p>
                    </div>
                  ) : (
                    myRequests.map((r) => {
                      const isResolved = r.status === "resolved";
                      const isNew = r.status === "new";
                      return (
                        <div key={r.id} className="sri-reportCard">
                          <div className="sri-reportCardTop">
                            <span
                              className={`sri-statusBadge ${
                                isResolved
                                  ? "sri-statusBadge--resolved"
                                  : isNew
                                  ? "sri-statusBadge--new"
                                  : "sri-statusBadge--dismissed"
                              }`}
                            >
                              ● {isNew ? "Pending Review" : isResolved ? "Resolved" : "Dismissed"}
                            </span>
                            <span className="sri-reportDate">
                              {r.created_at
                                ? new Date(r.created_at).toLocaleDateString("en-US", {
                                    month: "short",
                                    day: "numeric",
                                    year: "numeric",
                                  })
                                : ""}
                            </span>
                          </div>

                          <p className="sri-reportMsg">{r.message}</p>

                          {r.resolution_note && (
                            <div className="sri-adminNoteCallout">
                              <CheckCircle2 size={15} className="sri-adminNoteIcon" />
                              <div>
                                <strong>Admin Note:</strong> {r.resolution_note}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            <div className="sri-footer">
              <button
                type="button"
                className="sri-btnCancel"
                onClick={() => setShowReportIssue(false)}
              >
                {reportTab === "history" ? "Close" : "Cancel"}
              </button>

              {reportTab === "submit" ? (
                <button
                  type="button"
                  className="sri-btnSubmit"
                  onClick={submitCorrectionRequest}
                  disabled={reportBusy}
                >
                  <Send size={14} />
                  {reportBusy ? "Submitting..." : "Submit Report"}
                </button>
              ) : (
                <button
                  type="button"
                  className="sri-btnSubmit"
                  onClick={() => setReportTab("submit")}
                >
                  New Report
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </StudentLayout>
  );
}
