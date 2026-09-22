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
  CheckCircle,
  FileText,
  Plus,
  Minus,
  ChevronRight,
  Search,
  X,
  Info,
} from "lucide-react";
import StudentLayout from "./StudentLayout";

export default function StudentDashboard() {
  const [stats, setStats] = useState({ total: 0, evaluated: 0, pending: 0, open: 0 });
  const [activeYear, setActiveYear] = useState(null);
  const [loading, setLoading] = useState(true);
  const [recentActivity, setRecentActivity] = useState([]);

  const [enrollmentList, setEnrollmentList] = useState([]);
  const [allAssignments, setAllAssignments] = useState([]);
  const [assignedFaculty, setAssignedFaculty] = useState([]);
  const [submissionsData, setSubmissionsData] = useState(new Map());
  const [submittedIds, setSubmittedIds] = useState(new Set());
  const [subjectMode, setSubjectMode] = useState("loading");
  const [savingEnrollment, setSavingEnrollment] = useState(false);

  const [showAddModal, setShowAddModal] = useState(false);
  const [addSearch, setAddSearch] = useState("");

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
        const [assignmentsRes, submissionsRes, yearsRes] = await Promise.all([
          supabase.from("class_assignments").select("*"),
          supabase.from("evaluations").select("*").eq("student_id", currentUser.id),
          supabase.from("academic_years").select("*"),
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
        const submitted = new Set(subMap.keys());
        setSubmittedIds(submitted);

        if (!active) {
          setStats({ total: 0, evaluated: 0, pending: 0, open: 0 });
          setSubjectMode("evaluation");
          return;
        }

        const activeAssignments = assignments.filter(
          (a) => a.academicYear === active.year && a.semester === active.semester
        );
        setAllAssignments(activeAssignments);

        const normalize = (str) => (str || "").toLowerCase().replace(/[^a-z0-9]/g, "");
        const isMatch = (val1, val2) => {
          if (!val1 || !val2) return false;
          const n1 = normalize(val1);
          const n2 = normalize(val2);
          return n1 === n2 || n1.includes(n2) || n2.includes(n1);
        };

        const defaultMatched = activeAssignments.filter(
          (a) =>
            isMatch(a.department, studentDept) &&
            isMatch(a.yearLevel, studentYear) &&
            isMatch(a.section, studentSection)
        );

        let confirmedCount = null;
        let enrollmentUpdatedAt = null;

        const { data: enrData } = await supabase
          .from("student_enrollments")
          .select("*")
          .eq("student_id", currentUser.id)
          .eq("academic_year", active.year)
          .eq("semester", active.semester)
          .maybeSingle();

        if (enrData && Array.isArray(enrData.confirmed_assignments)) {
          confirmedCount = enrData.confirmed_assignments.length;
          enrollmentUpdatedAt = enrData.updated_at || null;
          const confirmedSet = new Set(enrData.confirmed_assignments);

          const confirmedFaculty = activeAssignments
            .filter((a) => confirmedSet.has(a.id))
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
                isDefaultMatch:
                  isMatch(a.department, studentDept) &&
                  isMatch(a.yearLevel, studentYear) &&
                  isMatch(a.section, studentSection),
              };
            });

          setAssignedFaculty(confirmedFaculty);
          setSubjectMode("evaluation");

          const confirmedEvaluated = confirmedFaculty.filter((f) => f.status === "submitted").length;
          const openNow = confirmedFaculty.filter((f) => f.status === "pending" && f.name).length;
          setStats({
            total: confirmedCount,
            evaluated: confirmedEvaluated,
            pending: confirmedCount - confirmedEvaluated,
            open: openNow,
          });
        }

        if (confirmedCount === null) {
          setEnrollmentList(
            defaultMatched.map((a) => ({
              assignmentId: a.id,
              facultyId: a.facultyId,
              name: a.facultyName || null,
              subject: `${a.subjectCode} - ${a.subjectName}`,
              dept: a.department,
              year: a.yearLevel,
              section: a.section,
              isDefaultMatch: true,
            }))
          );

          const evaluated = defaultMatched.filter((a) => submitted.has(a.id)).length;
          setStats({
            total: defaultMatched.length,
            evaluated,
            pending: defaultMatched.length - evaluated,
            open: defaultMatched.filter((a) => !submitted.has(a.id) && a.facultyName).length,
          });
          setSubjectMode("enrollment");
        }

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

        if (enrollmentUpdatedAt) {
          const date = enrollmentUpdatedAt ? new Date(enrollmentUpdatedAt) : null;
          activities.push({
            type: "confirmed",
            label: "Subject list confirmed",
            detail: `${confirmedCount} subject(s) confirmed`,
            date,
          });
        }

        activities.sort((a, b) => {
          if (!a.date && !b.date) return 0;
          if (!a.date) return 1;
          if (!b.date) return -1;
          return b.date - a.date;
        });
        setRecentActivity(activities.slice(0, 5));
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    })();
  }, [currentUser, userProfile]);

  const handleAddSubject = async (assignment) => {
    if (subjectMode === "enrollment") {
      const already = enrollmentList.some((e) => e.assignmentId === assignment.id);
      if (already) return;
      setEnrollmentList((prev) => [
        ...prev,
        {
          assignmentId: assignment.id,
          facultyId: assignment.facultyId,
          name: assignment.facultyName || null,
          subject: `${assignment.subjectCode} - ${assignment.subjectName}`,
          dept: assignment.department,
          year: assignment.yearLevel,
          section: assignment.section,
          isDefaultMatch: false,
        },
      ]);
    } else {
      const already = assignedFaculty.some((e) => e.assignmentId === assignment.id);
      if (already) return;
      const newItem = {
        assignmentId: assignment.id,
        facultyId: assignment.facultyId,
        name: assignment.facultyName || null,
        subject: `${assignment.subjectCode} - ${assignment.subjectName}`,
        dept: assignment.department,
        year: assignment.yearLevel,
        section: assignment.section,
        status: submittedIds.has(assignment.id) ? "submitted" : "pending",
        isDefaultMatch: false,
      };
      const updatedList = [...assignedFaculty, newItem];
      try {
        const { error } = await supabase.from("student_enrollments").upsert(
          {
            student_id: currentUser.id,
            academic_year: activeYear.year,
            semester: activeYear.semester,
            confirmed_assignments: updatedList.map((e) => e.assignmentId),
          },
          { onConflict: "student_id,academic_year,semester" }
        );
        if (error) throw new Error(error.message);
        setAssignedFaculty(updatedList);
        const evaluated = updatedList.filter((f) => f.status === "submitted").length;
        setStats({
          total: updatedList.length,
          evaluated,
          pending: updatedList.length - evaluated,
          open: updatedList.filter((f) => f.status === "pending" && f.name).length,
        });
      } catch (err) {
        alert("Error: " + err.message);
      }
    }
    setShowAddModal(false);
    setAddSearch("");
  };

  const handleRemoveSubject = (assignmentId) => {
    setEnrollmentList((prev) => prev.filter((e) => e.assignmentId !== assignmentId));
  };

  const handleRemoveFromConfirmed = async (assignmentId) => {
    const item = assignedFaculty.find((f) => f.assignmentId === assignmentId);
    if (item?.status === "submitted") {
      alert("You cannot remove a subject you have already evaluated.");
      return;
    }
    const updatedList = assignedFaculty.filter((f) => f.assignmentId !== assignmentId);
    try {
      const { error } = await supabase.from("student_enrollments").upsert(
        {
          student_id: currentUser.id,
          academic_year: activeYear.year,
          semester: activeYear.semester,
          confirmed_assignments: updatedList.map((e) => e.assignmentId),
        },
        { onConflict: "student_id,academic_year,semester" }
      );
      if (error) throw new Error(error.message);
      setAssignedFaculty(updatedList);
      const evaluated = updatedList.filter((f) => f.status === "submitted").length;
      setStats({
        total: updatedList.length,
        evaluated,
        pending: updatedList.length - evaluated,
        open: updatedList.filter((f) => f.status === "pending" && f.name).length,
      });
    } catch (err) {
      alert("Error: " + err.message);
    }
  };

  const handleConfirmEnrollment = async () => {
    if (!activeYear || !currentUser) return;
    if (enrollmentList.length === 0) {
      alert("Please add at least one subject before confirming.");
      return;
    }
    setSavingEnrollment(true);
    try {
      const { error } = await supabase.from("student_enrollments").upsert(
        {
          student_id: currentUser.id,
          academic_year: activeYear.year,
          semester: activeYear.semester,
          confirmed_assignments: enrollmentList.map((e) => e.assignmentId),
        },
        { onConflict: "student_id,academic_year,semester" }
      );
      if (error) throw new Error(error.message);

      const confirmedFaculty = enrollmentList.map((e) => ({
        ...e,
        status: submittedIds.has(e.assignmentId) ? "submitted" : "pending",
        submittedAt: submissionsData.get(e.assignmentId)?.submittedAt || null,
      }));
      setAssignedFaculty(confirmedFaculty);
      setSubjectMode("evaluation");

      const evaluated = confirmedFaculty.filter((f) => f.status === "submitted").length;
      setStats({
        total: confirmedFaculty.length,
        evaluated,
        pending: confirmedFaculty.length - evaluated,
        open: confirmedFaculty.filter((f) => f.status === "pending" && f.name).length,
      });
    } catch (err) {
      alert("Error: " + err.message);
    } finally {
      setSavingEnrollment(false);
    }
  };

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

  const formatActivityDate = (date) => {
    if (!date) return "—";
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };
  const formatActivityTime = (date) => {
    if (!date) return "";
    return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  };

  const currentActiveList = subjectMode === "enrollment" ? enrollmentList : assignedFaculty;
  const addableAssignments = allAssignments
    .filter((a) => !currentActiveList.some((e) => e.assignmentId === a.id))
    .filter(
      (a) =>
        addSearch === "" ||
        (a.subjectCode || "").toLowerCase().includes(addSearch.toLowerCase()) ||
        (a.subjectName || "").toLowerCase().includes(addSearch.toLowerCase()) ||
        (a.facultyName || "").toLowerCase().includes(addSearch.toLowerCase()) ||
        (a.department || "").toLowerCase().includes(addSearch.toLowerCase())
    );

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
                <h3 className="se-tableTitle">Review Your Enrolled Subjects</h3>
                <p className="se-tableHint">
                  {subjectMode === "enrollment"
                    ? "Confirm the subjects you are taking this semester before evaluating your teachers."
                    : "These are your confirmed subjects for this semester."}
                </p>
              </div>
              <button
                type="button"
                className="se-addSubjectBtn"
                onClick={() => { setShowAddModal(true); setAddSearch(""); }}
              >
                <Plus size={16} />
                Add Subject
              </button>
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
                        Loading...
                      </td>
                    </tr>
                  ) : subjectMode === "enrollment" ? (
                    enrollmentList.length === 0 ? (
                      <tr>
                        <td colSpan="4" style={{ textAlign: "center", padding: "40px", color: "#9ca3af" }}>
                          No subjects added yet. Click "+ Add Subject" to add one.
                        </td>
                      </tr>
                    ) : (
                      enrollmentList.map((item) => (
                        <tr key={item.assignmentId}>
                          <td>
                            <div className="sd-avatarCell">
                              <div className="sd-avatar sd-avatar--blue">
                                {(item.name || "??").substring(0, 2).toUpperCase()}
                              </div>
                              <div className="sd-cellLines">
                                <span className="sd-cellPrimary">{item.name}</span>
                                <span className="sd-cellSecondary">Faculty Member</span>
                              </div>
                            </div>
                          </td>
                          <td className="sd-engagement">{item.subject}</td>
                          <td>
                            <span className="se-sectionBadge">
                              {item.dept} {item.year} - {item.section}
                              {!item.isDefaultMatch && (
                                <span className="se-addedBadge">Added</span>
                              )}
                            </span>
                          </td>
                          <td className="sd-tableActions" style={{ justifyContent: "flex-end" }}>
                            <button
                              type="button"
                              className="se-removeBtn"
                              title="Remove subject"
                              onClick={() => handleRemoveSubject(item.assignmentId)}
                            >
                              <Minus size={15} />
                            </button>
                          </td>
                        </tr>
                      ))
                    )
                  ) : (
                    assignedFaculty.length === 0 ? (
                      <tr>
                        <td colSpan="4" style={{ textAlign: "center", padding: "40px", color: "#9ca3af" }}>
                          No subjects confirmed.
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
                            </span>
                          </td>
                          <td className="sd-tableActions" style={{ justifyContent: "flex-end" }}>
                            {item.status === "submitted" ? (
                              <span className="sdb-assignedBadge" title="Already evaluated">Evaluated</span>
                            ) : (
                              <button
                                type="button"
                                className="se-removeBtn"
                                title="Remove subject"
                                onClick={() => handleRemoveFromConfirmed(item.assignmentId)}
                              >
                                <Minus size={15} />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))
                    )
                  )}
                </tbody>
              </table>
            </div>

            <div className="se-enrollmentFooter">
              <p className="se-enrollmentNote">
                <Info size={14} />
                {subjectMode === "enrollment"
                  ? "Once confirmed, you can still edit this list as long as you haven't submitted an evaluation."
                  : "Go to Evaluate Teacher to submit or view your evaluations."}
              </p>
              {subjectMode === "enrollment" ? (
                <button
                  type="button"
                  className="se-confirmBtn"
                  onClick={handleConfirmEnrollment}
                  disabled={savingEnrollment || enrollmentList.length === 0}
                >
                  {savingEnrollment ? "Saving..." : "Confirm Subjects"}
                  {!savingEnrollment && <ChevronRight size={16} />}
                </button>
              ) : (
                <button
                  type="button"
                  className="se-editEnrollmentBtn"
                  onClick={() => navigate("/student/evaluate")}
                >
                  Go to Evaluate Teacher
                </button>
              )}
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

      {showAddModal && (
        <div className="se-modal" role="dialog" aria-modal="true">
          <div className="se-modalOverlay" onClick={() => setShowAddModal(false)} />
          <div className="se-modalContent se-addModal">
            <div className="se-modalHeader">
              <div>
                <h3 className="se-modalTitle">Add a Subject</h3>
                <p className="se-modalSubtitle">Search for any subject offered this semester.</p>
              </div>
              <button type="button" className="se-modalClose" onClick={() => setShowAddModal(false)}>
                <X size={22} />
              </button>
            </div>
            <div style={{ padding: "16px 24px 12px" }}>
              <div style={{ position: "relative" }}>
                <Search
                  size={16}
                  style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#9ca3af" }}
                />
                <input
                  type="text"
                  className="se-search"
                  style={{ width: "100%", paddingLeft: 36, boxSizing: "border-box" }}
                  placeholder="Search by subject, teacher, or program..."
                  value={addSearch}
                  onChange={(e) => setAddSearch(e.target.value)}
                  autoFocus
                />
              </div>
            </div>
            <div className="se-addModalList">
              {addableAssignments.length === 0 ? (
                <div style={{ textAlign: "center", padding: "32px", color: "#9ca3af" }}>
                  {addSearch ? "No subjects match your search." : "All available subjects are already in your list."}
                </div>
              ) : (
                addableAssignments.map((a) => (
                  <div key={a.id} className="se-addModalRow">
                    <div className="se-addModalInfo">
                      <span className="se-addModalSubject">{a.subjectCode} — {a.subjectName}</span>
                      <span className="se-addModalMeta">{a.facultyName} · {a.department} {a.yearLevel}-{a.section}</span>
                    </div>
                    <button
                      type="button"
                      className="se-addBtn"
                      onClick={() => handleAddSubject(a)}
                    >
                      <Plus size={15} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </StudentLayout>
  );
}

