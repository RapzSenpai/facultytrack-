import { useState, useEffect } from "react";
import AdminLayout from "./AdminLayout";
import { supabase } from "../../config/supabase";

const YEAR_LEVELS = ["1st", "2nd", "3rd", "4th"];
const SECTIONS = ["A", "B", "C", "D"];

const EMPTY_FORM = { schoolId: "", name: "", email: "", password: "", department: "", yearLevel: "", section: "" };

export default function AdminStudent() {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterDept, setFilterDept] = useState("");
  const [filterYear, setFilterYear] = useState("");
  const [filterSection, setFilterSection] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingStudent, setEditingStudent] = useState(null);
  const [viewingStudent, setViewingStudent] = useState(null);
  const [loading, setLoading] = useState(false);
  const [studentList, setStudentList] = useState([]);
  const [departmentOptions, setDepartmentOptions] = useState([]);

  const [formData, setFormData] = useState(EMPTY_FORM);

  const fetchStudents = async () => {
    try {
      const { data, error } = await supabase.from('users').select('*').eq('role', 'student');
      if (!error) {
        setStudentList((data || []).map(s => ({
          ...s,
          fullName: s.full_name,
          schoolId: s.school_id,
        })));
      }
    } catch (err) {
      console.error("Fetch error:", err);
    }
  };

  useEffect(() => {
    fetchStudents();
    // Fetch departments so the student's department matches class assignment dropdown
    supabase.from('departments').select('*')
      .then(({ data, error }) => {
        if (!error) setDepartmentOptions(Array.isArray(data) ? data : []);
      })
      .catch(err => console.error("Dept fetch error:", err));
  }, []);

  const handleDelete = async (uid) => {
    if (window.confirm("Are you sure you want to delete this student?")) {
      try {
        const { error } = await supabase.rpc('delete_user_account', { target_user_id: uid });
        if (error) {
          console.error("Delete RPC error, fallback to table delete:", error);
          await supabase.from('users').delete().eq('id', uid);
        }
        fetchStudents();
      } catch (err) {
        console.error("Delete error:", err);
      }
    }
  };

  const handleToggleStatus = async (uid, currentStatus) => {
    const newStatus = currentStatus === "active" ? "inactive" : "active";
    const action = newStatus === "active" ? "activate" : "deactivate";
    if (window.confirm(`Are you sure you want to ${action} this student?`)) {
      try {
        const { error } = await supabase
          .from('users')
          .update({ status: newStatus })
          .eq('id', uid);
        if (!error) fetchStudents();
      } catch (err) {
        console.error("Status update error:", err);
      }
    }
  };

  const handleSave = async () => {
    if (!formData.email || !formData.name || (!editingStudent && !formData.password)) {
      alert("Please fill in required fields.");
      return;
    }

    setLoading(true);
    const isEditing = !!editingStudent;

    try {
      let error = null;

      if (isEditing) {
        const { error: updateError } = await supabase
          .from('users')
          .update({
            full_name: formData.name,
            email: formData.email,
            school_id: formData.schoolId,
            department: formData.department,
            year_level: formData.yearLevel,
            section: formData.section,
          })
          .eq('id', editingStudent.id);
        error = updateError;
      } else {
        const { error: signUpError } = await supabase.auth.signUp({
          email: formData.email,
          password: formData.password,
          options: {
            data: {
              full_name: formData.name,
              role: 'student',
              school_id: formData.schoolId,
              department: formData.department,
              year_level: formData.yearLevel,
              section: formData.section,
            }
          }
        });
        error = signUpError;
      }

      if (!error) {
        setShowModal(false);
        fetchStudents();
      } else {
        alert(`Error: ${error.message || "Something went wrong"}`);
      }
    } catch (err) {
      console.error("Save error:", err);
    } finally {
      setLoading(false);
    }
  };

  const filteredStudents = studentList.filter(s =>
    ((s.fullName || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
      (s.schoolId || "").toLowerCase().includes(searchQuery.toLowerCase())) &&
    (s.status || "active").toLowerCase() !== "pending"
  );

  const displayedStudents = filteredStudents
    .filter(s => !filterDept || s.department === filterDept)
    .filter(s => !filterYear || s.yearLevel === filterYear)
    .filter(s => !filterSection || s.section === filterSection);

  return (
    <AdminLayout title="Student Management">
      <section className="ad-content">
        <div className="ad-welcomeHeader" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <h2 className="ad-title">Student Management</h2>
            <p className="ad-subtitle">Manage all student accounts in the system</p>
          </div>
          <button className="ad-btnPrimary" onClick={() => {
            setEditingStudent(null);
            setFormData(EMPTY_FORM);
            setShowModal(true);
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Add New Student
          </button>
        </div>

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
                placeholder="Search by name or ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <select className="ad-filterSelect" value={filterDept} onChange={(e) => setFilterDept(e.target.value)}>
              <option value="">All Programs</option>
              {departmentOptions.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
            </select>

            <select className="ad-filterSelect" value={filterYear} onChange={(e) => setFilterYear(e.target.value)}>
              <option value="">All Years</option>
              {YEAR_LEVELS.map(y => <option key={y} value={y}>{y} Year</option>)}
            </select>

            <select className="ad-filterSelect" value={filterSection} onChange={(e) => setFilterSection(e.target.value)}>
              <option value="">All Sections</option>
              {SECTIONS.map(s => <option key={s} value={s}>Section {s}</option>)}
            </select>

            {(filterDept || filterYear || filterSection || searchQuery) && (
              <button className="ad-filterClear" onClick={() => { setFilterDept(""); setFilterYear(""); setFilterSection(""); setSearchQuery(""); }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                Clear
              </button>
            )}

            <span className="ad-filterCount">
              Showing <strong>{displayedStudents.length}</strong> of <strong>{filteredStudents.length}</strong> students
            </span>
          </div>

          {/* TABLE */}
          <div className="ad-tableWrap ad-tableWrap--bordered">
            <table className="ad-table ad-table--plain">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>School ID</th>
                  <th>Email</th>
                  <th>Prog.</th>
                  <th>Year</th>
                  <th>Sec.</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {displayedStudents.length > 0 ? (
                  displayedStudents.map((student) => (
                    <tr key={student.id}>
                      <td>
                        <div className="ad-avatarCell">
                          <div className="ad-avatar ad-avatar--blue">
                            {(student.fullName || '??').substring(0, 2).toUpperCase()}
                          </div>
                          <div className="ad-cellLines">
                            <span className="ad-cellPrimary">{student.fullName}</span>
                            <span className="ad-cellSecondary">{student.department || 'Student'}</span>
                          </div>
                        </div>
                      </td>
                      <td className="ad-code">{student.schoolId}</td>
                      <td>{student.email}</td>
                      <td>{student.department}</td>
                      <td>
                        <span style={{ display: 'inline-block', padding: '4px 10px', background: '#f3f4f6', color: '#1e3a8a', borderRadius: '6px', fontSize: '11px', fontWeight: '800', border: '1px solid #e5e7eb', letterSpacing: '0.5px' }}>
                          {student.yearLevel ? student.yearLevel.toUpperCase() : "—"}
                        </span>
                      </td>
                      <td>
                        <span style={{ display: 'inline-block', padding: '4px 10px', background: '#f3f4f6', color: '#1e3a8a', borderRadius: '6px', fontSize: '11px', fontWeight: '800', border: '1px solid #e5e7eb', letterSpacing: '0.5px' }}>
                          {student.section ? student.section.toUpperCase() : "—"}
                        </span>
                      </td>
                      <td>
                        <span className={`ad-badge ad-badge--${(student.status || 'active').toLowerCase()}`}>
                          {student.status || 'Active'}
                        </span>
                      </td>
                      <td className="ad-tableActions" style={{ justifyContent: 'flex-end' }}>
                        <button className="ad-actionBtn ad-actionBtn--view" title="View" onClick={() => setViewingStudent(student)}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                        </button>
                        <button className="ad-actionBtn ad-actionBtn--edit" title="Edit" onClick={() => {
                          setEditingStudent(student);
                          setFormData({
                            schoolId: student.schoolId || "",
                            name: student.fullName || "",
                            email: student.email || "",
                            password: "",
                            department: student.department || "",
                            yearLevel: student.yearLevel || "",
                            section: student.section || "",
                          });
                          setShowModal(true);
                        }}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                        </button>
                        <button className="ad-actionBtn ad-actionBtn--edit" title={(!student.status || student.status === "active") ? "Deactivate" : "Activate"} style={{ color: (!student.status || student.status === "active") ? "#f59e0b" : "#22c55e", background: "rgba(245, 158, 11, 0.1)" }} onClick={() => handleToggleStatus(student.id, student.status || 'active')}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                        </button>
                        <button className="ad-actionBtn ad-actionBtn--delete" title="Delete" onClick={() => handleDelete(student.id)}>
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
                      <span style={{ fontSize: '15px', fontWeight: '500', color: '#4b5563' }}>No students found</span>
                      <p style={{ margin: '4px 0 0 0', fontSize: '13px' }}>Try adjusting your search or filters.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* FOOTER COUNT */}
          <div className="ad-filterFooter">
            Showing <strong>{displayedStudents.length}</strong> of <strong>{studentList.filter(s => (s.status || 'active').toLowerCase() !== 'pending').length}</strong> student accounts
          </div>
        </div>
      </section>

      {/* VIEW STUDENT MODAL */}
      {viewingStudent && (
        <div className="ad-modal">
          <div className="ad-modalOverlay" onClick={() => setViewingStudent(null)} />
          <div className="ad-modalContent">
            <div className="ad-modalHeader">
              <h3 className="ad-modalTitle">Student Details</h3>
              <button className="ad-modalClose" onClick={() => setViewingStudent(null)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div className="ad-modalBody">
              {[
                { label: "School ID", value: viewingStudent.schoolId || "—" },
                { label: "Full Name", value: viewingStudent.fullName || "—" },
                { label: "Email", value: viewingStudent.email || "—" },
                { label: "Program", value: viewingStudent.department || "—" },
                { label: "Year Level", value: viewingStudent.yearLevel || "—" },
                { label: "Section", value: viewingStudent.section || "—" },
                { label: "Status", value: viewingStudent.status || "Active" },
              ].map(f => (
                <div className="ad-formGroup" key={f.label} style={{ marginBottom: "12px" }}>
                  <label className="ad-label" style={{ marginBottom: "4px" }}>{f.label}</label>
                  <div style={{ padding: "8px 12px", background: "#f9fafb", borderRadius: "6px", border: "1px solid #e5e7eb", fontSize: "14px" }}>{f.value}</div>
                </div>
              ))}
            </div>
            <div className="ad-modalFooter">
              <button className="ad-btnSecondary" onClick={() => setViewingStudent(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {showModal && (
        <div className="ad-modal">
          <div className="ad-modalOverlay" onClick={() => setShowModal(false)} />
          <div className="ad-modalContent ad-modalContent--large">
            <div className="ad-modalHeader">
              <h3 className="ad-modalTitle">{editingStudent ? "Edit Student Account" : "Register New Student"}</h3>
              <button className="ad-modalClose" onClick={() => setShowModal(false)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div className="ad-modalBody">
              <div className="ad-formRow">
                <div className="ad-formGroup">
                  <label className="ad-label">School ID</label>
                  <input type="text" className="ad-input" placeholder="ID Number" value={formData.schoolId} onChange={(e) => setFormData({ ...formData, schoolId: e.target.value })} />
                </div>
                <div className="ad-formGroup">
                  <label className="ad-label">Full Name</label>
                  <input type="text" className="ad-input" placeholder="Enter complete name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} />
                </div>
              </div>

              <div className="ad-formRow">
                <div className="ad-formGroup">
                  <label className="ad-label">Email Address</label>
                  <input type="email" className="ad-input" placeholder="student@school.edu.ph" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} />
                </div>
                {!editingStudent && (
                  <div className="ad-formGroup">
                    <label className="ad-label">Password</label>
                    <input type="password" className="ad-input" placeholder="Initial password" value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} />
                  </div>
                )}
              </div>

              <div className="ad-formRow" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
                <div className="ad-formGroup">
                  <label className="ad-label">Program</label>
                  {/* Must use dropdown matching class assignment so student-faculty filtering works */}
                  <select className="ad-input" value={formData.department} onChange={(e) => setFormData({ ...formData, department: e.target.value })}>
                    <option value="">Select program</option>
                    {departmentOptions.map(d => (
                      <option key={d.id} value={d.name}>{d.name}</option>
                    ))}
                  </select>
                </div>
                <div className="ad-formGroup">
                  <label className="ad-label">Year Level</label>
                  <select className="ad-input" value={formData.yearLevel} onChange={(e) => setFormData({ ...formData, yearLevel: e.target.value })}>
                    <option value="">Select year</option>
                    {YEAR_LEVELS.map(y => <option key={y} value={y}>{y} Year</option>)}
                  </select>
                </div>
                <div className="ad-formGroup">
                  <label className="ad-label">Section</label>
                  <select className="ad-input" value={formData.section} onChange={(e) => setFormData({ ...formData, section: e.target.value })}>
                    <option value="">Select section</option>
                    {SECTIONS.map(s => <option key={s} value={s}>Section {s}</option>)}
                  </select>
                </div>
              </div>

              {editingStudent && (
                <div className="ad-formNote">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
                  Passwords cannot be updated from this panel for security reasons.
                </div>
              )}
            </div>
            <div className="ad-modalFooter">
              <button className="ad-btnSecondary" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="ad-btnPrimary" onClick={handleSave} disabled={loading}>
                {loading ? "Processing..." : (editingStudent ? "Update Account" : "Create Account")}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
