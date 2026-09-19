import { useState, useEffect } from "react";
import AdminLayout from "./AdminLayout";
import { supabase } from "../../config/supabase";

export default function AdminAcademicYear() {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterSemester, setFilterSemester] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingAY, setEditingAY] = useState(null);

  // Real Data State
  const [academicYearList, setAcademicYearList] = useState([]);

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
    try {
      const { data, error } = await supabase.from('academic_years').select('*');
      if (error) throw error;
      setAcademicYearList(data);
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
  }, []); // Empty dependency array ensures this only runs once

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
        status: ay.status || "on-going",
      });
    } else {
      setEditingAY(null);
      setFormData({ year: "", semester: "", start_date: "", end_date: "", status: "on-going" });
    }
    setShowModal(true);
  };

  // 4. Save/Update Handler
  const handleSave = async () => {
    const isEditing = !!editingAY;

    try {
      let result;
      if (isEditing) {
        result = await supabase.from('academic_years').update(formData).eq('id', editingAY.id);
      } else {
        result = await supabase.from('academic_years').insert(formData).select().single();
      }

      if (!result.error) {
        setShowModal(false);
        await fetchAY(); // Refresh table
      }
    } catch (err) {
      console.error("Save error:", err);
    }
  };

  // 5. Delete Handler
  const handleDelete = async (id) => {
    if (window.confirm("Delete this academic year record?")) {
      try {
        const { error } = await supabase.from('academic_years').delete().eq('id', id);
        if (!error) await fetchAY();
      } catch (err) {
        console.error("Delete error:", err);
      }
    }
  };

  const filteredAcademicYears = academicYearList.filter(
    (ay) =>
      ay.year?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ay.semester?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const displayedAY = filteredAcademicYears
    .filter(ay => !filterStatus || (ay.status || "").toLowerCase().trim() === filterStatus)
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
                      <td>
                        <span className={`ad-badge ad-badge--${(ay.status || "").toLowerCase().trim() === "on-going" ? "active" : "inactive"}`}>
                          {(ay.status || "").toLowerCase().trim() === "on-going" ? "On-going" : "Closed"}
                        </span>
                      </td>
                      <td className="ad-tableActions" style={{ justifyContent: 'flex-end' }}>
                        <button className="ad-actionBtn ad-actionBtn--edit" title="Edit" onClick={() => handleOpenModal(ay)}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                        </button>
                        <button className="ad-actionBtn ad-actionBtn--delete" title="Delete" onClick={() => handleDelete(ay.id)}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2-2v2" /></svg>
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="6" style={{ textAlign: "center", padding: "48px 20px", color: "#6b7280" }}>
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
                <label className="ad-label">Status</label>
                <select className="ad-input" value={formData.status} onChange={(e) => setFormData({ ...formData, status: e.target.value })}>
                  <option value="on-going">On-going (Open)</option>
                  <option value="closed">Closed</option>
                </select>
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
    </AdminLayout>
  );
}
