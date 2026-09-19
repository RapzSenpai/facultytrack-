import { useState, useEffect, useCallback } from "react";
import AdminLayout from "./AdminLayout";
import { supabase } from "../../config/supabase";

export default function AdminSubject() {
  const [searchQuery, setSearchQuery] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingSubject, setEditingSubject] = useState(null);
  const [subjectList, setSubjectList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({ code: "", description: "" });

  const fetchSubjects = useCallback(async () => {
    try {
      const { data, error } = await supabase.from("subjects").select("*");
      if (error) throw error;
      if (data) setSubjectList(data);
    } catch (err) {
      console.error("Fetch error:", err);
    }
  }, []);

  useEffect(() => {
    fetchSubjects();
  }, [fetchSubjects]);

  const handleSave = async () => {
    if (!formData.code || !formData.description) return alert("Please fill all fields");

    setLoading(true);
    const isEditing = !!editingSubject;

    try {
      if (isEditing) {
        const { error } = await supabase.from("subjects").update(formData).eq("id", editingSubject.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("subjects").insert(formData);
        if (error) throw error;
      }
      setShowModal(false);
      setFormData({ code: "", description: "" });
      fetchSubjects();
    } catch (err) {
      console.error("Save error:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Are you sure you want to delete this subject?")) return;
    try {
      const { error } = await supabase.from("subjects").delete().eq("id", id);
      if (error) throw error;
      fetchSubjects();
    } catch (err) {
      console.error("Delete error:", err);
    }
  };

  const filteredSubjects = subjectList.filter(s =>
    (s.code || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
    (s.description || "").toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <AdminLayout title="Manage Subject">
      <section className="ad-content">
        <div className="ad-welcomeHeader">
          <div>
            <h2 className="ad-title">Subject Management</h2>
            <p className="ad-subtitle">Manage all subjects in the system</p>
          </div>
          <button className="ad-btnPrimary" onClick={() => {
            setEditingSubject(null);
            setFormData({ code: "", description: "" });
            setShowModal(true);
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Add New Subject
          </button>
        </div>

        <div className="ad-tableCard ad-tableCard--padded">
          <div className="ad-filterBar ad-filterBar--end">
            <div className="ad-searchWrap">
              <svg className="ad-searchIcon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
              <input
                type="text"
                className="ad-searchInput"
                placeholder="Search subjects..."
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
              Showing <strong>{filteredSubjects.length}</strong> of <strong>{subjectList.length}</strong> subjects
            </span>
          </div>

          <div className="ad-tableWrap ad-tableWrap--bordered">
            <table className="ad-table ad-table--plain">
              <thead>
                <tr>
                  <th style={{ width: '60px' }}>No.</th>
                  <th>Subject</th>
                  <th>Description</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredSubjects.length > 0 ? (
                  filteredSubjects.map((subject, index) => (
                    <tr key={subject.id || index}>
                      <td>
                        <span className="ad-tableRowIndex">{index + 1}</span>
                      </td>
                      <td>
                        <div className="ad-avatarCell">
                          <div className="ad-avatar ad-avatar--blue">
                            {(subject.code || '??').substring(0, 2).toUpperCase()}
                          </div>
                          <div className="ad-cellLines">
                            <span className="ad-cellPrimary">{subject.code}</span>
                            <span className="ad-cellSecondary">Subject</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="ad-badge ad-badge--neutral">
                          {subject.description || "—"}
                        </span>
                      </td>
                      <td className="ad-tableActions" style={{ justifyContent: 'flex-end' }}>
                        <button
                          className="ad-actionBtn ad-actionBtn--edit"
                          title="Edit"
                          onClick={() => {
                            setEditingSubject(subject);
                            setFormData({ code: subject.code, description: subject.description });
                            setShowModal(true);
                          }}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                        </button>
                        <button
                          className="ad-actionBtn ad-actionBtn--delete"
                          title="Delete"
                          onClick={() => handleDelete(subject.id)}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2-2v2" /></svg>
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="2" className="ad-emptyState">
                      <svg className="ad-emptyStateIcon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                        <circle cx="9" cy="7" r="4"></circle>
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                        <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                      </svg>
                      <span className="ad-emptyStateTitle">No subjects found</span>
                      <p className="ad-emptyStateSubtitle">Try adjusting your search or add a new one.</p>
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
                {editingSubject ? "Edit Subject" : "Add New Subject"}
              </h3>
              <button className="ad-modalClose" onClick={() => setShowModal(false)}>×</button>
            </div>
            <div className="ad-modalBody">
              <div className="ad-formGroup">
                <label className="ad-label">Subject Code</label>
                <input
                  type="text"
                  className="ad-input"
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                />
              </div>
              <div className="ad-formGroup">
                <label className="ad-label">Subject Description</label>
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
                {loading ? "Processing..." : (editingSubject ? "Update" : "Save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}