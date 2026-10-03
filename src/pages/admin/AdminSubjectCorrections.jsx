import { useState, useEffect, useCallback } from "react";
import AdminLayout from "./AdminLayout";
import { supabase } from "../../config/supabase";
import { useScopedAdmin } from "../../hooks/useScopedAdmin";
import { useSuperScope } from "../../context/SuperScopeContext";
import { logAdminAction } from "../../utils/audit";
import { sendNotification } from "../../utils/notifications";
import {
  AlertTriangle,
  Check,
  X,
  Eye,
  ClipboardList,
  RefreshCw,
  Trash2,
  Clock,
  CheckCircle2,
  Tag,
  LayoutGrid,
  List,
  BookOpen,
  SlidersHorizontal,
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

const parseReportMessage = (rawMessage) => {
  const text = rawMessage || "";
  const bracketMatches = [...text.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]);
  const categoryTag = bracketMatches[0] || null;
  const subjectTag = bracketMatches.length > 1 ? bracketMatches[1] : null;

  let cleanMsg = text;
  if (bracketMatches.length > 0) {
    cleanMsg = text.replace(/^(\[[^\]]+\]\s*)+:?\s*/, "");
  }

  return { categoryTag, subjectTag, cleanMsg };
};

const statusBadgeStyle = (status) => {
  if (status === "resolved") return { background: "#dcfce7", color: "#166534" };
  if (status === "dismissed") return { background: "#f3f4f6", color: "#6b7280" };
  return { background: "#fef3c7", color: "#92400e" }; // new
};

export default function AdminSubjectCorrections() {
  const { isSuper, inScopeName } = useScopedAdmin();
  const { scopeDeptId, scopeDeptName } = useSuperScope();
  const sameDept = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
  // Student rows have TEXT department only: match own scope, or the
  // super pick when set.
  const inScopeStudent = (s) => (isSuper && !scopeDeptId)
    || (!isSuper && inScopeName(s?.department))
    || (isSuper && scopeDeptId && sameDept(s?.department, scopeDeptName));
  const [requests, setRequests] = useState([]);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);

  // Filters for the requests queue
  const [statusFilter, setStatusFilter] = useState("");
  const [studentSearch, setStudentSearch] = useState("");
  const [viewMode, setViewMode] = useState("cards"); // 'cards' | 'table'

  // Request deletion confirmation modal
  const [deletingRequest, setDeletingRequest] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // In-app toast feedback
  const [toast, setToast] = useState({ show: false, message: "", type: "success" });
  const showToast = (message, type = "success") => {
    setToast({ show: true, message, type });
    setTimeout(() => setToast({ show: false, message: "", type: "success" }), 3500);
  };

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
      const stu = students.find((x) => x.id === r.student_id);
      if (stu && !inScopeStudent(stu)) return false;
      if (!studentSearch) return true;
      const s = students.find((x) => x.id === r.student_id);
      const hay = `${s?.full_name || ""} ${s?.school_id || ""}`.toLowerCase();
      return (
        hay.includes(studentSearch.toLowerCase()) ||
        (r.message || "").toLowerCase().includes(studentSearch.toLowerCase())
      );
    });

  const scopedRequests = requests.filter((r) => {
    const s = students.find((x) => x.id === r.student_id);
    return !s || inScopeStudent(s);
  });
  const newCount = scopedRequests.filter((r) => r.status === "new").length;
  const resolvedCount = scopedRequests.filter((r) => r.status === "resolved").length;
  const totalCount = scopedRequests.length;

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
      logAdminAction("correction.resolve", "subject_correction_requests", resolving.id, { status });

      // Notify student
      if (resolving.student_id) {
        sendNotification({
          userId: resolving.student_id,
          title: status === "resolved" ? "Subject Issue Resolved" : "Subject Issue Update",
          message: resolutionNote.trim()
            ? `Admin note: ${resolutionNote.trim()}`
            : `Your subject list issue has been marked as ${status}.`,
          type: status === "resolved" ? "success" : "info",
          link: "/student/dashboard",
        }).catch((e) => console.warn("Student notification warning:", e));
      }

      fetchData();
      showToast(status === "resolved" ? "Ticket resolved successfully." : "Ticket marked as dismissed.", "success");
    } catch (err) {
      showToast(err.message || "Failed to update report status.", "error");
    } finally {
      setResolvingBusy(false);
    }
  };

  const confirmDeleteRequest = async () => {
    if (!deletingRequest) return;
    setDeleteBusy(true);
    try {
      const { error } = await supabase
        .from("subject_correction_requests")
        .delete()
        .eq("id", deletingRequest.id);
      if (error) throw error;
      logAdminAction("correction.delete", "subject_correction_requests", deletingRequest.id);
      showToast("Correction report deleted successfully.", "success");
      setDeletingRequest(null);
      fetchData();
    } catch (err) {
      console.error("Delete error:", err);
      showToast("Failed to delete request: " + (err.message || "Unknown error"), "error");
    } finally {
      setDeleteBusy(false);
    }
  };

  const normalizeValue = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const isMatch = (a, b) => {
    if (!a || !b) return false;
    const n1 = normalizeValue(a);
    const n2 = normalizeValue(b);
    return n1 !== "" && n1 === n2;
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
      logAdminAction("enrollment.override_clear", "student_enrollments", adjusting.id, {
        academic_year: adjustYear,
        semester: adjustSemester,
      });
      setSelectedIds(
        new Set(
          activeAssignments
            .filter((a) =>
              isMatch(a.department, adjusting.department) &&
              isMatch(a.year_level, adjusting.year_level) &&
              isMatch(a.section, adjusting.section)
            )
            .map((a) => a.id)
        )
      );
      setExcludedIds(new Set());
      setAdjustMsg("Overrides cleared — the student follows their section list again.");
      showToast("Overrides cleared — student restored to section list.", "success");
    } catch (err) {
      showToast(err.message || "Failed to clear overrides.", "error");
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
      showToast("Subject list saved successfully!", "success");
      logAdminAction("enrollment.override", "student_enrollments", adjusting.id, {
        academic_year: adjustYear,
        semester: adjustSemester,
      });
    } catch (err) {
      showToast(err.message || "Failed to save subject adjustments.", "error");
    } finally {
      setAdjustBusy(false);
    }
  };

  const addableExtras = activeAssignments.filter(
    (a) => !selectedIds.has(a.id) && !excludedIds.has(a.id)
  );

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

        {/* 3-Card Executive KPI Strip */}
        <div className="ad-kpiGrid">
          <div className="ad-kpiCard ad-kpiCard--amber">
            <div className="ad-kpiHeader">
              <span className="ad-kpiLabel">New Reports</span>
              <span className="ad-kpiIcon">
                <Clock size={18} />
              </span>
            </div>
            <div className="ad-kpiBody">
              <span className="ad-kpiValue" style={{ color: "#d97706" }}>
                {loading ? "—" : newCount}
              </span>
              <span className="ad-kpiBadge ad-kpiBadge--warning">
                Awaiting Review
              </span>
            </div>
          </div>

          <div className="ad-kpiCard ad-kpiCard--success">
            <div className="ad-kpiHeader">
              <span className="ad-kpiLabel">Resolved Reports</span>
              <span className="ad-kpiIcon">
                <CheckCircle2 size={18} />
              </span>
            </div>
            <div className="ad-kpiBody">
              <span className="ad-kpiValue" style={{ color: "#059669" }}>
                {loading ? "—" : resolvedCount}
              </span>
              <span className="ad-kpiBadge ad-kpiBadge--success">
                Resolved
              </span>
            </div>
          </div>

          <div className="ad-kpiCard ad-kpiCard--info">
            <div className="ad-kpiHeader">
              <span className="ad-kpiLabel">Total Reports</span>
              <span className="ad-kpiIcon">
                <ClipboardList size={18} />
              </span>
            </div>
            <div className="ad-kpiBody">
              <span className="ad-kpiValue">
                {loading ? "—" : totalCount}
              </span>
              <span className="ad-kpiBadge ad-kpiBadge--info">
                All Records
              </span>
            </div>
          </div>
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

            {/* View Mode Toggle */}
            <div className="asc-viewToggle">
              <button
                type="button"
                className={`asc-toggleBtn ${viewMode === "cards" ? "active" : ""}`}
                onClick={() => setViewMode("cards")}
                title="Interactive Cards View"
              >
                <LayoutGrid size={15} />
                <span>Cards</span>
              </button>
              <button
                type="button"
                className={`asc-toggleBtn ${viewMode === "table" ? "active" : ""}`}
                onClick={() => setViewMode("table")}
                title="Compact Table View"
              >
                <List size={15} />
                <span>Table</span>
              </button>
            </div>
          </div>

          {/* CARDS VIEW */}
          {viewMode === "cards" ? (
            <div className="asc-cardGrid">
              {loading ? (
                <div className="asc-emptyState">
                  <RefreshCw size={32} className="ft-spin" style={{ display: "block", margin: "0 auto 12px", color: "#64748b" }} />
                  <div style={{ fontSize: "15px", fontWeight: 600, color: "#475569" }}>Loading correction reports...</div>
                </div>
              ) : filteredRequests.length === 0 ? (
                <div className="asc-emptyState">
                  <ClipboardList size={40} style={{ display: "block", margin: "0 auto 12px", color: "#94a3b8" }} />
                  <h4 style={{ margin: "0 0 6px", fontSize: "16px", fontWeight: 700, color: "#1e293b" }}>
                    No correction requests found
                  </h4>
                  <p style={{ margin: 0, fontSize: "13px", color: "#64748b" }}>
                    {statusFilter || studentSearch
                      ? "Try changing or clearing your search and filter options."
                      : "Student reports about their subject lists will appear here."}
                  </p>
                </div>
              ) : (
                filteredRequests.map((r) => {
                  const s = students.find((x) => x.id === r.student_id);
                  const { categoryTag, subjectTag, cleanMsg } = parseReportMessage(r.message);
                  const initials = ((s?.full_name || "ST").substring(0, 2)).toUpperCase();
                  const cardModClass =
                    r.status === "resolved"
                      ? "asc-card--resolved"
                      : r.status === "dismissed"
                      ? "asc-card--dismissed"
                      : "asc-card--new";

                  return (
                    <div
                      key={r.id}
                      className={`asc-card ${cardModClass}`}
                      onClick={() => openResolve(r)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openResolve(r);
                        }
                      }}
                    >
                      {/* Top Header: Student Avatar & Info + Status Pill */}
                      <div className="asc-cardHeader">
                        <div className="asc-studentInfo">
                          <div className="asc-avatar">
                            {initials}
                          </div>
                          <div className="asc-studentMeta">
                            <span className="asc-studentName" title={s?.full_name || studentName(r.student_id)}>
                              {s?.full_name || studentName(r.student_id)}
                            </span>
                            <div className="asc-studentSubMeta">
                              {s?.school_id && (
                                <span className="asc-schoolId">ID: {s.school_id}</span>
                              )}
                              {s?.department && (
                                <span className="asc-deptBadge">
                                  {s.department} {s.year_level ? `${s.year_level}` : ""}{s.section ? `-${s.section}` : ""}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <span className={`asc-statusBadge asc-statusBadge--${r.status || "new"}`}>
                          <span className={`asc-dot ${r.status === "new" ? "asc-dot--pulse" : ""}`} />
                          {r.status === "new" ? "Pending Review" : r.status === "resolved" ? "Resolved" : "Dismissed"}
                        </span>
                      </div>

                      {/* Tags Row */}
                      {(categoryTag || subjectTag) && (
                        <div className="asc-tagsRow">
                          {categoryTag && (
                            <span className="asc-tag asc-tag--category">
                              <Tag size={11} /> {categoryTag}
                            </span>
                          )}
                          {subjectTag && (
                            <span className="asc-tag asc-tag--subject" title={subjectTag}>
                              <BookOpen size={11} /> {subjectTag}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Message Box */}
                      <div className="asc-msgBox">
                        <p className="asc-msgText">{cleanMsg}</p>
                      </div>

                      {/* Admin Note if resolved */}
                      {r.resolution_note && (
                        <div className="asc-adminCallout">
                          <CheckCircle2 size={15} className="asc-adminCalloutIcon" />
                          <div className="asc-adminCalloutText">
                            <strong>Admin Note:</strong> {r.resolution_note}
                          </div>
                        </div>
                      )}

                      {/* Footer Actions */}
                      <div className="asc-cardFooter">
                        <span className="asc-cardTime">
                          <Clock size={12} />
                          {new Date(r.created_at).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </span>

                        <div className="asc-cardActions">
                          <button
                            type="button"
                            className="asc-btnRespond"
                            title="Review & Respond"
                            onClick={(e) => {
                              e.stopPropagation();
                              openResolve(r);
                            }}
                          >
                            <Eye size={13} />
                            <span>Review</span>
                          </button>
                          <button
                            type="button"
                            className="asc-btnAdjust"
                            title="Adjust this student's subjects"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (s) openAdjust(s);
                            }}
                          >
                            <SlidersHorizontal size={13} />
                            <span>Adjust</span>
                          </button>
                          <button
                            type="button"
                            className="asc-btnDelete"
                            title="Delete request"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeletingRequest(r);
                            }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          ) : (
            /* TABLE VIEW */
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
                    filteredRequests.map((r) => {
                      const s = students.find((x) => x.id === r.student_id);
                      const { categoryTag, subjectTag, cleanMsg } = parseReportMessage(r.message);

                      return (
                        <tr key={r.id}>
                          <td>
                            <div className="ad-avatarCell">
                              <div className="ad-avatar ad-avatar--blue">
                                {((s?.full_name || "ST").substring(0, 2)).toUpperCase()}
                              </div>
                              <div className="ad-cellLines">
                                <span className="ad-cellPrimary">{s?.full_name || studentName(r.student_id)}</span>
                                <div style={{ display: "flex", gap: "6px", alignItems: "center", marginTop: "3px", flexWrap: "wrap" }}>
                                  {s?.school_id && (
                                    <span style={{ fontSize: "11px", color: "#64748b" }}>{s.school_id}</span>
                                  )}
                                  {s?.department && (
                                    <span style={{ background: "#eff6ff", color: "#1e40af", padding: "1px 6px", borderRadius: "4px", fontSize: "11px", fontWeight: "600" }}>
                                      {s.department} {s.year_level ? `${s.year_level}` : ""}{s.section ? `-${s.section}` : ""}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td style={{ maxWidth: "420px" }}>
                            {(categoryTag || subjectTag) && (
                              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "4px" }}>
                                {categoryTag && (
                                  <span style={{ background: "#fef2f2", color: "#991b1b", border: "1px solid #fee2e2", padding: "1px 7px", borderRadius: "999px", fontSize: "11px", fontWeight: "700", display: "inline-flex", alignItems: "center", gap: "3px" }}>
                                    <Tag size={10} /> {categoryTag}
                                  </span>
                                )}
                                {subjectTag && (
                                  <span style={{ background: "#f0f9ff", color: "#0369a1", border: "1px solid #e0f2fe", padding: "1px 7px", borderRadius: "999px", fontSize: "11px", fontWeight: "700", display: "inline-flex", alignItems: "center", gap: "3px" }}>
                                    <BookOpen size={10} /> {subjectTag}
                                  </span>
                                )}
                              </div>
                            )}
                            <div style={{ fontSize: "13px", color: "#1f2937", whiteSpace: "pre-wrap" }}>{cleanMsg}</div>
                            {r.resolution_note && (
                              <div style={{ fontSize: "12px", color: "#16a34a", marginTop: "6px", background: "#f0fdf4", padding: "4px 8px", borderRadius: "4px", border: "1px solid #bbf7d0" }}>
                                <strong>Admin:</strong> {r.resolution_note}
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
                            <button
                              className="ad-actionBtn ad-actionBtn--delete"
                              title="Delete request"
                              onClick={() => setDeletingRequest(r)}
                            >
                              <Trash2 size={16} />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
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
                <label className="ad-label" style={{ marginBottom: "4px" }}>Report Details</label>
                <div style={{ padding: "12px 14px", background: "#f8fafc", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                  {(() => {
                    const { categoryTag, subjectTag, cleanMsg } = parseReportMessage(resolving.message);
                    return (
                      <>
                        {(categoryTag || subjectTag) && (
                          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "8px" }}>
                            {categoryTag && (
                              <span className="asc-tag asc-tag--category">
                                <Tag size={11} /> {categoryTag}
                              </span>
                            )}
                            {subjectTag && (
                              <span className="asc-tag asc-tag--subject">
                                <BookOpen size={11} /> {subjectTag}
                              </span>
                            )}
                          </div>
                        )}
                        <div style={{ fontSize: "13.5px", color: "#1e293b", lineHeight: "1.5", whiteSpace: "pre-wrap" }}>
                          {cleanMsg}
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
              <div className="ad-formGroup" style={{ marginBottom: "12px" }}>
                <label className="ad-label" style={{ marginBottom: "4px" }}>Response note (visible to the student)</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "8px" }}>
                  <span style={{ fontSize: "11.5px", fontWeight: "700", color: "#64748b", alignSelf: "center", marginRight: "4px" }}>
                    Quick replies:
                  </span>
                  {[
                    "Subject added to your evaluation list.",
                    "Section assignment updated to reflect current enrollment.",
                    "Evaluation list verified and corrected.",
                    "This course does not require evaluation this semester.",
                  ].map((canned) => (
                    <button
                      key={canned}
                      type="button"
                      onClick={() => setResolutionNote(canned)}
                      style={{
                        fontSize: "11px",
                        background: "#f1f5f9",
                        border: "1px solid #cbd5e1",
                        borderRadius: "6px",
                        padding: "3px 8px",
                        color: "#334155",
                        cursor: "pointer",
                      }}
                    >
                      + {canned}
                    </button>
                  ))}
                </div>
                <textarea
                  className="ad-input"
                  rows="3"
                  placeholder="Example: 'IT 311 with Prof. Santos has been added to your list.'"
                  value={resolutionNote}
                  onChange={(e) => setResolutionNote(e.target.value)}
                />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px", background: "#f8fafc", padding: "10px 12px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                <div className="ad-formNote" style={{ margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
                  <AlertTriangle size={15} style={{ flexShrink: 0 }} />
                  <span>Use the subject adjuster to modify classes, then mark resolved.</span>
                </div>
                <button
                  type="button"
                  className="ad-btnSecondary"
                  style={{ display: "inline-flex", alignItems: "center", gap: "6px", color: "#2563eb", borderColor: "#bfdbfe", background: "#eff6ff", fontSize: "12.5px", padding: "6px 12px" }}
                  onClick={() => {
                    const stu = students.find((x) => x.id === resolving.student_id);
                    if (stu) {
                      setResolving(null);
                      openAdjust(stu);
                    }
                  }}
                >
                  <ClipboardList size={14} /> Open Subject Adjuster
                </button>
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

      {/* DELETE CONFIRMATION MODAL */}
      {deletingRequest && (
        <div className="ad-modal">
          <div
            className="ad-modalOverlay"
            onClick={() => !deleteBusy && setDeletingRequest(null)}
          />
          <div className="ad-modalContent" style={{ maxWidth: "460px" }}>
            <div className="ad-modalHeader" style={{ borderBottom: "none", paddingBottom: "4px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <div
                  style={{
                    width: "40px",
                    height: "40px",
                    borderRadius: "10px",
                    background: "#fee2e2",
                    color: "#dc2626",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <Trash2 size={20} />
                </div>
                <div>
                  <h3 className="ad-modalTitle" style={{ fontSize: "17px" }}>
                    Delete Correction Report
                  </h3>
                  <p style={{ margin: "2px 0 0", fontSize: "12px", color: "#64748b" }}>
                    Permanent deletion confirmation
                  </p>
                </div>
              </div>
              <button
                className="ad-modalClose"
                onClick={() => !deleteBusy && setDeletingRequest(null)}
                disabled={deleteBusy}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="ad-modalBody" style={{ paddingTop: "8px", paddingBottom: "16px" }}>
              <p style={{ margin: "0 0 14px", fontSize: "14px", color: "#334155", lineHeight: "1.5" }}>
                Are you sure you want to delete this correction report? This ticket will be permanently removed from the records.
              </p>

              {/* Preview Ticket Info */}
              <div
                style={{
                  background: "#f8fafc",
                  border: "1.5px solid #e2e8f0",
                  borderRadius: "10px",
                  padding: "12px 14px",
                  fontSize: "13px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                  <span style={{ fontWeight: "700", color: "#0f172a" }}>
                    {studentName(deletingRequest.student_id)}
                  </span>
                  <span
                    style={{
                      ...statusBadgeStyle(deletingRequest.status),
                      borderRadius: "999px",
                      padding: "2px 8px",
                      fontSize: "10px",
                      fontWeight: "800",
                      textTransform: "uppercase",
                    }}
                  >
                    {deletingRequest.status}
                  </span>
                </div>
                <div
                  style={{
                    color: "#64748b",
                    lineHeight: "1.4",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {deletingRequest.message}
                </div>
              </div>
            </div>

            <div className="ad-modalFooter" style={{ background: "#f8fafc" }}>
              <button
                type="button"
                className="ad-btnSecondary"
                onClick={() => setDeletingRequest(null)}
                disabled={deleteBusy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="ad-btnDanger"
                onClick={confirmDeleteRequest}
                disabled={deleteBusy}
              >
                <Trash2 size={14} style={{ marginRight: 6 }} />
                {deleteBusy ? "Deleting..." : "Delete Ticket"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TOAST NOTIFICATION */}
      {toast.show && (
        <div className={`ad-toast ad-toast--${toast.type}`}>
          <div className="ad-toastIcon">
            {toast.type === "success" ? <Check size={18} /> : <AlertTriangle size={18} />}
          </div>
          <div className="ad-toastMessage">{toast.message}</div>
        </div>
      )}
    </AdminLayout>
  );
}
