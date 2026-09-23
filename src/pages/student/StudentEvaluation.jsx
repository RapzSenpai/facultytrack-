import { useState, useEffect } from "react";
import { Search, X, List, Calendar, CheckCircle, AlertCircle, Info, MessageSquare, AlertTriangle, ChevronRight } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../config/supabase";
import StudentLayout from "./StudentLayout";

// Phase 3 (Req 2 / D5): the subject list is admin-controlled.
// All self-enrollment UI (Add Subject modal, confirm/remove,
// "Edit Subjects") is removed. Evaluable subjects =
// section match adjusted by the admin's per-student list
// (admin/exception enrollment replaces the match; exclusions
// remove). Subject-list problems are reported in-app via
// subject_correction_requests and resolved by an admin.
export default function StudentEvaluation() {
  const [mode, setMode] = useState("loading");

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFaculty, setSelectedFaculty] = useState(null);
  const [selectedSubjectId, setSelectedSubjectId] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [ratings, setRatings] = useState({});
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [assignedFaculty, setAssignedFaculty] = useState([]);
  const [submissionsData, setSubmissionsData] = useState(new Map());
  const [submittedIds, setSubmittedIds] = useState(new Set());
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [evaluationCriteria, setEvaluationCriteria] = useState([]);
  const [activeYear, setActiveYear] = useState(null);
  const [loading, setLoading] = useState(true);

  const [correctionMessage, setCorrectionMessage] = useState("");
  const [correctionRequests, setCorrectionRequests] = useState([]);
  const [submittingCorrection, setSubmittingCorrection] = useState(false);

  const { currentUser, userProfile } = useAuth();

  useEffect(() => {
    if (!currentUser || !userProfile) return;

    const studentDept = userProfile.department || userProfile.dept || "";
    const studentYear = userProfile.yearLevel || userProfile.year || "";
    const studentSection = userProfile.section || "";

    (async () => {
      try {
        const [assignmentsRes, submissionsRes, criteriaRes, questionsRes, yearsRes, enrRes, corrRes] = await Promise.all([
          supabase.from("class_assignments").select("*"),
          supabase.from("evaluations").select("*").eq("student_id", currentUser.id),
          supabase.from("criteria").select("*"),
          supabase.from("questions").select("*"),
          supabase.from("academic_years").select("*"),
          // Admin-managed per-student list (read-only for students).
          supabase
            .from("student_enrollments")
            .select("confirmed_assignments, excluded_assignments, enrollment_kind")
            .eq("student_id", currentUser.id)
            .maybeSingle(),
          supabase
            .from("subject_correction_requests")
            .select("*")
            .eq("student_id", currentUser.id)
            .order("created_at", { ascending: false }),
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

        const criteria = criteriaRes.data || [];
        const questions = (questionsRes.data || []).map((q) => ({
          id: q.id,
          criteriaId: q.criteria_id,
          text: q.text,
          order: q.order,
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

        setCorrectionRequests(corrRes.data || []);

        // Active criteria: use explicitly enabled criteria if any exist, otherwise fallback to all criteria
        const activeCriteriaList = criteria.some((c) => c.enabled)
          ? criteria.filter((c) => c.enabled)
          : criteria;

        const builtCriteria = activeCriteriaList.map((c) => ({
          id: c.id,
          category: c.name,
          items: questions
            .filter((q) => q.criteriaId === c.id)
            .sort((a, b) => a.order - b.order)
            .map((q) => ({ id: q.id, text: q.text })),
        })).filter((c) => c.items.length > 0);
        setEvaluationCriteria(builtCriteria);

        const activeAssignments = active
          ? assignments.filter((a) => a.academicYear === active.year && a.semester === active.semester)
          : [];

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

        if (!active) {
          setAssignedFaculty([]);
          setMode("evaluation");
          return;
        }

        // Admin-managed per-student list: admin/exception kinds
        // replace the section match; exclusions always remove.
        // Legacy confirmed ids (pre-Phase 3 confirmations) widen
        // the section match.
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

        setAssignedFaculty(evaluable.map((a) => {
          const subData = subMap.get(a.id);
          return {
            assignmentId: a.id,
            facultyId: a.facultyId,
            name: a.facultyName,
            subject: `${a.subjectCode} - ${a.subjectName}`,
            dept: a.department,
            year: a.yearLevel,
            section: a.section,
            status: subData ? "submitted" : "pending",
            submittedAt: subData?.submittedAt,
            isDefaultMatch: sectionMatched.some((m) => m.id === a.id),
          };
        }));
        setMode("evaluation");
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
    setIsReadOnly(false);
    setShowModal(true);
  };

  const handleViewSubmission = (faculty) => {
    const subData = submissionsData.get(faculty.assignmentId);
    if (!subData) return;
    setSelectedFaculty(faculty);
    setRatings(subData.ratings || {});
    setComment(subData.comment || "");
    setIsReadOnly(true);
    setShowModal(true);
  };

  const handleRatingChange = (questionId, value) => {
    setRatings((prev) => ({ ...prev, [questionId]: value }));
  };

  const handleSubmitEvaluation = async () => {
    if (!selectedFaculty || !currentUser) return;
    if (!activeYear) { alert("No active evaluation period is available."); return; }
    setSubmitting(true);
    try {
      // Submission goes through the submit-evaluation Edge Function
      // (the only write path for evaluations; RLS blocks direct inserts).
      const { data, error } = await supabase.functions.invoke("submit-evaluation", {
        body: {
          assignment_id: selectedFaculty.assignmentId,
          ratings,
          comment,
        },
      });
      if (error) {
        let message = error.message || "Submission failed. Please try again.";
        try {
          const body = await error.context.json();
          if (body?.error) message = body.error;
        } catch {
          // keep the default message for non-JSON error bodies
        }
        throw new Error(message);
      }
      const newSubData = new Map(submissionsData);
      newSubData.set(selectedFaculty.assignmentId, {
        ratings,
        comment,
        submittedAt: data?.evaluation?.submitted_at || new Date().toISOString(),
      });
      setSubmissionsData(newSubData);

      const newSubmittedIds = new Set([...submittedIds, selectedFaculty.assignmentId]);
      setSubmittedIds(newSubmittedIds);
      setAssignedFaculty((prev) =>
        prev.map((f) => f.assignmentId === selectedFaculty.assignmentId
          ? { ...f, status: "submitted", submittedAt: data.evaluation?.submitted_at || new Date().toISOString() }
          : f)
      );
      setShowModal(false);
      setSelectedFaculty(null);
      alert(`Evaluation for ${selectedFaculty.name} submitted successfully!`);
    } catch (error) {
      alert("Error: " + error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const refreshCorrectionRequests = async () => {
    const { data } = await supabase
      .from("subject_correction_requests")
      .select("*")
      .eq("student_id", currentUser.id)
      .order("created_at", { ascending: false });
    setCorrectionRequests(data || []);
  };

  const handleSubmitCorrection = async () => {
    const message = correctionMessage.trim();
    if (!message) {
      alert("Please describe the issue before sending.");
      return;
    }
    setSubmittingCorrection(true);
    try {
      const { error } = await supabase.from("subject_correction_requests").insert({
        student_id: currentUser.id,
        message,
      });
      if (error) throw new Error(error.message);
      setCorrectionMessage("");
      await refreshCorrectionRequests();
      alert("Report sent. The administrator will review your subject list.");
    } catch (err) {
      alert("Error: " + err.message);
    } finally {
      setSubmittingCorrection(false);
    }
  };

  const totalQuestions = evaluationCriteria.reduce((sum, c) => sum + c.items.length, 0);
  const answeredQuestions = Object.keys(ratings).length;
  const progressPercentage = totalQuestions > 0 ? Math.round((answeredQuestions / totalQuestions) * 100) : 0;
  const submittedCount = assignedFaculty.filter((f) => f.status === "submitted").length;

  const currentStep = !showModal
    ? 1
    : (submitting ? 4 : (answeredQuestions < totalQuestions ? 2 : 3));

  const now = new Date();
  const endDate = activeYear?.endDate ? new Date(activeYear.endDate + "T23:59:59") : null;
  const isEvaluationOpen = !loading && activeYear !== null && (!endDate || now <= endDate);

  if (mode === "loading" || loading) {
    return (
      <StudentLayout breadcrumb="Evaluate Teacher">
        <div style={{ padding: "60px", textAlign: "center", color: "#6b7280" }}>Loading...</div>
      </StudentLayout>
    );
  }

  const uniqueFacultyNames = [...new Set(assignedFaculty.map((f) => f.name).filter(Boolean))].sort();
  const filteredFacultyNames = uniqueFacultyNames.filter((name) =>
    name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const subjectsForFaculty = selectedFaculty
    ? assignedFaculty.filter((f) => f.name === selectedFaculty.name)
    : [];

  const chosenAssignment = subjectsForFaculty.find((f) => f.assignmentId === selectedSubjectId) || null;

  const hoursLeft = endDate ? Math.max(0, Math.floor((endDate - now) / 1000 / 3600)) : null;
  const showUrgencyBanner = isEvaluationOpen && hoursLeft !== null && hoursLeft <= 72;

  const handleSelectFaculty = (name) => {
    const match = assignedFaculty.find((f) => f.name === name);
    setSelectedFaculty(match || null);
    setSelectedSubjectId("");
    setSearchQuery(name);
  };

  const handleBeginEvaluation = () => {
    if (!chosenAssignment) return;
    handleEvaluate(chosenAssignment);
  };

  const formatDate = (ts) => {
    if (!ts) return "—";
    const date = new Date(ts);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  const formatDateTime = (ts) => {
    if (!ts) return "—";
    const date = new Date(ts);
    return date.toLocaleString("en-US", {
      month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
    });
  };

  const requestStatusBadge = (status) => {
    if (status === "resolved") {
      return <span className="sd-statusBadge sd-statusBadge--open" style={{ background: "#dcfce7", color: "#166534" }}>Resolved</span>;
    }
    if (status === "dismissed") {
      return <span className="sd-statusBadge sd-statusBadge--closed" style={{ background: "#f3f4f6", color: "#6b7280" }}>Dismissed</span>;
    }
    return <span className="sd-statusBadge sd-statusBadge--closed" style={{ background: "#fef3c7", color: "#92400e" }}>Under review</span>;
  };

  return (
    <StudentLayout breadcrumb="Evaluate Teacher">
      <div className="se-pageHeader">
        <div className="se-pageHeaderTop">
          <div className="se-pageHeaderLeft">
            <h2 className="se-pageTitle">Submit Evaluation</h2>
            <p className="se-pageSubtitle">
              {activeYear
                ? `${activeYear.year} — ${activeYear.semester} · Rate each faculty member carefully.`
                : "No active evaluation period found."}
            </p>
          </div>
        </div>

        <div className="se-stepper">
          <div className={`se-step-item ${currentStep >= 1 ? "active" : ""} ${currentStep > 1 ? "completed" : ""}`}>
            <div className="se-step-circle">1</div>
            <div className="se-step-text">
              <span className="se-step-title">Select Faculty</span>
              <span className="se-step-desc">Choose faculty and subject</span>
            </div>
          </div>
          <div className="se-step-divider"></div>
          <div className={`se-step-item ${currentStep >= 2 ? "active" : ""} ${currentStep > 2 ? "completed" : ""}`}>
            <div className="se-step-circle">2</div>
            <div className="se-step-text">
              <span className="se-step-title">Answer Questions</span>
              <span className="se-step-desc">Rate and give feedback</span>
            </div>
          </div>
          <div className="se-step-divider"></div>
          <div className={`se-step-item ${currentStep >= 3 ? "active" : ""} ${currentStep > 3 ? "completed" : ""}`}>
            <div className="se-step-circle">3</div>
            <div className="se-step-text">
              <span className="se-step-title">Review</span>
              <span className="se-step-desc">Check your responses</span>
            </div>
          </div>
          <div className="se-step-divider"></div>
          <div className={`se-step-item ${currentStep >= 4 ? "active" : ""} ${currentStep > 4 ? "completed" : ""}`}>
            <div className="se-step-circle">4</div>
            <div className="se-step-text">
              <span className="se-step-title">Submit</span>
              <span className="se-step-desc">Complete evaluation</span>
            </div>
          </div>
        </div>
      </div>

      {showUrgencyBanner && (
        <div className="se-urgencyBanner">
          <span className="se-urgencyIcon">⏳</span>
          <span>
            <strong>Evaluation period closes soon!</strong>
            {" "}You have ~{hoursLeft} hour{hoursLeft !== 1 ? "s" : ""} left to submit.{" "}
            Deadline:{" "}
            <strong>
              {endDate.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric" })},{""}
              {endDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}
            </strong>
          </span>
        </div>
      )}

      {!isEvaluationOpen && (
        <div className="se-closedBanner">
          <AlertCircle size={22} />
          <div>
            <strong>Evaluation Period is Closed</strong>
            <p style={{ margin: "2px 0 0", fontSize: "13px", opacity: 0.85 }}>
              {activeYear
                ? `The evaluation for ${activeYear.year} ${activeYear.semester} is not currently open. Please contact the administrator.`
                : "There is no active evaluation period at this time. Please contact the administrator."}
            </p>
          </div>
        </div>
      )}

      {assignedFaculty.length > 0 && (
        <div className="se-progressSummaryCardHorizontal">
          <div className="se-progressSummaryLeft">
            <h3 className="se-progressSummaryTitle">Evaluation Progress</h3>
            <div className="se-progressSummaryCountBox">
              <span className="se-progressSummaryCurrent">{submittedCount}</span>
              <span className="se-progressSummaryTotal">of {assignedFaculty.length}</span>
            </div>
            <div className="se-progressSummaryText">evaluations completed</div>
          </div>
          <div className="se-progressSummaryRight">
            <div className="se-progressSummaryBarWrapper">
              <div className="se-progressSummaryBarHorizontal">
                <div
                  className="se-progressSummaryFillHorizontal"
                  style={{ width: assignedFaculty.length > 0 ? `${Math.round((submittedCount / assignedFaculty.length) * 100)}%` : "0%" }}
                />
              </div>
              <span className="se-progressSummaryPercent">
                {assignedFaculty.length > 0 ? `${Math.round((submittedCount / assignedFaculty.length) * 100)}%` : "0%"}
              </span>
            </div>
            <div className="se-progressSummaryEncouragement">
              <CheckCircle size={16} className="se-progressCheckIcon" />
              <span>Great! You're {submittedCount === assignedFaculty.length ? "done" : "halfway there"}.</span>
            </div>
          </div>
        </div>
      )}

      <div className="se-stepCard">
        <div className="se-stepHeader se-stepHeader-flex">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span className="se-stepBadge">STEP 1</span>
            <h3 className="se-stepTitle">Select Faculty Member &amp; Subject</h3>
          </div>
        </div>

        <div className="se-infoCallout">
          <Info size={16} className="se-infoCalloutIcon" />
          <div>
            <p className="se-infoCalloutStrong">
              Your subject list is set by the administrator for your program and section.
            </p>
            <p className="se-infoCalloutText">
              You have <strong>{assignedFaculty.length}</strong> subject(s) this semester.
              Progress: <strong>{submittedCount}/{assignedFaculty.length}</strong> evaluated.
              {" "}If a subject is wrong or missing, use <strong>Report an Issue</strong> below —
              the administrator will correct your list.
            </p>
          </div>
        </div>

        <div className="se-step1-inputs">
          <div className="se-fieldGroup">
            <label className="se-fieldLabel">SEARCH FACULTY MEMBER</label>
            <div className="se-searchWrap">
              <Search size={16} className="se-searchIcon" />
              <input
                type="text"
                className="se-search"
                placeholder="Search by faculty name..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (selectedFaculty && e.target.value !== selectedFaculty.name) {
                    setSelectedFaculty(null);
                    setSelectedSubjectId("");
                  }
                }}
              />
            </div>
            {searchQuery && !selectedFaculty && filteredFacultyNames.length > 0 && (
              <div className="se-suggestionList">
                {filteredFacultyNames.map((name) => {
                  const isDone = assignedFaculty
                    .filter((x) => x.name === name)
                    .every((x) => x.status === "submitted");
                  return (
                    <div
                      key={name}
                      className={`se-suggestionItem ${isDone ? "se-suggestionItem--done" : ""}`}
                      onClick={() => handleSelectFaculty(name)}
                    >
                      <div className="sd-avatar sd-avatar--blue" style={{ width: 30, height: 30, fontSize: 11, flexShrink: 0 }}>
                        {name.substring(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <span className="se-suggestionName">{name}</span>
                        {isDone && <span className="se-suggestionDone">✓ All Evaluated</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="se-fieldGroup">
            <label className="se-fieldLabel">SUBJECT / COURSE</label>
            <div className="se-selectWrap">
              <select
                className="se-subjectSelect"
                value={selectedSubjectId}
                onChange={(e) => setSelectedSubjectId(e.target.value)}
                disabled={!selectedFaculty || subjectsForFaculty.length === 0}
              >
                <option value="">
                  {selectedFaculty
                    ? subjectsForFaculty.length === 0
                      ? "— No subjects available —"
                      : "— Select a subject —"
                    : "— Select a faculty member first —"}
                </option>
                {subjectsForFaculty.map((f) => (
                  <option key={f.assignmentId} value={f.assignmentId} disabled={f.status === "submitted"}>
                    {f.subject}{f.status === "submitted" ? " ✓ Already Evaluated" : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
          <button
            type="button"
            className="se-beginBtn"
            onClick={handleBeginEvaluation}
            disabled={
              !chosenAssignment ||
              chosenAssignment.status === "submitted" ||
              !isEvaluationOpen
            }
          >
            {!chosenAssignment
              ? "Select Faculty & Subject"
              : chosenAssignment.status === "submitted"
                ? "Already Evaluated"
                : !isEvaluationOpen
                  ? "Period Closed"
                  : "Begin Evaluation →"}
          </button>
        </div>
      </div>

      {assignedFaculty.length > 0 && (
        <div className="se-tableCard">
          <div className="se-tableHeader se-tableHeader-flex">
            <div>
              <h3 className="se-tableTitle">My Submissions</h3>
              <p className="se-tableHint">All subjects you are assigned to evaluate.</p>
            </div>
            <div className="se-tableSearchWrap">
              <input type="text" placeholder="Search submissions..." className="se-tableSearch" />
              <Search size={16} className="se-tableSearchIcon" />
            </div>
          </div>
          <div className="se-tableWrap">
            <table className="sd-table">
              <thead>
                <tr>
                  <th>FACULTY NAME</th>
                  <th>SUBJECT</th>
                  <th>SECTION</th>
                  <th>STATUS</th>
                  <th>SUBMITTED DATE</th>
                  <th style={{ textAlign: "right" }}>ACTION</th>
                </tr>
              </thead>
              <tbody>
                {assignedFaculty.map((item) => (
                  <tr key={item.assignmentId}>
                    <td>
                      <div className="sd-avatarCell">
                        <div className="sd-avatar sd-avatar--blue">
                          {(item.name || "??").substring(0, 2).toUpperCase()}
                        </div>
                        <span className="sd-cellPrimary">{item.name}</span>
                      </div>
                    </td>
                    <td className="sd-engagement">{item.subject}</td>
                    <td>
                      <span className="se-sectionBadge">
                        {item.dept} {item.year} - {item.section}
                      </span>
                    </td>
                    <td>
                      {item.status === "submitted" ? (
                        <span className="sd-statusBadge sd-statusBadge--open" style={{ background: "#dcfce7", color: "#166534" }}>Submitted</span>
                      ) : (
                        <span className="sd-statusBadge sd-statusBadge--closed" style={{ background: "#fef3c7", color: "#92400e" }}>Pending</span>
                      )}
                    </td>
                    <td className="sd-engagement">{item.status === "submitted" ? formatDate(item.submittedAt) : "—"}</td>
                    <td className="sd-tableActions" style={{ justifyContent: "flex-end" }}>
                      {item.status === "submitted" ? (
                        <button
                          type="button"
                          className="se-editEnrollmentBtn"
                          style={{ padding: "6px 12px", fontSize: "12px", background: "white", border: "1px solid #e5e7eb" }}
                          onClick={() => handleViewSubmission(item)}
                        >
                          View submission
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="se-confirmBtn"
                          style={{ padding: "6px 12px", fontSize: "12px" }}
                          onClick={() => handleEvaluate(item)}
                          disabled={!isEvaluationOpen}
                        >
                          Evaluate
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="se-tableCard">
        <div className="se-tableHeader se-tableHeader-flex">
          <div>
            <h3 className="se-tableTitle">Report an Issue</h3>
            <p className="se-tableHint">
              Wrong, missing, or extra subject on your list? Tell the administrator here.
            </p>
          </div>
        </div>

        <div style={{ padding: "16px" }}>
          <textarea
            className="se-commentsTextarea"
            style={{ width: "100%", boxSizing: "border-box" }}
            placeholder="Example: 'I am enrolled in IT 311 with Prof. Santos but it is not on my list' or 'I am not taking COM 101 — please remove it'..."
            rows="3"
            value={correctionMessage}
            onChange={(e) => setCorrectionMessage(e.target.value)}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "10px" }}>
            <button
              type="button"
              className="se-confirmBtn"
              onClick={handleSubmitCorrection}
              disabled={submittingCorrection || !correctionMessage.trim()}
            >
              <AlertTriangle size={14} style={{ marginRight: 6 }} />
              {submittingCorrection ? "Sending..." : "Send Report"}
            </button>
          </div>

          {correctionRequests.length > 0 && (
            <div style={{ marginTop: "16px" }}>
              <p className="se-tableHint" style={{ marginBottom: "8px" }}>
                Your previous reports
              </p>
              <div className="se-tableWrap" style={{ border: "1px solid #e5e7eb", borderRadius: "8px" }}>
                <table className="sd-table">
                  <thead>
                    <tr>
                      <th>REPORT</th>
                      <th>SENT</th>
                      <th>STATUS</th>
                      <th>ADMIN NOTE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {correctionRequests.map((req) => (
                      <tr key={req.id}>
                        <td className="sd-engagement" style={{ maxWidth: "360px" }}>{req.message}</td>
                        <td className="sd-engagement">{formatDateTime(req.created_at)}</td>
                        <td>{requestStatusBadge(req.status)}</td>
                        <td className="sd-engagement" style={{ maxWidth: "240px" }}>
                          {req.resolution_note || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {showModal && selectedFaculty && (
        <div className="se-modal" role="dialog" aria-modal="true">
          <div className="se-modalOverlay" onClick={() => setShowModal(false)} />
          <div className="se-modalContent">
            <div className="se-modalHeader">
              <div>
                <h3 className="se-modalTitle">Faculty Evaluation Form</h3>
                <p className="se-modalSubtitle">{selectedFaculty.name} — {selectedFaculty.subject}</p>
              </div>
              <button type="button" className="se-modalClose" onClick={() => setShowModal(false)}>
                <X size={22} />
              </button>
            </div>

            <div className="se-progressSection">
              <div className="se-progressInfo">
                <span className="se-progressLabel">Completion Progress</span>
                <span className="se-progressText">{answeredQuestions} of {totalQuestions} questions answered</span>
              </div>
              <div className="se-progressBar">
                <div className="se-progressFill" style={{ width: `${progressPercentage}%` }} />
              </div>
              <div className="se-progressPercent">{progressPercentage}%</div>
            </div>

            <div className="se-modalBody">
              <div className="se-instructions">
                <div className="se-instructionsHeader">
                  <Info size={20} />
                  <span>Rating Scale Guide</span>
                </div>
                <div className="se-scale">
                  {[
                    { num: 5, label: "Outstanding" },
                    { num: 4, label: "Very Good" },
                    { num: 3, label: "Good" },
                    { num: 2, label: "Fair" },
                    { num: 1, label: "Poor" },
                  ].map((s) => (
                    <div key={s.num} className="se-scaleItem">
                      <span className="se-scaleNum">{s.num}</span>
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
                            <div className="se-ratingButtons">
                              {[1, 2, 3, 4, 5].map((rating) => (
                                <button
                                  key={rating}
                                  type="button"
                                  className={`se-ratingBtn ${ratings[item.id] === rating ? "se-ratingBtn--active" : ""}`}
                                  onClick={() => !isReadOnly && handleRatingChange(item.id, rating)}
                                  disabled={isReadOnly}
                                  title={rating === 5 ? "Outstanding" : rating === 4 ? "Very Good" : rating === 3 ? "Good" : rating === 2 ? "Fair" : "Poor"}
                                >
                                  {rating}
                                </button>
                              ))}
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
              </div>
            </div>

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
