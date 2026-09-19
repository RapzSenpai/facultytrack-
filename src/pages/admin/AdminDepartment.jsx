import { useState, useEffect, useCallback } from "react";
import AdminLayout from "./AdminLayout";
import { supabase } from "../../config/supabase";

export default function AdminDepartment() {
  const [searchQuery, setSearchQuery] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingDepartment, setEditingDepartment] = useState(null);
  const [departmentList, setDepartmentList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({ name: "", description: "" });

  const fetchDepartments = useCallback(async () => {
    try {
      const { data, error } = await supabase.from("departments").select("*");
      if (error) throw error;
      if (data && data.length > 0) {
        setDepartmentList(data);
      } else {
        setDepartmentList([
          { id: "1", name: "BSIT", description: "BACHELOR OF SCIENCE IN INFORMATION TECHNOLOGY" },
          { id: "2", name: "BSEntrep", description: "BACHELOR OF SCIENCE IN ENTREPRENEURSHIP" },
          { id: "3", name: "BPED", description: "BACHELOR OF SCIENCE PHYSICAL EDUCATION" },
          { id: "4", name: "BSHM", description: "BACHELOR OF SCIENCE IN HOSPITALITY MANAGEMENT" },
          { id: "5", name: "BSED", description: "BACHELOR OF SECONDARY EDUCATION" },
          { id: "6", name: "BEED", description: "BACHELOR OF ELEMENTARY EDUCATION" }
        ]);
      }
    } catch (err) {
      console.error("Dept Fetch error:", err);
    }
  }, []);

  useEffect(() => {
    fetchDepartments();
  }, [fetchDepartments]);

  const handleSave = async () => {
    if (!formData.name || !formData.description) return alert("Please fill all fields");

    setLoading(true);
    const isEditing = !!editingDepartment;

    try {
      if (isEditing) {
        const { error } = await supabase.from("departments").update(formData).eq("id", editingDepartment.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("departments").insert(formData);
        if (error) throw error;
      }
      setShowModal(false);
      setFormData({ name: "", description: "" });
      fetchDepartments();
    } catch (err) {
      console.error("Save error:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this program?")) return;
    try {
      const { error } = await supabase.from("departments").delete().eq("id", id);
      if (error) throw error;
      fetchDepartments();
    } catch (err) {
      console.error("Delete error:", err);
    }
  };

  const filteredDepartments = departmentList.filter(dept =>
    (dept.name || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
    (dept.description || "").toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <AdminLayout title="Program">
      <section className="ad-content">
        <div className="ad-welcomeHeader" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <h2 className="ad-title">Program Management</h2>
            <p className="ad-subtitle">Manage all programs in the system.</p>
          </div>
          <button className="ad-btnPrimary" onClick={() => {
            setEditingDepartment(null);
            setFormData({ name: "", description: "" });
            setShowModal(true);
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Add New Program
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
                placeholder="Search programs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            {searchQuery && (
              <button className="ad-filterClear" onClick={() => { setSearchQuery(""); }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                Clear
              </button>
            )}

            <span className="ad-filterCount ad-filterBar--end">
              Showing <strong>{filteredDepartments.length}</strong> of <strong>{departmentList.length}</strong> programs
            </span>
          </div>

          {/* TABLE */}
          <div className="ad-tableWrap ad-tableWrap--bordered">
            <table className="ad-table ad-table--plain">
              <thead>
                <tr>
                  <th style={{ width: '60px' }}>No.</th>
                  <th>Program Code</th>
                  <th>Description</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredDepartments.length > 0 ? (
                  filteredDepartments.map((dept, index) => (
                    <tr key={dept.id || index}>
                      <td>
                        <span className="ad-tableRowIndex">{index + 1}</span>
                      </td>
                      <td>
                        <div className="ad-avatarCell">
                          <div className="ad-avatar ad-avatar--blue">
                            {(dept.name || '??').substring(0, 2).toUpperCase()}
                          </div>
                          <div className="ad-cellLines">
                            <span className="ad-cellPrimary">{dept.name}</span>
                            <span className="ad-cellSecondary">Program</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="ad-badge ad-badge--neutral">
                          {dept.description || "—"}
                        </span>
                      </td>
                      <td className="ad-tableActions" style={{ justifyContent: 'flex-end' }}>
                        <button
                          className="ad-actionBtn ad-actionBtn--edit"
                          title="Edit"
                          onClick={() => {
                            setEditingDepartment(dept);
                            setFormData({ name: dept.name, description: dept.description });
                            setShowModal(true);
                          }}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                        </button>
                        <button
                          className="ad-actionBtn ad-actionBtn--delete"
                          title="Delete"
                          onClick={() => handleDelete(dept.id)}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2-2v2" /></svg>
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="4" style={{ textAlign: "center", padding: "40px 20px", color: "#6b7280" }}>
                      <svg style={{ display: 'block', margin: '0 auto 12px auto', color: '#9ca3af' }} width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                        <circle cx="9" cy="7" r="4"></circle>
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                        <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                      </svg>
                      <span style={{ fontSize: '15px', fontWeight: '500', color: '#4b5563' }}>No programs found</span>
                      <p style={{ margin: '4px 0 0 0', fontSize: '13px' }}>Try adjusting your search or add a new one.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {showModal && (
        <div className="ad-modal">
          <div className="ad-modalOverlay" onClick={() => setShowModal(false)} />
          <div className="ad-modalContent">
            <div className="ad-modalHeader">
              <h3 className="ad-modalTitle">
                {editingDepartment ? "Edit Program" : "Add New Program"}
              </h3>
              <button className="ad-modalClose" onClick={() => setShowModal(false)}>×</button>
            </div>
            <div className="ad-modalBody">
              <div className="ad-formGroup">
                <label className="ad-label">Program Name (Code)</label>
                <input
                  type="text"
                  className="ad-input"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>
              <div className="ad-formGroup">
                <label className="ad-label">Description</label>
                <input
                  type="text"
                  className="ad-input"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                />
              </div>
            </div>
            <div className="ad-modalFooter">
              <button className="ad-btnSecondary" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="ad-btnPrimary" onClick={handleSave} disabled={loading}>
                {loading ? "Saving..." : (editingDepartment ? "Update" : "Save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}