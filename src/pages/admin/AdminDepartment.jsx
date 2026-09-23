import { useState, useEffect, useCallback, useMemo } from "react";
import AdminLayout from "./AdminLayout";
import { supabase } from "../../config/supabase";
import {
  GraduationCap,
  BookOpen,
  Users,
  Search,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Plus,
  Check,
  X,
  Clock,
  Layers,
  FileText,
  AlertCircle,
} from "lucide-react";

const STANDARD_YEARS = ["1st", "2nd", "3rd", "4th"];
const SEMESTERS = ["1st Semester", "2nd Semester", "Summer / Elective"];

export default function AdminDepartment() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Core Data
  const [departments, setDepartments] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [sections, setSections] = useState([]);
  const [studentCounts, setStudentCounts] = useState(new Map());

  // Navigation State: null = Programs List, object = Drill-down into a Program
  const [selectedProgram, setSelectedProgram] = useState(null);

  // Schema migration detector
  const [migrationNeeded, setMigrationNeeded] = useState(false);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState("");

  // Accordion open state for Year Levels: Map of yearLevel -> boolean
  const [openYears, setOpenYears] = useState({
    "1st": true,
    "2nd": false,
    "3rd": false,
    "4th": false,
  });

  // Active subtab for each Year Level: Map of yearLevel -> "subjects" | "sections"
  const [yearTabs, setYearTabs] = useState({
    "1st": "subjects",
    "2nd": "subjects",
    "3rd": "subjects",
    "4th": "subjects",
  });

  // Modal States
  const [showProgramModal, setShowProgramModal] = useState(false);
  const [editingProgram, setEditingProgram] = useState(null);
  const [programForm, setProgramForm] = useState({ name: "", description: "" });

  const [showSubjectModal, setShowSubjectModal] = useState(false);
  const [editingSubject, setEditingSubject] = useState(null);
  const [targetYearForSubject, setTargetYearForSubject] = useState("1st");
  const [subjectForm, setSubjectForm] = useState({
    code: "",
    description: "",
    semester: "1st Semester",
    units: 3,
  });

  const [showSectionModal, setShowSectionModal] = useState(false);
  const [editingSection, setEditingSection] = useState(null);
  const [targetYearForSection, setTargetYearForSection] = useState("1st");
  const [sectionForm, setSectionForm] = useState({ name: "" });

  const [showCustomYearModal, setShowCustomYearModal] = useState(false);
  const [customYearName, setCustomYearName] = useState("");

  // Normalizer helper
  const normYear = (y) => {
    if (!y) return "";
    const str = String(y).toLowerCase().replace(/[^a-z0-9]/g, "");
    if (str.includes("1") || str.includes("first")) return "1st";
    if (str.includes("2") || str.includes("second")) return "2nd";
    if (str.includes("3") || str.includes("third")) return "3rd";
    if (str.includes("4") || str.includes("fourth")) return "4th";
    if (str.includes("5") || str.includes("fifth")) return "5th";
    return y;
  };

  // 1. Fetch All Data
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [deptRes, subRes, secRes, userRes] = await Promise.all([
        supabase.from("departments").select("*").order("name"),
        supabase.from("subjects").select("*").order("code"),
        supabase.from("sections").select("*").order("name"),
        supabase.from("users").select("department, year_level, section").eq("role", "student"),
      ]);

      const depts = deptRes.data || [];
      const subs = subRes.data || [];
      const secs = secRes.data || [];
      const users = userRes.data || [];

      // Check if sections table exists or migration 014 is needed
      if (secRes.error) {
        const errMsg = secRes.error.message || "";
        if (errMsg.includes("schema cache") || secRes.error.code === "PGRST204" || secRes.error.code === "42P01") {
          setMigrationNeeded(true);
        }
      } else {
        setMigrationNeeded(false);
      }

      setDepartments(depts);
      setSubjects(subs);
      setSections(secs);

      // Build student count map: dept__year__section -> count
      const counts = new Map();
      users.forEach((u) => {
        if (u.department && u.year_level && u.section) {
          const key = `${u.department.trim().toLowerCase()}__${normYear(u.year_level)}__${u.section.trim().toLowerCase()}`;
          counts.set(key, (counts.get(key) || 0) + 1);
        }
      });
      setStudentCounts(counts);

      // Update selected program reference if currently drilling down
      if (selectedProgram) {
        const refreshed = depts.find((d) => d.id === selectedProgram.id);
        if (refreshed) setSelectedProgram(refreshed);
      }
    } catch (err) {
      console.error("Error loading curriculum data:", err);
    } finally {
      setLoading(false);
    }
  }, [selectedProgram]);

  useEffect(() => {
    loadData();
  }, []); // Run on initial mount

  // 2. Program CRUD
  const handleSaveProgram = async (e) => {
    e.preventDefault();
    if (!programForm.name.trim() || !programForm.description.trim()) {
      alert("Please provide both Program Code and Description.");
      return;
    }

    setSaving(true);
    try {
      if (editingProgram) {
        const { error } = await supabase
          .from("departments")
          .update({
            name: programForm.name.trim().toUpperCase(),
            description: programForm.description.trim(),
          })
          .eq("id", editingProgram.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("departments").insert({
          name: programForm.name.trim().toUpperCase(),
          description: programForm.description.trim(),
        });
        if (error) throw error;
      }

      setShowProgramModal(false);
      setEditingProgram(null);
      setProgramForm({ name: "", description: "" });
      await loadData();
    } catch (err) {
      console.error("Failed to save program:", err);
      alert(`Save failed: ${err.message || "Unknown error"}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteProgram = async (dept) => {
    if (
      !window.confirm(
        `Are you sure you want to delete ${dept.name}? This will also delete all associated sections and subjects.`,
      )
    )
      return;

    try {
      const { error } = await supabase.from("departments").delete().eq("id", dept.id);
      if (error) throw error;
      if (selectedProgram?.id === dept.id) setSelectedProgram(null);
      await loadData();
    } catch (err) {
      console.error("Failed to delete program:", err);
      alert(`Delete failed: ${err.message}`);
    }
  };

  // 3. Subject CRUD
  const handleOpenAddSubject = (yearLevel) => {
    setEditingSubject(null);
    setTargetYearForSubject(yearLevel);
    setSubjectForm({
      code: "",
      description: "",
      semester: "1st Semester",
      units: 3,
    });
    setShowSubjectModal(true);
  };

  const handleOpenEditSubject = (sub) => {
    setEditingSubject(sub);
    setTargetYearForSubject(normYear(sub.year_level) || "1st");
    setSubjectForm({
      code: sub.code,
      description: sub.description || "",
      semester: sub.semester || "1st Semester",
      units: sub.units || 3,
    });
    setShowSubjectModal(true);
  };

  const handleSaveSubject = async (e) => {
    e.preventDefault();
    if (!subjectForm.code.trim() || !subjectForm.description.trim()) {
      alert("Please provide both Subject Code and Title/Description.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        code: subjectForm.code.trim().toUpperCase(),
        description: subjectForm.description.trim(),
        department_id: selectedProgram.id,
        department: selectedProgram.name,
        year_level: targetYearForSubject,
        semester: subjectForm.semester,
        units: Number(subjectForm.units) || 3,
      };

      if (editingSubject) {
        const { error } = await supabase.from("subjects").update(payload).eq("id", editingSubject.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("subjects").insert(payload);
        if (error) throw error;
      }

      setShowSubjectModal(false);
      await loadData();
    } catch (err) {
      console.error("Failed to save subject:", err);
      const isSchemaError = err?.message?.includes("schema cache") || err?.message?.includes("column");
      if (isSchemaError) {
        setMigrationNeeded(true);
        alert(
          "DATABASE SETUP REQUIRED:\n\n" +
          "The 'department' column is missing from the 'subjects' table in your Supabase database.\n\n" +
          "To fix this:\n" +
          "1. Open your Supabase Dashboard -> SQL Editor\n" +
          "2. Paste the contents of 'supabase/migrations/014_unified_curriculum_and_sections.sql'\n" +
          "3. Click RUN, then refresh this page."
        );
      } else {
        alert(`Save failed: ${err.message || "Unknown error"}`);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSubject = async (sub) => {
    if (!window.confirm(`Delete subject ${sub.code} - ${sub.description}?`)) return;
    try {
      const { error } = await supabase.from("subjects").delete().eq("id", sub.id);
      if (error) throw error;
      await loadData();
    } catch (err) {
      console.error("Failed to delete subject:", err);
      alert(`Delete failed: ${err.message}`);
    }
  };

  // 4. Section CRUD
  const handleOpenAddSection = (yearLevel) => {
    setEditingSection(null);
    setTargetYearForSection(yearLevel);
    setSectionForm({ name: "" });
    setShowSectionModal(true);
  };

  const handleOpenEditSection = (sec) => {
    setEditingSection(sec);
    setTargetYearForSection(normYear(sec.year_level) || "1st");
    setSectionForm({ name: sec.name });
    setShowSectionModal(true);
  };

  const handleSaveSection = async (e) => {
    e.preventDefault();
    if (!sectionForm.name.trim()) {
      alert("Please provide a Section Name (e.g. A, B, 1-A).");
      return;
    }

    setSaving(true);
    try {
      const formattedName = sectionForm.name.trim().toUpperCase();
      const payload = {
        department_id: selectedProgram.id,
        department: selectedProgram.name,
        year_level: targetYearForSection,
        name: formattedName,
      };

      if (editingSection) {
        const { error } = await supabase.from("sections").update(payload).eq("id", editingSection.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("sections").insert(payload);
        if (error) throw error;
      }

      setShowSectionModal(false);
      await loadData();
    } catch (err) {
      console.error("Failed to save section:", err);
      const isSchemaError = err?.message?.includes("schema cache") || err?.message?.includes("table");
      if (isSchemaError) {
        setMigrationNeeded(true);
        alert(
          "DATABASE SETUP REQUIRED:\n\n" +
          "The 'sections' table is missing from your Supabase database.\n\n" +
          "To fix this:\n" +
          "1. Open your Supabase Dashboard -> SQL Editor\n" +
          "2. Paste the contents of 'supabase/migrations/014_unified_curriculum_and_sections.sql'\n" +
          "3. Click RUN, then refresh this page."
        );
      } else {
        alert(`Save failed: ${err.message || "Could not save section. Ensure it does not already exist."}`);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSection = async (sec) => {
    if (!window.confirm(`Delete Section ${sec.name} from ${selectedProgram.name} ${sec.year_level} Year?`))
      return;
    try {
      const { error } = await supabase.from("sections").delete().eq("id", sec.id);
      if (error) throw error;
      await loadData();
    } catch (err) {
      console.error("Failed to delete section:", err);
      alert(`Delete failed: ${err.message}`);
    }
  };

  // 5. Custom Year Level Addition
  const handleAddCustomYear = () => {
    if (!customYearName.trim()) return;
    const clean = customYearName.trim();
    setOpenYears((prev) => ({ ...prev, [clean]: true }));
    setYearTabs((prev) => ({ ...prev, [clean]: "subjects" }));
    setShowCustomYearModal(false);
    setCustomYearName("");
  };

  // Toggle year accordion
  const toggleYear = (yl) => {
    setOpenYears((prev) => ({ ...prev, [yl]: !prev[yl] }));
  };

  // Toggle year subtab
  const setTabForYear = (yl, tab) => {
    setYearTabs((prev) => ({ ...prev, [yl]: tab }));
  };

  // Computed data for the currently selected program
  const currentProgramSubjects = useMemo(() => {
    if (!selectedProgram) return [];
    return subjects.filter(
      (s) =>
        s.department === selectedProgram.name ||
        s.department_id === selectedProgram.id ||
        (s.department || "").toLowerCase() === selectedProgram.name.toLowerCase(),
    );
  }, [selectedProgram, subjects]);

  const currentProgramSections = useMemo(() => {
    if (!selectedProgram) return [];
    return sections.filter(
      (sec) =>
        sec.department === selectedProgram.name ||
        sec.department_id === selectedProgram.id ||
        (sec.department || "").toLowerCase() === selectedProgram.name.toLowerCase(),
    );
  }, [selectedProgram, sections]);

  // Combined year levels for currently selected program (standard + any custom configured)
  const activeYearLevels = useMemo(() => {
    const set = new Set(STANDARD_YEARS);
    currentProgramSubjects.forEach((s) => {
      if (s.year_level) set.add(normYear(s.year_level));
    });
    currentProgramSections.forEach((sec) => {
      if (sec.year_level) set.add(normYear(sec.year_level));
    });
    Object.keys(openYears).forEach((yl) => set.add(yl));
    return Array.from(set).sort();
  }, [currentProgramSubjects, currentProgramSections, openYears]);

  // Filtered Programs list for main overview
  const filteredDepartments = useMemo(() => {
    if (!searchQuery.trim()) return departments;
    const q = searchQuery.toLowerCase();
    return departments.filter(
      (d) =>
        (d.name || "").toLowerCase().includes(q) ||
        (d.description || "").toLowerCase().includes(q),
    );
  }, [departments, searchQuery]);

  return (
    <AdminLayout title={selectedProgram ? `${selectedProgram.name} Curriculum` : "Programs & Curriculum"}>
      <section className="ad-content">
        {/* Migration Alert Banner if tables/columns are missing */}
        {migrationNeeded && (
          <div
            style={{
              background: "#fffbeb",
              border: "1px solid #fef3c7",
              borderLeft: "5px solid #f59e0b",
              padding: "16px 20px",
              borderRadius: "10px",
              marginBottom: "20px",
              boxShadow: "0 2px 8px rgba(245, 158, 11, 0.08)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                fontWeight: "600",
                fontSize: "15px",
                color: "#92400e",
              }}
            >
              <AlertCircle size={20} color="#d97706" />
              <span>Supabase Database Migration Required (014)</span>
            </div>
            <p style={{ margin: "6px 0 10px 0", fontSize: "13.5px", lineHeight: "1.5", color: "#78350f" }}>
              The <code>sections</code> table and curriculum columns have not been created yet in your Supabase project. To enable class sections and curriculum subjects:
            </p>
            <ol style={{ margin: "0 0 0 18px", padding: 0, fontSize: "13px", lineHeight: "1.6", color: "#78350f" }}>
              <li>Open your <strong>Supabase Dashboard</strong> ➔ Click <strong>SQL Editor</strong>.</li>
              <li>Open the migration file <code>supabase/migrations/014_unified_curriculum_and_sections.sql</code>.</li>
              <li>Paste the SQL script into the editor and click <strong>Run</strong>.</li>
            </ol>
          </div>
        )}

        {/* ========================================================================= */}
        {/* VIEW 1: PROGRAMS OVERVIEW LIST                                            */}
        {/* ========================================================================= */}
        {!selectedProgram && (
          <>
            <div className="ad-welcomeHeader" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
              <div>
                <h2 className="ad-title" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <GraduationCap size={26} color="#1e3a5f" />
                  Programs & Curriculum Management
                </h2>
                <p className="ad-subtitle">
                  Configure academic programs, curriculum prospectus subjects, and dynamic student sections.
                </p>
              </div>
              <button
                type="button"
                className="ad-btnPrimary"
                onClick={() => {
                  setEditingProgram(null);
                  setProgramForm({ name: "", description: "" });
                  setShowProgramModal(true);
                }}
              >
                <Plus size={18} style={{ marginRight: 6 }} />
                Add New Program
              </button>
            </div>

            {/* Filter / Search Bar */}
            <div className="ad-tableCard ad-tableCard--padded" style={{ marginBottom: "20px" }}>
              <div className="ad-filterBar">
                <div className="ad-searchWrap">
                  <Search size={16} className="ad-searchIcon" />
                  <input
                    type="text"
                    className="ad-searchInput"
                    placeholder="Search programs by code or title..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
                {searchQuery && (
                  <button className="ad-filterClear" onClick={() => setSearchQuery("")}>
                    <X size={14} style={{ marginRight: 4 }} />
                    Clear
                  </button>
                )}
                <span className="ad-filterCount ad-filterBar--end">
                  Showing <strong>{filteredDepartments.length}</strong> of <strong>{departments.length}</strong> programs
                </span>
              </div>
            </div>

            {/* Programs Cards Grid */}
            {loading ? (
              <div className="ad-tableCard" style={{ padding: "60px 20px", textAlign: "center", color: "#64748b" }}>
                <Layers size={36} style={{ margin: "0 auto 12px", opacity: 0.5 }} />
                <p style={{ fontWeight: 600, fontSize: "15px", margin: 0 }}>Loading academic programs...</p>
              </div>
            ) : filteredDepartments.length === 0 ? (
              <div className="ad-tableCard" style={{ padding: "60px 20px", textAlign: "center", color: "#64748b" }}>
                <GraduationCap size={42} style={{ margin: "0 auto 12px", opacity: 0.4 }} />
                <h3 style={{ fontSize: "16px", fontWeight: 700, color: "#1e293b", margin: 0 }}>No programs found</h3>
                <p style={{ fontSize: "13.5px", margin: "6px 0 16px 0" }}>Try adjusting your search query or add a new program.</p>
                <button
                  type="button"
                  className="ad-btnPrimary"
                  onClick={() => {
                    setEditingProgram(null);
                    setProgramForm({ name: "", description: "" });
                    setShowProgramModal(true);
                  }}
                >
                  <Plus size={16} style={{ marginRight: 6 }} /> Add Program
                </button>
              </div>
            ) : (
              <div className="ad-curr-grid">
                {filteredDepartments.map((dept) => {
                  const deptSubs = subjects.filter(
                    (s) =>
                      s.department === dept.name ||
                      s.department_id === dept.id ||
                      (s.department || "").toLowerCase() === dept.name.toLowerCase(),
                  );
                  const deptSecs = sections.filter(
                    (sec) =>
                      sec.department === dept.name ||
                      sec.department_id === dept.id ||
                      (sec.department || "").toLowerCase() === dept.name.toLowerCase(),
                  );

                  return (
                    <div className="ad-curr-program-card" key={dept.id}>
                      <div>
                        <div className="ad-curr-program-top">
                          <h3 className="ad-curr-program-code">{dept.name}</h3>
                          <div style={{ display: "flex", gap: "6px" }}>
                            <button
                              type="button"
                              className="ad-actionBtn ad-actionBtn--edit"
                              title="Edit Program Info"
                              onClick={() => {
                                setEditingProgram(dept);
                                setProgramForm({ name: dept.name, description: dept.description });
                                setShowProgramModal(true);
                              }}
                            >
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                            </button>
                            <button
                              type="button"
                              className="ad-actionBtn ad-actionBtn--delete"
                              title="Delete Program"
                              onClick={() => handleDeleteProgram(dept)}
                            >
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2-2v2" /></svg>
                            </button>
                          </div>
                        </div>

                        <p className="ad-curr-program-desc">{dept.description || "No description provided."}</p>

                        {/* Metric Pills */}
                        <div className="ad-curr-stats-row">
                          <span className="ad-curr-stat-pill ad-curr-stat-pill--years">
                            <Layers size={12} /> 4 Year Levels
                          </span>
                          <span className="ad-curr-stat-pill ad-curr-stat-pill--sections">
                            <Users size={12} /> {deptSecs.length} Section{deptSecs.length === 1 ? "" : "s"}
                          </span>
                          <span className="ad-curr-stat-pill ad-curr-stat-pill--subjects">
                            <BookOpen size={12} /> {deptSubs.length} Subject{deptSubs.length === 1 ? "" : "s"}
                          </span>
                        </div>
                      </div>

                      {/* Main Action */}
                      <button
                        type="button"
                        className="ad-curr-btn-manage"
                        onClick={() => setSelectedProgram(dept)}
                      >
                        <Layers size={15} />
                        Manage Curriculum & Sections
                        <ChevronRight size={15} style={{ marginLeft: "auto" }} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* ========================================================================= */}
        {/* VIEW 2: PROGRAM DRILLDOWN (YEAR LEVELS, SUBJECTS & SECTIONS)              */}
        {/* ========================================================================= */}
        {selectedProgram && (
          <>
            {/* Breadcrumbs Navigation */}
            <div className="ad-curr-breadcrumb">
              <button
                type="button"
                className="ad-curr-breadcrumb-link"
                onClick={() => setSelectedProgram(null)}
              >
                <ArrowLeft size={14} /> All Programs
              </button>
              <span className="ad-curr-breadcrumb-sep">/</span>
              <span className="ad-curr-breadcrumb-active">{selectedProgram.name}</span>
              <span className="ad-curr-breadcrumb-sep">/</span>
              <span>Curriculum & Sections</span>
            </div>

            {/* Drilldown Hero Header Card */}
            <div className="ad-curr-drill-header">
              <div className="ad-curr-drill-title-group">
                <h2>{selectedProgram.name} — Curriculum Management</h2>
                <p>{selectedProgram.description}</p>
              </div>

              <div className="ad-curr-drill-stats">
                <div className="ad-curr-drill-stat-box">
                  <div className="ad-curr-drill-stat-val">{activeYearLevels.length}</div>
                  <div className="ad-curr-drill-stat-lbl">Year Levels</div>
                </div>
                <div className="ad-curr-drill-stat-box">
                  <div className="ad-curr-drill-stat-val">{currentProgramSections.length}</div>
                  <div className="ad-curr-drill-stat-lbl">Sections</div>
                </div>
                <div className="ad-curr-drill-stat-box">
                  <div className="ad-curr-drill-stat-val">{currentProgramSubjects.length}</div>
                  <div className="ad-curr-drill-stat-lbl">Subjects</div>
                </div>
                <button
                  type="button"
                  className="ad-btnSecondary"
                  style={{ background: "rgba(255, 255, 255, 0.15)", color: "#fff", borderColor: "rgba(255, 255, 255, 0.3)" }}
                  onClick={() => setShowCustomYearModal(true)}
                >
                  <Plus size={15} style={{ marginRight: 4 }} /> Add Year Level
                </button>
              </div>
            </div>

            {/* Year Level Accordion Cards */}
            {activeYearLevels.map((yl) => {
              const ylSubjects = currentProgramSubjects.filter((s) => normYear(s.year_level) === normYear(yl));
              const ylSections = currentProgramSections.filter((sec) => normYear(sec.year_level) === normYear(yl));
              const isOpen = openYears[yl] ?? true;
              const activeTab = yearTabs[yl] || "subjects";

              return (
                <div className="ad-curr-year-card" key={yl}>
                  {/* Year Header / Accordion Bar */}
                  <div
                    className={`ad-curr-year-header ${isOpen ? "ad-curr-year-header--open" : ""}`}
                    onClick={() => toggleYear(yl)}
                  >
                    <div className="ad-curr-year-left">
                      {isOpen ? <ChevronDown size={18} color="#1e3a5f" /> : <ChevronRight size={18} color="#64748b" />}
                      <h4 className="ad-curr-year-title">{yl} Year Level</h4>
                      <div className="ad-curr-year-badges">
                        <span className="ad-rel-count-pill" style={{ background: "#f8fafc", color: "#475569", borderColor: "#e2e8f0" }}>
                          <BookOpen size={11} style={{ marginRight: 4 }} />
                          {ylSubjects.length} Subject{ylSubjects.length === 1 ? "" : "s"}
                        </span>
                        <span className="ad-rel-count-pill" style={{ background: "#f8fafc", color: "#475569", borderColor: "#e2e8f0" }}>
                          <Users size={11} style={{ marginRight: 4 }} />
                          {ylSections.length} Section{ylSections.length === 1 ? "" : "s"}
                        </span>
                      </div>
                    </div>

                    <div className="ad-curr-year-actions" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="ad-btnView"
                        style={{ padding: "5px 12px", fontSize: "12px", background: "#f1f5f9", color: "#1e293b" }}
                        onClick={() => handleOpenAddSubject(yl)}
                      >
                        <Plus size={13} style={{ marginRight: 4 }} /> Add Subject
                      </button>
                      <button
                        type="button"
                        className="ad-btnView"
                        style={{ padding: "5px 12px", fontSize: "12px", background: "#f1f5f9", color: "#1e293b" }}
                        onClick={() => handleOpenAddSection(yl)}
                      >
                        <Plus size={13} style={{ marginRight: 4 }} /> Add Section
                      </button>
                    </div>
                  </div>

                  {/* Year Content Body (Accordion Collapsible) */}
                  {isOpen && (
                    <div className="ad-curr-body">
                      {/* Subtab Toggle (Subjects vs Sections) */}
                      <div className="ad-curr-subtabs">
                        <button
                          type="button"
                          className={`ad-curr-subtab ${activeTab === "subjects" ? "ad-curr-subtab--active" : ""}`}
                          onClick={() => setTabForYear(yl, "subjects")}
                        >
                          <BookOpen size={14} />
                          Curriculum Subjects ({ylSubjects.length})
                        </button>
                        <button
                          type="button"
                          className={`ad-curr-subtab ${activeTab === "sections" ? "ad-curr-subtab--active" : ""}`}
                          onClick={() => setTabForYear(yl, "sections")}
                        >
                          <Users size={14} />
                          Class Sections ({ylSections.length})
                        </button>
                      </div>

                      {/* ---------------------------------------------------- */}
                      {/* TAB 1: SUBJECTS LIST                                 */}
                      {/* ---------------------------------------------------- */}
                      {activeTab === "subjects" && (
                        <div>
                          {ylSubjects.length === 0 ? (
                            <div style={{ textAlign: "center", padding: "36px 16px", color: "#64748b", background: "#f8fafc", borderRadius: "10px", border: "1.5px dashed #cbd5e1" }}>
                              <BookOpen size={30} style={{ margin: "0 auto 8px", opacity: 0.4 }} />
                              <p style={{ margin: 0, fontWeight: 600, fontSize: "14px" }}>
                                No subjects mapped to {selectedProgram.name} {yl} Year yet.
                              </p>
                              <p style={{ margin: "4px 0 14px 0", fontSize: "12.5px" }}>
                                Add curriculum subjects for this year level to make class assignments seamless.
                              </p>
                              <button
                                type="button"
                                className="ad-btnPrimary"
                                style={{ padding: "6px 14px", fontSize: "12.5px" }}
                                onClick={() => handleOpenAddSubject(yl)}
                              >
                                <Plus size={14} style={{ marginRight: 4 }} /> Add First Subject
                              </button>
                            </div>
                          ) : (
                            SEMESTERS.map((sem) => {
                              const semSubjects = ylSubjects.filter(
                                (s) => (s.semester || "1st Semester").toLowerCase() === sem.toLowerCase(),
                              );
                              if (semSubjects.length === 0) return null;

                              return (
                                <div className="ad-curr-sem-group" key={sem}>
                                  <div className="ad-curr-sem-header">
                                    <span className="ad-curr-sem-title">{sem}</span>
                                    <span style={{ fontSize: "12px", color: "#64748b", fontWeight: 600 }}>
                                      {semSubjects.length} Subject{semSubjects.length === 1 ? "" : "s"} ·{" "}
                                      {semSubjects.reduce((acc, s) => acc + (Number(s.units) || 3), 0)} Units Total
                                    </span>
                                  </div>

                                  <div className="ad-tableWrap ad-tableWrap--bordered">
                                    <table className="ad-table ad-table--plain">
                                      <thead>
                                        <tr>
                                          <th style={{ width: "130px" }}>CODE</th>
                                          <th>DESCRIPTIVE TITLE</th>
                                          <th style={{ width: "90px", textAlign: "center" }}>UNITS</th>
                                          <th style={{ textAlign: "right", width: "110px" }}>ACTIONS</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {semSubjects.map((sub) => (
                                          <tr key={sub.id}>
                                            <td>
                                              <span className="ad-code" style={{ fontSize: "12.5px", fontWeight: 700, color: "#1e3a5f" }}>
                                                {sub.code}
                                              </span>
                                            </td>
                                            <td>
                                              <span style={{ fontSize: "13.5px", fontWeight: 600, color: "#0f172a" }}>
                                                {sub.description}
                                              </span>
                                            </td>
                                            <td style={{ textAlign: "center" }}>
                                              <span style={{ display: "inline-block", padding: "2px 8px", background: "#f1f5f9", borderRadius: "6px", fontSize: "12px", fontWeight: 700, color: "#475569" }}>
                                                {sub.units || 3}
                                              </span>
                                            </td>
                                            <td className="ad-tableActions" style={{ justifyContent: "flex-end" }}>
                                              <button
                                                type="button"
                                                className="ad-actionBtn ad-actionBtn--edit"
                                                title="Edit Subject"
                                                onClick={() => handleOpenEditSubject(sub)}
                                              >
                                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                                              </button>
                                              <button
                                                type="button"
                                                className="ad-actionBtn ad-actionBtn--delete"
                                                title="Delete Subject"
                                                onClick={() => handleDeleteSubject(sub)}
                                              >
                                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2-2v2" /></svg>
                                              </button>
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      )}

                      {/* ---------------------------------------------------- */}
                      {/* TAB 2: SECTIONS LIST                                 */}
                      {/* ---------------------------------------------------- */}
                      {activeTab === "sections" && (
                        <div>
                          <div className="ad-curr-sections-grid">
                            {ylSections.map((sec) => {
                              const countKey = `${selectedProgram.name.trim().toLowerCase()}__${normYear(yl)}__${sec.name.trim().toLowerCase()}`;
                              const enrolled = studentCounts.get(countKey) || 0;

                              return (
                                <div className="ad-curr-section-card" key={sec.id}>
                                  <div>
                                    <div className="ad-curr-section-name">Section {sec.name}</div>
                                    <div className="ad-curr-section-meta">
                                      {enrolled} enrolled student{enrolled === 1 ? "" : "s"}
                                    </div>
                                  </div>

                                  <div style={{ display: "flex", gap: "4px" }}>
                                    <button
                                      type="button"
                                      className="ad-actionBtn ad-actionBtn--edit"
                                      title="Rename Section"
                                      onClick={() => handleOpenEditSection(sec)}
                                    >
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                                    </button>
                                    <button
                                      type="button"
                                      className="ad-actionBtn ad-actionBtn--delete"
                                      title="Delete Section"
                                      onClick={() => handleDeleteSection(sec)}
                                    >
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2-2v2" /></svg>
                                    </button>
                                  </div>
                                </div>
                              );
                            })}

                            {/* Add Section Quick Card */}
                            <button
                              type="button"
                              className="ad-curr-add-section-card"
                              onClick={() => handleOpenAddSection(yl)}
                            >
                              <Plus size={16} /> Add Section to {yl} Year
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}

        {/* ========================================================================= */}
        {/* MODAL 1: CREATE / EDIT PROGRAM                                            */}
        {/* ========================================================================= */}
        {showProgramModal && (
          <div className="ad-modal">
            <div className="ad-modalOverlay" onClick={() => !saving && setShowProgramModal(false)} />
            <div className="ad-modalContent">
              <div className="ad-modalHeader">
                <h3 className="ad-modalTitle">{editingProgram ? "Edit Program Information" : "Add New Academic Program"}</h3>
                <button type="button" className="ad-modalClose" onClick={() => setShowProgramModal(false)}>
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSaveProgram}>
                <div className="ad-modalBody">
                  <div className="ad-formGroup">
                    <label className="ad-label">Program Code * (e.g. BSIT, BSED)</label>
                    <input
                      type="text"
                      className="ad-input"
                      placeholder="e.g. BSIT"
                      value={programForm.name}
                      onChange={(e) => setProgramForm({ ...programForm, name: e.target.value })}
                      required
                    />
                  </div>

                  <div className="ad-formGroup">
                    <label className="ad-label">Program Full Title / Description *</label>
                    <textarea
                      className="ad-input"
                      rows={3}
                      placeholder="e.g. Bachelor of Science in Information Technology"
                      value={programForm.description}
                      onChange={(e) => setProgramForm({ ...programForm, description: e.target.value })}
                      required
                    />
                  </div>
                </div>

                <div className="ad-modalFooter">
                  <button type="button" className="ad-btnSecondary" onClick={() => setShowProgramModal(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="ad-btnPrimary" disabled={saving}>
                    {saving ? "Saving..." : editingProgram ? "Update Program" : "Create Program"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* MODAL 2: CREATE / EDIT SUBJECT                                            */}
        {/* ========================================================================= */}
        {showSubjectModal && (
          <div className="ad-modal">
            <div className="ad-modalOverlay" onClick={() => !saving && setShowSubjectModal(false)} />
            <div className="ad-modalContent">
              <div className="ad-modalHeader">
                <h3 className="ad-modalTitle">
                  {editingSubject ? "Edit Subject" : `Add Subject to ${selectedProgram?.name} ${targetYearForSubject} Year`}
                </h3>
                <button type="button" className="ad-modalClose" onClick={() => setShowSubjectModal(false)}>
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSaveSubject}>
                <div className="ad-modalBody">
                  <div className="ad-formGroup">
                    <label className="ad-label">Subject Code * (e.g. IT 101, GE 1)</label>
                    <input
                      type="text"
                      className="ad-input"
                      placeholder="e.g. IT 101"
                      value={subjectForm.code}
                      onChange={(e) => setSubjectForm({ ...subjectForm, code: e.target.value })}
                      required
                    />
                  </div>

                  <div className="ad-formGroup">
                    <label className="ad-label">Descriptive Title *</label>
                    <input
                      type="text"
                      className="ad-input"
                      placeholder="e.g. Introduction to Computing"
                      value={subjectForm.description}
                      onChange={(e) => setSubjectForm({ ...subjectForm, description: e.target.value })}
                      required
                    />
                  </div>

                  <div className="ad-formRow">
                    <div className="ad-formGroup">
                      <label className="ad-label">Semester *</label>
                      <select
                        className="ad-input"
                        value={subjectForm.semester}
                        onChange={(e) => setSubjectForm({ ...subjectForm, semester: e.target.value })}
                      >
                        {SEMESTERS.map((sem) => (
                          <option key={sem} value={sem}>
                            {sem}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="ad-formGroup">
                      <label className="ad-label">Credit Units</label>
                      <input
                        type="number"
                        min={1}
                        max={12}
                        className="ad-input"
                        value={subjectForm.units}
                        onChange={(e) => setSubjectForm({ ...subjectForm, units: e.target.value })}
                      />
                    </div>
                  </div>
                </div>

                <div className="ad-modalFooter">
                  <button type="button" className="ad-btnSecondary" onClick={() => setShowSubjectModal(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="ad-btnPrimary" disabled={saving}>
                    {saving ? "Saving..." : editingSubject ? "Update Subject" : "Add Subject"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* MODAL 3: CREATE / EDIT SECTION                                            */}
        {/* ========================================================================= */}
        {showSectionModal && (
          <div className="ad-modal">
            <div className="ad-modalOverlay" onClick={() => !saving && setShowSectionModal(false)} />
            <div className="ad-modalContent" style={{ maxWidth: "420px" }}>
              <div className="ad-modalHeader">
                <h3 className="ad-modalTitle">
                  {editingSection ? "Rename Section" : `Add Section to ${selectedProgram?.name} ${targetYearForSection} Year`}
                </h3>
                <button type="button" className="ad-modalClose" onClick={() => setShowSectionModal(false)}>
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSaveSection}>
                <div className="ad-modalBody">
                  <div className="ad-formGroup">
                    <label className="ad-label">Section Identifier *</label>
                    <input
                      type="text"
                      className="ad-input"
                      placeholder="e.g. A, B, C, or 1-A"
                      value={sectionForm.name}
                      onChange={(e) => setSectionForm({ name: e.target.value })}
                      required
                      autoFocus
                    />
                    <small style={{ color: "#64748b", marginTop: "4px", display: "block" }}>
                      Example: Enter &ldquo;A&rdquo; to create Section A, or &ldquo;1-A&rdquo; for block sections.
                    </small>
                  </div>
                </div>

                <div className="ad-modalFooter">
                  <button type="button" className="ad-btnSecondary" onClick={() => setShowSectionModal(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="ad-btnPrimary" disabled={saving}>
                    {saving ? "Saving..." : editingSection ? "Rename Section" : "Add Section"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* MODAL 4: ADD CUSTOM YEAR LEVEL                                            */}
        {/* ========================================================================= */}
        {showCustomYearModal && (
          <div className="ad-modal">
            <div className="ad-modalOverlay" onClick={() => setShowCustomYearModal(false)} />
            <div className="ad-modalContent" style={{ maxWidth: "420px" }}>
              <div className="ad-modalHeader">
                <h3 className="ad-modalTitle">Add Custom Year Level</h3>
                <button type="button" className="ad-modalClose" onClick={() => setShowCustomYearModal(false)}>
                  <X size={18} />
                </button>
              </div>

              <div className="ad-modalBody">
                <div className="ad-formGroup">
                  <label className="ad-label">Year Level Name * (e.g. 5th, Senior High)</label>
                  <input
                    type="text"
                    className="ad-input"
                    placeholder="e.g. 5th"
                    value={customYearName}
                    onChange={(e) => setCustomYearName(e.target.value)}
                    autoFocus
                  />
                </div>
              </div>

              <div className="ad-modalFooter">
                <button type="button" className="ad-btnSecondary" onClick={() => setShowCustomYearModal(false)}>
                  Cancel
                </button>
                <button type="button" className="ad-btnPrimary" onClick={handleAddCustomYear}>
                  Add Year Level
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </AdminLayout>
  );
}