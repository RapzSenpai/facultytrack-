import { useState, useEffect } from "react";
import AdminLayout from "./AdminLayout";
import { supabase } from "../../config/supabase";

export default function AdminClassAssignment() {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterDept, setFilterDept] = useState("");
  const [filterYear, setFilterYear] = useState("");
  const [filterSemester, setFilterSemester] = useState("");
  const [filterAY, setFilterAY] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState(null);

  // Real Data States
  const [assignmentList, setAssignmentList] = useState([]);
  const [facultyOptions, setFacultyOptions] = useState([]);
  const [subjectOptions, setSubjectOptions] = useState([]);
  const [departmentOptions, setDepartmentOptions] = useState([]);
  const [academicYearOptions, setAcademicYearOptions] = useState([]);
  const [deletedFacultyIds, setDeletedFacultyIds] = useState(new Set());

  const [formData, setFormData] = useState({
    facultyId: "", facultyName: "", subjectCode: "", subjectName: "",
    department: "", yearLevel: "", section: "", semester: "", academicYear: ""
  });

  useEffect(() => {
    const loadAllData = async () => {
      try {
        const [assignRes, facRes, subRes, deptRes, ayRes] = await Promise.all([
          supabase.from('class_assignments').select('*'),
          supabase.from('users').select('*'),
          supabase.from('subjects').select('*'),
          supabase.from('departments').select('*'),
          supabase.from('academic_years').select('*'),
        ]);

        const assignments = (assignRes.data || []).map(a => ({
          ...a,
          facultyId: a.faculty_id,
          facultyName: a.faculty_name,
          subjectCode: a.subject_code,
          subjectName: a.subject_name,
          yearLevel: a.year_level,
          academicYear: a.academic_year,
        }));
        const users = facRes.data || [];
        const subjects = subRes.data || [];
        const depts = deptRes.data || [];
        const ays = ayRes.data || [];

        setAssignmentList(assignments);
        setFacultyOptions(users.filter(u => u.role === "faculty" && u.status !== "deleted").map(u => ({ ...u, fullName: u.full_name })));
        setSubjectOptions(subjects);
        setDepartmentOptions(depts);
        setAcademicYearOptions(ays);
        const deletedUids = new Set(
          users.filter(u => u.status === "deleted").map(u => u.id || u.uid)
        );
        setDeletedFacultyIds(deletedUids);
      } catch (err) { console.error("Fetch Error:", err); }
    };
    loadAllData();
  }, []);

  const handleSave = async () => {
    try {
      if (editingAssignment) {
        const { error } = await supabase.from('class_assignments').update({
          faculty_id: formData.facultyId,
          faculty_name: formData.facultyName,
          subject_code: formData.subjectCode,
          subject_name: formData.subjectName,
          department: formData.department,
          year_level: formData.yearLevel,
          section: formData.section,
          semester: formData.semester,
          academic_year: formData.academicYear,
        }).eq('id', editingAssignment.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('class_assignments').insert({
          faculty_id: formData.facultyId,
          faculty_name: formData.facultyName,
          subject_code: formData.subjectCode,
          subject_name: formData.subjectName,
          department: formData.department,
          year_level: formData.yearLevel,
          section: formData.section,
          semester: formData.semester,
          academic_year: formData.academicYear,
        });
        if (error) throw error;
      }

      const { data: refreshed } = await supabase.from('class_assignments').select('*');
      setAssignmentList((refreshed || []).map(a => ({
        ...a,
        facultyId: a.faculty_id,
        facultyName: a.faculty_name,
        subjectCode: a.subject_code,
        subjectName: a.subject_name,
        yearLevel: a.year_level,
        academicYear: a.academic_year,
      })));
      setShowModal(false);
    } catch (err) { console.error("Save error:", err); }
  };

  const handleDelete = async (id) => {
    if (confirm("Delete this assignment?")) {
      const { error } = await supabase.from('class_assignments').delete().eq('id', id);
      if (!error) {
        setAssignmentList(assignmentList.filter(a => a.id !== id));
      }
    }
  };

  // Filter out search terms AND hide rows for soft-deleted faculty
  const filteredAssignments = assignmentList
    .filter(a => !deletedFacultyIds.has(a.facultyId))
    .filter(a =>
      a.facultyName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.subjectCode?.toLowerCase().includes(searchQuery.toLowerCase())
    )
    .filter(a => !filterDept || a.department === filterDept)
    .filter(a => !filterYear || a.yearLevel === filterYear)
    .filter(a => !filterSemester || a.semester === filterSemester)
    .filter(a => !filterAY || a.academicYear === filterAY);

  return (
    <AdminLayout title="Class Assignment">
      <section className="ad-content">
        <div className="ad-welcomeHeader">
          <div>
            <h2 className="ad-title">Class Assignment</h2>
            <p className="ad-subtitle">Assign faculty members to specific subjects and sections</p>
          </div>
          <button className="ad-btnPrimary" onClick={() => {
            setEditingAssignment(null);
            setFormData({ facultyId: "", facultyName: "", subjectCode: "", subjectName: "", department: "", yearLevel: "", section: "", semester: "", academicYear: "" });
            setShowModal(true);
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Add New Assignment
          </button>
        </div>

        <div className="ad-tableCard" style={{ marginBottom: "1.5rem", padding: "0" }}>
          <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border, #e5e7eb)", display: "flex", alignItems: "center", gap: "8px", backgroundColor: "rgba(37, 99, 235, 0.04)" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--primary, #2563eb)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
            <span style={{ fontWeight: "600", fontSize: "14px", color: "var(--primary, #2563eb)" }}>Filter Assignments</span>
            {(filterDept || filterYear || filterSemester || filterAY || searchQuery) && (
              <span style={{ marginLeft: "auto", fontSize: "12px", color: "#6b7280" }}>
                {filteredAssignments.length} result{filteredAssignments.length !== 1 ? "s" : ""} found
              </span>
            )}
          </div>
          <div style={{ padding: "16px 20px", display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
            {/* Search */}
            <div style={{ position: 'relative', flex: '1 1 220px', minWidth: '200px' }}>
              <svg style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
              <input
                type="text"
                style={{ width: '100%', padding: '10px 12px 10px 40px', borderRadius: '8px', border: '1px solid #d1d5db', fontSize: '14px', outline: 'none', boxSizing: 'border-box' }}
                placeholder="Search by faculty, subject..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            {/* Program Filter */}
            <select
              style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid #d1d5db', fontSize: '14px', outline: 'none', background: '#fff', color: '#374151', cursor: 'pointer', minWidth: '170px' }}
              value={filterDept}
              onChange={(e) => setFilterDept(e.target.value)}
            >
              <option value="">All Programs</option>
              {departmentOptions.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
            </select>

            {/* Year Level Filter */}
            <select
              style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid #d1d5db', fontSize: '14px', outline: 'none', background: '#fff', color: '#374151', cursor: 'pointer', minWidth: '140px' }}
              value={filterYear}
              onChange={(e) => setFilterYear(e.target.value)}
            >
              <option value="">All Years</option>
              {["1st", "2nd", "3rd", "4th"].map(y => <option key={y} value={y}>{y} Year</option>)}
            </select>

            {/* Semester Filter */}
            <select
              style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid #d1d5db', fontSize: '14px', outline: 'none', background: '#fff', color: '#374151', cursor: 'pointer', minWidth: '150px' }}
              value={filterSemester}
              onChange={(e) => setFilterSemester(e.target.value)}
            >
              <option value="">All Semesters</option>
              {["1st Semester", "2nd Semester", "Summer"].map(s => <option key={s} value={s}>{s}</option>)}
            </select>

            {/* Academic Year Filter */}
            <select
              style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid #d1d5db', fontSize: '14px', outline: 'none', background: '#fff', color: '#374151', cursor: 'pointer', minWidth: '160px' }}
              value={filterAY}
              onChange={(e) => setFilterAY(e.target.value)}
            >
              <option value="">All Academic Years</option>
              {academicYearOptions.map(y => <option key={y.id} value={y.year}>{y.year}</option>)}
            </select>

            {/* Clear Filters */}
            {(filterDept || filterYear || filterSemester || filterAY || searchQuery) && (
              <button
                onClick={() => { setFilterDept(""); setFilterYear(""); setFilterSemester(""); setFilterAY(""); setSearchQuery(""); }}
                style={{ padding: '10px 16px', borderRadius: '8px', border: '1px solid #fca5a5', background: '#fef2f2', color: '#dc2626', fontSize: '14px', fontWeight: '500', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                Clear Filters
              </button>
            )}
          </div>
        </div>

        <div className="ad-tableCard ad-tableCard--padded">
          <div className="ad-tableWrap ad-tableWrap--bordered" style={{ overflowX: 'auto' }}>
            <table className="ad-table ad-table--plain ad-table--compact">
              <thead>
                <tr>
                  <th>Faculty Name</th>
                  <th>Subject Code</th>
                  <th>Subject Name</th>
                  <th>Program</th>
                  <th>Year & Section</th>
                  <th>Semester</th>
                  <th>Academic Year</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredAssignments.length > 0 ? (
                  filteredAssignments.map((assignment) => (
                    <tr key={assignment.id}>
                      <td>
                        <div className="ad-avatarCell">
                          <div className="ad-avatar ad-avatar--blue">
                            {(assignment.facultyName || '??').substring(0, 2).toUpperCase()}
                          </div>
                          <div className="ad-cellLines">
                            <span className="ad-cellPrimary">{assignment.facultyName}</span>
                            <span className="ad-cellSecondary">Faculty</span>
                          </div>
                        </div>
                      </td>
                      <td className="ad-code">{assignment.subjectCode}</td>
                      <td>
                        <span className="ad-cellPrimary">{assignment.subjectName}</span>
                      </td>
                      <td>
                        <span style={{ display: 'inline-block', padding: '4px 10px', background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb', borderRadius: '999px', fontSize: '11px', fontWeight: '700', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                          {assignment.department || "—"}
                        </span>
                      </td>
                      <td>
                        <span className="ad-badge ad-badge--info">{assignment.yearLevel} - {assignment.section}</span>
                      </td>
                      <td style={{ color: '#4b5563', fontSize: '14px' }}>{assignment.semester}</td>
                      <td style={{ color: '#4b5563', fontSize: '14px' }}>{assignment.academicYear}</td>
                      <td className="ad-tableActions" style={{ justifyContent: 'flex-end' }}>
                        <button className="ad-actionBtn ad-actionBtn--edit" title="Edit" onClick={() => {
                          setEditingAssignment(assignment);
                          setFormData({
                            facultyId: assignment.facultyId || "",
                            facultyName: assignment.facultyName || "",
                            subjectCode: assignment.subjectCode || "",
                            subjectName: assignment.subjectName || "",
                            department: assignment.department || "",
                            yearLevel: assignment.yearLevel || "",
                            section: assignment.section || "",
                            semester: assignment.semester || "",
                            academicYear: assignment.academicYear || "",
                          });
                          setShowModal(true);
                        }}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                        </button>
                        <button className="ad-actionBtn ad-actionBtn--delete" title="Delete" onClick={() => handleDelete(assignment.id)}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2-2v2" /></svg>
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="8" style={{ textAlign: "center", padding: "48px 20px", color: "#6b7280" }}>
                      <svg style={{ display: 'block', margin: '0 auto 12px auto', color: '#9ca3af' }} width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                        <circle cx="9" cy="7" r="4"></circle>
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                        <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                      </svg>
                      <span style={{ fontSize: '15px', fontWeight: '500', color: '#4b5563' }}>No class assignments found</span>
                      <p style={{ margin: '4px 0 0 0', fontSize: '13px' }}>Try adjusting your search or filters.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          
          <div className="ad-filterFooter">
            Showing <strong>{filteredAssignments.length}</strong> of <strong>{assignmentList.filter(a => !deletedFacultyIds.has(a.facultyId)).length}</strong> assignments
          </div>
        </div>
      </section>

      {showModal && (
        <div className="ad-modal">
          <div className="ad-modalOverlay" onClick={() => setShowModal(false)} />
          <div className="ad-modalContent ad-modalContent--large">
            <div className="ad-modalHeader">
              <h3 className="ad-modalTitle">{editingAssignment ? "Edit Class Assignment" : "Add New Class Assignment"}</h3>
              <button className="ad-modalClose" onClick={() => setShowModal(false)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div className="ad-modalBody">
              <div className="ad-formGroup">
                <label className="ad-label">Faculty Member *</label>
                <select
                  className="ad-input"
                  value={formData.facultyId || ""}
                  onChange={(e) => {
                    const fac = facultyOptions.find(f => f.id === e.target.value);
                    setFormData({ ...formData, facultyId: e.target.value, facultyName: fac?.fullName || "" });
                  }}
                >
                  <option value="">Select faculty member</option>
                  {facultyOptions.map(f => <option key={f.id} value={f.id}>{f.fullName}</option>)}
                </select>
              </div>

              <div className="ad-formGroup">
                <label className="ad-label">Subject *</label>
                <select
                  className="ad-input"
                  value={formData.subjectCode || ""}
                  onChange={(e) => {
                    const sub = subjectOptions.find(s => s.code === e.target.value);
                    setFormData({ ...formData, subjectCode: e.target.value, subjectName: sub?.description || "" });
                  }}
                >
                  <option value="">Select subject</option>
                  {subjectOptions.map(s => <option key={s.code} value={s.code}>{s.code} - {s.description}</option>)}
                </select>
              </div>

              <div className="ad-formRow">
                <div className="ad-formGroup">
                  <label className="ad-label">Program *</label>
                  <select className="ad-input" value={formData.department || ""} onChange={(e) => setFormData({ ...formData, department: e.target.value })}>
                    <option value="">Select program</option>
                    {departmentOptions.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
                  </select>
                </div>
                <div className="ad-formGroup">
                  <label className="ad-label">Year Level *</label>
                  <select className="ad-input" value={formData.yearLevel || ""} onChange={(e) => setFormData({ ...formData, yearLevel: e.target.value })}>
                    <option value="">Select year</option>
                    {["1st", "2nd", "3rd", "4th"].map(y => <option key={y} value={y}>{y} Year</option>)}
                  </select>
                </div>
              </div>

              <div className="ad-formRow">
                <div className="ad-formGroup">
                  <label className="ad-label">Section *</label>
                  <select className="ad-input" value={formData.section || ""} onChange={(e) => setFormData({ ...formData, section: e.target.value })}>
                    <option value="">Select section</option>
                    {["A", "B", "C", "D"].map(s => <option key={s} value={s}>Section {s}</option>)}
                  </select>
                </div>
                <div className="ad-formGroup">
                  <label className="ad-label">Semester *</label>
                  <select className="ad-input" value={formData.semester || ""} onChange={(e) => setFormData({ ...formData, semester: e.target.value })}>
                    <option value="">Select semester</option>
                    {["1st Semester", "2nd Semester", "Summer"].map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              <div className="ad-formGroup">
                <label className="ad-label">Academic Year *</label>
                <select
                  className="ad-input"
                  value={formData.academicYear || ""}
                  onChange={(e) => setFormData({ ...formData, academicYear: e.target.value })}
                >
                  <option value="">Select academic year</option>
                  {academicYearOptions.map(y => (
                    <option key={y.id} value={y.year}>
                      {y.year}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="ad-modalFooter">
              <button className="ad-btnSecondary" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="ad-btnPrimary" onClick={handleSave}>
                {editingAssignment ? "Update Assignment" : "Save Assignment"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
