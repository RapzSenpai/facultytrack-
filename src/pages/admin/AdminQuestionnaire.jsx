import { useState, useEffect } from "react";
import AdminLayout from "./AdminLayout";
import { supabase } from "../../config/supabase";
import { useScopedAdmin } from "../../hooks/useScopedAdmin";
import { useSuperScope } from "../../context/SuperScopeContext";
import { isPeriodActive } from "../../utils/periodStatus";
import "../../styles/dashboard-mockup.css";

export default function AdminQuestionnaire() {
  const { isSuper, myDeptIds, loading: scopeLoading } = useScopedAdmin();
  const { scopeDeptId } = useSuperScope();
  // D9: scoped admin sees own-program + shared (NULL) criteria.
  // Super sees all, or picked-program + shared when the super scope is set.
  // Shared rows are read-only for scoped admins.
  const inScopeCriteria = (c) => (isSuper && !scopeDeptId)
    || !c.department_id
    || myDeptIds.includes(c.department_id)
    || c.department_id === scopeDeptId;
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
  const [targetCriteriaId, setTargetCriteriaId] = useState(null);

  // Safety & Archiving State
  const [usedQuestionCounts, setUsedQuestionCounts] = useState({});
  const [activePeriods, setActivePeriods] = useState([]);
  const [questionFilter, setQuestionFilter] = useState("all"); // "all" | "active" | "archived"
  const [questionSearch, setQuestionSearch] = useState("");
  const [criteriaFilter, setCriteriaFilter] = useState("all"); // "all" | "active" | "disabled"
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [departmentsMap, setDepartmentsMap] = useState({});

  const [confirmModal, setConfirmModal] = useState({
    show: false,
    title: "",
    message: "",
    note: "",
    confirmText: "Confirm",
    confirmType: "danger",
    onConfirm: null,
  });

  const showToast = (message, type = "success") => {
    setToast({ show: true, message, type });
    setTimeout(() => setToast({ show: false, message: "", type: "" }), 3000);
  };

  const fetchData = async () => {
    if (scopeLoading) return;
    try {
      const [criteriaRes, questionsRes, evalsRes, yearsRes, deptsRes] = await Promise.all([
        supabase.from('criteria').select('*'),
        supabase.from('questions').select('*'),
        supabase.from('admin_evaluations_anon').select('academic_year, semester, ratings'),
        supabase.from('academic_years').select('*'),
        supabase.from('departments').select('id, name, description'),
      ]);

      const dMap = {};
      (deptsRes.data || []).forEach(d => {
        dMap[d.id] = d.name;
      });
      setDepartmentsMap(dMap);

      const criteriaData = (criteriaRes.data || []).filter(inScopeCriteria);
      const visibleIds = new Set(criteriaData.map((c) => c.id));
      const questionsData = (questionsRes.data || []).filter((q) => visibleIds.has(q.criteria_id));

      setCriteriaList(criteriaData);

      // Valid existing in-scope academic years
      const validYearKeys = new Set(
        (yearsRes.data || [])
          .filter(inScopeCriteria)
          .map((y) => `${y.year}__${y.semester}`)
      );

      // Usage mapping from existing valid evaluations only (ignores orphaned rows from deleted periods)
      const usageMap = {};
      (evalsRes.data || []).forEach(row => {
        const key = `${row.academic_year}__${row.semester}`;
        if (!validYearKeys.has(key)) return;

        if (row.ratings && typeof row.ratings === 'object') {
          Object.keys(row.ratings).forEach(qId => {
            usageMap[qId] = (usageMap[qId] || 0) + 1;
          });
        }
      });
      setUsedQuestionCounts(usageMap);

      // Active evaluation periods (strictly isolated to admin's program / scope)
      const openPeriods = (yearsRes.data || [])
        .filter(inScopeCriteria)
        .filter(y => isPeriodActive(y));
      setActivePeriods(openPeriods);

      const grouped = {};
      criteriaData.forEach(c => { grouped[c.id] = []; });
      questionsData.forEach(q => {
        if (!grouped[q.criteria_id]) grouped[q.criteria_id] = [];
        grouped[q.criteria_id].push({
          ...q,
          criteriaId: q.criteria_id,
          is_active: q.is_active !== false,
        });
      });
      
      Object.keys(grouped).forEach(k => {
        grouped[k].sort((a, b) => (a.order || 0) - (b.order || 0));
      });
      
      setQuestionsByCriteria(grouped);

      if (criteriaData.length > 0) {
        setSelectedCriteriaId(prev => (prev && criteriaData.some(c => c.id === prev) ? prev : criteriaData[0].id));
      } else {
        setSelectedCriteriaId(null);
      }
    } catch {
      showToast("Failed to load data", "error");
    } finally {
      setLoading(false);
    }
  };

  const deptKey = myDeptIds.join("|");
  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeLoading, isSuper, deptKey, scopeDeptId]);

  // --- CRITERIA CRUD ---
  const handleSaveCriteria = async () => {
    if (!criteriaFormData.name.trim()) {
      showToast("Please enter a criteria name", "error");
      return;
    }
    const ownerDeptId = isSuper ? (scopeDeptId || null) : (myDeptIds[0] || null);
    if (!isSuper && !ownerDeptId) {
      showToast("No program assigned — ask a super admin to assign you first.", "error");
      return;
    }
    try {
      if (editingCriteriaId) {
        const target = criteriaList.find((c) => c.id === editingCriteriaId);
        if (!isSuper && !target?.department_id) {
          showToast("Shared criteria are read-only for program admins.", "error");
          return;
        }
        const { error } = await supabase.from('criteria').update({ name: criteriaFormData.name }).eq('id', editingCriteriaId);
        if (error) throw error;
        setCriteriaList(list => list.map(c => c.id === editingCriteriaId ? { ...c, name: criteriaFormData.name } : c));
        showToast("Criteria updated successfully!", "success");
        setEditingCriteriaId(null);
      } else {
        const { data, error } = await supabase.from('criteria').insert({ name: criteriaFormData.name, enabled: true, department_id: ownerDeptId }).select().single();
        if (error) throw error;
        setCriteriaList(list => [...list, { id: data.id, name: criteriaFormData.name, enabled: true, department_id: ownerDeptId }]);
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
    if (!isSuper && !item.department_id) {
      showToast("Shared criteria are read-only for program admins.", "error");
      return;
    }
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
    if (!isSuper && !criteriaList.find((c) => c.id === id)?.department_id) {
      showToast("Shared criteria are read-only for program admins.", "error");
      return;
    }

    const cQuestions = questionsByCriteria[id] || [];
    const totalResponses = cQuestions.reduce((sum, q) => sum + (usedQuestionCounts[q.id] || 0), 0);

    if (totalResponses > 0) {
      setConfirmModal({
        show: true,
        title: "Disable Criteria & Archive Questions",
        message: `This criteria contains questions with ${totalResponses} recorded evaluation response(s) from past or current semesters.`,
        note: "To protect past evaluation records, category averages, and AI analytics, this criteria will be DISABLED and its questions ARCHIVED. Students in new evaluations will not see them, but all historical reports remain 100% intact.",
        confirmText: "Disable & Archive",
        confirmType: "warning",
        onConfirm: async () => {
          try {
            await supabase.from('criteria').update({ enabled: false }).eq('id', id);
            await supabase.from('questions').update({ is_active: false }).eq('criteria_id', id);
            setCriteriaList(list => list.map(c => c.id === id ? { ...c, enabled: false } : c));
            setQuestionsByCriteria(prev => ({
              ...prev,
              [id]: (prev[id] || []).map(q => ({ ...q, is_active: false })),
            }));
            showToast("Criteria disabled and questions archived. Past evaluation records protected!", "success");
          } catch {
            showToast("Error updating criteria status", "error");
          }
        },
      });
      return;
    }

    setConfirmModal({
      show: true,
      title: "Delete Criteria",
      message: "Are you sure you want to permanently delete this criteria and its questions? They have 0 evaluation responses.",
      note: "This action cannot be undone.",
      confirmText: "Delete Permanently",
      confirmType: "danger",
      onConfirm: async () => {
        try {
          await supabase.from('questions').delete().eq('criteria_id', id);
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
      },
    });
  };

  // --- QUESTION CRUD ---
  const handleSaveQuestion = async () => {
    const criteriaId = targetCriteriaId || selectedCriteriaId;
    if (!criteriaId || !questionFormData.text.trim()) {
      showToast("Please enter a question and select a criteria", "error");
      return;
    }
    const targetCriteria = criteriaList.find((c) => c.id === criteriaId);
    if (!isSuper && !targetCriteria?.department_id) {
      showToast("Shared criteria are read-only for program admins.", "error");
      return;
    }
    try {
      if (editingQuestion) {
        const oldCriteriaId = editingQuestion.criteriaId || editingQuestion.criteria_id || selectedCriteriaId;
        const newCriteriaId = criteriaId;
        const updatePayload = { text: questionFormData.text };
        if (newCriteriaId !== oldCriteriaId) {
          updatePayload.criteria_id = newCriteriaId;
        }

        const { error } = await supabase.from('questions').update(updatePayload).eq('id', editingQuestion.id);
        if (error) throw error;

        setQuestionsByCriteria(prev => {
          const next = { ...prev };
          if (newCriteriaId !== oldCriteriaId) {
            next[oldCriteriaId] = (next[oldCriteriaId] || []).filter(q => q.id !== editingQuestion.id);
            const updatedQ = {
              ...editingQuestion,
              ...updatePayload,
              criteriaId: newCriteriaId,
              criteria_id: newCriteriaId,
              text: questionFormData.text,
            };
            next[newCriteriaId] = [...(next[newCriteriaId] || []), updatedQ];
          } else {
            next[newCriteriaId] = (next[newCriteriaId] || []).map(q =>
              q.id === editingQuestion.id ? { ...q, text: questionFormData.text } : q
            );
          }
          return next;
        });

        setSelectedCriteriaId(newCriteriaId);
        showToast("Question updated successfully!", "success");
        setEditingQuestion(null);
      } else {
        const existingQuestions = questionsByCriteria[criteriaId] || [];
        const order = existingQuestions.length + 1;
        const insertPayload = {
          criteria_id: criteriaId,
          text: questionFormData.text,
          order,
          is_active: true,
        };
        let { data, error } = await supabase.from('questions').insert(insertPayload).select().single();
        if (error && error.message && error.message.includes('is_active')) {
          delete insertPayload.is_active;
          const retry = await supabase.from('questions').insert(insertPayload).select().single();
          data = retry.data;
          error = retry.error;
        }
        if (error) throw error;
        const newQuestion = {
          id: data.id,
          criteriaId,
          criteria_id: criteriaId,
          text: questionFormData.text,
          order,
          is_active: true,
        };
        setQuestionsByCriteria(prev => ({
          ...prev,
          [criteriaId]: [...(prev[criteriaId] || []), newQuestion],
        }));
        setSelectedCriteriaId(criteriaId);
        showToast("Question added successfully!", "success");
      }
      setQuestionFormData({ text: "" });
      setTargetCriteriaId(null);
      setShowQuestionModal(false);
    } catch (err) {
      console.error("Error saving question:", err);
      showToast(err?.message || "Error saving question", "error");
    }
  };

  const handleEditQuestion = (question) => {
    setQuestionFormData({ text: question.text });
    setEditingQuestion(question);
    setTargetCriteriaId(question.criteriaId || question.criteria_id || selectedCriteriaId);
    setShowQuestionModal(true);
  };

  const handleDeleteQuestion = (criteriaId, question) => {
    const responsesCount = usedQuestionCounts[question.id] || 0;

    if (responsesCount > 0) {
      setConfirmModal({
        show: true,
        title: "Archive Question",
        message: `This question has ${responsesCount} student evaluation response${responsesCount > 1 ? "s" : ""} recorded from previous/current evaluations.`,
        note: "To protect past evaluation records and averages, this question will be ARCHIVED instead of permanently deleted. Students in upcoming evaluations will no longer see it, but past reports remain 100% accurate.",
        confirmText: "Archive Question",
        confirmType: "warning",
        onConfirm: async () => {
          try {
            const { error } = await supabase.from('questions').update({ is_active: false }).eq('id', question.id);
            if (error) throw error;
            setQuestionsByCriteria(prev => ({
              ...prev,
              [criteriaId]: (prev[criteriaId] || []).map(q => q.id === question.id ? { ...q, is_active: false } : q),
            }));
            showToast("Question archived. Historical evaluation data protected!", "success");
          } catch {
            showToast("Error archiving question. Make sure migration 034 is executed in Supabase.", "error");
          }
        },
      });
      return;
    }

    setConfirmModal({
      show: true,
      title: "Delete Question",
      message: "This question has 0 evaluation responses. Are you sure you want to permanently delete it?",
      note: "This action cannot be undone.",
      confirmText: "Delete Permanently",
      confirmType: "danger",
      onConfirm: async () => {
        try {
          const { error } = await supabase.from('questions').delete().eq('id', question.id);
          if (error) throw error;
          setQuestionsByCriteria(prev => ({
            ...prev,
            [criteriaId]: (prev[criteriaId] || []).filter(q => q.id !== question.id),
          }));
          showToast("Question deleted successfully", "success");
        } catch {
          showToast("Error deleting question", "error");
        }
      },
    });
  };

  const handleReactivateQuestion = async (criteriaId, question) => {
    try {
      const { error } = await supabase.from('questions').update({ is_active: true }).eq('id', question.id);
      if (error) throw error;
      setQuestionsByCriteria(prev => ({
        ...prev,
        [criteriaId]: (prev[criteriaId] || []).map(q => q.id === question.id ? { ...q, is_active: true } : q),
      }));
      showToast("Question reactivated for student evaluations!", "success");
    } catch {
      showToast("Error reactivating question", "error");
    }
  };

  // Reorder Question Up or Down
  const handleMoveQuestion = async (criteriaId, questionIndex, direction) => {
    const list = [...(questionsByCriteria[criteriaId] || [])];
    const targetIndex = questionIndex + direction;
    if (targetIndex < 0 || targetIndex >= list.length) return;

    const currentQ = list[questionIndex];
    const targetQ = list[targetIndex];

    const currentOrder = currentQ.order || (questionIndex + 1);
    const targetOrder = targetQ.order || (targetIndex + 1);
    const newCurrentOrder = targetOrder === currentOrder ? currentOrder + direction : targetOrder;
    const newTargetOrder = currentOrder;

    const updatedList = [...list];
    updatedList[questionIndex] = { ...currentQ, order: newCurrentOrder };
    updatedList[targetIndex] = { ...targetQ, order: newTargetOrder };
    updatedList.sort((a, b) => (a.order || 0) - (b.order || 0));

    setQuestionsByCriteria(prev => ({
      ...prev,
      [criteriaId]: updatedList,
    }));

    try {
      await Promise.all([
        supabase.from('questions').update({ order: newCurrentOrder }).eq('id', currentQ.id),
        supabase.from('questions').update({ order: newTargetOrder }).eq('id', targetQ.id),
      ]);
    } catch (err) {
      console.error("Error updating question order:", err);
      showToast("Failed to save reorder", "error");
    }
  };

  // Metric summaries
  const totalCriteriaCount = criteriaList.length;
  const activeCriteriaCount = criteriaList.filter(c => c.enabled).length;
  const disabledCriteriaCount = totalCriteriaCount - activeCriteriaCount;

  const allQuestionsFlat = Object.values(questionsByCriteria).flat();
  const liveQuestionsCount = criteriaList
    .filter(c => c.enabled)
    .reduce((sum, c) => sum + (questionsByCriteria[c.id] || []).filter(q => q.is_active !== false).length, 0);

  const archivedQuestionsCount = allQuestionsFlat.filter(q => {
    const parentCriteria = criteriaList.find(c => c.id === q.criteria_id);
    return q.is_active === false || (parentCriteria && !parentCriteria.enabled);
  }).length;
  const totalProtectedResponses = allQuestionsFlat.reduce(
    (sum, q) => sum + (usedQuestionCounts[q.id] || 0),
    0
  );

  // Filter criteria list
  const filteredCriteria = criteriaList.filter(c => {
    const matchesSearch = c.name.toLowerCase().includes(criteriaSearch.toLowerCase());
    if (!matchesSearch) return false;
    if (criteriaFilter === 'active') return c.enabled === true;
    if (criteriaFilter === 'disabled') return c.enabled === false;
    return true;
  });
  
  const selectedCriteria = criteriaList.find(c => c.id === selectedCriteriaId);

  // Filter questions for right panel
  const allCurrentQuestions = questionsByCriteria[selectedCriteriaId] || [];
  const activeQuestionsList = allCurrentQuestions.filter(q => q.is_active !== false);
  const archivedQuestionsList = allCurrentQuestions.filter(q => q.is_active === false);
  
  const displayQuestions = allCurrentQuestions.filter(q => {
    if (questionFilter === "active" && q.is_active === false) return false;
    if (questionFilter === "archived" && q.is_active !== false) return false;
    if (questionSearch.trim() && !q.text.toLowerCase().includes(questionSearch.toLowerCase())) return false;
    return true;
  });

  return (
    <AdminLayout title="Questionnaire Management">
      <section className="ad-content">
        {/* HEADER SECTION */}
        <div className="ad-welcomeHeader" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px', marginBottom: '20px' }}>
          <div>
            <h2 className="ad-title" style={{ fontSize: '24px', fontWeight: '800', letterSpacing: '-0.5px' }}>Questionnaire Management</h2>
            <p className="ad-subtitle">Configure evaluation criteria, questions, and preview student experience.</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              className="ad-btnOutline"
              onClick={() => setShowPreviewModal(true)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: '#ffffff', fontWeight: '600' }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              Preview Student View
            </button>
            <button className="ad-btnPrimary" onClick={() => {
              setEditingCriteriaId(null);
              setCriteriaFormData({ name: "" });
              setShowCriteriaModal(true);
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              Add Criteria
            </button>
          </div>
        </div>

        {/* COMPACT MINIMIZED METRICS STRIP */}
        <div className="qn-miniStatsGrid">
          <div className="qn-miniStatCard">
            <div className="qn-miniStatIcon qn-miniStatIcon--green">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <div className="qn-miniStatInfo">
              <div className="qn-miniStatVal">{activeCriteriaCount}</div>
              <div className="qn-miniStatLbl">Active Criteria ({totalCriteriaCount})</div>
            </div>
          </div>

          <div className="qn-miniStatCard">
            <div className="qn-miniStatIcon qn-miniStatIcon--blue">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            </div>
            <div className="qn-miniStatInfo">
              <div className="qn-miniStatVal">{liveQuestionsCount}</div>
              <div className="qn-miniStatLbl">Live Questions</div>
            </div>
          </div>

          <div className="qn-miniStatCard">
            <div className="qn-miniStatIcon qn-miniStatIcon--orange">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>
            </div>
            <div className="qn-miniStatInfo">
              <div className="qn-miniStatVal">{archivedQuestionsCount}</div>
              <div className="qn-miniStatLbl">Archived Questions</div>
            </div>
          </div>

          <div className="qn-miniStatCard">
            <div className="qn-miniStatIcon qn-miniStatIcon--purple">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            </div>
            <div className="qn-miniStatInfo">
              <div className="qn-miniStatVal">{totalProtectedResponses.toLocaleString()}</div>
              <div className="qn-miniStatLbl">Protected Responses</div>
            </div>
          </div>
        </div>

        {/* ACTIVE EVALUATION ALERT BANNER — Consistent with Dashboard Period Card */}
        {activePeriods.length > 0 && (
          <div className="mockup-period-card" style={{ marginBottom: "20px", borderLeft: "4px solid #f59e0b" }}>
            <div className="mockup-period-icon" style={{ background: "#fef3c7", color: "#b45309" }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            </div>
            <div className="mockup-period-info">
              <div className="mockup-period-label" style={{ color: "#b45309" }}>Live Evaluation Period Ongoing</div>
              <div className="mockup-period-title">
                {activePeriods.map(p => `${p.year} (${p.semester})`).join(", ")}
              </div>
              <div className="mockup-period-status" style={{ color: "#92400e", fontSize: "13px" }}>
                Editing active questions immediately affects students completing forms. Past evaluation scores remain safe.
              </div>
            </div>
          </div>
        )}

        <div className="ad-splitLayout ad-splitLayout--questionnaire">
          {/* LEFT PANEL - CRITERIA NAVIGATION */}
          <div className="ad-tableCard ad-splitPanel--criteria" style={{ marginBottom: 0 }}>
            <div className="ad-panelHeader" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 className="ad-title" style={{ fontSize: '16px', margin: 0 }}>Evaluation Criteria</h3>
              <span className="ad-badge ad-badge--neutral">{filteredCriteria.length}</span>
            </div>
            <div className="ad-panelBody" style={{ padding: '16px' }}>
              {/* Search Criteria */}
              <div className="ad-searchWrap" style={{ maxWidth: '100%', marginBottom: '12px' }}>
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

              {/* Filter Tabs for Criteria */}
              <div className="qn-filterTabs">
                <button
                  type="button"
                  className={`qn-filterTabBtn ${criteriaFilter === "all" ? "qn-filterTabBtn--active" : ""}`}
                  onClick={() => setCriteriaFilter("all")}
                >
                  All ({totalCriteriaCount})
                </button>
                <button
                  type="button"
                  className={`qn-filterTabBtn ${criteriaFilter === "active" ? "qn-filterTabBtn--active" : ""}`}
                  onClick={() => setCriteriaFilter("active")}
                >
                  Active ({activeCriteriaCount})
                </button>
                <button
                  type="button"
                  className={`qn-filterTabBtn ${criteriaFilter === "disabled" ? "qn-filterTabBtn--active" : ""}`}
                  onClick={() => setCriteriaFilter("disabled")}
                >
                  Disabled ({disabledCriteriaCount})
                </button>
              </div>

              {/* Criteria List */}
              <div className="ad-criteriaList">
                {loading ? (
                  <div style={{ textAlign: 'center', padding: '24px', color: '#64748b', fontSize: '13px' }}>
                    Loading criteria...
                  </div>
                ) : filteredCriteria.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '24px', color: '#64748b', fontSize: '13px' }}>
                    No criteria match your filter
                  </div>
                ) : (
                  filteredCriteria.map(criteria => {
                    const isActive = selectedCriteriaId === criteria.id;
                    const cQuestions = questionsByCriteria[criteria.id] || [];
                    const activeCount = cQuestions.filter(q => q.is_active !== false).length;
                    const archivedCount = cQuestions.length - activeCount;
                    const scopeName = criteria.department_id ? (departmentsMap[criteria.department_id] || "Program") : "Shared";
                    
                    return (
                      <div 
                        key={criteria.id} 
                        className={`ad-criteriaItem ${isActive ? 'ad-criteriaItem--active' : ''}`}
                        onClick={() => setSelectedCriteriaId(criteria.id)}
                      >
                        <div className="ad-criteriaItemIcon ad-criteriaIcon--default">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
                        </div>
                        <div className="ad-criteriaItemContent" style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                            <h4 className="ad-criteriaItemTitle">{criteria.name}</h4>
                            <span className={`ad-badge ${criteria.department_id ? 'ad-badge--info' : 'ad-badge--neutral'}`} style={{ fontSize: '10px', padding: '1px 6px' }}>
                              {scopeName}
                            </span>
                          </div>
                          <p className="ad-criteriaItemDesc">
                            {activeCount} active question{activeCount !== 1 ? "s" : ""}
                            {archivedCount > 0 ? ` • ${archivedCount} archived` : ""}
                          </p>
                        </div>
                        <div className="ad-criteriaItemRight" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {/* Modern Toggle Switch */}
                          <label
                            className="qn-switch"
                            title={criteria.enabled ? "Active in evaluation. Click to disable." : "Disabled/Hidden. Click to activate."}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              checked={criteria.enabled}
                              onChange={(e) => handleToggleCriteria(e, criteria)}
                            />
                            <span className="qn-slider" />
                          </label>
                          <span className="ad-badge ad-badge--neutral" style={{ fontSize: '11px', fontWeight: '700' }}>{activeCount}</span>
                        </div>
                      </div>
                    );
                  })
                )}
                
                <button
                  type="button"
                  className="ad-btnOutline ad-btnOutline--full"
                  style={{ marginTop: '14px', width: '100%', justifyContent: 'center' }}
                  onClick={() => {
                    setEditingCriteriaId(null);
                    setCriteriaFormData({ name: "" });
                    setShowCriteriaModal(true);
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                  Add Criteria
                </button>
              </div>
            </div>
          </div>

          {/* RIGHT PANEL - QUESTIONS CANVAS */}
          <div className="ad-tableCard ad-splitPanel--questions" style={{ marginBottom: 0 }}>
            <div className="ad-panelHeader" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <h3 className="ad-title" style={{ fontSize: '18px', margin: 0 }}>
                  {selectedCriteria ? selectedCriteria.name : "Criteria Details"}
                </h3>
                {selectedCriteria && (
                  <>
                    <span className={`ad-badge ${selectedCriteria.department_id ? 'ad-badge--info' : 'ad-badge--neutral'}`}>
                      {selectedCriteria.department_id ? (departmentsMap[selectedCriteria.department_id] || "Program") : "Shared / Global"}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => handleToggleCriteria(e, selectedCriteria)}
                      className="ad-btnOutline ad-btnOutline--small"
                      style={{
                        padding: '4px 10px',
                        fontSize: '11.5px',
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
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    type="button"
                    className="ad-actionBtn ad-actionBtn--edit"
                    title="Edit Criteria Name"
                    onClick={(e) => handleEditCriteria(e, selectedCriteria)}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                  </button>
                  <button
                    type="button"
                    className="ad-actionBtn ad-actionBtn--delete"
                    title="Delete Criteria"
                    onClick={(e) => handleDeleteCriteria(e, selectedCriteriaId)}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2-2v2" /></svg>
                  </button>
                </div>
              )}
            </div>

            <div className="ad-panelBody" style={{ padding: '20px' }}>
              {selectedCriteria ? (
                <>
                  {/* TOOLBAR: QUESTION SEARCH + FILTER TABS + ADD BUTTON */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', flex: 1 }}>
                      {/* Search in Question */}
                      <div className="ad-searchWrap" style={{ maxWidth: '300px', minWidth: '200px' }}>
                        <svg className="ad-searchIcon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                        </svg>
                        <input
                          type="text"
                          className="ad-searchInput"
                          placeholder="Search questions in criteria..."
                          value={questionSearch}
                          onChange={(e) => setQuestionSearch(e.target.value)}
                        />
                      </div>
                      {questionSearch && (
                        <button className="ad-filterClear" onClick={() => setQuestionSearch("")}>
                          Clear
                        </button>
                      )}

                      {/* Status Tabs */}
                      <div className="qn-filterTabs" style={{ marginBottom: 0 }}>
                        <button
                          type="button"
                          className={`qn-filterTabBtn ${questionFilter === "all" ? "qn-filterTabBtn--active" : ""}`}
                          onClick={() => setQuestionFilter("all")}
                        >
                          All ({allCurrentQuestions.length})
                        </button>
                        <button
                          type="button"
                          className={`qn-filterTabBtn ${questionFilter === "active" ? "qn-filterTabBtn--active" : ""}`}
                          onClick={() => setQuestionFilter("active")}
                        >
                          Active ({activeQuestionsList.length})
                        </button>
                        {archivedQuestionsList.length > 0 && (
                          <button
                            type="button"
                            className={`qn-filterTabBtn ${questionFilter === "archived" ? "qn-filterTabBtn--active" : ""}`}
                            onClick={() => setQuestionFilter("archived")}
                          >
                            Archived ({archivedQuestionsList.length})
                          </button>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      className="ad-btnPrimary"
                      onClick={() => {
                        setEditingQuestion(null);
                        setQuestionFormData({ text: "" });
                        setTargetCriteriaId(selectedCriteriaId || criteriaList[0]?.id || null);
                        setShowQuestionModal(true);
                      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                      Add Question
                    </button>
                  </div>

                  {/* QUESTION CARDS LIST */}
                  <div className="ad-questionsList">
                    {displayQuestions.length > 0 ? (
                      displayQuestions.map((question, index) => {
                        const isArchived = question.is_active === false;
                        const responses = usedQuestionCounts[question.id] || 0;
                        const actualIndex = allCurrentQuestions.findIndex(q => q.id === question.id);

                        return (
                          <div
                            key={question.id}
                            className="ad-questionItem ad-questionItem--card"
                            style={isArchived ? {
                              background: '#f9fafb',
                              border: '1.5px dashed #cbd5e1',
                              opacity: 0.9,
                            } : {}}
                          >
                            {/* Order Number + Up/Down Reorder Buttons */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                              <div className={isArchived ? "ad-questionOrder" : "ad-questionOrder ad-questionOrder--blue"} style={isArchived ? { background: '#94a3b8' } : {}}>
                                {actualIndex >= 0 ? actualIndex + 1 : index + 1}
                              </div>
                              <div className="qn-reorderCol">
                                <button
                                  type="button"
                                  className="qn-reorderBtn"
                                  title="Move question up"
                                  disabled={actualIndex <= 0}
                                  onClick={() => handleMoveQuestion(selectedCriteriaId, actualIndex, -1)}
                                >
                                  ▲
                                </button>
                                <button
                                  type="button"
                                  className="qn-reorderBtn"
                                  title="Move question down"
                                  disabled={actualIndex === -1 || actualIndex >= allCurrentQuestions.length - 1}
                                  onClick={() => handleMoveQuestion(selectedCriteriaId, actualIndex, 1)}
                                >
                                  ▼
                                </button>
                              </div>
                            </div>

                            <div className="ad-questionContent" style={{ flex: 1, minWidth: 0 }}>
                              <p className="ad-questionText" style={{ margin: 0, fontSize: '14px', lineHeight: '1.5', color: isArchived ? '#64748b' : '#111827', fontWeight: 500 }}>
                                {question.text}
                              </p>
                            </div>

                            <div className="ad-questionActions" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              {isArchived ? (
                                <button
                                  type="button"
                                  className="ad-btnOutline ad-btnOutline--small"
                                  onClick={() => handleReactivateQuestion(selectedCriteriaId, question)}
                                  title="Reactivate this question for students"
                                  style={{ color: '#047857', borderColor: '#a7f3d0' }}
                                >
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
                                  Reactivate
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="ad-actionBtn ad-actionBtn--edit"
                                  title="Edit Question"
                                  onClick={() => handleEditQuestion(question)}
                                >
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                                </button>
                              )}

                              {responses > 0 ? (
                                <button
                                  type="button"
                                  className="ad-btnOutline ad-btnOutline--small"
                                  style={{ color: '#b45309', borderColor: '#fde68a' }}
                                  onClick={() => handleDeleteQuestion(selectedCriteriaId, question)}
                                  title="Archive question (protects past data)"
                                >
                                  Archive
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="ad-actionBtn ad-actionBtn--delete"
                                  onClick={() => handleDeleteQuestion(selectedCriteriaId, question)}
                                  title="Delete question"
                                >
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2-2v2" /></svg>
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="ad-emptyState" style={{ padding: '40px', textAlign: 'center', color: '#6b7280' }}>
                        <p className="ad-emptyText" style={{ margin: 0, fontSize: '14px', fontWeight: 500 }}>
                          {questionSearch ? "No questions match your search." : questionFilter === "archived" ? "No archived questions in this criteria." : "No questions configured yet for this criteria."}
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="ad-infoCard ad-infoCard--light" style={{ marginTop: '20px' }}>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2" style={{ marginRight: '8px' }}><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
                      <span style={{ color: '#1a4d7d', fontSize: '13px' }}>The order shown above determines question order on the student evaluation form. Use ▲ / ▼ to reorder questions.</span>
                    </div>
                  </div>
                </>
              ) : (
                 <div className="ad-emptyState" style={{ padding: '40px', textAlign: 'center', color: '#6b7280' }}>
                   <p className="ad-emptyText" style={{ margin: 0, fontSize: '14px', fontWeight: 500 }}>Select a criteria on the left to manage its questions</p>
                 </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* STUDENT EVALUATION PREVIEW MODAL */}
      {showPreviewModal && (
        <div className="ad-modal">
          <div className="ad-modalOverlay" onClick={() => setShowPreviewModal(false)} />
          <div className="ad-modalContent qn-previewModal">
            <div className="ad-modalHeader" style={{ borderBottom: '1px solid #e5e7eb', paddingBottom: '16px' }}>
              <div>
                <h3 className="ad-modalTitle" style={{ fontSize: '18px', fontWeight: '800' }}>👁️ Student Evaluation Preview</h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#6b7280' }}>
                  This is how students will see the questionnaire during active evaluations.
                </p>
              </div>
              <button className="ad-modalClose" onClick={() => setShowPreviewModal(false)}>×</button>
            </div>

            <div className="qn-previewModalBody">
              {/* Scale explanation banner */}
              <div style={{
                padding: '12px 16px',
                borderRadius: '8px',
                background: '#f9fafb',
                border: '1px solid #e5e7eb',
                marginBottom: '20px',
              }}>
                <div style={{ fontSize: '11px', fontWeight: '700', color: '#6b7280', textTransform: 'uppercase', marginBottom: '6px' }}>
                  Rating Scale (1–5)
                </div>
                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', fontSize: '12px', color: '#374151' }}>
                  <span><strong style={{ color: '#111827' }}>5:</strong> Strongly Agree</span>
                  <span><strong style={{ color: '#111827' }}>4:</strong> Very Satisfactory</span>
                  <span><strong style={{ color: '#111827' }}>3:</strong> Satisfactory</span>
                  <span><strong style={{ color: '#111827' }}>2:</strong> Fair</span>
                  <span><strong style={{ color: '#111827' }}>1:</strong> Poor</span>
                </div>
              </div>

              {/* Active Criteria and Questions */}
              {criteriaList.filter(c => c.enabled).length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px', color: '#9ca3af' }}>
                  No active criteria configured yet. Enable criteria and questions to preview.
                </div>
              ) : (
                criteriaList.filter(c => c.enabled).map((c, cIdx) => {
                  const activeQs = (questionsByCriteria[c.id] || []).filter(q => q.is_active !== false);
                  if (activeQs.length === 0) return null;

                  return (
                    <div key={c.id} style={{ marginBottom: '24px' }}>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        paddingBottom: '8px',
                        borderBottom: '2px solid #e5e7eb',
                        marginBottom: '12px',
                      }}>
                        <span style={{
                          width: '24px',
                          height: '24px',
                          borderRadius: '6px',
                          background: '#1a4d7d',
                          color: '#ffffff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '12px',
                          fontWeight: '800',
                        }}>
                          {cIdx + 1}
                        </span>
                        <h4 style={{ margin: 0, fontSize: '15px', fontWeight: '800', color: '#111827' }}>
                          {c.name}
                        </h4>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {activeQs.map((q, qIdx) => (
                          <div
                            key={q.id}
                            style={{
                              background: '#ffffff',
                              border: '1px solid #e5e7eb',
                              borderRadius: '8px',
                              padding: '12px 14px',
                            }}
                          >
                            <div style={{ fontSize: '13.5px', fontWeight: '500', color: '#1f2937', marginBottom: '8px' }}>
                              <span style={{ fontWeight: '700', marginRight: '6px', color: '#1a4d7d' }}>{qIdx + 1}.</span>
                              {q.text}
                            </div>
                            <div className="qn-likertRow">
                              {[1, 2, 3, 4, 5].map((val) => (
                                <div key={val} className="qn-likertOption">
                                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#d1d5db' }} />
                                  <span>{val}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}

              {/* Comments Preview */}
              <div style={{ marginTop: '16px', padding: '14px', borderRadius: '8px', border: '1.5px dashed #cbd5e1', background: '#f9fafb' }}>
                <label style={{ fontSize: '12px', fontWeight: '700', color: '#4b5563', display: 'block', marginBottom: '6px' }}>
                  Student Comments / Qualitative Feedback (Preview)
                </label>
                <div style={{ height: '64px', borderRadius: '6px', background: '#ffffff', border: '1px solid #e5e7eb', padding: '10px', fontSize: '12px', color: '#9ca3af' }}>
                  Students provide qualitative feedback and constructive suggestions here...
                </div>
              </div>
            </div>

            <div className="ad-modalFooter">
              <button className="ad-btnPrimary" onClick={() => setShowPreviewModal(false)}>
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}

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
              {/* Notice when editing question with past responses */}
              {editingQuestion && (usedQuestionCounts[editingQuestion.id] || 0) > 0 && (
                <div style={{
                  padding: '12px 14px',
                  borderRadius: '8px',
                  background: '#fef3c7',
                  border: '1px solid #fde68a',
                  marginBottom: '16px',
                  color: '#92400e',
                  fontSize: '12.5px',
                  lineHeight: '1.5',
                }}>
                  <strong>⚠️ Historical Data Notice:</strong> This question already has{" "}
                  <strong>{usedQuestionCounts[editingQuestion.id]}</strong> evaluation response(s) in past/current periods.
                  <div style={{ marginTop: '6px' }}>
                    • <strong>Fixing typos:</strong> Editing here is completely fine.<br />
                    • <strong>New question meaning:</strong> It is recommended to <em>Archive</em> this question and add a <em>New Question</em> instead so past reports keep their original wording.
                  </div>
                </div>
              )}

              <div className="ad-formGroup">
                <label className="ad-label">Criteria <span style={{ color: "#dc2626" }}>*</span></label>
                <select
                  className="ad-input"
                  value={targetCriteriaId || selectedCriteriaId || ""}
                  onChange={(e) => setTargetCriteriaId(e.target.value)}
                >
                  {criteriaList.map((c) => {
                    const isReadOnly = !isSuper && !c.department_id;
                    return (
                      <option key={c.id} value={c.id} disabled={isReadOnly}>
                        {c.name} {isReadOnly ? "(Shared - Read Only)" : ""}
                      </option>
                    );
                  })}
                </select>
                <span style={{ fontSize: "12px", color: "#64748b", marginTop: "4px", display: "block" }}>
                  Question will be assigned to this evaluation criteria.
                </span>
              </div>
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

      {/* Confirmation Modal */}
      {confirmModal.show && (
        <div className="ad-modal">
          <div className="ad-modalOverlay" onClick={() => setConfirmModal(prev => ({ ...prev, show: false }))} />
          <div className="ad-modalContent" style={{ maxWidth: '480px' }}>
            <div className="ad-modalHeader">
              <h3 className="ad-modalTitle" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {confirmModal.confirmType === "warning" ? "📦 " : "🗑️ "}
                {confirmModal.title}
              </h3>
              <button className="ad-modalClose" onClick={() => setConfirmModal(prev => ({ ...prev, show: false }))}>×</button>
            </div>
            <div className="ad-modalBody" style={{ fontSize: '13.5px', color: '#334155', lineHeight: '1.6' }}>
              <p style={{ margin: '0 0 12px 0' }}>{confirmModal.message}</p>
              {confirmModal.note && (
                <div style={{
                  padding: '10px 12px',
                  borderRadius: '8px',
                  background: confirmModal.confirmType === "warning" ? '#eff6ff' : '#fef2f2',
                  border: `1px solid ${confirmModal.confirmType === "warning" ? '#bfdbfe' : '#fecaca'}`,
                  color: confirmModal.confirmType === "warning" ? '#1e40af' : '#991b1b',
                  fontSize: '12.5px',
                  lineHeight: '1.5',
                }}>
                  {confirmModal.note}
                </div>
              )}
            </div>
            <div className="ad-modalFooter">
              <button
                className="ad-btnSecondary"
                onClick={() => setConfirmModal(prev => ({ ...prev, show: false }))}
              >
                Cancel
              </button>
              <button
                className={confirmModal.confirmType === "warning" ? "ad-btnPrimary" : "ad-btnPrimary ad-btnPrimary--danger"}
                style={confirmModal.confirmType === "warning" ? { background: '#2563eb' } : { background: '#dc2626' }}
                onClick={async () => {
                  const action = confirmModal.onConfirm;
                  setConfirmModal(prev => ({ ...prev, show: false }));
                  if (action) await action();
                }}
              >
                {confirmModal.confirmText}
              </button>
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
