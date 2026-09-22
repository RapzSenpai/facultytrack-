import { useState, useEffect } from "react";
import AdminLayout from "./AdminLayout";
import { supabase } from "../../config/supabase";

export default function AdminQuestionnaire() {
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState({ show: false, message: "", type: "" });

  // Criteria State
  const [criteriaList, setCriteriaList] = useState([]);
  const [criteriaSearch, setCriteriaSearch] = useState("");
  const [selectedCriteriaId, setSelectedCriteriaId] = useState(null);
  
  // Criteria Form Modal State
  const [showCriteriaModal, setShowCriteriaModal] = useState(false);
  const [criteriaFormData, setCriteriaFormData] = useState({ name: "" });
  const [editingCriteriaId, setEditingCriteriaId] = useState(null);

  // Question State
  const [questionsByCriteria, setQuestionsByCriteria] = useState({});
  const [showQuestionModal, setShowQuestionModal] = useState(false);
  const [questionFormData, setQuestionFormData] = useState({ text: "" });
  const [editingQuestion, setEditingQuestion] = useState(null);

  const showToast = (message, type = "success") => {
    setToast({ show: true, message, type });
    setTimeout(() => setToast({ show: false, message: "", type: "" }), 3000);
  };

  const fetchData = async () => {
    try {
      const [criteriaRes, questionsRes] = await Promise.all([
        supabase.from('criteria').select('*'),
        supabase.from('questions').select('*'),
      ]);

      const criteriaData = criteriaRes.data || [];
      const questionsData = questionsRes.data || [];

      setCriteriaList(criteriaData);

      const grouped = {};
      criteriaData.forEach(c => { grouped[c.id] = []; });
      questionsData.forEach(q => {
        if (!grouped[q.criteria_id]) grouped[q.criteria_id] = [];
        grouped[q.criteria_id].push({ ...q, criteriaId: q.criteria_id });
      });
      
      Object.keys(grouped).forEach(k => {
        grouped[k].sort((a, b) => (a.order || 0) - (b.order || 0));
      });
      
      setQuestionsByCriteria(grouped);

      if (criteriaData.length > 0) {
        setSelectedCriteriaId(criteriaData[0].id);
      }
    } catch {
      showToast("Failed to load data", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  // --- CRITERIA CRUD ---
  const handleSaveCriteria = async () => {
    if (!criteriaFormData.name.trim()) {
      showToast("Please enter a criteria name", "error");
      return;
    }
    try {
      if (editingCriteriaId) {
        const { error } = await supabase.from('criteria').update({ name: criteriaFormData.name }).eq('id', editingCriteriaId);
        if (error) throw error;
        setCriteriaList(list => list.map(c => c.id === editingCriteriaId ? { ...c, name: criteriaFormData.name } : c));
        showToast("Criteria updated successfully!", "success");
        setEditingCriteriaId(null);
      } else {
        const { data, error } = await supabase.from('criteria').insert({ name: criteriaFormData.name, enabled: true }).select().single();
        if (error) throw error;
        setCriteriaList(list => [...list, { id: data.id, name: criteriaFormData.name, enabled: true }]);
        setQuestionsByCriteria(prev => ({ ...prev, [data.id]: [] }));
        setSelectedCriteriaId(data.id);
        showToast("Criteria added and activated successfully!", "success");
      }
      setCriteriaFormData({ name: "" });
      setShowCriteriaModal(false);
    } catch {
      showToast("Error saving criteria", "error");
    }
  };

  const handleToggleCriteria = async (e, item) => {
    if (e) e.stopPropagation();
    const newEnabled = !item.enabled;
    try {
      const { error } = await supabase.from('criteria').update({ enabled: newEnabled }).eq('id', item.id);
      if (error) throw error;
      setCriteriaList(list => list.map(c => c.id === item.id ? { ...c, enabled: newEnabled } : c));
      showToast(`Criteria ${newEnabled ? "enabled and active for evaluation" : "disabled and hidden from students"}`, "success");
    } catch {
      showToast("Error updating criteria status", "error");
    }
  };

  const handleEditCriteria = (e, item) => {
    e.stopPropagation();
    setCriteriaFormData({ name: item.name });
    setEditingCriteriaId(item.id);
    setShowCriteriaModal(true);
  };

  const handleDeleteCriteria = async (e, id) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this criteria? All its questions will also be lost.")) return;
    try {
      const { error } = await supabase.from('criteria').delete().eq('id', id);
      if (error) throw error;
      setCriteriaList(list => list.filter(c => c.id !== id));
      if (selectedCriteriaId === id) {
        const remaining = criteriaList.filter(c => c.id !== id);
        setSelectedCriteriaId(remaining.length > 0 ? remaining[0].id : null);
      }
      showToast("Criteria deleted successfully", "success");
    } catch {
      showToast("Error deleting criteria", "error");
    }
  };

  // --- QUESTION CRUD ---
  const handleSaveQuestion = async () => {
    if (!selectedCriteriaId || !questionFormData.text.trim()) {
      showToast("Please enter a question", "error");
      return;
    }
    const criteriaId = selectedCriteriaId;
    try {
      if (editingQuestion) {
        const { error } = await supabase.from('questions').update({ text: questionFormData.text }).eq('id', editingQuestion.id);
        if (error) throw error;
        setQuestionsByCriteria(prev => ({
          ...prev,
          [criteriaId]: prev[criteriaId].map(q =>
            q.id === editingQuestion.id ? { ...q, text: questionFormData.text } : q
          ),
        }));
        showToast("Question updated successfully!", "success");
        setEditingQuestion(null);
      } else {
        const existingQuestions = questionsByCriteria[criteriaId] || [];
        const order = existingQuestions.length + 1;
        const { data, error } = await supabase.from('questions').insert({ criteria_id: criteriaId, text: questionFormData.text, order }).select().single();
        if (error) throw error;
        const newQuestion = { id: data.id, criteriaId, text: questionFormData.text, order };
        setQuestionsByCriteria(prev => ({
          ...prev,
          [criteriaId]: [...(prev[criteriaId] || []), newQuestion],
        }));
        showToast("Question added successfully!", "success");
      }
      setQuestionFormData({ text: "" });
      setShowQuestionModal(false);
    } catch {
      showToast("Error saving question", "error");
    }
  };

  const handleEditQuestion = (question) => {
    setQuestionFormData({ text: question.text });
    setEditingQuestion(question);
    setShowQuestionModal(true);
  };

  const handleDeleteQuestion = async (criteriaId, questionId) => {
    if (!confirm("Are you sure you want to delete this question?")) return;
    try {
      const { error } = await supabase.from('questions').delete().eq('id', questionId);
      if (error) throw error;
      setQuestionsByCriteria(prev => ({
        ...prev,
        [criteriaId]: prev[criteriaId].filter(q => q.id !== questionId),
      }));
      showToast("Question deleted successfully", "success");
    } catch {
      showToast("Error deleting question", "error");
    }
  };

  const filteredCriteria = criteriaList.filter(c => 
    c.name.toLowerCase().includes(criteriaSearch.toLowerCase())
  );
  
  const selectedCriteria = criteriaList.find(c => c.id === selectedCriteriaId);

  return (
    <AdminLayout title="Questionnaire Management">
      <section className="ad-content">
        <div className="ad-welcomeHeader" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <h2 className="ad-title">Questionnaire Management</h2>
            <p className="ad-subtitle">Manage evaluation criteria and their corresponding questions.</p>
          </div>
          <button className="ad-btnPrimary" onClick={() => {
            setEditingCriteriaId(null);
            setCriteriaFormData({ name: "" });
            setShowCriteriaModal(true);
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Add Criteria
          </button>
        </div>

        <div className="ad-splitLayout ad-splitLayout--questionnaire">
          {/* LEFT PANEL - CRITERIA */}
          <div className="ad-splitPanel ad-splitPanel--criteria">
            <div className="ad-panelHeader">
              <h3 className="ad-panelTitle">Evaluation Criteria</h3>
            </div>
            <div className="ad-panelBody" style={{ padding: '16px' }}>
              <div className="ad-searchWrap" style={{ marginBottom: '16px' }}>
                <svg className="ad-searchIcon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
                <input
                  type="text"
                  className="ad-searchInput"
                  placeholder="Search criteria..."
                  value={criteriaSearch}
                  onChange={(e) => setCriteriaSearch(e.target.value)}
                />
              </div>

              <div className="ad-criteriaList">
                {filteredCriteria.map(criteria => {
                  const isActive = selectedCriteriaId === criteria.id;
                  const qCount = (questionsByCriteria[criteria.id] || []).length;
                  
                  const isTeaching = criteria.name.includes("Teaching");
                  const isComm = criteria.name.includes("Communication");
                  const isOrg = criteria.name.includes("Organization") || criteria.name.includes("Management");
                  const isAssess = criteria.name.includes("Assessment");
                  
                  let iconClass = "ad-criteriaIcon--default";
                  if (isTeaching) iconClass = "ad-criteriaIcon--blue";
                  else if (isComm) iconClass = "ad-criteriaIcon--green";
                  else if (isOrg) iconClass = "ad-criteriaIcon--purple";
                  else if (isAssess) iconClass = "ad-criteriaIcon--orange";

                  return (
                    <div 
                      key={criteria.id} 
                      className={`ad-criteriaItem ${isActive ? 'ad-criteriaItem--active' : ''}`}
                      onClick={() => setSelectedCriteriaId(criteria.id)}
                    >
                      <div className={`ad-criteriaItemIcon ${iconClass}`}>
                        {isTeaching ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5z"></path><polyline points="10 2 10 10 13 7 16 10 16 2"></polyline></svg>
                        : isComm ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
                        : isOrg ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>
                        : isAssess ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                        : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                        }
                      </div>
                      <div className="ad-criteriaItemContent">
                        <h4 className="ad-criteriaItemTitle">{criteria.name}</h4>
                        <p className="ad-criteriaItemDesc">
                          {criteria.name === "Teaching Effectiveness" ? "Measures the effectiveness of teaching strategies and delivery." :
                           criteria.name === "Communication & Interaction" ? "Assesses communication skills and interaction with students." :
                           criteria.name === "Course Management & Organization" ? "Evaluates organization, planning, and management of the course." :
                           criteria.name === "Assessment & Feedback" ? "Measures the quality and fairness of assessments and feedback." :
                           "Evaluates this area of performance."} 
                        </p>
                      </div>
                      <div className="ad-criteriaItemRight" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <button
                          type="button"
                          className="ad-statusPill"
                          onClick={(e) => handleToggleCriteria(e, criteria)}
                          title={criteria.enabled ? "Active in evaluation. Click to disable." : "Disabled/Hidden. Click to activate."}
                          style={{
                            padding: '4px 10px',
                            fontSize: '11px',
                            fontWeight: '700',
                            borderRadius: '999px',
                            border: 'none',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                            background: criteria.enabled ? '#dcfce7' : '#fee2e2',
                            color: criteria.enabled ? '#15803d' : '#b91c1c',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '5px',
                          }}
                        >
                          <span style={{
                            width: '6px',
                            height: '6px',
                            borderRadius: '50%',
                            background: criteria.enabled ? '#22c55e' : '#ef4444',
                            display: 'inline-block',
                          }} />
                          {criteria.enabled ? "Active" : "Disabled"}
                        </button>
                        <span className="ad-badge ad-badge--neutral">{qCount}</span>
                        <svg className="ad-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
                      </div>
                    </div>
                  );
                })}
                
                <button className="ad-btnOutline ad-btnOutline--full" style={{ marginTop: '16px' }} onClick={() => {
                  setEditingCriteriaId(null);
                  setCriteriaFormData({ name: "" });
                  setShowCriteriaModal(true);
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                  Add Criteria
                </button>
              </div>
            </div>
          </div>

          {/* RIGHT PANEL - QUESTIONS */}
          <div className="ad-splitPanel ad-splitPanel--questions">
            <div className="ad-panelHeader" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <h3 className="ad-panelTitle">Criteria Details</h3>
                {selectedCriteria && (
                  <>
                    <span className="ad-badge ad-badge--info">{questionsByCriteria[selectedCriteriaId]?.length || 0} Questions</span>
                    <button
                      type="button"
                      onClick={(e) => handleToggleCriteria(e, selectedCriteria)}
                      className="ad-btnOutline ad-btnOutline--small"
                      title="Click to toggle criteria availability in student evaluations"
                      style={{
                        padding: '4px 10px',
                        fontSize: '12px',
                        fontWeight: '700',
                        cursor: 'pointer',
                        background: selectedCriteria.enabled ? '#ecfdf5' : '#fef2f2',
                        color: selectedCriteria.enabled ? '#047857' : '#b91c1c',
                        borderColor: selectedCriteria.enabled ? '#a7f3d0' : '#fecaca',
                      }}
                    >
                      {selectedCriteria.enabled ? "✓ Active in Evaluation" : "✕ Disabled (Hidden)"}
                    </button>
                  </>
                )}
              </div>
              {selectedCriteria && (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button className="ad-btnOutline ad-btnOutline--small" onClick={(e) => handleEditCriteria(e, selectedCriteria)}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                    Edit Criteria
                  </button>
                  <button className="ad-btnOutline ad-btnOutline--small ad-btnOutline--danger" onClick={(e) => handleDeleteCriteria(e, selectedCriteriaId)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2-2v2" /></svg>
                  </button>
                </div>
              )}
            </div>

            <div className="ad-panelBody" style={{ padding: '24px' }}>
              {selectedCriteria ? (
                <>
                  <div className="ad-infoCard ad-infoCard--blue" style={{ marginBottom: '24px' }}>
                    <div className="ad-infoIcon ad-infoIcon--blue">
                      i
                    </div>
                    <div>
                      <div className="ad-infoText">You are managing questions for:</div>
                      <div className="ad-infoTitle" style={{ fontSize: '16px', marginTop: '4px', fontWeight: '700', color: '#1e3a8a' }}>{selectedCriteria.name}</div>
                      <div className="ad-infoText" style={{ marginTop: '2px' }}>
                        {selectedCriteria.name === "Teaching Effectiveness" ? "Measures the effectiveness of teaching strategies and delivery." :
                         selectedCriteria.name === "Communication & Interaction" ? "Assesses communication skills and interaction with students." :
                         selectedCriteria.name === "Course Management & Organization" ? "Evaluates organization, planning, and management of the course." :
                         selectedCriteria.name === "Assessment & Feedback" ? "Measures the quality and fairness of assessments and feedback." :
                         "Evaluates this area of performance."}
                      </div>
                    </div>
                  </div>

                  <div className="ad-questionsHeader" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <h3 className="ad-panelTitle" style={{ fontSize: '16px' }}>Questions</h3>
                    <button className="ad-btnPrimary" onClick={() => {
                      setEditingQuestion(null);
                      setQuestionFormData({ text: "" });
                      setShowQuestionModal(true);
                    }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                      Add Question
                    </button>
                  </div>

                  <div className="ad-questionsList">
                    {(questionsByCriteria[selectedCriteriaId] || []).length > 0 ? (
                      (questionsByCriteria[selectedCriteriaId] || []).map((question, index) => (
                        <div key={question.id} className="ad-questionItem ad-questionItem--card">
                          <div className="ad-questionOrder ad-questionOrder--blue">{index + 1}</div>
                          <div className="ad-questionContent">
                            <p className="ad-questionText">{question.text}</p>
                          </div>
                          <div className="ad-questionActions">
                            <button className="ad-btnOutline ad-btnOutline--small" onClick={() => handleEditQuestion(question)}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                              Edit
                            </button>
                            <button className="ad-btnOutline ad-btnOutline--small ad-btnOutline--danger" onClick={() => handleDeleteQuestion(selectedCriteriaId, question.id)}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2-2v2" /></svg>
                            </button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="ad-emptyState">
                        <p className="ad-emptyText">No questions added yet</p>
                      </div>
                    )}
                  </div>

                  <div className="ad-infoCard ad-infoCard--light" style={{ marginTop: '24px' }}>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2" style={{ marginRight: '8px' }}><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
                      <span style={{ color: '#3b82f6', fontSize: '13px' }}>The order of questions will appear as listed above in the evaluation form.</span>
                    </div>
                  </div>
                </>
              ) : (
                 <div className="ad-emptyState">
                   <p className="ad-emptyText">Select a criteria to manage its questions</p>
                 </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Criteria Modal */}
      {showCriteriaModal && (
        <div className="ad-modal">
          <div className="ad-modalOverlay" onClick={() => setShowCriteriaModal(false)} />
          <div className="ad-modalContent">
            <div className="ad-modalHeader">
              <h3 className="ad-modalTitle">{editingCriteriaId ? "Edit Criteria" : "Add New Criteria"}</h3>
              <button className="ad-modalClose" onClick={() => setShowCriteriaModal(false)}>×</button>
            </div>
            <div className="ad-modalBody">
              <div className="ad-formGroup">
                <label className="ad-label">Criteria Name <span style={{ color: "#dc2626" }}>*</span></label>
                <input
                  type="text"
                  className="ad-input"
                  placeholder="Enter criteria name"
                  value={criteriaFormData.name}
                  onChange={(e) => setCriteriaFormData({ name: e.target.value })}
                />
              </div>
            </div>
            <div className="ad-modalFooter">
              <button className="ad-btnSecondary" onClick={() => setShowCriteriaModal(false)}>Cancel</button>
              <button className="ad-btnPrimary" onClick={handleSaveCriteria}>{editingCriteriaId ? "Update" : "Save"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Question Modal */}
      {showQuestionModal && (
        <div className="ad-modal">
          <div className="ad-modalOverlay" onClick={() => setShowQuestionModal(false)} />
          <div className="ad-modalContent">
            <div className="ad-modalHeader">
              <h3 className="ad-modalTitle">{editingQuestion ? "Edit Question" : "Add Question"}</h3>
              <button className="ad-modalClose" onClick={() => setShowQuestionModal(false)}>×</button>
            </div>
            <div className="ad-modalBody">
              <div className="ad-formGroup">
                <label className="ad-label">Question <span style={{ color: "#dc2626" }}>*</span></label>
                <textarea
                  className="ad-textarea"
                  rows="4"
                  placeholder="Enter evaluation question"
                  value={questionFormData.text}
                  onChange={(e) => setQuestionFormData({ text: e.target.value })}
                />
              </div>
            </div>
            <div className="ad-modalFooter">
              <button className="ad-btnSecondary" onClick={() => setShowQuestionModal(false)}>Cancel</button>
              <button className="ad-btnPrimary" onClick={handleSaveQuestion}>{editingQuestion ? "Update" : "Save"}</button>
            </div>
          </div>
        </div>
      )}

      {toast.show && (
        <div className={`ad-toast ad-toast--${toast.type}`}>
          <div className="ad-toastIcon">
            {toast.type === "success" && <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>}
            {toast.type === "error" && <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>}
            {toast.type === "info" && <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>}
          </div>
          <span className="ad-toastMessage">{toast.message}</span>
        </div>
      )}
    </AdminLayout>
  );
}
