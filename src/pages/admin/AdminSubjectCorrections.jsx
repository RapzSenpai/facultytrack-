import { useState, useEffect, useCallback } from "react";
import AdminLayout from "./AdminLayout";
import { supabase } from "../../config/supabase";
import {
  AlertTriangle,
  Check,
  X,
  Eye,
  ClipboardList,
  RefreshCw,
} from "lucide-react";

// Phase 3 (Req 2 / D5): students can no longer build their own
// subject lists. This page lets the admin (a) resolve student
// correction reports and (b) adjust a student's evaluable
// subjects per period via student_enrollments:
//   kind 'admin'/'exception' = explicit list replaces the
//   section match; 'excluded_assignments' removes subjects
//   from either mode. Every save is idempotent (UNIQUE triple).
const YEAR_LEVELS = ["1st", "2nd", "3rd", "4th"];
const SECTIONS = ["A", "B", "C", "D", "E"];

const statusBadgeStyle = (status) => {
  if (status === "resolved") return { background: "#dcfce7", color: "#166534" };
  if (status === "dismissed") return { background: "#f3f4f6", color: "#6b7280" };
  return { background: "#fef3c7", color: "#92400e" }; // new
};

export default function AdminSubjectCorrections() {
  const [requests, setRequests] = useState([]);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);

  // Filters for the requests queue
  const [statusFilter, setStatusFilter] = useState("");
  const [studentSearch, setStudentSearch] = useState("");

  // Request resolution modal
  const [resolving, setResolving] = useState(null); // request row
  const [resolutionNote, setResolutionNote] = useState("");
  const [resolvingBusy, setResolvingBusy] = useState(false);

  // Per-student subject adjustment modal
  const [adjusting, setAdjusting] = useState(null); // student row
  const [adjustYear, setAdjustYear] = useState("");
  const [adjustSemester, setAdjustSemester] = useState("");
  const [activeAssignments, setActiveAssignments] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [excludedIds, setExcludedIds] = useState(new Set());
  const [existingKind, setExistingKind] = useState(null); // null | 'auto' | 'admin' | 'exception'
  const [extraSubjectId, setExtraSubjectId] = useState("");
  const [adjustBusy, setAdjustBusy] = useState(false);
  const [adjustMsg, setAdjustMsg] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [reqRes, stuRes] = await Promise.all([
        supabase
          .from("subject_correction_requests")
          .select("*")
          .order("created_at", { ascending: false }),
        supabase
          .from("users")
          .select("id, full_name, school_id, email, department, year_level, section, status")
          .eq("role", "student"),
      ]);
      setRequests(reqRes.data || []);
      setStudents(stuRes.data || []);
    } catch (err) {
      console.error("Fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const studentName = (id) => {
    const s = students.find((x) => x.id === id);
    return s ? `${s.full_name || "Student"}${s.school_id ? ` (${s.school_id})` : ""}` : "Unknown student";
  };

  const filteredRequests = requests
    .filter((r) => !statusFilter || r.status === statusFilter)
    .filter((r) => {
      if (!studentSearch) return true;
      const s = students.find((x) => x.id === r.student_id);
      const hay = `${s?.full_name || ""} ${s?.school_id || ""}`.toLowerCase();
      return (
        hay.includes(studentSearch.toLowerCase()) ||
        (r.message || "").toLowerCase().includes(studentSearch.toLowerCase())
      );
    });

  const newCount = requests.filter((r) => r.status === "new").length;

  // ---------------- Request resolution ----------------

  const openResolve = (request) => {
    setResolving(request);
    setResolutionNote(request.resolution_note || "");
  };

  const submitResolution = async (status) => {
    if (!resolving) return;
    setResolvingBusy(true);
    try {
      const { error } = await supabase
        .from("subject_correction_requests")
        .update({
          status,
          resolution_note: resolutionNote.trim(),
          resolved_at: new Date().toISOString(),
          resolved_by: (await supabase.auth.getUser()).data?.user?.id || null,
        })
        .eq("id", resolving.id);
      if (error) throw new Error(error.message);
      setResolving(null);
      setResolutionNote("");
      fetchData();
    } catch (err) {
      alert("Error: " + err.message);
    } finally {
      setResolvingBusy(false);
    }
  };

  // ---------------- Per-student subject adjustment ----------------

  const loadAdjustment = async (student, year, semester) => {
    setAdjustBusy(true);
    setAdjustMsg("");
    try {
      const { data: assignments } = await supabase
        .from("class_assignments")
        .select("*")
        .eq("academic_year", year)
        .eq("semester", semester);

      const { data: enr } = await supabase
        .from("student_enrollments")
        .select("confirmed_assignments, excluded_assignments, enrollment_kind")
        .eq("student_id", student.id)
        .eq("academic_year", year)
        .eq("semester", semester)
        .maybeSingle();

      const normalize = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const isMatch = (a, b) => {
        if (!a || !b) return false;
        const n1 = normalize(a);
        const n2 = normalize(b);
        return n1 === n2 || n1.includes(n2) || n2.includes(n1);
      };

      const rows = assignments || [];
      setActiveAssignments(rows);

      const sectionMatches = rows.filter(
        (a) =>
          isMatch(a.department, student.department) &&
          isMatch(a.year_level, student.year_level) &&
          isMatch(a.section, student.section)
      );

      const kind = enr?.enrollment_kind === "admin" || enr?.enrollment_kind === "exception"
        ? "admin"
        : "auto";
      setExistingKind(kind);

      if (kind === "admin") {
        // Explicit list governs: start from the stored list; if the
        // stored list is empty, preselect the section match as a
        // sensible starting point.
        const stored = new Set(
          (enr.confirmed_assignments || []).filter((id) =>
            rows.some((a) => a.id === id)
          )
        );
        setSelectedIds(stored.size > 0 ? stored : new Set(sectionMatches.map((a) => a.id)));
      } else {
        setSelectedIds(new Set(sectionMatches.map((a) => a.id)));
      }
      setExcludedIds(new Set(enr?.excluded_assignments || []));
    } finally {
      setAdjustBusy(false);
    }
  };

  const openAdjust = async (student) => {
    setAdjusting(student);
    setAdjustYear("");
    setAdjustSemester("");
    setActiveAssignments([]);
    setSelectedIds(new Set());
    setExcludedIds(new Set());
    setExistingKind(null);
    setExtraSubjectId("");
    setAdjustMsg("");
    try {
      const { data: years } = await supabase
        .from("academic_years")
        .select("*");
      const active =
        (years || []).find(
          (y) => (y.status || "").toLowerCase().trim() === "on-going"
        ) ||
        (years || [])[0] ||
        null;
      if (active) {
        setAdjustYear(active.year);
        setAdjustSemester(active.semester);
        await loadAdjustment(student, active.year, active.semester);
      }
    } catch (err) {
      console.error("Adjust modal load error:", err);
    }
  };

  const changeAdjustPeriod = async (year, semester) => {
    setAdjustYear(year);
    setAdjustSemester(semester);
    if (year && semester && adjusting) {
      await loadAdjustment(adjusting, year, semester);
    }
  };

  const toggleSubject = (id, kind) => {
    if (kind === "exclude") {
      setExcludedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    }
  };

  const addExtraSubject = () => {
    if (!extraSubjectId) return;
    setSelectedIds((prev) => new Set(prev).add(extraSubjectId));
    setExcludedIds((prev) => {
      const next = new Set(prev);
      next.delete(extraSubjectId);
      return next;
    });
    setExtraSubjectId("");
  };

  const clearOverrides = async () => {
    if (!adjusting || !adjustYear || !adjustSemester) return;
    setAdjustBusy(true);
    setAdjustMsg("");
    try {
      // Remove the override row entirely: the student reverts to the
      // plain section match (minus nothing).
      const { error } = await supabase
        .from("student_enrollments")
        .delete()
        .eq("student_id", adjusting.id)
        .eq("academic_year", adjustYear)
        .eq("semester", adjustSemester);
      if (error) throw new Error(error.message);
      setExistingKind("auto");
      setSelectedIds(
        new Set(
          activeAssignments
            .filter(
              (a) =>
                (a.department || "").toLowerCase() === (adjusting.department || "").toLowerCase() &&
                (a.year_level || "").toLowerCase() === (adjusting.year_level || "").toLowerCase() &&
                (a.section || "").toLowerCase() === (adjusting.section || "").toLowerCase()
            )
            .map((a) => a.id)
        )
      );
      setExcludedIds(new Set());
      setAdjustMsg("Overrides cleared — the student follows their section list again.");
    } catch (err) {
      alert("Error: " + err.message);
    } finally {
      setAdjustBusy(false);
    }
  };

  const saveAdjustment = async () => {
    if (!adjusting || !adjustYear || !adjustSemester) return;
    setAdjustBusy(true);
    setAdjustMsg("");
    try {
      const { error } = await supabase.from("student_enrollments").upsert(
        {
          student_id: adjusting.id,
          academic_year: adjustYear,
          semester: adjustSemester,
          confirmed_assignments: [...selectedIds],
          excluded_assignments: [...excludedIds],
          enrollment_kind: "admin",
        },
        { onConflict: "student_id,academic_year,semester" }
      );
      if (error) throw new Error(error.message);
      setExistingKind("admin");
      setAdjustMsg("Saved — the student now evaluates exactly the subjects selected above.");
    } catch (err) {
      alert("Error: " + err.message);
    } finally {
      setAdjustBusy(false);
    }
  };

  const addableExtras = activeAssignments.filter(
    (a) => !selectedIds.has(a.id) && !excludedIds.has(a.id)
  );

  const studentSuggestions = students
    .filter((s) => (s.status || "") !== "pending")
    .filter((s) => {
      if (!studentSearch) return true;
      const hay = `${s.full_name || ""} ${s.school_id || ""}`.toLowerCase();
      return hay.includes(studentSearch.toLowerCase());
    })
    .slice(0, 6);

  return (
    <AdminLayout title="Subject Corrections">
      <section className="ad-content">
        <div className="ad-welcomeHeader" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <h2 className="ad-title">Subject Corrections</h2>
            <p className="ad-subtitle">
              Student subject-list reports and per-student subject adjustments
            </p>
          </div>
          <button className="ad-btnPrimary" onClick={fetchData} disabled={loading}>
            <RefreshCw size={16} style={{ marginRight: 6 }} />
            Refresh
          </button>
        </div>

        <div className="ad-tableCard ad-tableCard--padded">
          <div className="ad-filterBar">
            <div className="ad-searchWrap">
              <svg className="ad-searchIcon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
              <input
                type="text"
                className="ad-searchInput"
                placeholder="Search by student or report text..."
                value={studentSearch}
                onChange={(e) => setStudentSearch(e.target.value)}
              />
            </div>

            <select className="ad-filterSelect" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              <option value="new">New</option>
              <option value="resolved">Resolved</option>
              <option value="dismissed">Dismissed</option>
            </select>

            <span className="ad-filterCount">
              <strong>{newCount}</strong> new report{newCount === 1 ? "" : "s"} waiting
            </span>
          </div>

          {/* REQUESTS TABLE */}
          <div className="ad-tableWrap ad-tableWrap--bordered">
            <table className="ad-table ad-table--plain">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Report</th>
                  <th>Sent</th>
                  <th>Status</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan="5" style={{ textAlign: "center", padding: "40px", color: "#6b7280" }}>Loading...</td></tr>
                ) : filteredRequests.length === 0 ? (
                  <tr>
                    <td colSpan="5" style={{ textAlign: "center", padding: "48px 20px", color: "#6b7280" }}>
                      <ClipboardList size={36} style={{ display: "block", margin: "0 auto 12px", color: "#9ca3af" }} />
                      <span style={{ fontSize: "15px", fontWeight: 500 }}>No correction requests</span>
                      <p style={{ margin: "4px 0 0", fontSize: "13px" }}>
                        Student reports about their subject lists will appear here.
                      </p>
                    </td>
                  </tr>
                ) : (
                  filteredRequests.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <div className="ad-avatarCell">
                          <div className="ad-avatar ad-avatar--blue">
                            {(studentName(r.student_id) || "??").substring(0, 2).toUpperCase()}
                          </div>
                          <div className="ad-cellLines">
                            <span className="ad-cellPrimary">{studentName(r.student_id)}</span>
                          </div>
                        </div>
                      </td>
                      <td style={{ maxWidth: "420px" }}>
                        <div style={{ fontSize: "13px", color: "#1f2937", whiteSpace: "pre-wrap" }}>{r.message}</div>
                        {r.resolution_note && (
                          <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "4px" }}>
                            Note: {r.resolution_note}
                          </div>
                        )}
                      </td>
                      <td className="ad-code">
                        {new Date(r.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </td>
                      <td>
                        <span className="ad-badge" style={{ ...statusBadgeStyle(r.status), borderRadius: "6px", padding: "4px 10px", fontSize: "11px", fontWeight: "800", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                          {r.status}
                        </span>
                      </td>
                      <td className="ad-tableActions" style={{ justifyContent: "flex-end" }}>
                        <button className="ad-actionBtn ad-actionBtn--view" title="View / respond" onClick={() => openResolve(r)}>
                          <Eye size={16} />
                        </button>
                        <button
                          className="ad-actionBtn ad-actionBtn--edit"
                          title="Adjust this student's subjects"
                          onClick={() => {
                            const s = students.find((x) => x.id === r.student_id);
                            if (s) openAdjust(s);
                          }}
                        >
                          <ClipboardList size={16} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* QUICK PER-STUDENT ADJUSTMENT */}
        <div className="ad-tableCard ad-tableCard--padded" style={{ marginTop: "20px" }}>
          <div className="ad-filterBar">
            <div>
              <h3 style={{ margin: 0, fontSize: "15px", color: "#1e3a5f" }}>Adjust a student's subject list</h3>
              <p style={{ margin: "2px 0 0", fontSize: "13px", color: "#6b7280" }}>
                Search a student below, then pick the subjects they should evaluate this period.
              </p>
            </div>
          </div>
          <div className="ad-filterBar">
            {studentSuggestions.length === 0 ? (
              <span style={{ fontSize: "13px", color: "#6b7280" }}>
                {studentSearch ? "No students match your search." : "Type a student name or ID above to search."}
              </span>
            ) : (
              studentSuggestions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="ad-filterClear"
                  style={{ border: "1px solid #e5e7eb", background: "#fff", borderRadius: "8px", padding: "8px 12px" }}
                  onClick={() => openAdjust(s)}
                  title={`${s.department || ""} ${s.year_level || ""} - ${s.section || ""}`}
                >
                  <ClipboardList size={14} style={{ marginRight: 6, verticalAlign: "-2px" }} />
                  {s.full_name || s.school_id}
                </button>
              ))
            )}
          </div>
        </div>
      </section>

      {/* RESOLVE REQUEST MODAL */}
      {resolving && (
        <div className="ad-modal">
          <div className="ad-modalOverlay" onClick={() => setResolving(null)} />
          <div className="ad-modalContent">
            <div className="ad-modalHeader">
              <h3 className="ad-modalTitle">Correction Report</h3>
              <button className="ad-modalClose" onClick={() => setResolving(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="ad-modalBody">
              <div className="ad-formGroup" style={{ marginBottom: "12px" }}>
                <label className="ad-label" style={{ marginBottom: "4px" }}>Student</label>
                <div style={{ padding: "8px 12px", background: "#f9fafb", borderRadius: "6px", border: "1px solid #e5e7eb", fontSize: "14px" }}>
                  {studentName(resolving.student_id)}
                </div>
              </div>
              <div className="ad-formGroup" style={{ marginBottom: "12px" }}>
                <label className="ad-label" style={{ marginBottom: "4px" }}>Report</label>
                <div style={{ padding: "8px 12px", background: "#f9fafb", borderRadius: "6px", border: "1px solid #e5e7eb", fontSize: "14px", whiteSpace: "pre-wrap" }}>
                  {resolving.message}
                </div>
              </div>
              <div className="ad-formGroup" style={{ marginBottom: "12px" }}>
                <label className="ad-label" style={{ marginBottom: "4px" }}>Response note (visible to the student)</label>
                <textarea
                  className="ad-input"
                  rows="3"
                  placeholder="Example: 'IT 311 with Prof. Santos has been added to your list.'"
                  value={resolutionNote}
                  onChange={(e) => setResolutionNote(e.target.value)}
                />
              </div>
              <div className="ad-formNote" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <AlertTriangle size={16} />
                Tip: use the clipboard button on this report (or the section below) to change the student's subjects, then mark this report resolved.
              </div>
            </div>
            <div className="ad-modalFooter">
              <button className="ad-btnSecondary" onClick={() => setResolving(null)} disabled={resolvingBusy}>Close</button>
              <button
                className="ad-btnSecondary"
                onClick={() => submitResolution("dismissed")}
                disabled={resolvingBusy}
                style={{ color: "#6b7280" }}
              >
                <X size={14} style={{ marginRight: 4, verticalAlign: "-2px" }} /> Dismiss
              </button>
              <button className="ad-btnPrimary" onClick={() => submitResolution("resolved")} disabled={resolvingBusy}>
                <Check size={14} style={{ marginRight: 4, verticalAlign: "-2px" }} />
                {resolvingBusy ? "Saving..." : "Mark Resolved"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ADJUST SUBJECTS MODAL */}
      {adjusting && (
        <div className="ad-modal">
          <div className="ad-modalOverlay" onClick={() => setAdjusting(null)} />
          <div className="ad-modalContent ad-modalContent--large">
            <div className="ad-modalHeader">
              <h3 className="ad-modalTitle">Subjects for {adjusting.full_name || adjusting.school_id}</h3>
              <button className="ad-modalClose" onClick={() => setAdjusting(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="ad-modalBody">
              <div className="ad-formRow" style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr", alignItems: "end" }}>
                <div className="ad-formGroup">
                  <label className="ad-label">Academic Year</label>
                  <select className="ad-input" value={adjustYear} onChange={(e) => changeAdjustPeriod(e.target.value, adjustSemester)}>
                    <option value="">Select…</option>
                    {[...new Set(activeAssignments.map((a) => a.academic_year).concat(adjustYear).filter(Boolean))].map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
                <div className="ad-formGroup">
                  <label className="ad-label">Semester</label>
                  <select className="ad-input" value={adjustSemester} onChange={(e) => changeAdjustPeriod(adjustYear, e.target.value)}>
                    <option value="">Select…</option>
                    {["1st", "2nd", "Midterm", "Summer"].map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div className="ad-formGroup">
                  <label className="ad-label">Student section</label>
                  <div style={{ padding: "8px 12px", background: "#f9fafb", borderRadius: "6px", border: "1px solid #e5e7eb", fontSize: "13px" }}>
                    {adjusting.department || "—"} · {adjusting.year_level || "—"} · {adjusting.section || "—"}
                  </div>
                </div>
                <div className="ad-formGroup">
                  <label className="ad-label">List mode</label>
                  <div style={{ padding: "8px 12px", borderRadius: "6px", fontSize: "12px", fontWeight: 800, letterSpacing: "0.5px", textTransform: "uppercase", border: "1px solid #e5e7eb", background: existingKind === "admin" ? "#fef9c3" : "#f9fafb", color: existingKind === "admin" ? "#854d0e" : "#6b7280" }}>
                    {existingKind === "admin" ? "Custom (admin-set)" : "Section default"}
                  </div>
                </div>
              </div>

              <div className="ad-formNote" style={{ marginBottom: "12px" }}>
                Check the subjects this student should evaluate this period. Anything left
                unchecked is removed from their list. This replaces the automatic section match
                when saved.
              </div>

              {adjustBusy && activeAssignments.length === 0 ? (
                <div style={{ textAlign: "center", padding: "32px", color: "#6b7280" }}>Loading subjects…</div>
              ) : activeAssignments.length === 0 ? (
                <div style={{ textAlign: "center", padding: "32px", color: "#6b7280" }}>
                  No class assignments found for {adjustYear || "—"} {adjustSemester || "—"}.
                </div>
              ) : (
                <div className="ad-tableWrap ad-tableWrap--bordered" style={{ maxHeight: "320px", overflowY: "auto" }}>
                  <table className="ad-table ad-table--plain">
                    <thead>
                      <tr>
                        <th style={{ width: "90px" }}>Include</th>
                        <th style={{ width: "90px" }}>Exclude</th>
                        <th>Subject</th>
                        <th>Faculty</th>
                        <th>Section</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeAssignments.map((a) => (
                        <tr key={a.id}>
                          <td>
                            <input
                              type="checkbox"
                              checked={selectedIds.has(a.id)}
                              onChange={() => toggleSubject(a.id, "include")}
                            />
                          </td>
                          <td>
                            <input
                              type="checkbox"
                              checked={excludedIds.has(a.id)}
                              onChange={() => toggleSubject(a.id, "exclude")}
                            />
                          </td>
                          <td>
                            <span className="ad-cellPrimary">{a.subject_code}</span>
                            <span className="ad-cellSecondary"> {a.subject_name}</span>
                          </td>
                          <td>{a.faculty_name || "—"}</td>
                          <td className="ad-code">{a.department} {a.year_level}-{a.section}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="ad-formRow" style={{ gridTemplateColumns: "2fr 1fr", marginTop: "12px", alignItems: "end" }}>
                <div className="ad-formGroup">
                  <label className="ad-label">Add a subject outside the student's section (irregular / retake)</label>
                  <select className="ad-input" value={extraSubjectId} onChange={(e) => setExtraSubjectId(e.target.value)}>
                    <option value="">Select a subject…</option>
                    {addableExtras.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.subject_code} — {a.subject_name} ({a.department} {a.year_level}-{a.section})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="ad-formGroup">
                  <button type="button" className="ad-btnSecondary" onClick={addExtraSubject} disabled={!extraSubjectId}>
                    Add to list
                  </button>
                </div>
              </div>

              {adjustMsg && (
                <div className="ad-formNote" style={{ marginTop: "8px", color: "#166534", borderColor: "#bbf7d0", background: "#f0fdf4" }}>
                  {adjustMsg}
                </div>
              )}
            </div>
            <div className="ad-modalFooter">
              <button className="ad-btnSecondary" onClick={() => setAdjusting(null)}>Close</button>
              <button
                className="ad-btnSecondary"
                onClick={clearOverrides}
                disabled={adjustBusy}
                title="Remove all overrides — the student reverts to their automatic section list"
              >
                Clear Overrides
              </button>
              <button className="ad-btnPrimary" onClick={saveAdjustment} disabled={adjustBusy}>
                {adjustBusy ? "Saving..." : "Save Subject List"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
