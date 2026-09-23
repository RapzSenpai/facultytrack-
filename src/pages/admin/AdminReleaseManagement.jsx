import { useEffect, useMemo, useState } from "react";
import AdminLayout from "./AdminLayout";
import { supabase } from "../../config/supabase";
import { useAuth } from "../../context/AuthContext";
import { is_period_released } from "../../utils/periodRelease";
import { logAdminAction } from "../../utils/audit";

const STATUS_COLORS = {
  released: "#16a34a",
  scheduled: "#2563eb",
  draft: "#9ca3af",
};

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

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [fRes, rRes, yRes, dRes] = await Promise.all([
          supabase.from("users").select("id, full_name, department").eq("role", "faculty").order("full_name"),
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

  // [D2] Per-faculty grade status for the selected period — read from
  // grade_submissions via the admins-only view.
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

  const derivedStatus = (row) =>
    is_period_released(row) ? "released" : row.approved || row.release_date ? "scheduled" : "draft";

  const setDraft = (patch) =>
    setDrafts((prev) => ({
      ...prev,
      [periodKey]: { ...(prev[periodKey] || { approved: releaseRow?.approved || false, release_date: releaseRow?.release_date || "" }), ...patch },
    }));

  const currentDraft = drafts[periodKey] || {
    approved: releaseRow?.approved || false,
    release_date: releaseRow?.release_date || "",
  };

  const handleSave = async () => {
    if (!isSuper && !scopeDept) {
      alert("Your account has no program assignment yet. Ask a super admin to assign you a program first.");
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
      // The unique index is on COALESCE(department,''), so PostgREST's
      // onConflict can't target it with a NULL department column —
      // do select-then-update/insert instead.
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

  return (
    <AdminLayout title="Release Management">
      <section className="ad-content">
        <div className="ad-welcomeHeader" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <h2 className="ad-title">Release Management</h2>
            <p className="ad-subtitle">
              Results become visible to faculty only when approved AND the release date has passed.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="ad-tableCard" style={{ padding: "40px", textAlign: "center", color: "#6b7280" }}>
            Loading release data...
          </div>
        ) : (
          <>
            {/* Period picker + release controls */}
            <div className="ad-filterCard">
              <div className="ad-filterGroup" style={{ gridTemplateColumns: "repeat(2, 1fr)", gap: "12px" }}>
                <select className="ad-filterSelect" value={periodSelectorValue} onChange={(e) => {
                  const [year, sem] = e.target.value.split("__");
                  setFilterYear(year);
                  setFilterSem(sem);
                }}>
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
                    onChange={(e) => setDraft({ approved: e.target.checked })}
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

              <div style={{ marginTop: "12px", fontSize: "13px", color: "#6b7280" }}>
                Scope: <strong>{isSuper ? "All programs (global)" : (scopeDept || "—")}</strong>
                {" · "}
                {releaseRow
                  ? `Saved: ${releaseRow.approved ? "approved" : "not approved"}, release date ${releaseRow.release_date || "—"}`
                  : "No release row saved for this period yet."}
                {releaseRow && releaseRow.approved && releaseRow.release_date && (
                  <span style={{ marginLeft: "8px", fontWeight: 700, color: STATUS_COLORS[derivedStatus(releaseRow)] }}>
                    {is_period_released(releaseRow)
                      ? "→ RELEASED — faculty can see results"
                      : `→ Waiting: date passes on ${releaseRow.release_date}`}
                  </span>
                )}
              </div>
            </div>

            {/* Per-faculty grade status [D2] */}
            <div className="ad-tableCard">
              <div className="fd-tableHeader" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 24px", borderBottom: "1px solid #f1f5f9" }}>
                <h3 className="fd-tableTitle" style={{ fontSize: "14px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  Grades Submitted — {submittedCount}/{faculty.length} faculty
                </h3>
                <span className="fd-criteriaPillMain">{filterYear} {filterSem}</span>
              </div>
              <div className="ad-tableWrap">
                <table className="ad-table">
                  <thead>
                    <tr>
                      <th>FACULTY NAME</th>
                      <th>PROGRAM</th>
                      <th>GRADES STATUS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {faculty.length === 0 ? (
                      <tr><td colSpan="3" style={{ textAlign: "center", padding: "24px", color: "#6b7280" }}>No faculty found.</td></tr>
                    ) : (
                      faculty.map((f) => {
                        const submittedAt = gradeMap.get(f.id);
                        return (
                          <tr key={f.id}>
                            <td className="ad-name">{f.full_name || f.id}</td>
                            <td className="ad-engagement">{f.department || "—"}</td>
                            <td className="ad-engagement">
                              {submittedAt ? (
                                <span style={{ color: STATUS_COLORS.released, fontWeight: 700 }}>
                                  Submitted ✓{submittedAt ? ` · ${new Date(submittedAt).toLocaleDateString()}` : ""}
                                </span>
                              ) : (
                                <span style={{ color: "#f59e0b", fontWeight: 700 }}>Not yet</span>
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

      {/* Draft-status reminder (visible only when unsaved changes exist) */}
      {!loading && drafts[periodKey] && (
        <div style={{ margin: "0 24px 24px", padding: "12px 16px", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: "8px", fontSize: "13px", color: "#1d4ed8" }}>
          Unsaved changes for {filterYear} {filterSem} — preview status: <strong>{draftStatus.toUpperCase()}</strong>.
          Remember: a passed date without approval keeps results hidden.
        </div>
      )}
    </AdminLayout>
  );
}
