import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../config/supabase";
import {
  Calendar,
  Check,
  Clock,
  Users,
  Bell,
  ChevronRight,
  Info,
} from "lucide-react";
import StudentLayout from "./StudentLayout";

// Phase 3 (Req 2 / D5): the subject list is admin-controlled.
// Evaluable subjects = class_assignments for the student's
// program/year/section in the active period, adjusted by the
// admin's per-student list (admin/exception enrollments
// replace the section match; exclusions remove from it).
// All self-enrollment UI (Add Subject modals, confirm/remove
// handlers) is removed — students report issues via the
// correction form on the Evaluate page.
export default function StudentDashboard() {
  const [stats, setStats] = useState({ total: 0, evaluated: 0, pending: 0, open: 0 });
  const [activeYear, setActiveYear] = useState(null);
  const [loading, setLoading] = useState(true);

  const [assignedFaculty, setAssignedFaculty] = useState([]);

  const { currentUser, userProfile } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!currentUser || !userProfile) return;

    const studentDept = userProfile.department || userProfile.dept || "";
    const studentYear = userProfile.yearLevel || userProfile.year || "";
    const studentSection = userProfile.section || "";

    (async () => {
      try {
        const [assignmentsRes, submissionsRes, yearsRes, enrRes] = await Promise.all([
          supabase.from("class_assignments").select("*"),
          supabase
            .from("evaluations")
            .select("*")
            .eq("student_id", currentUser.id),
          supabase.from("academic_years").select("*"),
          // Admin-managed per-student list (exceptions/exclusions),
          // readable only; students can no longer write enrollments.
          supabase
            .from("student_enrollments")
            .select("confirmed_assignments, excluded_assignments, enrollment_kind, updated_at")
            .eq("student_id", currentUser.id)
            .maybeSingle(),
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

        if (!active) {
          setStats({ total: 0, evaluated: 0, pending: 0, open: 0 });
          return;
        }

        const activeAssignments = assignments.filter(
          (a) => a.academicYear === active.year && a.semester === active.semester
        );

        const normalize = (str) => (str || "").toLowerCase().replace(/[^a-z0-9]/g, "");
        const isMatch = (val1, val2) => {
          if (!val1 || !val2) return false;
          const n1 = normalize(val1);
          const n2 = normalize(val2);
          return n1 === n2 || n1.includes(n2) || n2.includes(n1);
        };

        const sectionMatched = activeAssignments.filter(
          (a) =>
            isMatch(a.department, studentDept) &&
            isMatch(a.yearLevel, studentYear) &&
            isMatch(a.section, studentSection)
        );

        const enr = enrRes?.data || null;
        const confirmedIds = Array.isArray(enr?.confirmed_assignments)
          ? new Set(enr.confirmed_assignments)
          : null;
        const excludedIds = Array.isArray(enr?.excluded_assignments)
          ? new Set(enr.excluded_assignments)
          : new Set();
        const adminGoverned =
          confirmedIds !== null &&
          (enr.enrollment_kind === "admin" || enr.enrollment_kind === "exception");

        // Evaluable list: admin/exception list replaces the section
        // match; exclusions always remove. Legacy confirmed IDs
        // (pre-Phase 3 confirmations) widen the section match.
        const evaluable = adminGoverned
          ? activeAssignments.filter(
              (a) => confirmedIds.has(a.id) && !excludedIds.has(a.id)
            )
          : activeAssignments.filter(
              (a) =>
                !excludedIds.has(a.id) &&
                (sectionMatched.some((m) => m.id === a.id) ||
                  (confirmedIds !== null && confirmedIds.has(a.id)))
            );

        const subjectList = evaluable.map((a) => {
          const subData = subMap.get(a.id);
          return {
            assignmentId: a.id,
            facultyId: a.facultyId,
            name: a.facultyName || null,
            subject: `${a.subjectCode} - ${a.subjectName}`,
            dept: a.department,
            year: a.yearLevel,
            section: a.section,
            status: subData ? "submitted" : "pending",
            submittedAt: subData?.submittedAt || null,
            isAdminAdjustment: adminGoverned || excludedIds.has(a.id),
          };
        });

        setAssignedFaculty(subjectList);

        const evaluated = subjectList.filter((f) => f.status === "submitted").length;
        const openNow = subjectList.filter((f) => f.status === "pending" && f.name).length;
        setStats({
          total: subjectList.length,
          evaluated,
          pending: subjectList.length - evaluated,
          open: openNow,
        });
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    })();
  }, [currentUser, userProfile]);

  const displayName = userProfile?.fullName || "Student";
  const firstName = displayName.split(" ")[0];

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
          <button
            type="button"
            className="sdb-bellBtn"
            aria-label="Notifications"
          >
            <Bell size={18} />
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
                <h3 className="se-tableTitle">Your Subjects This Semester</h3>
                <p className="se-tableHint">
                  Set by the administrator from your program and section.
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
                        Loading...
                      </td>
                    </tr>
                  ) : assignedFaculty.length === 0 ? (
                    <tr>
                      <td colSpan="4" style={{ textAlign: "center", padding: "40px", color: "#9ca3af" }}>
                        No subjects assigned yet. If something looks wrong, report it on the Evaluate page.
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
                              <span className="sd-cellPrimary">{item.name || "— No faculty"}</span>
                              <span className="sd-cellSecondary">Faculty Member</span>
                            </div>
                          </div>
                        </td>
                        <td className="sd-engagement">{item.subject}</td>
                        <td>
                          <span className="se-sectionBadge">
                            {item.dept} {item.year} - {item.section}
                            {item.isAdminAdjustment && (
                              <span className="se-addedBadge">Admin</span>
                            )}
                          </span>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          {item.status === "submitted" ? (
                            <span className="sdb-assignedBadge" title="Already evaluated">Evaluated</span>
                          ) : (
                            <span className="sd-statusBadge sd-statusBadge--closed" style={{ background: "#fef3c7", color: "#92400e" }}>
                              Pending
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
                Your subject list is managed by the administrator. To report a
                wrong or missing subject, use <strong>Report an Issue</strong> on
                the Evaluate Teacher page.
              </p>
              <button
                type="button"
                className="se-editEnrollmentBtn"
                onClick={() => navigate("/student/evaluate")}
              >
                Go to Evaluate Teacher
              </button>
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
    </StudentLayout>
  );
}
