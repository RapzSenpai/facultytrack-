import { useState, useEffect } from "react";
import { Search, X, List, Calendar, CheckCircle, AlertCircle, Info, MessageSquare, Plus, Minus, BookOpen, ChevronRight } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../config/supabase";
import StudentLayout from "./StudentLayout";

export default function StudentEvaluation() {
  const [mode, setMode] = useState("loading");

  const [enrollmentList, setEnrollmentList] = useState([]);
  const [allAssignments, setAllAssignments] = useState([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addSearch, setAddSearch] = useState("");
  const [savingEnrollment, setSavingEnrollment] = useState(false);

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

  const { currentUser, userProfile } = useAuth();

  useEffect(() => {
    if (!currentUser || !userProfile) return;

    const studentDept = userProfile.department || userProfile.dept || "";
    const studentYear = userProfile.yearLevel || userProfile.year || "";
    const studentSection = userProfile.section || "";

    (async () => {
      try {
        const [assignmentsRes, submissionsRes, criteriaRes, questionsRes, yearsRes] = await Promise.all([
          supabase.from("class_assignments").select("*"),
          supabase.from("evaluations").select("*").eq("student_id", currentUser.id),
          supabase.from("criteria").select("*"),
          supabase.from("questions").select("*"),
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

        const enabledCriteria = criteria.filter((c) => c.enabled);
        const builtCriteria = enabledCriteria.map((c) => ({
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
        setAllAssignments(activeAssignments);

        const defaultMatched = activeAssignments.filter(
          (a) =>
            a.department === studentDept &&
            a.yearLevel === studentYear &&
            a.section === studentSection
        );

        if (!active) {
          setAssignedFaculty([]);
          setMode("evaluation");
          return;
        }

        const { data: enrData } = await supabase
          .from("student_enrollments")
          .select("*")
          .eq("student_id", currentUser.id)
          .eq("academic_year", active.year)
          .eq("semester", active.semester)
          .maybeSingle();

        if (enrData && Array.isArray(enrData.confirmed_assignments)) {
          const confirmedSet = new Set(enrData.confirmed_assignments);
          const confirmedFaculty = activeAssignments
            .filter((a) => confirmedSet.has(a.id))
            .map((a) => {
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
                isDefaultMatch: a.department === studentDept && a.yearLevel === studentYear && a.section === studentSection,
              };
            });
          setAssignedFaculty(confirmedFaculty);
          setMode("evaluation");
          return;
        }

        setEnrollmentList(defaultMatched.map((a) => ({
          assignmentId: a.id,
          facultyId: a.facultyId,
          name: a.facultyName,
          subject: `${a.subjectCode} - ${a.subjectName}`,
          dept: a.department,
          year: a.yearLevel,
          section: a.section,
          isDefaultMatch: true,
        })));
        setMode("enrollment");
      } catch (err) {
        console.error("Evaluation page fetch error:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, [currentUser, userProfile]);

  const handleAddSubject = (assignment) => {
    const already = enrollmentList.some((e) => e.assignmentId === assignment.id);
    if (already) return;
    setEnrollmentList((prev) => [...prev, {
      assignmentId: assignment.id,
      facultyId: assignment.facultyId,
      name: assignment.facultyName,
      subject: `${assignment.subjectCode} - ${assignment.subjectName}`,
      dept: assignment.department,
      year: assignment.yearLevel,
      section: assignment.section,
      isDefaultMatch: false,
    }]);
    setShowAddModal(false);
    setAddSearch("");
  };

  const handleRemoveSubject = (assignmentId) => {
    setEnrollmentList((prev) => prev.filter((e) => e.assignmentId !== assignmentId));
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
      setAssignedFaculty(enrollmentList.map((e) => ({
        ...e,
        status: submittedIds.has(e.assignmentId) ? "submitted" : "pending",
        submittedAt: submissionsData.get(e.assignmentId)?.submittedAt,
      })));
      setMode("evaluation");
    } catch (err) {
      alert("Error: " + err.message);
    } finally {
      setSavingEnrollment(false);
    }
  };

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
      const { data, error } = await supabase
        .from("evaluations")
        .insert({
          student_id: currentUser.id,
          faculty_id: selectedFaculty.facultyId,
          assignment_id: selectedFaculty.assignmentId,
          academic_year: activeYear.year,
          semester: activeYear.semester,
          ratings,
          comment,
          submitted_at: new Date().toISOString(),
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      const newSubData = new Map(submissionsData);
      newSubData.set(selectedFaculty.assignmentId, {
        ratings,
        comment,
        submittedAt: data.submitted_at,
      });
      setSubmissionsData(newSubData);

      const newSubmittedIds = new Set([...submittedIds, selectedFaculty.assignmentId]);
      setSubmittedIds(newSubmittedIds);
      setAssignedFaculty((prev) =>
        prev.map((f) => f.assignmentId === selectedFaculty.assignmentId
          ? { ...f, status: "submitted", submittedAt: data.submitted_at }
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

  const dept = userProfile?.department || userProfile?.dept || "—";
  const yearLevel = userProfile?.yearLevel || userProfile?.year || "—";
  const section = userProfile?.section || "—";

  const filteredFaculty = assignedFaculty.filter((f) =>
    f.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    f.subject.toLowerCase().includes(searchQuery.toLowerCase())
  );

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

  const addableAssignments = allAssignments.filter(
    (a) => !enrollmentList.some((e) => e.assignmentId === a.id)
  ).filter((a) =>
    addSearch === "" ||
    (a.subjectCode || "").toLowerCase().includes(addSearch.toLowerCase()) ||
    (a.subjectName || "").toLowerCase().includes(addSearch.toLowerCase()) ||
    (a.facultyName || "").toLowerCase().includes(addSearch.toLowerCase()) ||
    (a.department || "").toLowerCase().includes(addSearch.toLowerCase())
  );

  if (mode === "loading" || loading) {
    return (
      <StudentLayout breadcrumb="Evaluate Teacher">
        <div style={{ padding: "60px", textAlign: "center", color: "#6b7280" }}>Loading...</div>
      </StudentLayout>
    );
  }

  if (mode === "enrollment") {
    return (
      <StudentLayout breadcrumb="Evaluate Teacher">
        <div className="sd-welcomeHeader">
          <div>
            <h2 className="sd-title">Review Your Enrolled Subjects</h2>
            <p className="sd-subtitle">
              Confirm the subjects you are taking this semester before evaluating your teachers.
            </p>
          </div>
          <div className="sd-dateInfo">
            {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
          </div>
        </div>

        <div className="sd-infoCard">
          <div className="sd-infoIcon"><Calendar size={24} /></div>
          <div>
            <div className="sd-infoTitle">
              Academic Year: {activeYear ? `${activeYear.year} ${activeYear.semester}` : "—"}
            </div>
            <div className="sd-infoText">
              <strong>Your Section:</strong> {dept} {yearLevel} - {section}
            </div>
            <div className="sd-infoText">
              The list below was <strong>automatically matched</strong> to your section. Review it carefully — remove any subject you are <em>not</em> taking, and add any irregular or retake subjects you are enrolled in.
            </div>
          </div>
        </div>

        <div className="se-tableCard">
          <div className="se-tableHeader">
            <div>
              <h3 className="se-tableTitle">Your Subjects This Semester</h3>
              <p className="se-tableHint">{enrollmentList.length} subject(s) added</p>
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
            <table className="ad-table">
              <thead>
                <tr>
                  <th>FACULTY NAME</th>
                  <th>SUBJECT</th>
                  <th>SECTION</th>
                  <th style={{ textAlign: "right" }}>REMOVE</th>
                </tr>
              </thead>
              <tbody>
                {enrollmentList.length === 0 ? (
                  <tr>
                    <td colSpan="4" style={{ textAlign: "center", padding: "40px", color: "#9ca3af" }}>
                      No subjects added yet. Click "+ Add Subject" to add one.
                    </td>
                  </tr>
                ) : (
                  enrollmentList.map((item) => (
                    <tr key={item.assignmentId}>
                      <td>
                        <div className="ad-avatarCell">
                          <div className="ad-avatar ad-avatar--blue">
                            {(item.name || "??").substring(0, 2).toUpperCase()}
                          </div>
                          <div className="ad-cellLines">
                            <span className="ad-cellPrimary">{item.name}</span>
                            <span className="ad-cellSecondary">Faculty Member</span>
                          </div>
                        </div>
                      </td>
                      <td className="ad-engagement">{item.subject}</td>
                      <td>
                        <span className="se-sectionBadge">
                          {item.dept} {item.year} - {item.section}
                          {!item.isDefaultMatch && (
                            <span className="se-addedBadge">Added</span>
                          )}
                        </span>
                      </td>
                      <td className="ad-tableActions" style={{ justifyContent: "flex-end" }}>
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
                )}
              </tbody>
            </table>
          </div>

          <div className="se-enrollmentFooter">
            <p className="se-enrollmentNote">
              <Info size={14} />
              Once confirmed, you can still edit this list as long as you haven't submitted an evaluation.
            </p>
            <button
              type="button"
              className="se-confirmBtn"
              onClick={handleConfirmEnrollment}
              disabled={savingEnrollment || enrollmentList.length === 0}
            >
              {savingEnrollment ? "Saving..." : "Confirm Subjects"}
              {!savingEnrollment && <ChevronRight size={16} />}
            </button>
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
                  <Search size={16} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#9ca3af" }} />
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
          <button
            type="button"
            className="se-editEnrollmentBtn se-editEnrollmentBtn-outline"
            onClick={() => setMode("enrollment")}
            title="Edit your subject list"
          >
            <BookOpen size={15} />
            Edit Subjects
          </button>
        </div>

        <div className="se-infoCallout">
          <Info size={16} className="se-infoCalloutIcon" />
          <div>
            <p className="se-infoCalloutStrong">
              Showing faculty from your confirmed enrolled subjects only.
            </p>
            <p className="se-infoCalloutText">
              You have <strong>{assignedFaculty.length}</strong> subject(s) confirmed this semester.
              Progress: <strong>{submittedCount}/{assignedFaculty.length}</strong> evaluated.
              {" "}If a faculty member is missing, click <strong>Edit Subjects</strong> to update your list.
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
                  const f = assignedFaculty.find((x) => x.name === name);
                  const isDone = assignedFaculty
                    .filter((x) => x.name === name)
                    .every((x) => x.status === "submitted");
                  return (
                    <div
                      key={name}
                      className={`se-suggestionItem ${isDone ? "se-suggestionItem--done" : ""}`}
                      onClick={() => handleSelectFaculty(name)}
                    >
                      <div className="ad-avatar ad-avatar--blue" style={{ width: 30, height: 30, fontSize: 11, flexShrink: 0 }}>
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
                      : "— Select a faculty member first —"
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
            <table className="ad-table">
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
                      <div className="ad-avatarCell">
                        <div className="ad-avatar ad-avatar--blue">
                          {(item.name || "??").substring(0, 2).toUpperCase()}
                        </div>
                        <span className="ad-cellPrimary">{item.name}</span>
                      </div>
                    </td>
                    <td className="ad-engagement">{item.subject}</td>
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
                    <td className="ad-engagement">{item.status === "submitted" ? formatDate(item.submittedAt) : "—"}</td>
                    <td className="ad-tableActions" style={{ justifyContent: "flex-end" }}>
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
