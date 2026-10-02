import React, { useState, useEffect, Fragment } from "react";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../config/supabase";
import FacultyLayout from "./FacultyLayout";
import { fetchFacultyReleaseStatus } from "../../utils/releaseStatus";
const getPerformanceLabel = (rating) => {
  if (rating >= 4.5) return "Outstanding";
  if (rating >= 4.0) return "Excellent";
  if (rating >= 3.5) return "Very Good";
  if (rating >= 3.0) return "Good";
  return "Needs Improvement";
};

const getPerformanceColor = (rating) => {
  if (rating >= 4.5) return "#16a34a"; // Green-600
  if (rating >= 4.0) return "#22c55e"; // Green-500
  if (rating >= 3.5) return "#10b981"; // Emerald-500 (Greenish)
  if (rating >= 3.0) return "#f59e0b"; // Orange-500
  return "#ef4444"; // Red-500
};

const generateRemarks = (rating) => {
  if (rating >= 4.5) return "Excellent teaching performance. Strong commitment to student learning and professional development.";
  if (rating >= 4.0) return "Very good teaching performance. Demonstrates dedication to student learning with room for further growth.";
  if (rating >= 3.0) return "Good teaching performance. Continue developing teaching methods and engagement strategies.";
  return "Teaching performance needs improvement. Professional development activities are recommended.";
};

const avg = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

function buildEvaluationPeriods(evaluations, questions, criteria) {
  const byPeriod = {};
  evaluations.forEach(ev => {
    const key = `${ev.academicYear}__${ev.semester}`;
    if (!byPeriod[key]) byPeriod[key] = { academicYear: ev.academicYear, semester: ev.semester, evals: [] };
    byPeriod[key].evals.push(ev);
  });

  const periods = {};
  for (const [key, { academicYear, semester, evals }] of Object.entries(byPeriod)) {
    const qScores = {};
    evals.forEach(ev => {
      Object.entries(ev.ratings || {}).forEach(([qId, score]) => {
        if (!qScores[qId]) qScores[qId] = [];
        qScores[qId].push(Number(score));
      });
    });

    const enabledCriteria = criteria.filter(c => c.enabled);
    const categories = enabledCriteria.map(c => {
      const cQuestions = questions.filter(q => q.criteriaId === c.id);
      const items = cQuestions.map(q => ({
        criterion: q.text,
        rating: avg(qScores[q.id] || []),
      }));
      return { id: c.id, name: c.name, rating: avg(items.map(i => i.rating)), items };
    }).filter(c => c.items.length > 0);

    const overallRating = avg(categories.map(c => c.rating));

    // Basic Insights extraction
    const rawComments = evals.map(ev => ev.comment).filter(c => c && c.trim().length > 0);
    
    // 1. Analyze sentiments
    const analyzedComments = rawComments.map(c => {
      const lower = c.toLowerCase();
      const posWords = ['excellent','great','good','outstanding','best','helpful','clear','nice','amazing','love','perfect','awesome','approachable','kind','patient','effective'];
      const negWords = ['bad','poor','unclear','boring','late','rude','hard','difficult','improve','needs','strict','fast','confusing','absent','unfair'];
      
      let posCount = 0;
      let negCount = 0;
      
      posWords.forEach(w => { if (lower.includes(w)) posCount++; });
      negWords.forEach(w => { if (lower.includes(w)) negCount++; });
      
      let sentiment = "neutral";
      if (posCount > negCount) sentiment = "positive";
      else if (negCount > posCount) sentiment = "negative";
      
      return { text: c, sentiment };
    });

    // 2. Keyword extraction
    const stopWords = new Set(['the','and','to','a','is','in','of','for','it','with','as','on','that','this','teacher','sir','maam','miss','instructor','he','she','his','her','very','are','not','be','you','can','we','all','so','at','but','they','them','has','have']);
    const wordCounts = {};
    rawComments.forEach(c => {
      const words = c.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/);
      words.forEach(w => {
        if (w.length > 2 && !stopWords.has(w)) {
          wordCounts[w] = (wordCounts[w] || 0) + 1;
        }
      });
    });
    const topKeywords = Object.entries(wordCounts)
      .filter(([, count]) => count > 1) // Must appear at least twice
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(entry => entry[0]);

    // 3. Strengths & Improvements based on categories
    const sortedCategories = [...categories].sort((a, b) => b.rating - a.rating);
    const strengths = sortedCategories.filter(c => c.rating >= 4.0).map(c => c.name);
    const improvements = sortedCategories.filter(c => c.rating < 4.0).map(c => c.name);
    if (improvements.length === 0 && sortedCategories.length > 1) {
      improvements.push(sortedCategories[sortedCategories.length - 1].name + " (Relatively lowest)");
    }

    periods[key] = {
      periodLabel: `Academic Year ${academicYear} - ${semester}`,
      periodShort: `${academicYear} ${semester}`,
      overallRating,
      totalResponses: evals.length,
      // Phase 4 anonymity: student_id is no longer readable by
      // faculty, so per-period "unique students" is replaced by
      // the count of submitted forms (no identity needed).
      uniqueStudents: evals.length,
      performanceSummary: getPerformanceLabel(overallRating),
      remarks: generateRemarks(overallRating),
      categories,
      analyzedComments,
      topKeywords,
      strengths,
      improvements
    };
  }
  return periods;
}

export default function FacultyEvalResult() {
  const [periodDropdownOpen, setPeriodDropdownOpen] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState(null);
  const [evaluationPeriods, setEvaluationPeriods] = useState({});
  const [loading, setLoading] = useState(true);
  // Phase 5 [D4]: periods with evaluations but no release yet.
  const [pendingStatuses, setPendingStatuses] = useState([]);
  // Phase 8 (Req 5/6): on-demand AI summary of this period's
  // anonymized comments (scope = this teacher, all subjects, one
  // period [D1]). The Edge Function re-checks scope + release.
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryData, setSummaryData] = useState(null);
  const [summaryError, setSummaryError] = useState(null);
  const [expandedCriteria, setExpandedCriteria] = useState(new Set());
  const [selectedKeyword, setSelectedKeyword] = useState(null);
  const [sentimentFilter, setSentimentFilter] = useState("all");
  const [copiedSummary, setCopiedSummary] = useState(false);
  const { currentUser, userProfile } = useAuth();

  const toggleCriteria = (id) => {
    setExpandedCriteria((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCopySummary = () => {
    if (!summaryData?.summary) return;
    navigator.clipboard.writeText(summaryData.summary);
    setCopiedSummary(true);
    setTimeout(() => setCopiedSummary(false), 2000);
  };

  // Close period dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (periodDropdownOpen && !e.target.closest(".fd-periodSelector")) {
        setPeriodDropdownOpen(false);
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [periodDropdownOpen]);

  useEffect(() => {
    if (!currentUser) return;
    // Phase 4 anonymity: read the identity-stripped view instead of
    // the evaluations base table (base-table faculty SELECT is
    // revoked; the view carries no student_id).
    // Phase 5: the view is release-aware — unreleased periods are
    // invisible here by design; pendingStatuses powers the notice.
    Promise.all([
      supabase.from('faculty_evaluations_anon').select('*'),
      supabase.from('questions').select('*'),
      supabase.from('criteria').select('*'),
      fetchFacultyReleaseStatus().catch(() => []),
    ])
      .then(([evalRes, questionRes, criteriaRes, statusRows]) => {
        const rawEvals = evalRes.data || [];
        const rawQuestions = questionRes.data || [];
        const rawCriteria = criteriaRes.data || [];
        const statuses = statusRows || [];

        const releasedKeys = new Set(
          statuses.filter((s) => s.released).map((s) => `${s.academic_year}__${s.semester}`),
        );
        setPendingStatuses(statuses.filter((s) => s.has_evaluations && !s.released));

        const evals = rawEvals.map(e => ({
          ...e,
          assignmentId: e.assignment_id,
          facultyId: e.faculty_id,
          academicYear: e.academic_year,
          submittedAt: e.submitted_on,
        }));

        const questions = rawQuestions.map(q => ({
          ...q,
          criteriaId: q.criteria_id,
        }));

        const criteria = rawCriteria;

        // The view already filters to released periods; the set is a
        // belt-and-braces guard against stale client state.
        const visibleEvals = evals.filter((e) =>
          releasedKeys.has(`${e.academicYear}__${e.semester}`),
        );

        const periods = buildEvaluationPeriods(visibleEvals, questions, criteria);
        setEvaluationPeriods(periods);
        const keys = Object.keys(periods);
        if (keys.length > 0) setSelectedPeriod(keys[0]);
      })
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  }, [currentUser]);

  const displayName = userProfile?.fullName || "Faculty";
  const evaluationData = selectedPeriod ? evaluationPeriods[selectedPeriod] : null;

  const toggleAllCriteria = () => {
    if (!evaluationData?.categories) return;
    if (expandedCriteria.size === evaluationData.categories.length) {
      setExpandedCriteria(new Set());
    } else {
      setExpandedCriteria(new Set(evaluationData.categories.map((c) => c.id)));
    }
  };

  const runSummary = async () => {
    if (!currentUser || !selectedPeriod) return;
    const [academicYear, semester] = selectedPeriod.split("__");
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const { data, error } = await supabase.functions.invoke("summarize-comments", {
        body: {
          faculty_id: currentUser.id,
          academic_year: academicYear,
          semester,
          subject_code: "",
        },
      });
      if (error) {
        let msg = "AI summary is temporarily unavailable.";
        try {
          const errBody = await error.context.json();
          if (errBody?.error) msg = errBody.error;
        } catch {
          /* keep default message */
        }
        setSummaryError(msg);
      } else if (data) {
        setSummaryData(data);
      }
    } catch {
      setSummaryError("Could not reach the summary service.");
    } finally {
      setSummaryLoading(false);
    }
  };

  const openSummary = () => {
    setSummaryData(null);
    setSummaryError(null);
    setSummaryOpen(true);
    runSummary();
  };

  // No evaluations state — Phase 5 distinguishes "nothing at all"
  // from "results exist but are pending admin release" [D4].
  const hasPendingOnly =
    !loading &&
    Object.keys(evaluationPeriods).length === 0 &&
    pendingStatuses.length > 0;

  if (!loading && Object.keys(evaluationPeriods).length === 0) {
    return (
      <FacultyLayout breadcrumb="Evaluation Results">
        <section className="fd-content">
          <div className="fd-welcomeHeader">
            <div>
              <h2 className="fd-title">Evaluation Results</h2>
              <p className="fd-subtitle">{displayName}</p>
            </div>
          </div>
          <div style={{ textAlign: "center", padding: "60px 20px", color: "#6b7280" }}>
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" strokeWidth="1.5" style={{ marginBottom: "16px" }}>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            {hasPendingOnly ? (
              <>
                <p style={{ fontSize: "16px", fontWeight: 500 }}>Results pending release</p>
                <p style={{ fontSize: "14px", marginTop: "8px" }}>
                  Evaluations exist for: {pendingStatuses.map((p) => `${p.academic_year} ${p.semester}`).join(", ")}.
                  {" "}They will appear here once the admin approves the release.
                </p>
              </>
            ) : (
              <>
                <p style={{ fontSize: "16px", fontWeight: 500 }}>No evaluation results yet</p>
                <p style={{ fontSize: "14px", marginTop: "8px" }}>Your results will appear here once students complete their evaluations.</p>
              </>
            )}
          </div>
        </section>
      </FacultyLayout>
    );
  }

  return (
    <FacultyLayout breadcrumb="Evaluation Results">
      <section className="fd-content">
        {loading || !evaluationData ? (
          <div style={{ padding: "60px", textAlign: "center", color: "#6b7280" }}>Loading evaluation data...</div>
        ) : (
          <>
            {/* Print Header for PDF / Paper Export */}
            <div className="fd-printHeader">
              <h1 style={{ fontSize: "22px", fontWeight: "900", margin: "0 0 6px", color: "#0f172a" }}>Consolatrix College of Toledo City</h1>
              <h2 style={{ fontSize: "16px", fontWeight: "700", margin: "0 0 4px", color: "#334155" }}>Faculty Evaluation Performance Report</h2>
              <p style={{ fontSize: "13px", color: "#64748b", margin: 0 }}>
                Faculty: <strong>{displayName}</strong> • Period: <strong>{evaluationData.periodLabel}</strong> • Generated on {new Date().toLocaleDateString()}
              </p>
            </div>

            <div className="fd-welcomeHeader">
              <div className="fd-welcomeText">
                <span className="fd-welcomeBadge">Analytics & Results</span>
                <h2 className="fd-title">Evaluation Results</h2>
                <p className="fd-subtitle">Comprehensive teaching evaluations breakdown and feedback for {displayName}</p>
              </div>
              <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }} className="no-print">
                <button
                  type="button"
                  onClick={() => window.print()}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "8px",
                    background: "#ffffff",
                    color: "#0f172a",
                    border: "1px solid #cbd5e1",
                    borderRadius: "10px",
                    padding: "10px 16px",
                    fontSize: "13px",
                    fontWeight: 700,
                    cursor: "pointer",
                    boxShadow: "0 2px 6px rgba(0,0,0,0.04)",
                    transition: "all 0.2s ease"
                  }}
                  title="Print or Save Report as PDF"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <polyline points="6 9 6 2 18 2 18 9" />
                    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                    <rect x="6" y="14" width="12" height="8" />
                  </svg>
                  Print Report
                </button>

                <button
                  type="button"
                  onClick={openSummary}
                  disabled={summaryLoading}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "8px",
                    background: "#0f172a",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "10px",
                    padding: "10px 16px",
                    fontSize: "13px",
                    fontWeight: 700,
                    cursor: summaryLoading ? "wait" : "pointer",
                    boxShadow: "0 2px 8px rgba(15, 23, 42, 0.2)",
                    transition: "all 0.2s ease"
                  }}
                  title="AI-generated summary of anonymized comments for this period"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2l1.9 5.7a2 2 0 0 0 1.3 1.3L21 11l-5.8 2a2 2 0 0 0-1.3 1.3L12 20l-1.9-5.7a2 2 0 0 0-1.3-1.3L3 11l5.8-2a2 2 0 0 0 1.3-1.3L12 2z" />
                  </svg>
                  AI Summary
                </button>
              </div>
            </div>

            {/* Period Selector */}
            <div className="fd-periodSelectorCard">
              <div className="fd-periodSelectorWrapper">
                <label className="fd-periodSelectorLabel">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                  Academic Period:
                </label>
                <div className="fd-periodSelector">
                  <button type="button" className="fd-periodSelectorBtn" onClick={() => setPeriodDropdownOpen(v => !v)}>
                    <span className="fd-periodSelectorText">{evaluationData.periodLabel}</span>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                      className={`fd-periodSelectorIcon ${periodDropdownOpen ? "fd-periodSelectorIcon--open" : ""}`}>
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                  {periodDropdownOpen && (
                    <div className="fd-periodDropdownMenu">
                      {Object.entries(evaluationPeriods).map(([key, period]) => (
                        <button key={key} type="button"
                          className={`fd-periodDropdownItem ${selectedPeriod === key ? "fd-periodDropdownItem--active" : ""}`}
                          onClick={() => { setSelectedPeriod(key); setPeriodDropdownOpen(false); }}>
                          <div className="fd-periodDropdownItemText">
                            <div className="fd-periodDropdownItemTitle">{period.periodLabel}</div>
                            <div className="fd-periodDropdownItemMeta">Rating: {period.overallRating.toFixed(1)} • {period.totalResponses} responses</div>
                          </div>
                          {selectedPeriod === key && (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Summary Cards */}
            <div className="fd-perfGrid">
              {/* Card 1: Overall Rating */}
              <div className="fd-perfMetric fd-card--green">
                <div className="fd-metricIcon fd-icon--yellow">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                  </svg>
                </div>
                <div className="fd-metricContent">
                  <div className="fd-metricLabel">OVERALL RATING</div>
                  <div className="fd-metricMain">
                    <span className="fd-metricValue">{evaluationData.overallRating.toFixed(1)}</span>
                    <span className="fd-metricSlash">/ 5.0</span>
                  </div>
                  <div className="fd-metricSubtext" style={{ color: "#22c55e", fontWeight: "700" }}>{evaluationData.performanceSummary}</div>
                </div>
              </div>

              {/* Card 2: Responses */}
              <div className="fd-perfMetric fd-card--blue">
                <div className="fd-metricIcon fd-icon--blue">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                </div>
                <div className="fd-metricContent">
                  <div className="fd-metricLabel">STUDENTS EVALUATED</div>
                  <div className="fd-metricValue">{evaluationData.uniqueStudents}</div>
                  <div className="fd-metricSubtext">{evaluationData.totalResponses} forms submitted</div>
                </div>
              </div>

              {evaluationData.categories.length > 0 && (() => {
                const sorted = [...evaluationData.categories].sort((a, b) => b.rating - a.rating);
                return (
                  <>
                    {/* Card 3: Highest Category */}
                    <div className="fd-perfMetric fd-card--emerald">
                      <div className="fd-metricIcon fd-icon--emerald">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <polyline points="23 6 13.5 15.5 8.5 10.5 1 17" /><polyline points="17 6 23 6 23 12" />
                        </svg>
                      </div>
                      <div className="fd-metricContent">
                        <div className="fd-metricLabel">HIGHEST CATEGORY</div>
                        <div className="fd-metricValue fd-metricValue--small">{sorted[0].name}</div>
                        <div className="fd-metricSubtext">{sorted[0].rating.toFixed(1)} avg rating</div>
                      </div>
                    </div>

                    {/* Card 4: Status */}
                    <div className="fd-perfMetric fd-card--purple">
                      <div className="fd-metricIcon fd-icon--purple">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                        </svg>
                      </div>
                      <div className="fd-metricContent">
                        <div className="fd-metricLabel">STATUS</div>
                        <div className="fd-metricValue fd-metricValue--small">{evaluationData.performanceSummary}</div>
                        <div className="fd-metricSubtext">highly recommended</div>
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>

            {/* Criteria Summary Table */}
            <div className="fd-tableCard" style={{ padding: 0, overflow: "hidden" }}>
              <div className="fd-tableHeader" style={{ 
                display: "flex", 
                justifyContent: "space-between", 
                alignItems: "center", 
                padding: "20px 24px",
                borderBottom: "1px solid #f1f5f9"
              }}>
                <h3 className="fd-tableTitle" style={{ fontSize: "14px", fontWeight: "800", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  Criteria Summary
                </h3>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                  <span className="fd-criteriaPillMain">
                    {evaluationData.categories.length} criteria
                  </span>
                  <button
                    type="button"
                    onClick={toggleAllCriteria}
                    className="fd-expandAllBtn"
                    title={expandedCriteria.size === evaluationData.categories.length ? "Collapse all question breakdowns" : "Expand all question breakdowns"}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      {expandedCriteria.size === evaluationData.categories.length ? (
                        <polyline points="18 15 12 9 6 15" />
                      ) : (
                        <polyline points="6 9 12 15 18 9" />
                      )}
                    </svg>
                    {expandedCriteria.size === evaluationData.categories.length ? "Collapse All" : "Expand All Questions"}
                  </button>
                </div>
              </div>
              <div className="fd-tableWrap">
                <table className="fd-table">
                  <thead className="fd-tableDarkHead">
                    <tr>
                      <th style={{ width: "35%", backgroundColor: "#0f172a", color: "#fff" }}>CRITERIA</th>
                      <th className="fd-thCenter" style={{ backgroundColor: "#0f172a", color: "#fff" }}>AVG RATING</th>
                      <th className="fd-thCenter" style={{ backgroundColor: "#0f172a", color: "#fff" }}>PERFORMANCE</th>
                      <th className="fd-thCenter" style={{ backgroundColor: "#0f172a", color: "#fff" }}>PROGRESS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {evaluationData.categories.map(category => {
                      const isExpanded = expandedCriteria.has(category.id);
                      return (
                        <React.Fragment key={category.id}>
                          <tr
                            className="fd-trCriteriaParent"
                            onClick={() => toggleCriteria(category.id)}
                            title="Click to view question breakdown"
                          >
                            <td className="fd-tdCriteria" style={{ padding: "16px 24px" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                <span className="fd-criteriaName" style={{ fontSize: "14px", fontWeight: "700" }}>{category.name}</span>
                                <span className={`fd-chevronToggle ${isExpanded ? "fd-chevronToggle--open" : ""}`}>
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <polyline points="6 9 12 15 18 9" />
                                  </svg>
                                </span>
                              </div>
                              <div className="fd-itemCountSubtext" style={{ fontSize: "12px", color: "#94a3b8", marginTop: "2px" }}>
                                {category.items.length} items • {isExpanded ? "Click to collapse" : "Click to expand questions"}
                              </div>
                            </td>
                            <td className="fd-tdRating" style={{ textAlign: "center", verticalAlign: "middle" }}>
                              <div className="fd-ratingDisplay" style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: "2px" }}>
                                <span className="fd-ratingValue" style={{ 
                                  fontSize: "20px",
                                  fontWeight: "800",
                                  color: getPerformanceColor(category.rating) 
                                }}>
                                  {category.rating.toFixed(1)}
                                </span>
                                <span className="fd-ratingSlashSub" style={{ fontSize: "12px", color: "#cbd5e1", fontWeight: "500" }}>/ 5</span>
                              </div>
                            </td>
                            <td className="fd-tdStatus" style={{ textAlign: "center", verticalAlign: "middle" }}>
                              <span className="fd-perfPillSub" style={{ 
                                backgroundColor: `${getPerformanceColor(category.rating)}15`,
                                color: getPerformanceColor(category.rating),
                                padding: "6px 16px",
                                borderRadius: "999px",
                                fontSize: "12px",
                                fontWeight: "700",
                                display: "inline-block"
                              }}>
                                {getPerformanceLabel(category.rating)}
                              </span>
                            </td>
                            <td className="fd-tdProgress" style={{ textAlign: "center", verticalAlign: "middle" }}>
                              <div className="fd-ratingBar" style={{ width: "120px", height: "8px", background: "#f1f5f9", borderRadius: "999px", overflow: "hidden", margin: "0 auto" }}>
                                <div className="fd-ratingFill" style={{ 
                                  width: `${(category.rating / 5) * 100}%`, 
                                  height: "100%",
                                  backgroundColor: getPerformanceColor(category.rating),
                                  borderRadius: "999px"
                                }} />
                              </div>
                            </td>
                          </tr>

                          {/* Accordion Questions Breakdown */}
                          {isExpanded && (
                            <tr>
                              <td colSpan={4} style={{ padding: 0, background: "#f8fafc" }}>
                                <div className="fd-subItemsContainer">
                                  <div style={{ fontSize: "11px", fontWeight: "800", textTransform: "uppercase", color: "#64748b", marginBottom: "8px", letterSpacing: "0.5px" }}>
                                    Questionnaire Items Breakdown ({category.items.length})
                                  </div>
                                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                                    {category.items.map((item, idx) => (
                                      <div key={idx} className="fd-subItemRow">
                                        <span className="fd-subItemText">{idx + 1}. {item.criterion}</span>
                                        <span className="fd-subItemRating">
                                          <span style={{ color: getPerformanceColor(item.rating) }}>{item.rating.toFixed(1)}</span>
                                          <span style={{ fontSize: "11px", color: "#94a3b8", marginLeft: "2px" }}>/ 5</span>
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Executive Insights Grid: Remarks & Qualitative Competencies */}
            <div className="fd-insightsGrid">
              {/* Left Column: System Remarks & Institutional Standing */}
              <div className="fd-insightCard">
                <div className="fd-insightCardHeader">
                  <div className="fd-insightHeaderLeft">
                    <div className="fd-insightIconBox fd-insightIconBox--amber">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="fd-insightTitle">System Remarks</h3>
                      <p className="fd-insightSubtitle">Institutional synthesis from faculty evaluation</p>
                    </div>
                  </div>
                  <span
                    className="fd-standingBadge"
                    style={{
                      backgroundColor: `${getPerformanceColor(evaluationData.overallRating)}15`,
                      color: getPerformanceColor(evaluationData.overallRating),
                      borderColor: `${getPerformanceColor(evaluationData.overallRating)}40`
                    }}
                  >
                    {evaluationData.performanceSummary}
                  </span>
                </div>

                <div className="fd-insightCardBody">
                  <div className="fd-quoteContainer">
                    <div className="fd-quoteMark">“</div>
                    <p className="fd-quoteText">{evaluationData.remarks}</p>
                  </div>

                  <div className="fd-standingFooter">
                    <div className="fd-standingItem">
                      <span className="fd-standingLabel">Evaluation Volume</span>
                      <span className="fd-standingValue">{evaluationData.totalResponses} form{evaluationData.totalResponses === 1 ? '' : 's'} recorded</span>
                    </div>
                    <div className="fd-standingDivider" />
                    <div className="fd-standingItem">
                      <span className="fd-standingLabel">Academic Term</span>
                      <span className="fd-standingValue">{evaluationData.periodShort}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column: Strengths & Growth Areas Matrix */}
              <div className="fd-insightCard">
                <div className="fd-insightCardHeader">
                  <div className="fd-insightHeaderLeft">
                    <div className="fd-insightIconBox fd-insightIconBox--emerald">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="fd-insightTitle">Competencies & Growth Areas</h3>
                      <p className="fd-insightSubtitle">Derived from student rating indicators</p>
                    </div>
                  </div>
                </div>

                <div className="fd-insightCardBody fd-insightCardBody--split">
                  {/* Key Strengths */}
                  <div className="fd-matrixSection">
                    <div className="fd-matrixSectionHead">
                      <span className="fd-matrixDot fd-matrixDot--emerald" />
                      <h4 className="fd-matrixHeading">Key Strengths (Score ≥ 4.0)</h4>
                    </div>
                    {evaluationData.strengths && evaluationData.strengths.length > 0 ? (
                      <div className="fd-matrixList">
                        {evaluationData.strengths.map(strength => (
                          <div key={strength} className="fd-strengthChip">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                            <span>{strength}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="fd-matrixEmptyNote">
                        No criteria reached the 4.0 threshold for this period.
                      </div>
                    )}
                  </div>

                  {/* Areas for Improvement */}
                  <div className="fd-matrixSection">
                    <div className="fd-matrixSectionHead">
                      <span className="fd-matrixDot fd-matrixDot--amber" />
                      <h4 className="fd-matrixHeading">Areas for Improvement</h4>
                    </div>
                    {evaluationData.improvements && evaluationData.improvements.length > 0 ? (
                      <div className="fd-matrixList">
                        {evaluationData.improvements.map(imp => (
                          <div key={imp} className="fd-improvementChip">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2.2">
                              <circle cx="12" cy="12" r="10" />
                              <line x1="12" y1="8" x2="12" y2="12" />
                              <line x1="12" y1="16" x2="12.01" y2="16" />
                            </svg>
                            <span>{imp}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="fd-matrixPassCard">
                        <div className="fd-passIcon">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.2">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                          </svg>
                        </div>
                        <div>
                          <div className="fd-passTitle">All Standards Satisfied</div>
                          <div className="fd-passSubtitle">
                            All evaluated instructional criteria performed at or above the expected benchmark.
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Student Comments & Sentiment Analysis Card */}
            <div className="fd-feedbackCard">
              <div className="fd-feedbackCardHeader">
                <div className="fd-insightHeaderLeft">
                  <div className="fd-insightIconBox fd-insightIconBox--blue">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="fd-insightTitle">Student Feedback & Sentiment Analysis</h3>
                    <p className="fd-insightSubtitle">Direct, anonymized feedback submitted by students</p>
                  </div>
                </div>

                <div className="fd-feedbackBadges">
                  <span className="fd-badgeAnonymized">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                    100% Anonymized
                  </span>
                  <span className="fd-commentCountBadge">
                    {evaluationData.analyzedComments ? evaluationData.analyzedComments.length : 0} Comment{evaluationData.analyzedComments?.length === 1 ? '' : 's'}
                  </span>
                </div>
              </div>

              <div className="fd-feedbackCardBody">
                {/* Keywords Filter */}
                {evaluationData.topKeywords && evaluationData.topKeywords.length > 0 && (
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                      <h4 style={{ fontSize: "12px", fontWeight: "800", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px", margin: 0 }}>
                        Filter by Topic / Keyword
                      </h4>
                      {selectedKeyword && (
                        <button
                          type="button"
                          onClick={() => setSelectedKeyword(null)}
                          style={{ background: "none", border: "none", color: "#2563eb", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}
                        >
                          Clear keyword filter
                        </button>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                      {evaluationData.topKeywords.map(word => (
                        <button
                          key={word}
                          type="button"
                          className={`fd-keywordChip ${selectedKeyword === word ? "fd-keywordChip--active" : ""}`}
                          onClick={() => setSelectedKeyword(prev => prev === word ? null : word)}
                          title={`Click to filter comments mentioning "${word}"`}
                        >
                          <span>{word}</span>
                          {selectedKeyword === word && <span style={{ fontSize: "11px" }}>✕</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Sentiment tabs and comments feed */}
                <div>
                  {/* Sentiment Filter Tabs (shown when comments exist) */}
                  {evaluationData.analyzedComments && evaluationData.analyzedComments.length > 0 && (
                    <div className="fd-sentimentTabs">
                      {[
                        { id: "all", label: `All (${evaluationData.analyzedComments.length})` },
                        { id: "positive", label: `Positive (${evaluationData.analyzedComments.filter(c => c.sentiment === "positive").length})` },
                        { id: "negative", label: `Constructive (${evaluationData.analyzedComments.filter(c => c.sentiment === "negative").length})` },
                        { id: "neutral", label: `Neutral (${evaluationData.analyzedComments.filter(c => c.sentiment === "neutral").length})` },
                      ].map(tab => (
                        <button
                          key={tab.id}
                          type="button"
                          className={`fd-sentimentTab ${sentimentFilter === tab.id ? "fd-sentimentTab--active" : ""}`}
                          onClick={() => setSentimentFilter(tab.id)}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                  )}

                  {(() => {
                    const allComments = evaluationData.analyzedComments || [];
                    const filtered = allComments.filter(comment => {
                      if (sentimentFilter !== "all" && comment.sentiment !== sentimentFilter) return false;
                      if (selectedKeyword && !comment.text.toLowerCase().includes(selectedKeyword.toLowerCase())) return false;
                      return true;
                    });

                    if (allComments.length === 0) {
                      return (
                        <div className="fd-feedbackEmptyCard">
                          <div className="fd-feedbackEmptyIcon">
                            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                              <line x1="9" y1="10" x2="15" y2="10" />
                            </svg>
                          </div>
                          <h4 className="fd-feedbackEmptyTitle">No Qualitative Comments Submitted</h4>
                          <p className="fd-feedbackEmptyDesc">
                            Students completed their numerical evaluations across all criteria without submitting optional written feedback for this period.
                          </p>
                          <div className="fd-feedbackEmptyTrust">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                            <span>All numerical criteria ratings remain recorded in the Criteria Summary.</span>
                          </div>
                        </div>
                      );
                    }

                    if (filtered.length === 0) {
                      return (
                        <div style={{ background: "#f8fafc", padding: "28px", borderRadius: "10px", border: "1px dashed #cbd5e1", color: "#64748b", textAlign: "center", fontSize: "13.5px" }}>
                          No comments matching current filters.
                          <div style={{ marginTop: "10px" }}>
                            <button
                              type="button"
                              onClick={() => { setSelectedKeyword(null); setSentimentFilter("all"); }}
                              style={{ background: "#0f172a", color: "#fff", border: "none", borderRadius: "8px", padding: "7px 14px", fontSize: "12px", fontWeight: 700, cursor: "pointer" }}
                            >
                              Reset all filters
                            </button>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                        {filtered.map((comment, i) => (
                          <div
                            key={i}
                            style={{
                              background: "#fff",
                              padding: "16px 18px",
                              borderRadius: "10px",
                              border: "1px solid #e2e8f0",
                              boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
                              display: "flex",
                              flexDirection: "column",
                              gap: "10px",
                              borderLeft: comment.sentiment === "positive" ? "4px solid #22c55e" : comment.sentiment === "negative" ? "4px solid #ef4444" : "4px solid #94a3b8"
                            }}
                          >
                            <div style={{ fontSize: "14.5px", color: "#1e293b", lineHeight: "1.6" }}>
                              "{comment.text}"
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                              <span style={{
                                fontSize: "11px",
                                fontWeight: 700,
                                textTransform: "uppercase",
                                letterSpacing: "0.4px",
                                padding: "3px 9px",
                                borderRadius: "4px",
                                background: comment.sentiment === "positive" ? "#dcfce7" : comment.sentiment === "negative" ? "#fee2e2" : "#f1f5f9",
                                color: comment.sentiment === "positive" ? "#15803d" : comment.sentiment === "negative" ? "#b91c1c" : "#475569"
                              }}>
                                {comment.sentiment === "positive" ? "Positive" : comment.sentiment === "negative" ? "Constructive" : "Neutral"}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>

            {/* Detailed Breakdown (Active for Print / PDF Export) */}
            <div className="fd-detailsCard fd-detailsCard--screenHidden">
              <div className="fd-detailsHeader"><h3 className="fd-detailsTitle">Detailed Breakdown by Criteria</h3></div>
              {evaluationData.categories.map(category => (
                <div key={category.id} className="fd-categorySection">
                  <div className="fd-categoryHead">
                    <h4 className="fd-categoryName">{category.name}</h4>
                    <div className="fd-categoryAvg">Average: {category.rating.toFixed(1)} / 5.0</div>
                  </div>
                  <div className="fd-itemsList">
                    {category.items.map((item, index) => (
                      <div key={index} className="fd-itemRow">
                        <div className="fd-itemText">{item.criterion}</div>
                        <div className="fd-itemRating">
                          <span className="fd-itemValue">{item.rating.toFixed(1)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {/* Phase 8 (Req 5/6): AI summary modal */}
      {summaryOpen && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => { if (!summaryLoading) setSummaryOpen(false); }}
          style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1050, padding: "20px" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: "#fff", borderRadius: "14px", maxWidth: "640px", width: "100%", maxHeight: "80vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 22px", borderBottom: "1px solid #e5e7eb", position: "sticky", top: 0, background: "#fff", borderRadius: "14px 14px 0 0" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ background: "#eef2ff", color: "#4f46e5", fontSize: "11px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.5px", padding: "4px 10px", borderRadius: "999px" }}>
                  AI-generated summary
                </span>
                {evaluationData && (
                  <span style={{ fontSize: "12px", color: "#6b7280" }}>{evaluationData.periodShort}</span>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                {summaryData && !summaryLoading && (
                  <button
                    type="button"
                    onClick={handleCopySummary}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      background: copiedSummary ? "#dcfce7" : "#f8fafc",
                      border: "1px solid #cbd5e1",
                      borderRadius: "6px",
                      padding: "5px 10px",
                      fontSize: "12px",
                      fontWeight: 600,
                      color: copiedSummary ? "#15803d" : "#334155",
                      cursor: "pointer"
                    }}
                  >
                    {copiedSummary ? "✓ Copied!" : "Copy Summary"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSummaryOpen(false)}
                  style={{ background: "none", border: "none", fontSize: "20px", lineHeight: 1, color: "#6b7280", cursor: "pointer" }}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
            </div>

            <div style={{ padding: "20px 22px" }}>
              {summaryLoading && (
                <div style={{ textAlign: "center", padding: "36px 12px", color: "#6b7280", fontSize: "14px" }}>
                  Generating AI summary of your anonymized comments…
                </div>
              )}

              {!summaryLoading && summaryError && (
                <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", borderRadius: "8px", padding: "14px 16px", fontSize: "13.5px" }}>
                  {summaryError}
                  <div style={{ marginTop: "12px" }}>
                    <button type="button" onClick={runSummary} style={{ background: "#0f172a", color: "#fff", border: "none", borderRadius: "6px", padding: "7px 14px", fontSize: "12.5px", fontWeight: 700, cursor: "pointer" }}>
                      Try again
                    </button>
                  </div>
                </div>
              )}

              {!summaryLoading && summaryData && (
                <>
                  {summaryData.caveat && (
                    <div style={{ background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e", borderRadius: "8px", padding: "10px 14px", fontSize: "13px", marginBottom: "14px" }}>
                      ⚠ {summaryData.caveat}
                    </div>
                  )}
                  <div style={{ fontSize: "14.5px", color: "#1f2937", lineHeight: "1.7", whiteSpace: "pre-wrap" }}>
                    {summaryData.summary}
                  </div>
                  <div style={{ marginTop: "16px", paddingTop: "12px", borderTop: "1px solid #f1f5f9", fontSize: "12px", color: "#9ca3af" }}>
                    Based on {summaryData.comment_count} anonymized, moderation-approved comment(s) for this period.
                    {" "}AI-generated content — may contain mistakes. No student identity exists in this data.
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </FacultyLayout>
  );
}
