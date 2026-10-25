import { useState, useEffect, useRef } from "react";
import { Search, X, List, Calendar, CheckCircle, AlertCircle, Info, MessageSquare, BookOpen, FileText, ChevronRight, Clock } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useDialog } from "../../context/DialogContext";
import { supabase } from "../../config/supabase";
import { parseFunctionError } from "../../utils/audit";
import { isAssignmentMatch } from "../../utils/assignmentMatch";
import { pickActivePeriod, isPeriodActive, periodEndPassed, matchDepartment, listStudentPeriods, getCanonicalDept, periodNotStarted } from "../../utils/periodStatus";
import { notifyAdminsForDepartment } from "../../utils/notifications";
import StudentLayout from "./StudentLayout";


export default function StudentEvaluation() {
  const { showNotice } = useDialog();
  const [searchQuery, setSearchQuery] = useState("");
  const [filterTab, setFilterTab] = useState("all");
  const [selectedFaculty, setSelectedFaculty] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [ratings, setRatings] = useState({});
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [assignedFaculty, setAssignedFaculty] = useState([]);
  const [submissionsData, setSubmissionsData] = useState(new Map());
  const [submittedIds, setSubmittedIds] = useState(new Set());
  const [evaluationCriteria, setEvaluationCriteria] = useState([]);
  const [activeYear, setActiveYear] = useState(null);
  const [loading, setLoading] = useState(true);
  // Phase 6 [Req 8]: Priority pill + OK/Cancel dialog.
  const [isPriority, setIsPriority] = useState(false);
  const [showPriorityDialog, setShowPriorityDialog] = useState(false);

  const { currentUser, userProfile } = useAuth();

  // Academic-period filter: only periods created by the admin(s) of the
  // student's own program. Default = the current (active) period.
  const [periods, setPeriods] = useState([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState(null);
  const periodDataRef = useRef({ assignments: [], enrollments: [] });

  // Same matching rules as the initial load below, for any chosen period.
  // For past periods it also keeps assignments the student already evaluated
  // so evaluation history is always complete.
  const buildFacultyForPeriod = (period, subMap, includeEvaluated) => {
    const studentDept = userProfile?.department || userProfile?.dept || "";
    const studentYear = userProfile?.yearLevel || userProfile?.year || "";
    const studentSection = userProfile?.section || "";
    const { assignments, enrollments } = periodDataRef.current;

    const periodAssignments = assignments.filter(
      (a) => a.academicYear === period.year && a.semester === period.semester
    );
    const enrollment = enrollments.find(
      (r) => r.academic_year === period.year && r.semester === period.semester
    ) || null;
    const confirmedSet = new Set(enrollment?.confirmed_assignments || []);
    const excludedSet = new Set(enrollment?.excluded_assignments || []);
    const isAdminList =
      enrollment?.enrollment_kind === "admin" ||
      enrollment?.enrollment_kind === "exception";

    const matched = periodAssignments.filter((a) => {
      if (!matchDepartment(a.department, studentDept)) return false;
      if (excludedSet.has(a.id)) return false;
      if (isAdminList) return confirmedSet.has(a.id);
      if (confirmedSet.has(a.id)) return true;
      return isAssignmentMatch(a, studentDept, studentYear, studentSection);
    });

    let rows = matched;
    if (includeEvaluated) {
      const have = new Set(matched.map((a) => a.id));
      const evaluatedExtra = periodAssignments.filter(
        (a) => !have.has(a.id) && subMap.has(a.id) && matchDepartment(a.department, studentDept)
      );
      rows = [...matched, ...evaluatedExtra];
    }

    return rows.map((a) => {
      const subData = subMap.get(a.id);
      return {
        assignmentId: a.id,
        facultyId: a.facultyId,
        name: a.facultyName || "— No faculty assigned",
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
  };

  const handlePeriodChange = (id) => {
    const p = periods.find((x) => String(x.id) === String(id));
    if (!p) return;
    setSelectedPeriodId(p.id);
    const isPast = !activeYear || p.id !== activeYear.id;
    setAssignedFaculty(buildFacultyForPeriod(p, submissionsData, isPast));
    setFilterTab("all");
  };

  useEffect(() => {
    if (!currentUser || !userProfile) return;

    const studentDept = userProfile.department || userProfile.dept || "";
    const studentYear = userProfile.yearLevel || userProfile.year || "";
    const studentSection = userProfile.section || "";

    (async () => {
      try {
        const [assignmentsRes, submissionsRes, criteriaRes, questionsRes, yearsRes, enrollmentRes] = await Promise.all([
          supabase.from("class_assignments").select("*"),
          supabase.from("evaluations").select("*").eq("student_id", currentUser.id),
          supabase.from("criteria").select("*, departments(id, name, description)"),
          supabase.from("questions").select("*"),
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

        const questions = (questionsRes.data || []).map((q) => ({
          id: q.id,
          criteriaId: q.criteria_id,
          text: q.text,
          order: q.order,
          isActive: q.is_active !== false,
        }));

        const years = (yearsRes.data || []).map((y) => ({
          id: y.id,
          year: y.year,
          semester: y.semester,
          startDate: y.start_date,
          endDate: y.end_date,
          end_date: y.end_date,
          status: y.status,
          department_id: y.department_id,
          departments: y.departments,
        }));

        const active = pickActivePeriod(years, studentDept) || null;
        console.log("[StudentEvaluation] Student dept:", studentDept, "Academic years from DB:", yearsRes.data, "Resolved active period:", active);
        setActiveYear(active);

        // Cache raw data + list the admin-created periods of this student's program.
        periodDataRef.current = { assignments, enrollments: enrollmentRes.data || [] };
        setPeriods(listStudentPeriods(years, studentDept));
        setSelectedPeriodId(active ? active.id : null);

        const subMap = new Map();
        submissions.forEach((s) => {
          subMap.set(s.assignmentId, s);
        });
        setSubmissionsData(subMap);
        const submitted = new Set(subMap.keys());
        setSubmittedIds(submitted);

        // Active criteria: filter strictly for this student's department.
        // Isolation rules:
        // 1. Program-specific criteria: c.departments.name or c.departments.code matches studentDept,
        //    or c.department_id matches student's department_id.
        // 2. Shared/global criteria (department_id IS NULL) are included for all departments.
        // 3. Criteria created for other departments are NEVER shown to this student.
        const studentDeptId = userProfile.department_id || null;
        const scopedCriteria = (criteriaRes.data || []).filter((c) => {
          if (!c.department_id) return true; // shared/global criteria
          if (studentDeptId && c.department_id === studentDeptId) return true;
          if (c.departments?.name && matchDepartment(c.departments.name, studentDept)) return true;
          if (c.departments?.description && matchDepartment(c.departments.description, studentDept)) return true;
          return false;
        });

        const activeCriteriaList = scopedCriteria.some((c) => c.enabled)
          ? scopedCriteria.filter((c) => c.enabled)
          : scopedCriteria;

        const builtCriteria = activeCriteriaList.map((c) => ({
          id: c.id,
          category: c.name,
          items: questions
            .filter((q) => q.criteriaId === c.id && q.isActive !== false)
            .sort((a, b) => a.order - b.order)
            .map((q) => ({ id: q.id, text: q.text })),
        })).filter((c) => c.items.length > 0);

        setEvaluationCriteria(builtCriteria);

        if (!active) {
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

        // Automatic matching (exact normalized equality — mirrors
        // the server gate).
        const matchedRaw = activeAssignments.filter((a) => {
          // Strict program restriction: Never display subjects from another program
          if (!matchDepartment(a.department, studentDept)) return false;
          if (excludedSet.has(a.id)) return false;
          if (isAdminList) return confirmedSet.has(a.id);
          if (confirmedSet.has(a.id)) return true;
          return isAssignmentMatch(a, studentDept, studentYear, studentSection);
        });

        // Group by facultyId + section so a faculty handling multiple subjects in 1 section is evaluated once
        const facultyGroups = new Map();
        matchedRaw.forEach((a) => {
          const key = a.facultyId ? `${a.facultyId}__${a.section || ""}` : a.id;
          if (!facultyGroups.has(key)) {
            facultyGroups.set(key, {
              assignmentId: a.id,
              assignmentIds: [a.id],
              facultyId: a.facultyId,
              name: a.facultyName || "— No faculty assigned",
              subjectCodes: a.subjectCode ? [a.subjectCode] : [],
              subjectNames: a.subjectName ? [a.subjectName] : [],
              dept: a.department,
              year: a.yearLevel,
              section: a.section,
              semester: a.semester,
            });
          } else {
            const entry = facultyGroups.get(key);
            entry.assignmentIds.push(a.id);
            if (a.subjectCode && !entry.subjectCodes.includes(a.subjectCode)) {
              entry.subjectCodes.push(a.subjectCode);
            }
            if (a.subjectName && !entry.subjectNames.includes(a.subjectName)) {
              entry.subjectNames.push(a.subjectName);
            }
          }
        });

        const matchedFaculty = Array.from(facultyGroups.values()).map((g) => {
          const subData = g.assignmentIds.map((id) => subMap.get(id)).find(Boolean);
          const subject = g.subjectCodes.length > 0 ? g.subjectCodes.join(", ") : (g.subjectNames.join(", ") || "—");
          return {
            assignmentId: g.assignmentId,
            assignmentIds: g.assignmentIds,
            facultyId: g.facultyId,
            name: g.name,
            subject,
            subjectCode: g.subjectCodes.join(", "),
            subjectCodes: g.subjectCodes,
            subjectName: g.subjectNames.join(" / "),
            subjectNames: g.subjectNames,
            dept: g.dept,
            year: g.year,
            section: g.section,
            semester: g.semester,
            status: subData ? "submitted" : "pending",
            submittedAt: subData?.submittedAt || null,
          };
        });

        setAssignedFaculty(matchedFaculty);

        // Pre-selection if navigated with URL parameters (?assignmentId=... or ?facultyId=...)
        const searchParams = new URLSearchParams(window.location.search);
        const initialAssignmentId = searchParams.get("assignmentId");
        if (initialAssignmentId) {
          const target = matchedFaculty.find((f) =>
            f.assignmentId === initialAssignmentId || f.assignmentIds?.includes(initialAssignmentId)
          );
          if (target && target.status !== "submitted") {
            setSelectedFaculty(target);
            setSearchQuery(target.name || "");
          }
        } else {
          const initialFacultyId = searchParams.get("facultyId");
          if (initialFacultyId) {
            const target = matchedFaculty.find(
              (f) => f.facultyId === initialFacultyId && f.status !== "submitted"
            );
            if (target) {
              setSelectedFaculty(target);
              setSearchQuery(target.name || "");
            }
          }
        }
      } catch (err) {
        console.error("Evaluation page fetch error:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, [currentUser, userProfile]);

  const handleEvaluate = (faculty) => {
    setSelectedFaculty(faculty);
    setRatings({});
    setComment("");
    setIsPriority(false);
    setShowModal(true);
  };

  // [Req 8] Toggling Priority opens an OK/Cancel confirm dialog,
  // not an alert — the student must confirm before it applies.
  const handlePriorityToggle = () => {
    if (isPriority) {
      setIsPriority(false);
      return;
    }
    setShowPriorityDialog(true);
  };

  const confirmPriority = () => {
    setShowPriorityDialog(false);
    setIsPriority(true);
  };

  const handleRatingChange = (questionId, value) => {
    setRatings((prev) => ({ ...prev, [questionId]: value }));
  };

  // Phase 6: submissions go through the submit-evaluation Edge
  // Function — the ONLY write path for evaluations (migration 006
  // closed direct INSERT; RLS rejects it). moderation_status comes
  // back so the student knows if their comment was flagged/blocked.
  const handleSubmitEvaluation = async () => {
    if (!selectedFaculty || !currentUser) return;
    if (!activeYear) {
      showNotice("No active evaluation period is available.", {
        type: "warning",
        title: "Evaluation Period Notice",
      });
      return;
    }
    setSubmitting(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData?.session) {
        throw new Error("Your login session expired. Please log out and log back in.");
      }

      const { data, error } = await supabase.functions.invoke("submit-evaluation", {
        body: {
          assignment_id: selectedFaculty.assignmentId,
          ratings,
          comment,
          priority: isPriority,
        },
      });

      if (error) throw new Error(await parseFunctionError(error, "Submission failed."));
      if (data?.error) throw new Error(data.error);

      const submittedAt = data?.evaluation?.submitted_at;
      const moderationStatus = data?.evaluation?.moderation_status || "allow";

      const newSubData = new Map(submissionsData);
      const allIds = selectedFaculty.assignmentIds || [selectedFaculty.assignmentId];
      allIds.forEach((id) => {
        newSubData.set(id, {
          ratings,
          comment,
          submittedAt,
        });
      });
      setSubmissionsData(newSubData);

      const newSubmittedIds = new Set([...submittedIds, ...allIds]);
      setSubmittedIds(newSubmittedIds);
      setAssignedFaculty((prev) =>
        prev.map((f) => (f.facultyId === selectedFaculty.facultyId && f.section === selectedFaculty.section) || f.assignmentId === selectedFaculty.assignmentId
          ? { ...f, status: "submitted", submittedAt }
          : f)
      );

      const evaluatedFaculty = selectedFaculty;
      const targetDept = evaluatedFaculty?.dept || evaluatedFaculty?.department || userProfile?.department || null;
      const facultyName = evaluatedFaculty?.name || "a faculty member";

      setShowModal(false);
      setSelectedFaculty(null);
      setRatings({});
      setComment("");
      setIsPriority(false);

      if (moderationStatus === "flag") {
        showNotice(`Evaluation for ${facultyName} submitted. Your comment was flagged for review and will be checked by the administrator before release.`, {
          type: "info",
          title: "Evaluation Submitted",
        });
      } else if (isPriority) {
        showNotice(`Priority evaluation for ${facultyName} submitted. The administrator will review it.`, {
          type: "info",
          title: "Priority Evaluation Submitted",
        });
      } else {
        showNotice(`Evaluation for ${facultyName} submitted successfully!`, {
          type: "success",
          title: "Submission Successful",
        });
      }

      // Notify administrators if concern was priority or flagged (department-scoped + super_admin)
      if (isPriority || moderationStatus === "flag") {
        try {
          const canonicalDept = targetDept ? getCanonicalDept(targetDept) : "";
          const deptTag = canonicalDept ? `[${canonicalDept}] ` : "";
          await notifyAdminsForDepartment({
            department: targetDept,
            title: isPriority ? `${deptTag}Priority Concern Flagged` : `${deptTag}Comment Flagged for Review`,
            message: isPriority
              ? `A student submitted a priority concern for ${facultyName} (${canonicalDept || targetDept || "General"}) requiring admin attention.`
              : `A student comment for ${facultyName} (${canonicalDept || targetDept || "General"}) was flagged by automated moderation.`,
            type: "alert",
            link: "/admin/moderation",
          });
        } catch (notifErr) {
          console.warn("Failed to notify admins of priority concern:", notifErr);
        }
      }
    } catch (error) {
      showNotice(error.message || "An unexpected error occurred.", {
        type: "error",
        title: "Submission Error",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const dept = userProfile?.department || userProfile?.dept || "—";
  const yearLevel = userProfile?.yearLevel || userProfile?.year || "—";
  const section = userProfile?.section || "—";

  const totalQuestions = evaluationCriteria.reduce((sum, c) => sum + c.items.length, 0);
  const answeredQuestions = Object.keys(ratings).length;
  const progressPercentage = totalQuestions > 0 ? Math.round((answeredQuestions / totalQuestions) * 100) : 0;
  const submittedCount = assignedFaculty.filter((f) => f.status === "submitted").length;
  const pendingCount = assignedFaculty.filter((f) => f.status !== "submitted").length;

  const filteredAssignedFaculty = assignedFaculty.filter((item) => {
    if (filterTab === "pending" && item.status === "submitted") return false;
    if (filterTab === "completed" && item.status !== "submitted") return false;
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase().trim();
    const nameMatch = (item.name || "").toLowerCase().includes(query);
    const subjectMatch =
      (item.subject || "").toLowerCase().includes(query) ||
      (item.subjectCode || "").toLowerCase().includes(query) ||
      (item.subjectName || "").toLowerCase().includes(query);
    const sectionMatch = `${item.dept || ""} ${item.year || ""} ${item.section || ""}`.toLowerCase().includes(query);
    return nameMatch || subjectMatch || sectionMatch;
  });

  const now = new Date();
  const endDate = activeYear?.endDate ? new Date(activeYear.endDate + "T23:59:59") : null;
  const isPeriodEnded = activeYear ? periodEndPassed(activeYear, now) : false;
  // Viewing any period other than the current one is read-only.
  const viewPeriod = periods.find((p) => p.id === selectedPeriodId) || activeYear;
  const isViewingPast = !!(viewPeriod && activeYear && viewPeriod.id !== activeYear.id);
  const isEvaluationOpen = !loading && activeYear !== null && !isViewingPast && isPeriodActive(activeYear, now);

  const hoursLeft = endDate ? Math.max(0, Math.floor((endDate - now) / 1000 / 3600)) : null;
  const showUrgencyBanner = isEvaluationOpen && hoursLeft !== null && hoursLeft <= 72;

  const formatDate = (ts) => {
    if (!ts) return "—";
    const date = new Date(ts);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  if (loading) {
    return (
      <StudentLayout breadcrumb="Evaluate Teacher">
        <div style={{ padding: "60px", textAlign: "center", color: "#6b7280" }}>Loading...</div>
      </StudentLayout>
    );
  }

  return (
    <StudentLayout breadcrumb="Evaluate Teacher">

      {showUrgencyBanner && (
        <div className="se-urgencyBanner">
          <span className="se-urgencyIcon">⏳</span>
          <span>
            <strong>Evaluation period closes soon!</strong>
            {" "}You have ~{hoursLeft} hour{hoursLeft !== 1 ? "s" : ""} left to submit.{" "}
            Deadline:{" "}
            <strong>
              {endDate.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric" })},{" "}
              {endDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}
            </strong>
          </span>
        </div>
      )}

      {isViewingPast && (
        <div className="se-closedBanner">
          <Info size={22} />
          <div>
            <strong>Viewing past period: {viewPeriod.year} · {viewPeriod.semester}</strong>
            <p style={{ margin: "2px 0 0", fontSize: "13px", opacity: 0.85 }}>
              Evaluation is closed for this period (view only).
            </p>
          </div>
        </div>
      )}

      {!isEvaluationOpen && !isViewingPast && (
        <div className="se-closedBanner">
          <AlertCircle size={22} />
          <div>
            <strong>
              {activeYear && periodNotStarted(activeYear, now)
                ? "Evaluation Period Not Started Yet"
                : "Evaluation Period is Closed"}
            </strong>
            <p style={{ margin: "2px 0 0", fontSize: "13px", opacity: 0.85 }}>
              {activeYear && periodNotStarted(activeYear, now)
                ? `The evaluation period for ${activeYear.year} ${activeYear.semester} opens on ${activeYear.startDate || activeYear.start_date}.`
                : activeYear && isPeriodEnded
                ? `The evaluation period for ${activeYear.year} ${activeYear.semester} closed on ${activeYear.endDate || activeYear.end_date}.`
                : activeYear
                ? `The evaluation for ${activeYear.year} ${activeYear.semester} is currently closed.`
                : "There is no active evaluation period configured for your program at this time. Please contact the administrator."}
            </p>
          </div>
        </div>
      )}

      {/* Search Bar & Filter Controls */}
      <div className="se-controlsCard">
        <div className="se-controlsTop">
          {periods.length > 0 && (
            <div className="se-periodSelectWrap">
              <Calendar size={15} className="se-periodSelectIcon" />
              <select
                id="se-period-select"
                aria-label="Academic Period"
                className="se-periodSelect"
                value={selectedPeriodId || ""}
                onChange={(e) => handlePeriodChange(e.target.value)}
              >
                {periods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.year} · {p.semester}{activeYear && p.id === activeYear.id ? " (Current)" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="se-searchBarWrap">
            <Search size={16} className="se-searchBarIcon" />
            <input
              type="text"
              className="se-searchBarInput"
              placeholder="Search by teacher name or subject..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                className="se-searchBarClear"
                onClick={() => setSearchQuery("")}
                title="Clear search"
                aria-label="Clear search"
              >
                <X size={15} />
              </button>
            )}
          </div>

          <div className="se-filterChips">
            <button
              type="button"
              className={`se-filterChip ${filterTab === "all" ? "se-filterChip--active" : ""}`}
              onClick={() => setFilterTab("all")}
            >
              All <span className="se-filterChipCount">{assignedFaculty.length}</span>
            </button>
            <button
              type="button"
              className={`se-filterChip ${filterTab === "pending" ? "se-filterChip--active" : ""}`}
              onClick={() => setFilterTab("pending")}
            >
              To Evaluate <span className="se-filterChipCount">{pendingCount}</span>
            </button>
            <button
              type="button"
              className={`se-filterChip ${filterTab === "completed" ? "se-filterChip--active" : ""}`}
              onClick={() => setFilterTab("completed")}
            >
              Completed <span className="se-filterChipCount">{submittedCount}</span>
            </button>
          </div>
        </div>

        <div className="se-sectionSummaryBanner">
          <Info size={15} style={{ color: "#2563eb", flexShrink: 0 }} />
          <span>
            Assigned faculty for <strong>{dept} {yearLevel} - Section {section}</strong>
            {viewPeriod ? <> ({viewPeriod.year} · {viewPeriod.semester})</> : null}. Progress:{" "}
            <strong>{submittedCount}/{assignedFaculty.length}</strong> evaluated.
          </span>
        </div>
      </div>

      {/* Responsive Teacher Cards Grid */}
      {filteredAssignedFaculty.length === 0 ? (
        <div className="se-empty-card">
          <AlertCircle size={36} style={{ color: "#94a3b8", margin: "0 auto 8px" }} />
          <h4 className="se-empty-title">No assigned teachers found</h4>
          <p className="se-empty-desc">
            {searchQuery
              ? `No teachers or subjects match "${searchQuery}".`
              : filterTab === "pending"
              ? "All your evaluations are completed!"
              : "No faculty members match the selected filter."}
          </p>
          {(searchQuery || filterTab !== "all") && (
            <button
              type="button"
              className="sdb-evaluatePillBtn"
              onClick={() => {
                setSearchQuery("");
                setFilterTab("all");
              }}
            >
              Reset Filters
            </button>
          )}
        </div>
      ) : (
        <div className="se-teacher-grid">
          {filteredAssignedFaculty.map((item) => {
            const isEvaluated = item.status === "submitted";
            const initials = (item.name || "??")
              .split(" ")
              .map((n) => n[0])
              .filter(Boolean)
              .slice(0, 2)
              .join("")
              .toUpperCase();

            return (
              <div
                key={item.assignmentId}
                className={`se-teacher-card ${isEvaluated ? "se-teacher-card--evaluated" : ""}`}
              >
                <div>
                  {/* Card Top: Avatar, Name & Status Pill */}
                  <div className="se-teacher-card-top">
                    <div className="se-teacher-profile">
                      <div className={`se-teacher-avatar ${isEvaluated ? "se-teacher-avatar--evaluated" : ""}`}>
                        {initials}
                      </div>
                      <div className="se-teacher-meta">
                        <h4 className="se-teacher-name" title={item.name}>
                          {item.name || "— No faculty assigned"}
                        </h4>
                        <span className="se-teacher-role">Faculty Member</span>
                      </div>
                    </div>

                    {isEvaluated ? (
                      <span className="se-statusPill se-statusPill--evaluated" title="Evaluation finalized">
                        <CheckCircle size={12} /> Evaluated
                      </span>
                    ) : (
                      <span className="se-statusPill se-statusPill--pending">
                        <Clock size={11} /> Pending
                      </span>
                    )}
                  </div>

                  {/* Card Body: Subject Box */}
                  <div className="se-teacher-body">
                    <span className="se-teacher-subject-label">
                      {item.subjectCodes && item.subjectCodes.length > 1 ? "ASSIGNED SUBJECTS" : "ASSIGNED SUBJECT"}
                    </span>
                    <div className="se-teacher-subject-row" style={{ flexWrap: "wrap", gap: "6px" }}>
                      <BookOpen size={16} className="se-teacher-subject-icon" style={{ flexShrink: 0, marginTop: "2px" }} />
                      {item.subjectCodes && item.subjectCodes.length > 1 ? (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", flex: 1 }}>
                          {item.subjectCodes.map((code, idx) => (
                            <span
                              key={code}
                              className="se-teacher-subject-text"
                              style={{
                                background: "#eff6ff",
                                color: "#1d4ed8",
                                padding: "2px 7px",
                                borderRadius: "4px",
                                fontSize: "12px",
                                fontWeight: "600",
                                display: "inline-block",
                              }}
                              title={item.subjectNames?.[idx] || code}
                            >
                              {code}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="se-teacher-subject-text" title={item.subjectName || item.subjectCode}>
                          {item.subjectCode || item.subject}
                        </span>
                      )}
                    </div>

                    <div className="se-teacher-badges-row">
                      <span className="se-teacher-section-badge">
                        {item.dept} {item.year} - Section {item.section}
                      </span>
                      {item.semester && (
                        <span className="se-teacher-sem-badge">
                          {item.semester}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Card Bottom: Action Button */}
                <div className="se-teacher-card-bottom">
                  {isEvaluated ? (
                    <div
                      className="se-btn-evaluated"
                      title={item.submittedAt ? `Submitted on ${formatDate(item.submittedAt)}` : "Evaluation submitted"}
                    >
                      <CheckCircle size={15} />
                      <span>Evaluation Completed</span>
                    </div>
                  ) : !isEvaluationOpen ? (
                    <button type="button" className="se-btn-closed" disabled>
                      <Clock size={15} />
                      <span>Period Closed</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="se-btn-evaluate"
                      onClick={() => handleEvaluate(item)}
                    >
                      <FileText size={15} />
                      <span>Evaluate Teacher</span>
                      <ChevronRight size={15} style={{ marginLeft: "auto" }} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showModal && selectedFaculty && (
        <div className="se-modal" role="dialog" aria-modal="true">
          <div className="se-modalOverlay" onClick={() => setShowModal(false)} />
          <div className="se-modalContent">
            <div className="se-modalHeader">
              <div className="se-modalHeaderTitles">
                <h3 className="se-modalTitle">Faculty Evaluation Form</h3>
                <p className="se-modalSubtitle">
                  <span className="se-modalSubtitleTeacher">{selectedFaculty.name}</span>
                  <span className="se-modalSubtitleDivider">—</span>
                  <span className="se-modalSubtitleSubject" title={selectedFaculty.subjectName || selectedFaculty.subjectCode}>
                    {selectedFaculty.subjectCodes?.length > 1
                      ? `Subjects: ${selectedFaculty.subjectCodes.join(", ")}`
                      : (selectedFaculty.subjectCode || selectedFaculty.subject)}
                  </span>
                </p>
              </div>
              <button type="button" className="se-modalClose" onClick={() => setShowModal(false)} aria-label="Close modal">
                <X size={20} />
              </button>
            </div>

            <div className="se-progressSection">
              <div className="se-progressInfo">
                <div className="se-progressInfoLeft">
                  <span className="se-progressLabel">Completion Progress</span>
                  <span className={`se-progressBadge ${progressPercentage === 100 ? "se-progressBadge--complete" : ""}`}>
                    {progressPercentage}%
                  </span>
                </div>
                <span className="se-progressText">
                  <strong>{answeredQuestions}</strong> of <strong>{totalQuestions}</strong> questions answered
                </span>
              </div>
              <div className="se-progressBar">
                <div
                  className={`se-progressFill ${progressPercentage === 100 ? "se-progressFill--complete" : ""}`}
                  style={{ width: `${progressPercentage}%` }}
                />
              </div>
            </div>

            <div className="se-modalBody">
              <div className="se-instructions">
                <div className="se-instructionsHeader">
                  <Info size={20} />
                  <span>Rating Scale Guide</span>
                </div>
                <div className="se-scale">
                  {[
                    { num: 5, label: "Strongly Agree" },
                    { num: 4, label: "Agree" },
                    { num: 3, label: "Neutral" },
                    { num: 2, label: "Disagree" },
                    { num: 1, label: "Strongly Disagree" },
                  ].map((s) => (
                    <div key={s.num} className={`se-scaleItem se-scaleItem--${s.num}`}>
                      <span className={`se-scaleNum se-scaleNum--${s.num}`}>{s.num}</span>
                      <span className="se-scaleLabel">{s.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {evaluationCriteria.length === 0 ? (
                <div style={{ textAlign: "center", padding: "40px", color: "#6b7280" }}>
                  <p>No questionnaire has been set up yet.</p>
                  <p style={{ fontSize: "13px", marginTop: "8px" }}>Please contact the admin to configure evaluation criteria and questions.</p>
                </div>
              ) : (
                evaluationCriteria.map((criteria) => {
                  const answeredCount = criteria.items.filter((item) => ratings[item.id]).length;
                  const isComplete = answeredCount === criteria.items.length;
                  return (
                    <div key={criteria.id} className="se-criteriaCard">
                      <div className="se-criteriaCardHeader">
                        <div className="se-criteriaIconWrap">
                          <List size={20} strokeWidth={2.5} />
                        </div>
                        <div className="se-criteriaHeaderContent">
                          <h4 className="se-criteriaTitle">{criteria.category}</h4>
                          <p className="se-criteriaSubtitle">
                            {answeredCount} of {criteria.items.length} questions answered
                            {isComplete && <span className="se-completeBadge">✓ Complete</span>}
                          </p>
                        </div>
                      </div>
                      <div className="se-criteriaItems">
                        {criteria.items.map((item) => (
                          <div key={item.id} className="se-criteriaItem">
                            <div className="se-criteriaItemHeader">
                              <div className="se-criteriaText">{item.text}</div>
                            </div>
                            <div className="se-ratingRadioGroup" role="radiogroup" aria-label={`Rating for ${item.text}`}>
                              {[5, 4, 3, 2, 1].map((rating) => {
                                const isSelected = ratings[item.id] === rating;
                                const labelText =
                                  rating === 5 ? "Strongly Agree" :
                                  rating === 4 ? "Agree" :
                                  rating === 3 ? "Neutral" :
                                  rating === 2 ? "Disagree" : "Strongly Disagree";
                                return (
                                  <label
                                    key={rating}
                                    className={`se-ratingRadio se-ratingRadio--${rating} ${isSelected ? "se-ratingRadio--active" : ""}`}
                                    title={`${rating} - ${labelText}`}
                                  >
                                    <input
                                      type="radio"
                                      name={`rating-${item.id}`}
                                      value={rating}
                                      checked={isSelected}
                                      onChange={() => handleRatingChange(item.id, rating)}
                                      className="se-ratingRadioInput"
                                    />
                                    <span className="se-radioCircle" aria-hidden="true">
                                      <span className="se-radioDot" />
                                    </span>
                                    <span className="se-radioNum">{rating}</span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}

              <div className="se-commentsCard">
                <div className="se-commentsHeader">
                  <MessageSquare size={18} />
                  <label className="se-commentsLabel">Additional Comments (Optional)</label>
                </div>
                <textarea
                  className="se-commentsTextarea"
                  placeholder="Share your thoughts, suggestions, or feedback about this instructor's teaching performance..."
                  rows="4"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />

                {/* Phase 6 [Req 8]: Priority pill + OK/Cancel dialog. */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginTop: "12px", flexWrap: "wrap" }}>
                  <div style={{ fontSize: "12.5px", color: "#6b7280" }}>
                    Mark <strong>Priority</strong> if this concern is serious and needs admin attention. The teacher is notified that a concern was escalated — never the comment itself.
                  </div>
                  <button
                    type="button"
                    onClick={handlePriorityToggle}
                    style={{
                      padding: "6px 16px",
                      borderRadius: "999px",
                      border: isPriority ? "none" : "1.5px solid #f59e0b",
                      background: isPriority ? "#f59e0b" : "#fff",
                      color: isPriority ? "#fff" : "#b45309",
                      fontWeight: 800,
                      fontSize: "12px",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {isPriority ? "★ PRIORITY ON" : "☆ Mark as Priority"}
                  </button>
                </div>
              </div>
            </div>

            {/* Phase 6 [Req 8]: Priority OK/Cancel dialog. */}
            {showPriorityDialog && (
              <div className="se-modal" role="alertdialog" aria-modal="true">
                <div className="se-modalOverlay" onClick={() => setShowPriorityDialog(false)} />
                <div className="se-modalContent" style={{ maxWidth: "440px" }}>
                  <div className="se-modalHeader">
                    <div>
                      <h3 className="se-modalTitle">Mark as Priority?</h3>
                    </div>
                    <button type="button" className="se-modalClose" onClick={() => setShowPriorityDialog(false)}>
                      <X size={22} />
                    </button>
                  </div>
                  <div className="se-modalBody" style={{ fontSize: "14px", color: "#374151", lineHeight: 1.6 }}>
                    <p style={{ margin: "0 0 10px" }}>
                      This evaluation will be flagged as a <strong>priority concern</strong> and sent to the administrator for review.
                    </p>
                    <p style={{ margin: 0 }}>
                      The teacher will only be told that a concern was escalated — your comment stays confidential.
                    </p>
                  </div>
                  <div className="se-modalFooter">
                    <button type="button" className="se-modalBtn se-modalBtn--cancel" onClick={() => setShowPriorityDialog(false)}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="se-modalBtn se-modalBtn--submit"
                      style={{ background: "#f59e0b" }}
                      onClick={confirmPriority}
                    >
                      OK, Mark as Priority
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="se-modalFooter">
              <button type="button" className="se-modalBtn se-modalBtn--cancel" onClick={() => setShowModal(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="se-modalBtn se-modalBtn--submit"
                onClick={handleSubmitEvaluation}
                disabled={answeredQuestions < totalQuestions || submitting}
              >
                {submitting ? "Submitting..." : `Submit Evaluation (${progressPercentage}%)`}
              </button>
            </div>
          </div>
        </div>
      )}
    </StudentLayout>
  );
}
