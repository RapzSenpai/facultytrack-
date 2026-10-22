import { useState, useEffect } from "react";
import AdminLayout from "./AdminLayout";
import { supabase } from "../../config/supabase";
import { isPeriodActive, periodStatusLabel, periodEndPassed, periodNotStarted } from "../../utils/periodStatus";
import { useScopedAdmin } from "../../hooks/useScopedAdmin";
import { useSuperScope } from "../../context/SuperScopeContext";

export default function AdminAcademicYear() {
  const { isSuper, myDeptIds, loading: scopeLoading } = useScopedAdmin();
  const { scopeDeptId } = useSuperScope();
  // D9: scoped admin sees own-program + shared (NULL) periods.
  // Super sees all, or picked-program + shared when the super scope is set.
  // Shared rows are read-only for scoped admins.
  const inScopePeriod = (r) => (isSuper && !scopeDeptId)
    || !r.department_id
    || myDeptIds.includes(r.department_id)
    || r.department_id === scopeDeptId;
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterSemester, setFilterSemester] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingAY, setEditingAY] = useState(null);

  // Real Data State
  const [academicYearList, setAcademicYearList] = useState([]);
  const [orphanedPeriods, setOrphanedPeriods] = useState([]);
  const [deleteTarget, setDeleteTarget] = useState(null);

  // Form State for CRUD
  const [formData, setFormData] = useState({
    year: "",
    semester: "",
    start_date: "",
    end_date: "",
    status: "on-going"
  });

  // 1. Fetch Function
  const fetchAY = async () => {
    if (scopeLoading) return;
    try {
      const [ayRes, assignRes, evalRes] = await Promise.all([
        supabase.from('academic_years').select('*, departments(name)'),
        supabase.from('class_assignments').select('academic_year, semester, department_id, department'),
        supabase.from('admin_evaluations_anon').select('academic_year, semester')
      ]);

      if (ayRes.error) throw ayRes.error;
      const allAY = ayRes.data || [];
      const scopedAY = allAY.filter(inScopePeriod);
      setAcademicYearList(scopedAY);

      // Detect orphaned periods (data present in class_assignments or evaluations but deleted from academic_years)
      const registeredKeys = new Set(allAY.map(a => `${a.year}___${a.semester}`));
      const orphanMap = new Map();

      (assignRes.data || []).forEach(a => {
        if (!a.academic_year || !a.semester) return;
        const key = `${a.academic_year}___${a.semester}`;
        if (!registeredKeys.has(key)) {
          if (!orphanMap.has(key)) {
            orphanMap.set(key, { year: a.academic_year, semester: a.semester, classCount: 0, evalCount: 0 });
          }
          orphanMap.get(key).classCount += 1;
        }
      });

      (evalRes.data || []).forEach(e => {
        if (!e.academic_year || !e.semester) return;
        const key = `${e.academic_year}___${e.semester}`;
        if (!registeredKeys.has(key)) {
          if (!orphanMap.has(key)) {
            orphanMap.set(key, { year: e.academic_year, semester: e.semester, classCount: 0, evalCount: 0 });
          }
          orphanMap.get(key).evalCount += 1;
        }
      });

      setOrphanedPeriods(Array.from(orphanMap.values()));
    } catch (err) {
      console.error("Fetch error:", err);
    }
  };

  // 2. Fixed useEffect (Linter-Safe Pattern)
  useEffect(() => {
    const loadInitialData = async () => {
      await fetchAY();
    };
    loadInitialData();
  }, [scopeLoading, isSuper, myDeptIds.join("|"), scopeDeptId]); // refetch once scope resolves

  // 3. Modal Handlers
  const handleOpenModal = (ay = null) => {
    if (ay) {
      setEditingAY(ay);
      // Only copy form-relevant fields — avoids sending Firestore Timestamps/id back
      setFormData({
        year: ay.year || "",
        semester: ay.semester || "",
        start_date: ay.start_date || "",
        end_date: ay.end_date || "",
        status: periodEndPassed(ay) ? "closed" : "on-going",
      });
    } else {
      setEditingAY(null);
      setFormData({ year: "", semester: "", start_date: "", end_date: "", status: "on-going" });
    }
    setShowModal(true);
  };

  // 4. Save/Update Handler
  const handleSave = async () => {
    if (!formData.year || !formData.semester) {
      alert("Please fill in the Academic Year and Semester.");
      return;
    }

    const isEditing = !!editingAY;

    // Scoped admin creates into own program; super creates shared rows.
    // Shared rows are read-only for scoped admins.
    if (!isSuper && !myDeptIds[0]) {
      alert("No program assigned — ask a super admin to assign you first.");
      return;
    }
    if (isEditing && !isSuper && !editingAY.department_id) {
      alert("Shared periods are read-only for program admins.");
      return;
    }

    // Status is determined automatically: scheduled if not started yet, closed once deadline has passed, otherwise on-going.
    const autoStatus = periodNotStarted(formData)
      ? "scheduled"
      : periodEndPassed(formData)
      ? "closed"
      : "on-going";

    const payload = {
      ...formData,
      status: autoStatus,
      department_id: isEditing ? (editingAY.department_id || null) : (isSuper ? (scopeDeptId || null) : myDeptIds[0]),
    };

    try {
      let result;
      if (isEditing) {
        result = await supabase.from('academic_years').update(payload).eq('id', editingAY.id);
      } else {
        result = await supabase.from('academic_years').insert(payload).select().single();
      }

      if (result.error) {
        alert(`Failed to save: ${result.error.message || 'Unknown error. Check your permissions.'}`);
        console.error("Save error:", result.error);
        return;
      }

      setShowModal(false);
      await fetchAY(); // Refresh table
    } catch (err) {
      console.error("Save error:", err);
      alert("Network error: Could not connect to the server.");
    }
  };

  // 5. Delete Handlers with Cascade Support
  const handleOpenDelete = async (ay, isOrphan = false) => {
    if (!isOrphan && !isSuper && !ay.department_id) {
      alert("Shared periods are read-only for program admins.");
      return;
    }

    setDeleteTarget({
      id: ay.id,
      year: ay.year,
      semester: ay.semester,
      department_id: ay.department_id,
      deptName: ay.departments?.name,
      isOrphan,
      checking: !isOrphan,
      classCount: isOrphan ? (ay.classCount || 0) : 0,
      evalCount: isOrphan ? (ay.evalCount || 0) : 0,
      cascade: true,
      deleting: false,
    });

    if (!isOrphan) {
      try {
        let assignQuery = supabase
          .from('class_assignments')
          .select('id', { count: 'exact', head: true })
          .eq('academic_year', ay.year)
          .eq('semester', ay.semester);
        if (ay.department_id) {
          assignQuery = assignQuery.eq('department_id', ay.department_id);
        }

        const [assignRes, evalRes] = await Promise.all([
          assignQuery,
          supabase
            .from('admin_evaluations_anon')
            .select('assignment_id', { count: 'exact', head: true })
            .eq('academic_year', ay.year)
            .eq('semester', ay.semester),
        ]);

        setDeleteTarget(prev => (prev && prev.id === ay.id) ? {
          ...prev,
          checking: false,
          classCount: assignRes.count || 0,
          evalCount: evalRes.count || 0,
        } : prev);
      } catch (err) {
        console.error("Count check error:", err);
        setDeleteTarget(prev => prev ? { ...prev, checking: false } : null);
      }
    }
  };

  const executeDelete = async () => {
    if (!deleteTarget) return;
    const { id, year, semester, department_id, cascade, isOrphan } = deleteTarget;
    setDeleteTarget(prev => ({ ...prev, deleting: true }));

    try {
      if (cascade || isOrphan) {
        // 1. Delete evaluations for this period
        const { error: evalErr } = await supabase
          .from('evaluations')
          .delete()
          .eq('academic_year', year)
          .eq('semester', semester);
        if (evalErr) console.warn("evaluations delete warning:", evalErr);

        // 2. Delete class assignments
        let assignDelete = supabase
          .from('class_assignments')
          .delete()
          .eq('academic_year', year)
          .eq('semester', semester);
        if (department_id) {
          assignDelete = assignDelete.or(`department_id.eq.${department_id},department.eq.${deleteTarget.deptName || ''}`);
        }
        const { error: caErr } = await assignDelete;
        if (caErr) console.warn("class_assignments delete warning:", caErr);

        // 3. Delete evaluation releases
        let relDelete = supabase
          .from('evaluation_releases')
          .delete()
          .eq('academic_year', year)
          .eq('semester', semester);
        const { error: relErr } = await relDelete;
        if (relErr) console.warn("evaluation_releases delete warning:", relErr);

        // 4. Delete student enrollments
        let enrollDelete = supabase
          .from('student_enrollments')
          .delete()
          .eq('academic_year', year)
          .eq('semester', semester);
        const { error: seErr } = await enrollDelete;
        if (seErr) console.warn("student_enrollments delete warning:", seErr);
      }

      // 5. Delete from academic_years if record still exists
      if (!isOrphan && id) {
        const { error: ayErr } = await supabase.from('academic_years').delete().eq('id', id);
        if (ayErr) throw ayErr;
      }

      setDeleteTarget(null);
      await fetchAY();
    } catch (err) {
      console.error("Delete execution error:", err);
      alert(`Delete failed: ${err.message || 'Error deleting records'}`);
      setDeleteTarget(prev => ({ ...prev, deleting: false }));
    }
  };

  const purgeAllOrphans = async () => {
    if (!window.confirm("Permanently delete all orphaned class assignments, student evaluations, releases, and enrollments for deleted periods?")) return;
    try {
      for (const p of orphanedPeriods) {
        await supabase.from('evaluations').delete().eq('academic_year', p.year).eq('semester', p.semester);
        await supabase.from('class_assignments').delete().eq('academic_year', p.year).eq('semester', p.semester);
        await supabase.from('evaluation_releases').delete().eq('academic_year', p.year).eq('semester', p.semester);
        await supabase.from('student_enrollments').delete().eq('academic_year', p.year).eq('semester', p.semester);
      }
      await fetchAY();
      alert("All orphaned records have been purged from the database.");
    } catch (err) {
      console.error("Purge error:", err);
      alert("Failed to purge orphaned records: " + err.message);
    }
  };

  const filteredAcademicYears = academicYearList.filter(
    (ay) =>
      ay.year?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ay.semester?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Derived status: scheduled if not started, closed if deadline passed, otherwise on-going.
  const ayStatus = (ay) => {
    if (periodNotStarted(ay)) return "scheduled";
    return isPeriodActive(ay) ? "on-going" : "closed";
  };

  const displayedAY = filteredAcademicYears
    .filter(ay => !filterStatus || ayStatus(ay) === filterStatus)
    .filter(ay => !filterSemester || ay.semester === filterSemester);

  return (
    <AdminLayout title="Academic Year Management">
      <section className="ad-content">
        <div className="ad-welcomeHeader" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <h2 className="ad-title">Academic Year & Evaluation Period</h2>
            <p className="ad-subtitle">Manage academic year records and evaluation periods</p>
          </div>
          <button className="ad-btnPrimary" onClick={() => handleOpenModal()}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add New
          </button>
        </div>

        {/* ORPHANED PERIOD DATA BANNER */}
        {orphanedPeriods.length > 0 && (
          <div style={{
            background: "#fffbeb",
            border: "1px solid #fef3c7",
            borderRadius: "10px",
            padding: "16px 20px",
            marginBottom: "20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "16px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: "280px", flex: 1 }}>
              <div style={{
                width: "36px", height: "36px", borderRadius: "50%",
                background: "#fef3c7", color: "#d97706",
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/>
                  <line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
              </div>
              <div>
                <h4 style={{ margin: 0, fontSize: "14px", fontWeight: "600", color: "#92400e" }}>
                  Orphaned Period Data Detected
                </h4>
                <p style={{ margin: "2px 0 0 0", fontSize: "13px", color: "#b45309" }}>
                  Found data from deleted period(s): <strong>{orphanedPeriods.map(p => `${p.year} • ${p.semester}`).join(", ")}</strong>. These still show in Reports and Class Assignments.
                </p>
              </div>
            </div>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
              <button
                onClick={purgeAllOrphans}
                style={{
                  background: "#dc2626",
                  color: "#fff",
                  border: "none",
                  padding: "8px 16px",
                  borderRadius: "6px",
                  fontSize: "13px",
                  fontWeight: "600",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  boxShadow: "0 1px 2px rgba(220,38,38,0.2)"
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2-2v2" />
                </svg>
                Purge All Orphaned Data
              </button>
              {orphanedPeriods.length > 1 && orphanedPeriods.map((p, idx) => (
                <button
                  key={idx}
                  onClick={() => handleOpenDelete(p, true)}
                  style={{
                    background: "#fef2f2",
                    color: "#dc2626",
                    border: "1px solid #fecaca",
                    padding: "7px 12px",
                    borderRadius: "6px",
                    fontSize: "12px",
                    fontWeight: "600",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "5px"
                  }}
                >
                  {p.year} ({p.semester})
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="ad-tableCard ad-tableCard--padded">
          {/* TOOLBAR */}
          <div className="ad-filterBar">
            <div className="ad-searchWrap">
              <svg className="ad-searchIcon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
              <input
                type="text"
                className="ad-searchInput"
                placeholder="Search academic years..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <select className="ad-filterSelect" value={filterSemester} onChange={(e) => setFilterSemester(e.target.value)}>
              <option value="">All Semesters</option>
              <option value="1st Semester">1st Semester</option>
              <option value="2nd Semester">2nd Semester</option>
              <option value="Summer">Summer</option>
            </select>

            <select className="ad-filterSelect" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
              <option value="">All Status</option>
              <option value="scheduled">Scheduled</option>
              <option value="on-going">On-going</option>
              <option value="closed">Closed</option>
            </select>

            {(filterStatus || filterSemester || searchQuery) && (
              <button className="ad-filterClear" onClick={() => { setFilterStatus(""); setFilterSemester(""); setSearchQuery(""); }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                Clear
              </button>
            )}

            <span className="ad-filterCount">
              Showing <strong>{displayedAY.length}</strong> of <strong>{academicYearList.length}</strong> records
            </span>
          </div>

          {/* TABLE */}
          <div className="ad-tableWrap ad-tableWrap--bordered">
            <table className="ad-table ad-table--plain">
              <thead>
                <tr>
                  <th>Academic Year</th>
                  <th>Semester</th>
                  <th>Starting Date</th>
                  <th>End Date</th>
                  <th>Program</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {displayedAY.length > 0 ? (
                  displayedAY.map((ay) => (
                    <tr key={ay.id}>
                      <td className="ad-name">{ay.year}</td>
                      <td className="ad-engagement">{ay.semester}</td>
                      <td className="ad-engagement">{ay.start_date}</td>
                      <td className="ad-engagement">{ay.end_date}</td>
                      <td className="ad-engagement">{ay.departments?.name || "Shared"}</td>
                      <td>
                        <span className={`ad-badge ad-badge--${periodNotStarted(ay) ? "scheduled" : isPeriodActive(ay) ? "active" : "inactive"}`}>
                          {periodStatusLabel(ay)}
                        </span>
                        {ay.start_date && periodNotStarted(ay) && (
                          <div style={{ fontSize: "11px", color: "#2563eb", marginTop: "3px" }}>
                            Starts {ay.start_date}
                          </div>
                        )}
                        {ay.end_date && !periodNotStarted(ay) && (
                          <div style={{ fontSize: "11px", color: isPeriodActive(ay) ? "#059669" : "#64748b", marginTop: "3px" }}>
                            {isPeriodActive(ay) ? `Until ${ay.end_date}` : `Ended ${ay.end_date}`}
                          </div>
                        )}
                      </td>
                      <td className="ad-tableActions" style={{ justifyContent: 'flex-end' }}>
                        <button className="ad-actionBtn ad-actionBtn--edit" title="Edit" onClick={() => handleOpenModal(ay)}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                        </button>
                        <button className="ad-actionBtn ad-actionBtn--delete" title="Delete" onClick={() => handleOpenDelete(ay, false)}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2-2v2" /></svg>
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="7" style={{ textAlign: "center", padding: "48px 20px", color: "#6b7280" }}>
                      <svg style={{ display: 'block', margin: '0 auto 12px auto', color: '#9ca3af' }} width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                        <line x1="16" y1="2" x2="16" y2="6"></line>
                        <line x1="8" y1="2" x2="8" y2="6"></line>
                        <line x1="3" y1="10" x2="21" y2="10"></line>
                      </svg>
                      <span style={{ fontSize: '15px', fontWeight: '500', color: '#4b5563' }}>No academic years found</span>
                      <p style={{ margin: '4px 0 0 0', fontSize: '13px' }}>Try adjusting your search or add a new one.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* FOOTER COUNT */}
          <div className="ad-filterFooter">
            Showing <strong>{displayedAY.length}</strong> of <strong>{academicYearList.length}</strong> academic year records
          </div>
        </div>
      </section>

      {showModal && (
        <div className="ad-modal">
          <div className="ad-modalOverlay" onClick={() => setShowModal(false)} />
          <div className="ad-modalContent">
            <div className="ad-modalHeader">
              <h3 className="ad-modalTitle">{editingAY ? "Edit Academic Year" : "Add New Academic Year"}</h3>
              <button className="ad-modalClose" onClick={() => setShowModal(false)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="ad-modalBody">
              <div className="ad-formGroup">
                <label className="ad-label">Academic Year</label>
                <input
                  type="text" className="ad-input" placeholder="e.g., 2025-2026"
                  value={formData.year} onChange={(e) => setFormData({ ...formData, year: e.target.value })}
                />
              </div>
              <div className="ad-formGroup">
                <label className="ad-label">Semester</label>
                <select className="ad-input" value={formData.semester} onChange={(e) => setFormData({ ...formData, semester: e.target.value })}>
                  <option value="">Select semester</option>
                  <option value="1st Semester">1st Semester</option>
                  <option value="2nd Semester">2nd Semester</option>
                  <option value="Summer">Summer</option>
                </select>
              </div>
              <div className="ad-formRow">
                <div className="ad-formGroup">
                  <label className="ad-label">Starting Date</label>
                  <input type="date" className="ad-input"                   value={formData.start_date} onChange={(e) => setFormData({ ...formData, start_date: e.target.value })} />
                </div>
                <div className="ad-formGroup">
                  <label className="ad-label">End Date</label>
                  <input type="date" className="ad-input"                   value={formData.end_date} onChange={(e) => setFormData({ ...formData, end_date: e.target.value })} />
                </div>
              </div>
              <div className="ad-formGroup">
                <label className="ad-label">Evaluation Status (Automated)</label>
                {(() => {
                  const isFormActive = !periodEndPassed(formData);
                  return (
                    <div style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      padding: "10px 14px",
                      background: isFormActive ? "#f0fdf4" : "#f8fafc",
                      border: `1px solid ${isFormActive ? "#bbf7d0" : "#e2e8f0"}`,
                      borderRadius: "8px",
                      fontSize: "13px"
                    }}>
                      <span className={`ad-badge ad-badge--${isFormActive ? "active" : "inactive"}`}>
                        {isFormActive ? "On-going" : "Closed"}
                      </span>
                      <span style={{ color: isFormActive ? "#15803d" : "#64748b" }}>
                        {formData.end_date
                          ? (isFormActive
                              ? `Open until ${formData.end_date} at 11:59 PM`
                              : `Closed automatically (deadline passed on ${formData.end_date})`)
                          : "Open (No end date set)"}
                      </span>
                    </div>
                  );
                })()}
                <small style={{ color: "#64748b", marginTop: "6px", display: "block" }}>
                  Status is automated based on the End Date. Period automatically closes once the deadline passes.
                </small>
              </div>
            </div>
            <div className="ad-modalFooter">
              <button className="ad-btnSecondary" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="ad-btnPrimary" onClick={handleSave}>
                {editingAY ? "Update" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* DELETE CONFIRMATION & CASCADE MODAL */}
      {deleteTarget && (
        <div className="ad-modal">
          <div className="ad-modalOverlay" onClick={() => !deleteTarget.deleting && setDeleteTarget(null)} />
          <div className="ad-modalContent" style={{ maxWidth: "480px" }}>
            <div className="ad-modalHeader">
              <h3 className="ad-modalTitle" style={{ color: "#dc2626", display: "flex", alignItems: "center", gap: "8px" }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2-2v2" />
                </svg>
                {deleteTarget.isOrphan ? "Purge Orphaned Period Data" : "Delete Evaluation Period"}
              </h3>
              <button
                className="ad-modalClose"
                disabled={deleteTarget.deleting}
                onClick={() => setDeleteTarget(null)}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="ad-modalBody">
              <p style={{ margin: "0 0 14px 0", fontSize: "14px", color: "#374151" }}>
                {deleteTarget.isOrphan
                  ? <>Permanently purge orphaned records for deleted period: <strong style={{ color: "#111827" }}>{deleteTarget.year} ({deleteTarget.semester})</strong>.</>
                  : <>Are you sure you want to delete <strong style={{ color: "#111827" }}>{deleteTarget.year} ({deleteTarget.semester})</strong>?</>}
              </p>

              {deleteTarget.checking ? (
                <div style={{ padding: "16px", textAlign: "center", color: "#6b7280", fontSize: "13px" }}>
                  Scanning associated records...
                </div>
              ) : (
                <div style={{
                  background: "#f9fafb",
                  border: "1px solid #e5e7eb",
                  borderRadius: "8px",
                  padding: "14px",
                  marginBottom: "16px"
                }}>
                  <div style={{ fontSize: "12px", fontWeight: "600", textTransform: "uppercase", color: "#6b7280", marginBottom: "8px" }}>
                    Associated Records Found
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "6px", padding: "10px" }}>
                      <span style={{ fontSize: "11px", color: "#6b7280", display: "block" }}>Class Assignments</span>
                      <strong style={{ fontSize: "18px", color: deleteTarget.classCount > 0 ? "#dc2626" : "#111827" }}>
                        {deleteTarget.classCount}
                      </strong>
                    </div>
                    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "6px", padding: "10px" }}>
                      <span style={{ fontSize: "11px", color: "#6b7280", display: "block" }}>Student Evaluations</span>
                      <strong style={{ fontSize: "18px", color: deleteTarget.evalCount > 0 ? "#dc2626" : "#111827" }}>
                        {deleteTarget.evalCount}
                      </strong>
                    </div>
                  </div>
                </div>
              )}

              {!deleteTarget.isOrphan && (
                <div style={{
                  background: deleteTarget.cascade ? "#fef2f2" : "#f8fafc",
                  border: `1px solid ${deleteTarget.cascade ? "#fecaca" : "#e2e8f0"}`,
                  borderRadius: "8px",
                  padding: "12px 14px",
                  transition: "all 0.15s ease"
                }}>
                  <label style={{ display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer", userSelect: "none" }}>
                    <input
                      type="checkbox"
                      checked={deleteTarget.cascade}
                      disabled={deleteTarget.deleting}
                      onChange={(e) => setDeleteTarget(prev => ({ ...prev, cascade: e.target.checked }))}
                      style={{ marginTop: "3px" }}
                    />
                    <div>
                      <span style={{ fontSize: "13px", fontWeight: "600", color: deleteTarget.cascade ? "#991b1b" : "#334155", display: "block" }}>
                        Cascade Delete Associated Records (Recommended)
                      </span>
                      <span style={{ fontSize: "12px", color: deleteTarget.cascade ? "#b91c1c" : "#64748b", display: "block", marginTop: "2px" }}>
                        Also permanently delete all associated class assignments, student evaluation results, releases, and enrollments for this period.
                      </span>
                    </div>
                  </label>
                </div>
              )}

              {deleteTarget.isOrphan && (
                <p style={{ margin: 0, fontSize: "12px", color: "#dc2626", fontWeight: "500" }}>
                  ⚠️ This action will permanently remove all class assignments, evaluation responses, and releases for this period from the database.
                </p>
              )}
            </div>

            <div className="ad-modalFooter">
              <button
                className="ad-btnSecondary"
                disabled={deleteTarget.deleting}
                onClick={() => setDeleteTarget(null)}
              >
                Cancel
              </button>
              <button
                onClick={executeDelete}
                disabled={deleteTarget.deleting || deleteTarget.checking}
                style={{
                  background: "#dc2626",
                  color: "#fff",
                  border: "none",
                  borderRadius: "8px",
                  padding: "10px 18px",
                  fontWeight: "600",
                  fontSize: "14px",
                  cursor: (deleteTarget.deleting || deleteTarget.checking) ? "not-allowed" : "pointer",
                  opacity: (deleteTarget.deleting || deleteTarget.checking) ? 0.6 : 1,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px"
                }}
              >
                {deleteTarget.deleting ? (
                  <>Deleting...</>
                ) : (
                  deleteTarget.isOrphan ? "Purge All Data" : (deleteTarget.cascade ? "Delete Period & Data" : "Delete Period Only")
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
