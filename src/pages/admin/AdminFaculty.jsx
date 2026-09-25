import { useState, useEffect } from "react";
import AdminLayout from "./AdminLayout";
import { supabase } from "../../config/supabase";

export default function AdminFaculty() {
  const [facultyList, setFacultyList] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterDept, setFilterDept] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingFaculty, setEditingFaculty] = useState(null);
  const [loading, setLoading] = useState(false);

  const [departmentOptions, setDepartmentOptions] = useState([]);

  // Initial Form State
  const initialForm = { schoolId: "", name: "", email: "", password: "", department: "" };
  const [formData, setFormData] = useState(initialForm);

  // 1. READ: Fetch faculty members and departments
  const fetchData = async () => {
    try {
      const [facultyResult, deptResult] = await Promise.all([
        supabase.from('users').select('*').eq('role', 'faculty'),
        supabase.from('departments').select('*')
      ]);

      if (facultyResult.error) throw facultyResult.error;
      setFacultyList((facultyResult.data || []).map(f => ({
        ...f,
        fullName: f.full_name,
        schoolId: f.school_id,
      })));

      if (!deptResult.error) {
        setDepartmentOptions(deptResult.data || []);
      }
    } catch (err) {
      console.error("Fetch error:", err);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // 2. CREATE & UPDATE Logic
  const handleSave = async (e) => {
    e.preventDefault(); // Prevent form reload

    // Basic Validation
    if (!formData.email || !formData.name || (!editingFaculty && !formData.password)) {
      alert("Please fill in all required fields.");
      return;
    }

    setLoading(true);
    const isEditing = !!editingFaculty;
    // Keep department_id in sync with the department name —
    // release gating + scoped-admin RLS match on it, and the
    // signup trigger only resolves it at signup time.
    const selectedDept = departmentOptions.find((d) => d.name === formData.department);

    try {
      if (isEditing) {
        const { error: updateError } = await supabase
          .from('users')
          .update({
            full_name: formData.name,
            email: formData.email,
            school_id: formData.schoolId,
            department: formData.department,
            department_id: selectedDept?.id || null,
          })
          .eq('id', editingFaculty.id);

        if (updateError) {
          alert(`Update failed: ${updateError.message || 'Unknown error.'}`);
          console.error("Update error:", updateError);
          return;
        }
      } else {
        // Step 1: Create the auth user
        const { data: authData, error: signUpError } = await supabase.auth.signUp({
          email: formData.email,
          password: formData.password,
          options: {
            data: {
              full_name: formData.name,
              role: 'faculty',
              school_id: formData.schoolId,
              department: formData.department,
            }
          }
        });

        if (signUpError) {
          alert(`Registration failed: ${signUpError.message}`);
          console.error("SignUp error:", signUpError);
          return;
        }

        // Step 2: Directly insert profile into users table so it shows up immediately
        // (in case email confirmation is required, the trigger may not fire until confirmed)
        if (authData?.user?.id) {
          const { error: insertError } = await supabase.from('users').upsert({
            id: authData.user.id,
            email: formData.email,
            full_name: formData.name,
            role: 'faculty',
            school_id: formData.schoolId,
            department: formData.department,
            department_id: selectedDept?.id || null,
            status: 'active',
          }, { onConflict: 'id' });

          if (insertError) {
            console.warn("Profile upsert warning (may already exist):", insertError.message);
          }
        }
      }

      await fetchData();
      setShowModal(false);
      setFormData(initialForm);
      setEditingFaculty(null);
    } catch (err) {
      alert("Network error: Could not connect to the server.");
      console.error("Save error:", err);
    } finally {
      setLoading(false);
    }
  };

  // 3. DELETE Logic
  const handleDelete = async (uid) => {
    if (!window.confirm("Are you sure you want to delete this faculty member? This action cannot be undone.")) return;

    try {
      const { error } = await supabase.rpc('delete_user_account', { target_user_id: uid });

      if (!error) {
        setFacultyList(prev => prev.filter(f => f.id !== uid));
      } else {
        console.error("Delete RPC error, fallback to table delete:", error);
        const { error: delErr } = await supabase.from('users').delete().eq('id', uid);
        if (!delErr) {
          setFacultyList(prev => prev.filter(f => f.id !== uid));
        } else {
          alert(`Delete failed: ${delErr.message}`);
        }
      }
    } catch (err) {
      console.error("Delete error:", err);
    }
  };

  // 3.5 TOGGLE STATUS Logic
  const handleToggleStatus = async (uid, currentStatus) => {
    const newStatus = currentStatus === "active" ? "inactive" : "active";
    const action = newStatus === "active" ? "activate" : "deactivate";

    if (!window.confirm(`Are you sure you want to ${action} this faculty member?`)) return;

    try {
      const { error } = await supabase
        .from('users')
        .update({ status: newStatus })
        .eq('id', uid);

      if (!error) {
        setFacultyList(prev => prev.map(f => f.id === uid ? { ...f, status: newStatus } : f));
      } else {
        alert(`Update failed: ${error.message}`);
      }
    } catch (err) {
      console.error("Update error:", err);
      alert("Error updating user status.");
    }
  };

  // UI Helper: Prepare for Edit
  const openEditModal = (faculty) => {
    setEditingFaculty(faculty);
    setFormData({
      schoolId: faculty.schoolId || "",
      name: faculty.fullName || "",
      email: faculty.email || "",
      password: "", // Keep empty for security
      department: faculty.department || ""
    });
    setShowModal(true);
  };

  // Filtering Logic
  const filteredFaculty = facultyList.filter(f =>
    ((f.fullName || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
      (f.schoolId || "").toLowerCase().includes(searchQuery.toLowerCase())) &&
    (f.status || "active").toLowerCase() !== "pending"
  );

  return (
    <AdminLayout title="Faculty Management">
      <section className="ad-content">
        <div className="ad-welcomeHeader" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <h2 className="ad-title">Faculty Management</h2>
            <p className="ad-subtitle">Manage all faculty members in the system</p>
          </div>
          <button className="ad-btnPrimary" onClick={() => {
            setEditingFaculty(null);
            setFormData(initialForm);
            setShowModal(true);
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Add New Faculty
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

            {(filterDept || searchQuery) && (
              <button className="ad-filterClear" onClick={() => { setFilterDept(""); setSearchQuery(""); }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                Clear
              </button>
            )}

            <span className="ad-filterCount">
              Showing <strong>{filteredFaculty.filter(f => !filterDept || f.department === filterDept).length}</strong> of <strong>{filteredFaculty.length}</strong> faculty
            </span>
          </div>

          {/* TABLE */}
          <div className="ad-tableWrap ad-tableWrap--bordered">
            <table className="ad-table ad-table--plain">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>School ID</th>
                  <th>Program</th>
                  <th>Email</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredFaculty.filter(f => !filterDept || f.department === filterDept).length > 0 ? (
                  filteredFaculty
                    .filter(f => !filterDept || f.department === filterDept)
                    .map((f) => (
                      <tr key={f.id}>
                        <td>
                          <div className="ad-avatarCell">
                            <div className="ad-avatar ad-avatar--blue">
                              {(f.fullName || '??').substring(0, 2).toUpperCase()}
                            </div>
                            <div className="ad-cellLines">
                              <span className="ad-cellPrimary">{f.fullName}</span>
                              <span className="ad-cellSecondary">Faculty Member</span>
                            </div>
                          </div>
                        </td>
                        <td className="ad-code">{f.schoolId}</td>
                        <td>
                          <span style={{ display: 'inline-block', padding: '4px 10px', background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb', borderRadius: '999px', fontSize: '11px', fontWeight: '700', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                            {f.department || "—"}
                          </span>
                        </td>
                        <td>{f.email}</td>
                        <td>
                          <span className={`ad-badge ad-badge--${(f.status || 'active').toLowerCase()}`}>
                            {f.status || 'ACTIVE'}
                          </span>
                        </td>
                        <td className="ad-tableActions" style={{ justifyContent: 'flex-end' }}>
                          <button className="ad-actionBtn ad-actionBtn--edit" title="Edit" onClick={() => openEditModal(f)}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                          </button>
                          <button className="ad-actionBtn ad-actionBtn--edit" title={(!f.status || f.status === "active") ? "Deactivate" : "Activate"} style={{ color: (!f.status || f.status === "active") ? "#f59e0b" : "#22c55e", background: "rgba(245, 158, 11, 0.1)" }} onClick={() => handleToggleStatus(f.id, f.status || 'active')}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                          </button>
                          <button className="ad-actionBtn ad-actionBtn--delete" title="Delete" onClick={() => handleDelete(f.id)}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2-2v2" /></svg>
                          </button>
                        </td>
                      </tr>
                    ))
                ) : (
                  <tr>
                    <td colSpan="6" style={{ textAlign: "center", padding: "48px 20px", color: "#6b7280" }}>
                      <svg style={{ display: 'block', margin: '0 auto 12px auto', color: '#9ca3af' }} width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                        <circle cx="9" cy="7" r="4"></circle>
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                        <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                      </svg>
                      <span style={{ fontSize: '15px', fontWeight: '500', color: '#4b5563' }}>No faculty members found</span>
                      <p style={{ margin: '4px 0 0 0', fontSize: '13px' }}>Try adjusting your search or filters.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* FOOTER COUNT */}
          <div className="ad-filterFooter">
            Showing <strong>{filteredFaculty.filter(f => !filterDept || f.department === filterDept).length}</strong> of <strong>{facultyList.filter(f => (f.status || 'active').toLowerCase() !== 'pending').length}</strong> faculty members
          </div>
        </div>
      </section>

      {/* MODAL SECTION */}
      {showModal && (
        <div className="ad-modal">
          <div className="ad-modalOverlay" onClick={() => !loading && setShowModal(false)} />
          <div className="ad-modalContent ad-modalContent--large">
            <div className="ad-modalHeader">
              <h3 className="ad-modalTitle">{editingFaculty ? "Edit Faculty Profile" : "Register New Faculty"}</h3>
              <button className="ad-modalClose" onClick={() => setShowModal(false)}>×</button>
            </div>
            <form onSubmit={handleSave}>
              <div className="ad-modalBody">
                <div className="ad-formRow">
                  <div className="ad-formGroup">
                    <label className="ad-label">School ID</label>
                    <input
                      type="text" required className="ad-input"
                      value={formData.schoolId}
                      onChange={(e) => setFormData({ ...formData, schoolId: e.target.value })}
                    />
                  </div>
                  <div className="ad-formGroup">
                    <label className="ad-label">Full Name</label>
                    <input
                      type="text" required className="ad-input"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    />
                  </div>
                </div>

                <div className="ad-formRow">
                  <div className="ad-formGroup">
                    <label className="ad-label">Email / Username</label>
                    <input
                      type="email" required className="ad-input"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    />
                  </div>
                  <div className="ad-formGroup">
                    <label className="ad-label">Program</label>
                    <select
                      className="ad-input"
                      value={formData.department}
                      onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                      required
                    >
                      <option value="">Select Program</option>
                      {departmentOptions.map((dept) => (
                        <option key={dept.id} value={dept.name}>{dept.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="ad-formRow">
                  {!editingFaculty ? (
                    <div className="ad-formGroup">
                      <label className="ad-label">Temporary Password</label>
                      <input
                        type="password" required className="ad-input"
                        value={formData.password}
                        onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      />
                    </div>
                  ) : (
                    <div className="ad-formGroup">
                      <div className="ad-formNote" style={{ marginTop: '30px' }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
                        <span>To change password, use the Account Security tab.</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className="ad-modalFooter">
                <button type="button" className="ad-btnSecondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="ad-btnPrimary" disabled={loading}>
                  {loading ? "Processing..." : (editingFaculty ? "Update Faculty" : "Save Faculty")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
