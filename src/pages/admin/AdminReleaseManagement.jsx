import { useEffect, useMemo, useState } from "react";
import AdminLayout from "./AdminLayout";
import { supabase } from "../../config/supabase";
import { useAuth } from "../../context/AuthContext";
import { is_period_released } from "../../utils/periodRelease";
import { logAdminAction } from "../../utils/audit";
import {
  ClipboardCheck,
  Calendar,
  ShieldCheck,
  Clock,
  AlertTriangle,
  Search,
  Users,
  Lock,
  Unlock,
  Save,
  RotateCcw,
  Eye,
  EyeOff,
  Check,
  X,
  FileCheck,
} from "lucide-react";

const STATUS_CONFIG = {
  released: {
    label: "Live & Released",
    color: "#059669",
    bg: "#ecfdf5",
    border: "#a7f3d0",
    icon: Eye,
    description: "Results are published and visible to all faculty members who have submitted their grades.",
  },
  scheduled: {
    label: "Scheduled",
    color: "#2563eb",
    bg: "#eff6ff",
    border: "#bfdbfe",
    icon: Clock,
    description: "Approved for release. Results will automatically publish once the scheduled date arrives.",
  },
  draft: {
    label: "Restricted (Draft)",
    color: "#64748b",
    bg: "#f8fafc",
    border: "#e2e8f0",
    icon: EyeOff,
    description: "Results are completely hidden. Requires administrative approval and a valid release date.",
  },
};

const STATUS_COLORS = {
  released: "#059669",
  scheduled: "#2563eb",
  draft: "#64748b",
};

const today = new Date().toISOString().slice(0, 10);

export default function AdminReleaseManagement() {
  const { currentUser, userProfile } = useAuth();
  const isSuper = userProfile?.role === "super_admin";
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [faculty, setFaculty] = useState([]);
  const [releases, setReleases] = useState([]);
  const [years, setYears] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [myDeptIds, setMyDeptIds] = useState([]);
  const [filterYear, setFilterYear] = useState("");
  const [filterSem, setFilterSem] = useState("");
  const [filterDept, setFilterDept] = useState("");
  const [drafts, setDrafts] = useState({});

  // Search and filter state for faculty table
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState("all"); // "all" | "submitted" | "pending"

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [fRes, rRes, yRes, dRes] = await Promise.all([
          supabase
            .from("users")
            .select("id, full_name, email, school_id, department")
            .eq("role", "faculty")
            .order("full_name"),
          supabase.from("evaluation_releases").select("*"),
          supabase.from("academic_years").select("*").order("start_date"),
          supabase.from("departments").select("id, name").order("name"),
        ]);
        if (cancelled) return;
        const f = fRes.data || [];
        const r = rRes.data || [];
        const y = yRes.data || [];
        setFaculty(f);
        setReleases(r);
        setYears(y);
        setDepartments(dRes.data || []);

        if (currentUser && !isSuper) {
          const { data: mine } = await supabase
            .from("admin_program_assignments")
            .select("department_id")
            .eq("admin_id", currentUser.id);
          if (!cancelled) setMyDeptIds((mine || []).map((a) => a.department_id));
        }

        const active = y.find((row) => (row.status || "").toLowerCase().trim() === "on-going") || y[0];
        if (active) {
          setFilterYear(active.year);
          setFilterSem(active.semester);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  const periodOptions = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const y of years) {
      const key = `${y.year}__${y.semester}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ year: y.year, semester: y.semester, status: y.status });
      }
    }
    return out;
  }, [years]);

  // Scope [D9/D10]: super admin manages the global row
  // (department NULL); a scoped admin manages rows for their own
  // assigned program(s) only — global rows are super-only per RLS.
  const myDeptNames = useMemo(
    () => departments.filter((d) => myDeptIds.includes(d.id)).map((d) => d.name),
    [departments, myDeptIds],
  );
  const scopeDept = isSuper ? null : (myDeptNames.includes(filterDept) ? filterDept : (myDeptNames[0] || ""));

  const periodKey = `${filterYear}__${filterSem}__${scopeDept ?? "global"}`;
  const periodSelectorValue = `${filterYear}__${filterSem}`;
  const releaseRow = releases.find(
    (r) => r.academic_year === filterYear && r.semester === filterSem && (r.department ?? null) === (scopeDept ?? null),
  );

  // Per-faculty grade status for the selected period
  const [gradeRows, setGradeRows] = useState([]);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!filterYear || !filterSem) return;
      const { data } = await supabase
        .from("grade_submissions")
        .select("faculty_id, submitted_at")
        .eq("academic_year", filterYear)
        .eq("semester", filterSem);
      if (!cancelled) setGradeRows(data || []);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [filterYear, filterSem]);

  const gradeMap = useMemo(() => {
    const m = new Map();
    for (const g of gradeRows) m.set(g.faculty_id, g.submitted_at);
    return m;
  }, [gradeRows]);

  const submittedCount = faculty.filter((f) => gradeMap.has(f.id)).length;
  const pendingCount = faculty.length - submittedCount;
  const submissionPercent = faculty.length > 0 ? Math.round((submittedCount / faculty.length) * 100) : 0;

  const derivedStatus = (row) =>
    is_period_released(row) ? "released" : row?.approved || row?.release_date ? "scheduled" : "draft";

  const setDraft = (patch) =>
    setDrafts((prev) => ({
      ...prev,
      [periodKey]: {
        ...(prev[periodKey] || {
          approved: releaseRow?.approved || false,
          release_date: releaseRow?.release_date || "",
        }),
        ...patch,
      },
    }));

  const currentDraft = drafts[periodKey] || {
    approved: releaseRow?.approved || false,
    release_date: releaseRow?.release_date || "",
  };

  const hasUnsavedChanges =
    drafts[periodKey] !== undefined &&
    (currentDraft.approved !== (releaseRow?.approved || false) ||
      (currentDraft.release_date || "") !== (releaseRow?.release_date || ""));

  const handleDiscard = () => {
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[periodKey];
      return next;
    });
  };

  // Approved without a date never releases (is_period_released rule).
  // Shared by both approval checkboxes below.
  const handleApproveToggle = (checked) => {
    setDraft({
      approved: checked,
      ...(checked && !currentDraft.release_date ? { release_date: today } : {}),
    });
  };

  const needsDate = currentDraft.approved && !currentDraft.release_date;

  const handleSave = async () => {
    if (!isSuper && !scopeDept) {
      alert("Your account has no program assignment yet. Ask a super admin to assign you a program first.");
      return;
    }
    if (currentDraft.approved && !currentDraft.release_date) {
      alert("Set a release date before saving an approval. Approved without a date stays hidden from faculty.");
      return;
    }
    setSaving(true);
    try {
      const approvedBy = currentDraft.approved
        ? (await supabase.auth.getUser()).data.user?.id
        : null;
      const payload = {
        academic_year: filterYear,
        semester: filterSem,
        department: scopeDept,
        approved: currentDraft.approved || false,
        approved_by: approvedBy,
        approved_at: currentDraft.approved ? new Date().toISOString() : null,
        release_date: currentDraft.release_date || null,
        updated_at: new Date().toISOString(),
      };

      if (releaseRow) {
        const { error } = await supabase
          .from("evaluation_releases")
          .update(payload)
          .eq("id", releaseRow.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("evaluation_releases").insert(payload);
        if (error) throw error;
      }
      const { data: refreshed } = await supabase.from("evaluation_releases").select("*");
      setReleases(refreshed || []);
      logAdminAction("release.save", "evaluation_releases", `${filterYear}:${filterSem}:${scopeDept ?? "global"}`, {
        approved: currentDraft.approved || false,
        release_date: currentDraft.release_date || null,
      });
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[periodKey];
        return next;
      });
    } catch (err) {
      console.error("Failed to save release:", err);
      alert("Could not save the release settings. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const effectiveStatus = releaseRow ? derivedStatus(releaseRow) : "draft";
  const draftStatus = derivedStatus({ ...currentDraft, approved: currentDraft.approved || false });
  const isCurrentlyReleased = releaseRow ? is_period_released(releaseRow) : false;

  // Unique departments for filter
  const uniqueDepartments = useMemo(() => {
    const set = new Set();
    faculty.forEach((f) => {
      if (f.department) set.add(f.department);
    });
    return Array.from(set).sort();
  }, [faculty]);

  // Filtered faculty list
  const filteredFaculty = useMemo(() => {
    return faculty.filter((f) => {
      // Search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = (f.full_name || "").toLowerCase().includes(q);
        const matchesId = (f.school_id || "").toLowerCase().includes(q);
        const matchesDept = (f.department || "").toLowerCase().includes(q);
        if (!matchesName && !matchesId && !matchesDept) return false;
      }

      // Department filter
      if (filterDept && f.department !== filterDept) {
        return false;
      }

      // Status filter
      const isSubmitted = gradeMap.has(f.id);
      if (filterStatus === "submitted" && !isSubmitted) return false;
      if (filterStatus === "pending" && isSubmitted) return false;

      return true;
    });
  }, [faculty, searchQuery, filterDept, filterStatus, gradeMap]);

  // Date helper functions
  const formatDateDisplay = (dateStr) => {
    if (!dateStr) return "Not Scheduled";
    try {
      const d = new Date(dateStr + "T00:00:00");
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    } catch {
      return dateStr;
    }
  };

  const getRelativeDateLabel = (dateStr) => {
    if (!dateStr) return "No date set";
    if (dateStr < today) return "Release date passed";
    if (dateStr === today) return "Releases today";
    const diffDays = Math.ceil((new Date(dateStr) - new Date(today)) / (1000 * 60 * 60 * 24));
    return `In ${diffDays} day${diffDays === 1 ? "" : "s"}`;
  };

  const setDatePreset = (daysFromToday) => {
    if (daysFromToday === null) {
      setDraft({ release_date: "" });
      return;
    }
    const d = new Date();
    d.setDate(d.getDate() + daysFromToday);
    setDraft({ release_date: d.toISOString().slice(0, 10) });
  };

  const activePeriodObj = periodOptions.find((p) => `${p.year}__${p.semester}` === periodSelectorValue);
  const statusInfo = STATUS_CONFIG[effectiveStatus] || STATUS_CONFIG.draft;
  const StatusIcon = statusInfo.icon;

  return (
    <AdminLayout title="Release Management">
      <section className="ad-content">
        {/* Page Header with Context Pill */}
        <div className="ad-rel-header-row">
          <div className="ad-rel-header-left">
            <h2 className="ad-title" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <ClipboardCheck size={26} color="#1e3a5f" />
              Release Management
            </h2>
            <p className="ad-subtitle">
              Schedule and authorize evaluation result visibility for faculty members, and monitor compliance with grade submission requirements.
            </p>
          </div>
          <div className="ad-rel-period-badge">
            <span className="ad-rel-period-dot" />
            <span>
              {filterYear && filterSem ? `${filterYear} • ${filterSem}` : "Select Period"}
              {(activePeriodObj?.status || "").toLowerCase() === "on-going" ? " (Active)" : ""}
            </span>
          </div>
        </div>

        {loading ? (
          <div className="ad-tableCard" style={{ padding: "60px 20px", textAlign: "center", color: "#64748b" }}>
            <ClipboardCheck size={36} style={{ margin: "0 auto 12px", opacity: 0.5 }} />
            <p style={{ fontWeight: 600, fontSize: "15px", margin: 0 }}>Loading release configuration...</p>
          </div>
        ) : (
          <>
            <div className="ad-filterCard">
              <div className="ad-filterGroup" style={{ gridTemplateColumns: "repeat(2, 1fr)", gap: "12px" }}>
                <select
                  className="ad-filterSelect"
                  value={periodSelectorValue}
                  onChange={(e) => {
                    const [year, sem] = e.target.value.split("__");
                    setFilterYear(year);
                    setFilterSem(sem);
                  }}
                >
                  {periodOptions.map((p) => (
                    <option key={`${p.year}__${p.semester}`} value={`${p.year}__${p.semester}`}>
                      {p.year} — {p.semester}{(p.status || "").toLowerCase() === "on-going" ? " (active)" : ""}
                    </option>
                  ))}
                </select>

                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "8px 16px",
                    borderRadius: "999px",
                    fontSize: "12px",
                    fontWeight: 700,
                    color: STATUS_COLORS[releaseRow ? effectiveStatus : "draft"],
                    background: `${STATUS_COLORS[releaseRow ? effectiveStatus : "draft"]}15`,
                  }}
                >
                  {(releaseRow ? effectiveStatus : "draft").toUpperCase()}
                </div>

                {!isSuper && (
                  <select
                    className="ad-filterSelect"
                    value={scopeDept}
                    onChange={(e) => setFilterDept(e.target.value)}
                    title="Your assigned program"
                  >
                    {myDeptNames.length === 0 && <option value="">No program assigned</option>}
                    {myDeptNames.map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                )}
              </div>

              {!isSuper && myDeptNames.length === 0 && (
                <div style={{ marginTop: "12px", fontSize: "13px", color: "#b45309" }}>
                  Your account has no program assignment yet — release controls stay disabled until a super admin assigns you a program.
                </div>
              )}

              <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", alignItems: "flex-end", marginTop: "16px" }}>
                <div>
                  <label className="ad-label" style={{ display: "block", marginBottom: "4px" }}>Release date</label>
                  <input
                    type="date"
                    className="ad-filterSelect"
                    value={currentDraft.release_date || ""}
                    onChange={(e) => setDraft({ release_date: e.target.value })}
                  />
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", fontWeight: 600, color: "#374151", paddingBottom: "8px" }}>
                  <input
                    type="checkbox"
                    checked={currentDraft.approved || false}
                    onChange={(e) => handleApproveToggle(e.target.checked)}
                  />
                  Approved for release
                </label>
                <button
                  type="button"
                  className="ad-btnSearch"
                  disabled={saving || !filterYear || (!isSuper && !scopeDept)}
                  onClick={handleSave}
                  style={{ opacity: saving ? 0.6 : 1 }}
                >
                  {saving ? "Saving..." : "Save Release Settings"}
                </button>
              </div>

              {needsDate && (
                <div style={{ marginTop: "12px", fontSize: "13px", fontWeight: 700, color: "#b45309" }}>
                  Approved without a release date stays hidden from faculty. Pick a date before saving.
                </div>
              )}

              <div style={{ marginTop: "12px", fontSize: "13px", color: "#6b7280" }}>
                Scope: <strong>{isSuper ? "All programs (global)" : (scopeDept || "—")}</strong>
                {" · "}
                {releaseRow
                  ? `Saved: ${releaseRow.approved ? "approved" : "not approved"}, release date ${releaseRow.release_date || "—"}`
                  : "No release row saved for this period yet."}
                {releaseRow && releaseRow.approved && !releaseRow.release_date && (
                  <span style={{ marginLeft: "8px", fontWeight: 700, color: "#b45309" }}>
                    → Still hidden: approval needs a release date
                  </span>
                )}
                {releaseRow && releaseRow.approved && releaseRow.release_date && (
                  <span style={{ marginLeft: "8px", fontWeight: 700, color: STATUS_COLORS[derivedStatus(releaseRow)] }}>
                    {is_period_released(releaseRow)
                      ? "→ RELEASED — faculty can see results"
                      : `→ Waiting: date passes on ${releaseRow.release_date}`}
                  </span>
                )}
              </div>
            </div>

            <div className="ad-rel-stats">
              <div className="ad-rel-stat-card">
                <div className="ad-rel-stat-top">
                  <span className="ad-rel-stat-label">Evaluation Visibility</span>
                  <div
                    className={`ad-rel-stat-icon-wrap ${
                      effectiveStatus === "released"
                        ? "ad-rel-stat-icon-wrap--green"
                        : effectiveStatus === "scheduled"
                        ? "ad-rel-stat-icon-wrap--blue"
                        : "ad-rel-stat-icon-wrap--amber"
                    }`}
                  >
                    <StatusIcon size={20} />
                  </div>
                </div>
                <div className="ad-rel-stat-val" style={{ color: statusInfo.color }}>
                  {statusInfo.label}
                </div>
                <div className="ad-rel-stat-desc">
                  {effectiveStatus === "released"
                    ? "Results active for faculty"
                    : effectiveStatus === "scheduled"
                    ? `Queued for ${formatDateDisplay(releaseRow?.release_date)}`
                    : "Admin approval required"}
                </div>
              </div>

              <div className="ad-rel-stat-card">
                <div className="ad-rel-stat-top">
                  <span className="ad-rel-stat-label">Scheduled Release Date</span>
                  <div className="ad-rel-stat-icon-wrap ad-rel-stat-icon-wrap--blue">
                    <Calendar size={20} />
                  </div>
                </div>
                <div className="ad-rel-stat-val" style={{ fontSize: "20px" }}>
                  {formatDateDisplay(releaseRow?.release_date)}
                </div>
                <div className="ad-rel-stat-desc">
                  <Clock size={13} />
                  {getRelativeDateLabel(releaseRow?.release_date)}
                </div>
              </div>

              <div className="ad-rel-stat-card">
                <div className="ad-rel-stat-top">
                  <span className="ad-rel-stat-label">Grades Submitted</span>
                  <div className="ad-rel-stat-icon-wrap ad-rel-stat-icon-wrap--green">
                    <FileCheck size={20} />
                  </div>
                </div>
                <div className="ad-rel-stat-val">
                  {submittedCount}{" "}
                  <span style={{ fontSize: "14px", fontWeight: 500, color: "#64748b" }}>
                    / {faculty.length}
                  </span>
                </div>
                <div className="ad-rel-stat-desc">
                  {submissionPercent}% of faculty have submitted grades.
                </div>
              </div>
            </div>

            <div className="ad-rel-console">
              <div className="ad-rel-panel">
                <div className="ad-rel-panel-header">
                  <div className="ad-rel-panel-icon">
                    <Calendar size={20} />
                  </div>
                  <div>
                    <h3 className="ad-rel-panel-title">Academic Period & Policy</h3>
                    <p className="ad-rel-panel-sub">Select evaluation term and review release prerequisites.</p>
                  </div>
                </div>

                <label className="ad-rel-field-label" htmlFor="periodSelect">
                  Evaluation Period
                </label>
                <select
                  id="periodSelect"
                  className="ad-filterSelect"
                  style={{ width: "100%", marginBottom: "16px", fontWeight: 600 }}
                  value={periodSelectorValue}
                  onChange={(e) => {
                    const [year, sem] = e.target.value.split("__");
                    setFilterYear(year);
                    setFilterSem(sem);
                  }}
                >
                  {periodOptions.map((p) => (
                    <option key={`${p.year}__${p.semester}`} value={`${p.year}__${p.semester}`}>
                      {p.year} — {p.semester}
                      {(p.status || "").toLowerCase() === "on-going" ? " (Active Semester)" : ""}
                    </option>
                  ))}
                </select>

                <label className="ad-rel-field-label">Institutional Release Criteria</label>
                <div className="ad-rel-policy-list">
                  <div
                    className={`ad-rel-policy-item ${
                      currentDraft.approved ? "ad-rel-policy-item--met" : "ad-rel-policy-item--unmet"
                    }`}
                  >
                    <div
                      className={`ad-rel-policy-check ${
                        currentDraft.approved ? "ad-rel-policy-check--met" : "ad-rel-policy-check--unmet"
                      }`}
                    >
                      {currentDraft.approved ? <Check size={14} /> : <X size={14} />}
                    </div>
                    <div className="ad-rel-policy-content">
                      <div className="ad-rel-policy-heading">1. Administrative Approval</div>
                      <div className="ad-rel-policy-desc">
                        {currentDraft.approved
                          ? "Approved by administration. Release authorized."
                          : "Awaiting administrative authorization switch."}
                      </div>
                    </div>
                  </div>

                  <div
                    className={`ad-rel-policy-item ${
                      currentDraft.release_date && currentDraft.release_date <= today
                        ? "ad-rel-policy-item--met"
                        : "ad-rel-policy-item--unmet"
                    }`}
                  >
                    <div
                      className={`ad-rel-policy-check ${
                        currentDraft.release_date && currentDraft.release_date <= today
                          ? "ad-rel-policy-check--met"
                          : "ad-rel-policy-check--unmet"
                      }`}
                    >
                      {currentDraft.release_date && currentDraft.release_date <= today ? (
                        <Check size={14} />
                      ) : (
                        <Clock size={14} />
                      )}
                    </div>
                    <div className="ad-rel-policy-content">
                      <div className="ad-rel-policy-heading">2. Scheduled Release Date Reached</div>
                      <div className="ad-rel-policy-desc">
                        {!currentDraft.release_date
                          ? "No release date specified. Results will not publish."
                          : currentDraft.release_date <= today
                          ? `Target date (${formatDateDisplay(currentDraft.release_date)}) reached.`
                          : `Scheduled for ${formatDateDisplay(currentDraft.release_date)}. Results remain gated until then.`}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="ad-rel-panel">
                <div className="ad-rel-panel-header">
                  <div className="ad-rel-panel-icon">
                    <ShieldCheck size={20} />
                  </div>
                  <div>
                    <h3 className="ad-rel-panel-title">Release Authorization Controls</h3>
                    <p className="ad-rel-panel-sub">Set approval toggle and target publication schedule.</p>
                  </div>
                </div>

                <div
                  className={`ad-rel-approval-card ${
                    currentDraft.approved ? "ad-rel-approval-card--active" : ""
                  }`}
                >
                  <div className="ad-rel-switch-info">
                    <span className="ad-rel-switch-title">Administrative Approval</span>
                    <span className="ad-rel-switch-sub">
                      {currentDraft.approved
                        ? "Results authorized to release on the target date."
                        : "Evaluation visibility restricted from faculty."}
                    </span>
                  </div>
                  <label className="ad-rel-switch-label" title="Toggle administrative approval">
                    <input
                      type="checkbox"
                      className="ad-rel-switch-input"
                      checked={currentDraft.approved || false}
                      onChange={(e) => handleApproveToggle(e.target.checked)}
                    />
                    <span className="ad-rel-switch-slider" />
                  </label>
                </div>

                <div className="ad-rel-date-section">
                  <label className="ad-rel-field-label" htmlFor="releaseDateInput">
                    Target Release Date
                  </label>
                  <div className="ad-rel-date-input-wrap">
                    <input
                      id="releaseDateInput"
                      type="date"
                      className="ad-rel-date-input"
                      value={currentDraft.release_date || ""}
                      min={today}
                      onChange={(e) => setDraft({ release_date: e.target.value })}
                    />
                  </div>
                  <div className="ad-rel-presets">
                    <button
                      type="button"
                      className={`ad-rel-preset-btn ${currentDraft.release_date === today ? "ad-rel-preset-btn--active" : ""}`}
                      onClick={() => setDatePreset(0)}
                    >
                      Release Today
                    </button>
                    <button
                      type="button"
                      className="ad-rel-preset-btn"
                      onClick={() => setDatePreset(1)}
                    >
                      Tomorrow
                    </button>
                    <button
                      type="button"
                      className="ad-rel-preset-btn"
                      onClick={() => setDatePreset(7)}
                    >
                      In 1 Week
                    </button>
                    {currentDraft.release_date && (
                      <button
                        type="button"
                        className="ad-rel-preset-btn"
                        style={{ color: "#ef4444" }}
                        onClick={() => setDatePreset(null)}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>

                <div className={`ad-rel-status-callout ad-rel-status-callout--${draftStatus}`}>
                  <StatusIcon size={18} style={{ flexShrink: 0, marginTop: "1px" }} />
                  <div>
                    <strong>
                      {draftStatus === "released"
                        ? "Live Access Enabled"
                        : draftStatus === "scheduled"
                        ? "Release Scheduled"
                        : "Evaluation Results Gated"}
                    </strong>
                    <div style={{ marginTop: "2px", opacity: 0.9 }}>
                      {draftStatus === "released"
                        ? "Faculty members who have submitted their grades can now view their evaluation ratings."
                        : draftStatus === "scheduled"
                        ? (currentDraft.release_date
                          ? `Results will become automatically accessible on ${formatDateDisplay(currentDraft.release_date)}.`
                          : "Approved, but no date set — still hidden. Pick a release date.")
                        : "Faculty cannot view ratings until approved AND scheduled date arrives."}
                    </div>
                  </div>
                </div>

                {hasUnsavedChanges && (
                  <div className="ad-rel-unsaved-alert">
                    <div>
                      <span className="ad-rel-unsaved-pulse" />
                      Unsaved changes for <strong>{filterYear} {filterSem}</strong>
                    </div>
                    <button
                      type="button"
                      className="ad-rel-discard-btn"
                      style={{ padding: "6px 12px", fontSize: "12px" }}
                      onClick={handleDiscard}
                    >
                      <RotateCcw size={13} style={{ marginRight: 4 }} />
                      Reset
                    </button>
                  </div>
                )}

                <div className="ad-rel-action-bar">
                  <button
                    type="button"
                    className="ad-rel-save-btn"
                    disabled={saving || !filterYear}
                    onClick={handleSave}
                  >
                    <Save size={16} />
                    {saving ? "Saving settings..." : "Save Release Settings"}
                  </button>
                  <span style={{ fontSize: "12.5px", color: "#64748b" }}>
                    {releaseRow
                      ? `Last updated: ${new Date(releaseRow.updated_at || Date.now()).toLocaleDateString()}`
                      : "No release record saved yet"}
                  </span>
                </div>
              </div>
            </div>

            <div className="ad-rel-table-card">
              <div className="ad-rel-table-header">
                <div className="ad-rel-table-header-top">
                  <div className="ad-rel-table-title-group">
                    <h3 className="ad-rel-table-title">Faculty Grade Submissions Monitor</h3>
                    <span className="ad-rel-count-pill">
                      {submittedCount} of {faculty.length} Submitted
                    </span>
                  </div>
                  <span style={{ fontSize: "13px", color: "#64748b" }}>
                    Period: <strong>{filterYear} {filterSem}</strong>
                  </span>
                </div>

                <div className="ad-rel-filter-row">
                  <div className="ad-rel-search-wrap">
                    <Search size={16} className="ad-rel-search-icon" />
                    <input
                      type="text"
                      className="ad-rel-search-input"
                      placeholder="Search faculty by name, ID, or program..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                  </div>

                  <div className="ad-rel-tabs">
                    <button
                      type="button"
                      className={`ad-rel-tab ${filterStatus === "all" ? "ad-rel-tab--active" : ""}`}
                      onClick={() => setFilterStatus("all")}
                    >
                      All ({faculty.length})
                    </button>
                    <button
                      type="button"
                      className={`ad-rel-tab ${filterStatus === "submitted" ? "ad-rel-tab--active" : ""}`}
                      onClick={() => setFilterStatus("submitted")}
                    >
                      Submitted ({submittedCount})
                    </button>
                    <button
                      type="button"
                      className={`ad-rel-tab ${filterStatus === "pending" ? "ad-rel-tab--active" : ""}`}
                      onClick={() => setFilterStatus("pending")}
                    >
                      Awaiting ({pendingCount})
                    </button>
                  </div>

                  {uniqueDepartments.length > 0 && (
                    <select
                      className="ad-filterSelect"
                      style={{ padding: "8px 12px", fontSize: "12.5px" }}
                      value={filterDept}
                      onChange={(e) => setFilterDept(e.target.value)}
                    >
                      <option value="">All Programs</option>
                      {uniqueDepartments.map((d) => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              <div className="ad-tableWrap">
                <table className="ad-table ad-table--plain">
                  <thead>
                    <tr>
                      <th>FACULTY MEMBER</th>
                      <th>SCHOOL ID</th>
                      <th>PROGRAM</th>
                      <th>GRADE STATUS</th>
                      <th style={{ textAlign: "right" }}>EVALUATION ACCESS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredFaculty.length === 0 ? (
                      <tr>
                        <td colSpan="5" style={{ textAlign: "center", padding: "48px 20px", color: "#64748b" }}>
                          <Users size={36} style={{ margin: "0 auto 10px", opacity: 0.4 }} />
                          <p style={{ margin: 0, fontWeight: 600, fontSize: "14px" }}>
                            No faculty members match your filters.
                          </p>
                          <p style={{ margin: "4px 0 0 0", fontSize: "12.5px", color: "#94a3b8" }}>
                            Try adjusting your search query or status filter.
                          </p>
                        </td>
                      </tr>
                    ) : (
                      filteredFaculty.map((f) => {
                        const submittedAt = gradeMap.get(f.id);
                        const hasAccess = isCurrentlyReleased && submittedAt;
                        const initials = (f.full_name || "??")
                          .split(" ")
                          .map((n) => n[0])
                          .slice(0, 2)
                          .join("")
                          .toUpperCase();

                        return (
                          <tr key={f.id}>
                            <td>
                              <div className="ad-avatarCell">
                                <div className="ad-avatar ad-avatar--blue">{initials}</div>
                                <div className="ad-cellLines">
                                  <span className="ad-cellPrimary">{f.full_name}</span>
                                  <span className="ad-cellSecondary">{f.email || "Faculty Member"}</span>
                                </div>
                              </div>
                            </td>
                            <td>
                              <span className="ad-code">{f.school_id || "—"}</span>
                            </td>
                            <td>
                              <span
                                style={{
                                  display: "inline-block",
                                  padding: "3px 10px",
                                  background: "#f1f5f9",
                                  color: "#334155",
                                  border: "1px solid #e2e8f0",
                                  borderRadius: "999px",
                                  fontSize: "11px",
                                  fontWeight: 700,
                                }}
                              >
                                {f.department || "General"}
                              </span>
                            </td>
                            <td>
                              {submittedAt ? (
                                <span className="ad-rel-badge ad-rel-badge--submitted">
                                  <Check size={13} />
                                  Submitted · {new Date(submittedAt).toLocaleDateString()}
                                </span>
                              ) : (
                                <span className="ad-rel-badge ad-rel-badge--pending">
                                  <Clock size={13} />
                                  Awaiting Submission
                                </span>
                              )}
                            </td>
                            <td style={{ textAlign: "right" }}>
                              {hasAccess ? (
                                <span className="ad-rel-access-badge ad-rel-access-badge--granted">
                                  <Unlock size={12} />
                                  Access Granted
                                </span>
                              ) : !isCurrentlyReleased ? (
                                <span className="ad-rel-access-badge ad-rel-access-badge--locked">
                                  <Lock size={12} />
                                  Period Gated
                                </span>
                              ) : (
                                <span className="ad-rel-access-badge ad-rel-access-badge--locked">
                                  <Lock size={12} />
                                  Grades Required
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </section>
    </AdminLayout>
  );
}
