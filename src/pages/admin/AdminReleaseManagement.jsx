import { useEffect, useMemo, useState } from "react";
import AdminLayout from "./AdminLayout";
import { supabase } from "../../config/supabase";
import { useAuth } from "../../context/AuthContext";
import { is_period_released } from "../../utils/periodRelease";
import { isPeriodActive } from "../../utils/periodStatus";
import { logAdminAction } from "../../utils/audit";
import { notifyFacultyOnRelease } from "../../utils/notifications";
import {
  ClipboardCheck,
  Calendar,
  ShieldCheck,
  Clock,
  Save,
  RotateCcw,
  Eye,
  EyeOff,
  Check,
  X,
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
  const [toast, setToast] = useState(null);

  const showToast = (message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

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
          supabase.from("academic_years").select("*, departments(name)").order("start_date"),
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

        const inScopeY = (r) => isSuper || !r.department_id || myDeptIds.includes(r.department_id);
        const active = y.find((row) => inScopeY(row) && isPeriodActive(row))
          || y.find((row) => isPeriodActive(row)) || y[0];
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
    // D9: scoped admin picks from own-program + shared periods only.
    const inScope = (y) => isSuper || !y.department_id || myDeptIds.includes(y.department_id);
    for (const y of years) {
      if (!inScope(y)) continue;
      const key = `${y.year}__${y.semester}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ year: y.year, semester: y.semester, status: y.status, end_date: y.end_date });
      }
    }
    return out;
  }, [years, isSuper, myDeptIds]);

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

  // Faculty without a program never match a scoped release row
  // (gate compares release.department to users.department text).
  const unassignedCount = faculty.filter((f) => !f.department || !String(f.department).trim()).length;

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
    // D9/D10: scoped admins can only write their own program row —
    // never the global (NULL department) row, which is super-only.
    const targetDept = isSuper ? null : (scopeDept || "");
    if (!isSuper && !targetDept) {
      showToast("Your account has no program assignment yet. Ask a super admin to assign you a program first.", "error");
      return;
    }
    if (needsDate) {
      showToast("Set a release date before saving an approval. Approved without a date stays hidden from faculty.", "error");
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
        department: targetDept,
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
      logAdminAction("release.save", "evaluation_releases", `${filterYear}:${filterSem}:${targetDept ?? "global"}`, {
        approved: currentDraft.approved || false,
        release_date: currentDraft.release_date || null,
      });
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[periodKey];
        return next;
      });

      showToast("Release settings saved successfully.", "success");

      // Notify faculty if period is live and released
      if (payload.approved && payload.release_date && payload.release_date <= today) {
        notifyFacultyOnRelease({
          academicYear: filterYear,
          semester: filterSem,
          department: targetDept,
        }).catch((err) => console.warn("notifyFacultyOnRelease warning:", err));
      }
    } catch (err) {
      console.error("Failed to save release:", err);
      showToast("Could not save release settings: " + (err.message || "Please try again."), "error");
    } finally {
      setSaving(false);
    }
  };

  const effectiveStatus = releaseRow ? derivedStatus(releaseRow) : "draft";
  // A released global (all-program) row makes results visible to EVERY
  // program — flag its blast radius explicitly (super-only surface).
  const globalReleasedRow = releases.find(
    (r) => r.academic_year === filterYear && r.semester === filterSem
      && (r.department ?? null) === null && is_period_released(r),
  );
  const draftStatus = derivedStatus({ ...currentDraft, approved: currentDraft.approved || false });

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
    <AdminLayout title={<span style={{ color: "#9ca3af" }}>Admin &gt; <strong style={{ color: "#111827" }}>Release Management</strong></span>}>
      <section className="ad-content">
        {/* Welcome Header */}
        <div className="ad-welcomeHeader" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", marginBottom: "22px" }}>
          <div>
            <h2 className="ad-title">Release Management</h2>
            <p className="ad-subtitle">Manage evaluation result visibility and publication schedule</p>
          </div>
          <div className="ad-rel-period-badge">
            <span className="ad-rel-period-dot" />
            <span>
              {filterYear && filterSem ? `${filterYear} • ${filterSem}` : "Select Period"}
              {isPeriodActive(activePeriodObj) ? " (Active)" : ""}
            </span>
          </div>
        </div>

        {/* In-app Toast Banner */}
        {toast && (
          <div
            style={{
              background: toast.type === "error" ? "#fef2f2" : "#ecfdf5",
              color: toast.type === "error" ? "#991b1b" : "#065f46",
              border: `1px solid ${toast.type === "error" ? "#fecaca" : "#a7f3d0"}`,
              padding: "12px 18px",
              borderRadius: "10px",
              fontWeight: "700",
              fontSize: "13.5px",
              marginBottom: "20px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            {toast.type === "error" ? <X size={18} /> : <Check size={18} />}
            <span>{toast.message}</span>
          </div>
        )}

        {loading ? (
          <div className="ad-tableCard" style={{ padding: "60px 20px", textAlign: "center", color: "#64748b" }}>
            <ClipboardCheck size={36} style={{ margin: "0 auto 12px", opacity: 0.5 }} />
            <p style={{ fontWeight: 600, fontSize: "15px", margin: 0 }}>Loading release configuration...</p>
          </div>
        ) : (
          <>
            {/* Filter Bar */}
            <div className="ad-filterCard" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", flexWrap: "wrap", marginBottom: "20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span className="ad-label" style={{ fontWeight: 700, fontSize: "12.5px", color: "#475569" }}>Academic Period:</span>
                  <select
                    className="ad-filterSelect"
                    style={{ minWidth: "250px", fontWeight: 600 }}
                    value={periodSelectorValue}
                    onChange={(e) => {
                      const [year, sem] = e.target.value.split("__");
                      setFilterYear(year);
                      setFilterSem(sem);
                    }}
                  >
                    {periodOptions.map((p) => (
                      <option key={`${p.year}__${p.semester}`} value={`${p.year}__${p.semester}`}>
                        {p.year} — {p.semester}{isPeriodActive(p) ? " (Active)" : ""}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span className="ad-label" style={{ fontWeight: 700, fontSize: "12.5px", color: "#475569" }}>Department Scope:</span>
                  {isSuper ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "7px 12px", borderRadius: "8px", background: "#f1f5f9", border: "1px solid #e2e8f0", fontSize: "12.5px", fontWeight: 600, color: "#334155" }}>
                      🏢 All Programs (Global Super Admin)
                    </span>
                  ) : (
                    <select
                      className="ad-filterSelect"
                      style={{ fontWeight: 600 }}
                      value={scopeDept}
                      onChange={(e) => setFilterDept(e.target.value)}
                      title="Your assigned program"
                    >
                      {myDeptNames.length === 0 && <option value="">No program assigned</option>}
                      {myDeptNames.map((n) => (
                        <option key={n} value={n}>🏢 {n}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            </div>

            {/* 3-Card Executive KPI Strip */}
            <div className="ad-kpiGrid">
              <div className={`ad-kpiCard ${effectiveStatus === "released" ? "ad-kpiCard--success" : effectiveStatus === "scheduled" ? "ad-kpiCard--primary" : "ad-kpiCard--amber"}`}>
                <div className="ad-kpiHeader">
                  <span className="ad-kpiLabel">Evaluation Visibility</span>
                  <span className="ad-kpiIcon">
                    <StatusIcon size={18} />
                  </span>
                </div>
                <div className="ad-kpiBody">
                  <span className="ad-kpiValue" style={{ fontSize: "22px", color: statusInfo.color }}>
                    {statusInfo.label}
                  </span>
                  <span className={`ad-kpiBadge ${effectiveStatus === "released" ? "ad-kpiBadge--success" : effectiveStatus === "scheduled" ? "ad-kpiBadge--info" : "ad-kpiBadge--warning"}`}>
                    {effectiveStatus === "released" ? "Live" : effectiveStatus === "scheduled" ? "Queued" : "Restricted"}
                  </span>
                </div>
              </div>

              <div className="ad-kpiCard ad-kpiCard--info">
                <div className="ad-kpiHeader">
                  <span className="ad-kpiLabel">Scheduled Release Date</span>
                  <span className="ad-kpiIcon">
                    <Calendar size={18} />
                  </span>
                </div>
                <div className="ad-kpiBody">
                  <span className="ad-kpiValue" style={{ fontSize: "22px" }}>
                    {formatDateDisplay(releaseRow?.release_date)}
                  </span>
                  {releaseRow?.release_date && (
                    <span className="ad-kpiBadge ad-kpiBadge--info">
                      {getRelativeDateLabel(releaseRow?.release_date)}
                    </span>
                  )}
                </div>
              </div>

              <div className="ad-kpiCard ad-kpiCard--primary">
                <div className="ad-kpiHeader">
                  <span className="ad-kpiLabel">Program Scope</span>
                  <span className="ad-kpiIcon">
                    <ShieldCheck size={18} />
                  </span>
                </div>
                <div className="ad-kpiBody">
                  <span className="ad-kpiValue" style={{ fontSize: "22px" }}>
                    {isSuper ? "All Programs" : (scopeDept || "Unassigned")}
                  </span>
                  <span className="ad-kpiBadge ad-kpiBadge--info">
                    {isSuper ? "Global" : "Scoped"}
                  </span>
                </div>
              </div>
            </div>

            {/* Scoped / Super Admin Context Alerts */}
            {isSuper && globalReleasedRow && (
              <div className="ad-rel-unsaved-alert" style={{ borderColor: "#fca5a5", background: "#fef2f2", color: "#991b1b", marginBottom: "16px" }}>
                <div>
                  <span className="ad-rel-unsaved-pulse" style={{ background: "#dc2626" }} />
                  Global release is live for <strong>{filterYear} {filterSem}</strong> across all programs.
                </div>
              </div>
            )}

            {!isSuper && myDeptNames.length === 0 && (
              <div className="ad-rel-unsaved-alert" style={{ borderColor: "#fde68a", background: "#fffbeb", color: "#92400e", marginBottom: "16px" }}>
                <div>
                  <span className="ad-rel-unsaved-pulse" style={{ background: "#d97706" }} />
                  Your account has no program assignment yet — controls remain disabled until assigned.
                </div>
              </div>
            )}

            {unassignedCount > 0 && (
              <div className="ad-rel-unsaved-alert" style={{ borderColor: "#bfdbfe", background: "#eff6ff", color: "#1e40af", marginBottom: "16px" }}>
                <div>
                  <span className="ad-rel-unsaved-pulse" style={{ background: "#2563eb" }} />
                  {unassignedCount} faculty member{unassignedCount === 1 ? " has" : "s have"} no program assigned and won't match scoped releases.
                </div>
              </div>
            )}

            {/* Focused Release Settings Card */}
            <div className="ad-rel-settings-card">
              <div className="ad-rel-settings-header">
                <h3 className="ad-rel-settings-title">Release Settings</h3>
              </div>

              {/* Approval Switch */}
              <div
                className={`ad-rel-approval-card ${
                  currentDraft.approved ? "ad-rel-approval-card--active" : ""
                }`}
              >
                <div className="ad-rel-switch-info">
                  <span className="ad-rel-switch-title">Administrative Approval</span>
                  <span className="ad-rel-switch-sub">
                    {currentDraft.approved
                      ? "Results authorized to release on the scheduled date"
                      : "Visibility restricted from faculty"}
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

              {/* Target Release Date */}
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
                    Today
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

              {/* Concise 1-line Alert Banner */}
              <div className={`ad-rel-status-callout ad-rel-status-callout--${draftStatus}`}>
                <StatusIcon size={18} style={{ flexShrink: 0, marginTop: "1px" }} />
                <span style={{ fontWeight: 600 }}>
                  {draftStatus === "released"
                    ? "Evaluation results are currently published and visible to faculty."
                    : draftStatus === "scheduled"
                    ? (currentDraft.release_date
                      ? `Results will automatically become visible on ${formatDateDisplay(currentDraft.release_date)}.`
                      : "Approval is granted, but a release date is required to publish.")
                    : "Results remain hidden until administrative approval and scheduled date are reached."}
                </span>
              </div>

              {/* Unsaved Changes Banner */}
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

              {/* Card Footer with Save button */}
              <div className="ad-rel-action-bar">
                <button
                  type="button"
                  className="ad-rel-save-btn"
                  disabled={saving || !filterYear || (!isSuper && !scopeDept)}
                  onClick={handleSave}
                >
                  <Save size={16} />
                  {saving ? "Saving settings..." : "Save Release Settings"}
                </button>
                <span style={{ fontSize: "12.5px", color: "#64748b" }}>
                  {releaseRow
                    ? `Last saved: ${new Date(releaseRow.updated_at || Date.now()).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
                    : "No release record saved yet"}
                </span>
              </div>
            </div>
          </>
        )}
      </section>
    </AdminLayout>
  );
}
