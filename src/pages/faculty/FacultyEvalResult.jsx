import { useState, useEffect } from "react";
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
  const { currentUser, userProfile } = useAuth();

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
            <div className="fd-welcomeHeader">
              <div>
                <h2 className="fd-title">Evaluation Results</h2>
                <p className="fd-subtitle">{displayName}</p>
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
                <span className="fd-criteriaPillMain">
                  {evaluationData.categories.length} criteria
                </span>
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
                    {evaluationData.categories.map(category => (
                      <tr key={category.id}>
                        <td className="fd-tdCriteria" style={{ padding: "16px 24px" }}>
                          <div className="fd-criteriaName" style={{ fontSize: "14px", fontWeight: "700" }}>{category.name}</div>
                          <div className="fd-itemCountSubtext" style={{ fontSize: "12px", color: "#94a3b8", marginTop: "2px" }}>
                            {category.items.length} items
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
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Remarks & Insights */}
            <div className="fd-remarksCard">
              <div className="fd-remarksHeader">
                <h3 className="fd-remarksTitle">System Remarks</h3>
              </div>
              <div className="fd-remarksContent">
                <p className="fd-remarksText">{evaluationData.remarks}</p>
              </div>
            </div>

            {/* Strengths & Improvements Card */}
            <div className="fd-remarksCard">
              <div className="fd-remarksHeader" style={{ borderLeftColor: "#22c55e" }}>
                <h3 className="fd-remarksTitle">Strengths & Areas for Improvement</h3>
              </div>
              <div className="fd-remarksContent">
                <div style={{ display: "flex", gap: "24px", flexWrap: "wrap" }}>
                  {evaluationData.strengths && evaluationData.strengths.length > 0 && (
                    <div style={{ flex: "1 1 250px" }}>
                      <h4 style={{ fontSize: "13px", fontWeight: "700", color: "#6b7280", marginBottom: "12px", textTransform: "uppercase", letterSpacing: "0.5px", margin: "0 0 12px 0" }}>Key Strengths</h4>
                      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        {evaluationData.strengths.map(strength => (
                          <div key={strength} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13.5px", color: "#1f2937", background: "#f8fafc", padding: "8px 12px", borderRadius: "6px", borderLeft: "3px solid #22c55e" }}>
                            {strength}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {evaluationData.improvements && evaluationData.improvements.length > 0 && (
                    <div style={{ flex: "1 1 250px" }}>
                      <h4 style={{ fontSize: "13px", fontWeight: "700", color: "#6b7280", marginBottom: "12px", textTransform: "uppercase", letterSpacing: "0.5px", margin: "0 0 12px 0" }}>Areas for Improvement</h4>
                      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        {evaluationData.improvements.map(imp => (
                          <div key={imp} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13.5px", color: "#1f2937", background: "#f8fafc", padding: "8px 12px", borderRadius: "6px", borderLeft: "3px solid #ef4444" }}>
                            {imp}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Student Comments & Basic Insights */}
            <div className="fd-remarksCard">
              <div className="fd-remarksHeader" style={{ borderLeftColor: "#3b82f6", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
                <h3 className="fd-remarksTitle" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  Student Feedback & Insights
                </h3>
                <button
                  type="button"
                  onClick={openSummary}
                  disabled={summaryLoading}
                  style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "#0f172a", color: "#fff", border: "none", borderRadius: "8px", padding: "8px 14px", fontSize: "12.5px", fontWeight: 700, cursor: summaryLoading ? "wait" : "pointer", whiteSpace: "nowrap" }}
                  title="AI-generated summary of anonymized comments for this period"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.9 5.7a2 2 0 0 0 1.3 1.3L21 11l-5.8 2a2 2 0 0 0-1.3 1.3L12 20l-1.9-5.7a2 2 0 0 0-1.3-1.3L3 11l5.8-2a2 2 0 0 0 1.3-1.3L12 2z" /></svg>
                  AI Summary
                </button>
              </div>
              
              <div className="fd-remarksContent" style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
                {/* Keywords */}
                {evaluationData.topKeywords && evaluationData.topKeywords.length > 0 && (
                  <div>
                    <h4 style={{ fontSize: "13px", fontWeight: "700", color: "#6b7280", marginBottom: "12px", textTransform: "uppercase", letterSpacing: "0.5px", margin: "0 0 12px 0" }}>Commonly Mentioned Words</h4>
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                      {evaluationData.topKeywords.map(word => (
                        <span key={word} style={{ display: "flex", alignItems: "center", gap: "6px", background: "#f0fdf4", color: "#16a34a", border: "1px solid #bbf7d0", padding: "6px 12px", borderRadius: "999px", fontSize: "13px", fontWeight: "600", textTransform: "capitalize" }}>
                          {word}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Comments */}
                <div>
                  <h4 style={{ fontSize: "13px", fontWeight: "700", color: "#6b7280", marginBottom: "12px", textTransform: "uppercase", letterSpacing: "0.5px", margin: "0 0 12px 0" }}>Anonymized Comments ({evaluationData.analyzedComments ? evaluationData.analyzedComments.length : 0})</h4>
                  {!evaluationData.analyzedComments || evaluationData.analyzedComments.length === 0 ? (
                    <div style={{ background: "#f9fafb", padding: "20px", borderRadius: "8px", border: "1px dashed #d1d5db", color: "#6b7280", textAlign: "center", fontSize: "14px" }}>
                      No textual comments provided by students for this period.
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                      {evaluationData.analyzedComments.map((comment, i) => (
                        <div key={i} style={{ background: "#fff", padding: "16px", borderRadius: "8px", border: "1px solid #e5e7eb", boxShadow: "0 1px 2px rgba(0,0,0,0.02)", display: "flex", gap: "14px", alignItems: "flex-start", borderLeft: comment.sentiment === "positive" ? "4px solid #22c55e" : comment.sentiment === "negative" ? "4px solid #ef4444" : "4px solid #9ca3af" }}>
                          <div style={{ flex: 1, fontSize: "14.5px", color: "#374151", lineHeight: "1.6" }}>
                            "{comment.text}"
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
               </div>

            {/* Detailed Breakdown */}
            <div className="fd-detailsCard">
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

      {/* Phase 8 (Req 5/6): AI summary modal — labeled AI-generated,
          shows the small-sample caveat, never shows identity (there
          is none: scope is anonymized comments only). */}
      {summaryOpen && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => { if (!summaryLoading) setSummaryOpen(false); }}
          style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1050, padding: "20px" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: "#fff", borderRadius: "12px", maxWidth: "640px", width: "100%", maxHeight: "80vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 22px", borderBottom: "1px solid #e5e7eb", position: "sticky", top: 0, background: "#fff", borderRadius: "12px 12px 0 0" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ background: "#eef2ff", color: "#4f46e5", fontSize: "11px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.5px", padding: "4px 10px", borderRadius: "999px" }}>
                  AI-generated summary
                </span>
                {evaluationData && (
                  <span style={{ fontSize: "12px", color: "#6b7280" }}>{evaluationData.periodShort}</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSummaryOpen(false)}
                style={{ background: "none", border: "none", fontSize: "20px", lineHeight: 1, color: "#6b7280", cursor: "pointer" }}
                aria-label="Close"
              >
                ×
              </button>
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
                  <div style={{ fontSize: "14.5px", color: "#1f2937", lineHeight: 1.65, whiteSpace: "pre-wrap" }}>
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
