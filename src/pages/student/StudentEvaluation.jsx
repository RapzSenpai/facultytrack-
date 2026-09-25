import { useState, useEffect } from "react";
import { Search, X, List, Calendar, CheckCircle, AlertCircle, Info, MessageSquare, BookOpen, FileText, ChevronRight, Clock } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../config/supabase";
import { parseFunctionError } from "../../utils/audit";
import { isAssignmentMatch } from "../../utils/assignmentMatch";
import StudentLayout from "./StudentLayout";

// Institutional fallback criteria so questionnaire is never blank
const FALLBACK_CRITERIA = [
  {
    id: "fb-1",
    category: "Instructional Competence & Subject Mastery",
    items: [
      { id: "q1", text: "Demonstrates comprehensive and up-to-date knowledge of the subject matter." },
      { id: "q2", text: "Explains lessons and concepts clearly with practical, real-world examples." },
      { id: "q3", text: "Organizes topics logically and follows the approved course syllabus." },
      { id: "q4", text: "Encourages student questions, analytical discussions, and critical thinking." },
    ],
  },
  {
    id: "fb-2",
    category: "Classroom Management & Learning Environment",
    items: [
      { id: "q5", text: "Starts and dismisses classes punctually and maintains consistent attendance." },
      { id: "q6", text: "Fosters an inclusive, respectful, and motivating classroom atmosphere." },
      { id: "q7", text: "Enforces classroom rules and academic standards fairly and consistently." },
    ],
  },
  {
    id: "fb-3",
    category: "Assessment & Constructive Feedback",
    items: [
      { id: "q8", text: "Provides timely and constructive feedback on exams, assignments, and projects." },
      { id: "q9", text: "Evaluates student work objectively based on transparent grading criteria." },
    ],
  },
  {
    id: "fb-4",
    category: "Professionalism & Communication",
    items: [
      { id: "q10", text: "Shows approachability, professionalism, and willingness to assist students." },
      { id: "q11", text: "Communicates course expectations, deadlines, and grade standing clearly." },
    ],
  },
];

export default function StudentEvaluation() {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterTab, setFilterTab] = useState("all");
  const [selectedFaculty, setSelectedFaculty] = useState(null);
  const [selectedSubjectId, setSelectedSubjectId] = useState("");
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
          supabase.from("criteria").select("*"),
          supabase.from("questions").select("*"),
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

        // Active criteria: load active criteria with questions, or fallback to standard criteria
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

        setEvaluationCriteria(builtCriteria.length > 0 ? builtCriteria : FALLBACK_CRITERIA);

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
              name: a.facultyName || "— No faculty assigned",
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

        // Pre-selection if navigated with URL parameters (?assignmentId=... or ?facultyId=...)
        const searchParams = new URLSearchParams(window.location.search);
        const initialAssignmentId = searchParams.get("assignmentId");
        if (initialAssignmentId) {
          const target = matchedFaculty.find((f) => f.assignmentId === initialAssignmentId);
          if (target && target.status !== "submitted") {
            setSelectedFaculty(target);
            setSelectedSubjectId(target.assignmentId);
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
              setSelectedSubjectId(target.assignmentId);
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
    setSelectedSubjectId(faculty.assignmentId);
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
    if (!activeYear) { alert("No active evaluation period is available."); return; }
    setSubmitting(true);
    try {
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
      newSubData.set(selectedFaculty.assignmentId, {
        ratings,
        comment,
        submittedAt,
      });
      setSubmissionsData(newSubData);

      const newSubmittedIds = new Set([...submittedIds, selectedFaculty.assignmentId]);
      setSubmittedIds(newSubmittedIds);
      setAssignedFaculty((prev) =>
        prev.map((f) => f.assignmentId === selectedFaculty.assignmentId
          ? { ...f, status: "submitted", submittedAt }
          : f)
      );

      setShowModal(false);
      setSelectedFaculty(null);
      setSelectedSubjectId("");
      setRatings({});
      setComment("");
      setIsPriority(false);

      if (moderationStatus === "flag") {
        alert(`Evaluation for ${selectedFaculty.name} submitted. Your comment was flagged for review and will be checked by the administrator before release.`);
      } else if (isPriority) {
        alert(`Priority evaluation for ${selectedFaculty.name} submitted. The administrator will review it.`);
      } else {
        alert(`Evaluation for ${selectedFaculty.name} submitted successfully!`);
      }
    } catch (error) {
      alert("Error: " + error.message);
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
    const subjectMatch = (item.subject || "").toLowerCase().includes(query);
    const sectionMatch = `${item.dept || ""} ${item.year || ""} ${item.section || ""}`.toLowerCase().includes(query);
    return nameMatch || subjectMatch || sectionMatch;
  });

  const now = new Date();
  const endDate = activeYear?.endDate ? new Date(activeYear.endDate + "T23:59:59") : null;
  const isEvaluationOpen = !loading && activeYear !== null && (!endDate || now <= endDate);

  const uniqueFacultyNames = [...new Set(assignedFaculty.map((f) => f.name))].sort();
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
    setSelectedSubjectId(match?.assignmentId || "");
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

      {/* Search Bar & Filter Controls */}
      <div className="se-controlsCard">
        <div className="se-controlsTop">
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
            Assigned faculty for <strong>{dept} {yearLevel} - Section {section}</strong>. Progress:{" "}
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
                    <span className="se-teacher-subject-label">ASSIGNED SUBJECT</span>
                    <div className="se-teacher-subject-row">
                      <BookOpen size={16} className="se-teacher-subject-icon" />
                      <span className="se-teacher-subject-text">{item.subject}</span>
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
                  <span className="se-modalSubtitleSubject">{selectedFaculty.subject}</span>
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
                    { num: 5, label: "Outstanding" },
                    { num: 4, label: "Very Good" },
                    { num: 3, label: "Good" },
                    { num: 2, label: "Fair" },
                    { num: 1, label: "Poor" },
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
                            <div className="se-ratingButtons">
                              {[1, 2, 3, 4, 5].map((rating) => (
                                <button
                                  key={rating}
                                  type="button"
                                  className={`se-ratingBtn se-ratingBtn--${rating} ${ratings[item.id] === rating ? "se-ratingBtn--active" : ""}`}
                                  onClick={() => handleRatingChange(item.id, rating)}
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
