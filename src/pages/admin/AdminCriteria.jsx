import { useState, useEffect } from "react";
import AdminLayout from "./AdminLayout";
import { supabase } from "../../config/supabase";

export default function AdminCriteria() {
  const [criteriaList, setCriteriaList] = useState([]);
  const [formData, setFormData] = useState({ criteriaName: "" });
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState({ show: false, message: "", type: "" });

  const showToast = (message, type = "success") => {
    setToast({ show: true, message, type });
    setTimeout(() => setToast({ show: false, message: "", type: "" }), 3000);
  };

  const fetchCriteria = async () => {
    try {
      const { data, error } = await supabase.from('criteria').select('*');
      if (error) throw error;
      setCriteriaList(data);
    } catch {
      showToast("Failed to load criteria", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCriteria(); }, []);

  const handleSave = async () => {
    if (!formData.criteriaName.trim()) {
      showToast("Please enter a criteria name", "error");
      return;
    }
    try {
      if (editingId) {
        const { error } = await supabase.from('criteria').update({ name: formData.criteriaName }).eq('id', editingId);
        if (error) throw error;
        setCriteriaList(list => list.map(c => c.id === editingId ? { ...c, name: formData.criteriaName } : c));
        showToast("Criteria updated successfully!", "success");
        setEditingId(null);
      } else {
        const { data, error } = await supabase.from('criteria').insert({ name: formData.criteriaName }).select().single();
        if (error) throw error;
        setCriteriaList(list => [...list, data]);
        showToast("Criteria added successfully!", "success");
      }
      setFormData({ criteriaName: "" });
    } catch {
      showToast("Error saving criteria", "error");
    }
  };

  const handleCancel = () => {
    setFormData({ criteriaName: "" });
    setEditingId(null);
  };

  const handleToggle = async (item) => {
    const newEnabled = !item.enabled;
    try {
      const { error } = await supabase.from('criteria').update({ enabled: newEnabled }).eq('id', item.id);
      if (error) throw error;
      setCriteriaList(list => list.map(c => c.id === item.id ? { ...c, enabled: newEnabled } : c));
    } catch {
      showToast("Error updating criteria", "error");
    }
  };

  const handleEdit = (item) => {
    setFormData({ criteriaName: item.name });
    setEditingId(item.id);
    showToast("Criteria loaded for editing", "info");
  };

  const handleDelete = async (id) => {
    if (!confirm("Are you sure you want to delete this criteria?")) return;
    try {
      const { error } = await supabase.from('criteria').delete().eq('id', id);
      if (error) throw error;
      setCriteriaList(list => list.filter(c => c.id !== id));
      showToast("Criteria deleted successfully", "success");
    } catch {
      showToast("Error deleting criteria", "error");
    }
  };


  return (
    <AdminLayout title="Manage Criteria">
      <section className="ad-content">
        <div className="ad-splitLayout">
          {/* LEFT PANEL - FORM */}
          <div className="ad-splitPanel ad-splitPanel--form">
            <div className="ad-panelHeader">
              <h3 className="ad-panelTitle">{editingId ? "Edit" : "Add"} Evaluation Criteria</h3>
            </div>
            <div className="ad-panelBody">
              <div className="ad-formGroup">
                <label className="ad-label">Criteria Name</label>
                <input
                  type="text"
                  className="ad-input"
                  placeholder="Enter criteria name"
                  value={formData.criteriaName}
                  onChange={(e) => setFormData({ criteriaName: e.target.value })}
                />
              </div>
              <div className="ad-formActions">
                <button className="ad-btnPrimary" onClick={handleSave}>
                  {editingId ? "Update" : "Save"}
                </button>
                <button className="ad-btnSecondary" onClick={handleCancel}>
                  {editingId ? "Cancel" : "Reset"}
                </button>
              </div>
            </div>
          </div>

          {/* RIGHT PANEL - LIST */}
          <div className="ad-splitPanel ad-splitPanel--list">
            <div className="ad-panelHeader">
              <h3 className="ad-panelTitle">Criteria List ({criteriaList.length})</h3>
            </div>
            <div className="ad-panelBody">
              {loading ? (
                <div className="ad-emptyState"><p className="ad-emptyText">Loading...</p></div>
              ) : criteriaList.length === 0 ? (
                <div className="ad-emptyState">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 11l3 3L22 4" />
                    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                  </svg>
                  <p className="ad-emptyText">No criteria added yet</p>
                  <p className="ad-emptySubtext">Start by adding your first evaluation criteria</p>
                </div>
              ) : (
                <div className="ad-criteriaList">
                  {criteriaList.map((item) => (
                    <div key={item.id} className={`ad-criteriaItem ${editingId === item.id ? "ad-criteriaItem--editing" : ""}`}>
                      <label className="ad-criteriaCheckbox">
                        <input
                          type="checkbox"
                          checked={item.enabled || false}
                          onChange={() => handleToggle(item)}
                        />
                        <span className="ad-criteriaName">{item.name}</span>
                      </label>
                      <div className="ad-criteriaActions">
                        <button className="ad-iconBtn ad-iconBtn--edit" title="Edit" onClick={() => handleEdit(item)}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </button>
                        <button className="ad-iconBtn ad-iconBtn--delete" title="Delete" onClick={() => handleDelete(item.id)}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            <line x1="10" y1="11" x2="10" y2="17" />
                            <line x1="14" y1="11" x2="14" y2="17" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

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
