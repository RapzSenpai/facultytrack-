import { useEffect, useMemo, useState } from "react";
import AdminLayout from "./AdminLayout";
import { supabase } from "../../config/supabase";
import { useAuth } from "../../context/AuthContext";

// Phase 1 SuperAdmin revamp: system-wide monitoring (super-only).
// Tab 1 — Activity: audit_log trail (027 read path) with actor names.
// Tab 2 — Data Health: orphan/duplicate/backlog detectors computed
// client-side from existing tables. Read-only; every fix action lives
// in its owning page (shown as a hint, not a button).
export default function AdminMonitor() {
  const { userProfile } = useAuth();
  const isSuper = userProfile?.role === "super_admin";
  const [tab, setTab] = useState("activity");
  const [loading, setLoading] = useState(true);
  const [audit, setAudit] = useState([]);
  const [users, setUsers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [criteria, setCriteria] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [flagCount, setFlagCount] = useState(0);
  const [priorityCount, setPriorityCount] = useState(0);
  const [fetchError, setFetchError] = useState("");
  const [auditSearch, setAuditSearch] = useState("");
  const [auditAction, setAuditAction] = useState("");

  useEffect(() => {
    if (!isSuper) return;
    const load = async () => {
      try {
        const [auditRes, usersRes, deptRes, assignRes, critRes, perRes, flagRes, priRes] = await Promise.all([
          supabase.from("audit_log").select("*").order("created_at", { ascending: false }).limit(200),
          supabase.from("users").select("id, full_name, email, role, status, department, department_id, created_at"),
          supabase.from("departments").select("id, name").order("name"),
          supabase.from("admin_program_assignments").select("admin_id, department_id"),
          supabase.from("criteria").select("id, name, department_id"),
          supabase.from("academic_years").select("id, year, semester, department_id"),
          supabase.from("evaluations").select("id", { count: "exact", head: true }).eq("moderation_status", "flag"),
          supabase.from("priority_reviews").select("id", { count: "exact", head: true }).in("status", ["new", "acknowledged"]),
        ]);
        const firstErr = [auditRes, usersRes, deptRes, assignRes, critRes, perRes, flagRes, priRes].find((r) => r.error);
        if (firstErr) throw new Error(firstErr.error.message);
        setAudit(auditRes.data || []);
        setUsers(usersRes.data || []);
        setDepartments(deptRes.data || []);
        setAssignments(assignRes.data || []);
        setCriteria(critRes.data || []);
        setPeriods(perRes.data || []);
        setFlagCount(flagRes.count || 0);
        setPriorityCount(priRes.count || 0);
      } catch (err) {
        console.error("Monitor load error:", err);
        setFetchError(err.message || "Could not load monitoring data.");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [isSuper]);

  const actorLabel = useMemo(() => {
    const m = new Map();
    for (const u of users) m.set(u.id, `${u.full_name || u.email} (${u.role})`);
    return (id) => m.get(id) || (id || "—");
  }, [users]);

  const auditActions = useMemo(
    () => Array.from(new Set(audit.map((a) => a.action))).sort(),
    [audit],
  );

  const filteredAudit = audit.filter((a) =>
    (!auditAction || a.action === auditAction) &&
    (!auditSearch || JSON.stringify([a.action, a.entity, a.entity_id, actorLabel(a.actor_id)]).toLowerCase().includes(auditSearch.toLowerCase()))
  );

  const deptName = (id) => departments.find((d) => d.id === id)?.name || "—";

  const health = useMemo(() => {
    const norm = (v) => String(v || "").trim().toLowerCase();
    const programLess = users.filter((u) =>
      (u.role === "faculty" || u.role === "student") && !u.department_id && !norm(u.department));
    const pending = users.filter((u) => (u.status || "").toLowerCase() === "pending");
    const unownedCriteria = criteria.filter((c) => !c.department_id);
    const unownedPeriods = periods.filter((p) => !p.department_id);
    const seen = new Map();
    for (const d of departments) {
      const k = norm(d.name);
      if (!seen.has(k)) seen.set(k, []);
      seen.get(k).push(d);
    }
    const dupes = Array.from(seen.values()).filter((g) => g.length > 1);
    const assignedDeptIds = new Set(assignments.map((a) => a.department_id));
    const uncovered = departments.filter((d) => !assignedDeptIds.has(d.id));
    return { programLess, pending, unownedCriteria, unownedPeriods, dupes, uncovered };
  }, [users, criteria, periods, departments, assignments]);

  if (!isSuper) {
    return (
      <AdminLayout title="System Monitor">
        <section className="ad-content">
          <div className="ad-tableCard ad-tableCard--padded">Super admin only.</div>
        </section>
      </AdminLayout>
    );
  }

  const cards = [
    { label: "Program-less accounts", value: health.programLess.length, hint: "Fix in Faculty / Student Management" },
    { label: "Pending approvals", value: health.pending.length, hint: "Fix in Approvals" },
    { label: "Unowned criteria", value: health.unownedCriteria.length, hint: "Claim in Questionnaire or delete" },
    { label: "Shared periods", value: health.unownedPeriods.length, hint: "Assign in Evaluation Period" },
    { label: "Duplicate programs", value: health.dupes.reduce((n, g) => n + g.length, 0), hint: "Merge via SQL (see below)" },
    { label: "Programs with no admin", value: health.uncovered.length, hint: "Fix in Program Assignments" },
    { label: "Flagged comments", value: flagCount, hint: "Triage in Moderation & Priority" },
    { label: "Open priority cases", value: priorityCount, hint: "Triage in Moderation & Priority" },
  ];

  return (
    <AdminLayout title="System Monitor">
      <section className="ad-content">
        <div className="ad-welcomeHeader" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <h2 className="ad-title">System Monitor</h2>
            <p className="ad-subtitle">Cross-program activity and data health. Read-only.</p>
          </div>
        </div>

        <div style={{ display: "flex", gap: "8px", marginBottom: "16px", flexWrap: "wrap" }}>
          {[
            { key: "activity", label: `Activity (${audit.length})` },
            { key: "health", label: "Data Health" },
          ].map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              style={{
                padding: "8px 18px", borderRadius: "999px",
                border: tab === t.key ? "none" : "1px solid #e5e7eb",
                background: tab === t.key ? "#1e3a5f" : "#fff",
                color: tab === t.key ? "#fff" : "#374151",
                fontWeight: 700, fontSize: "13px", cursor: "pointer",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="ad-tableCard" style={{ padding: "40px", textAlign: "center", color: "#6b7280" }}>Loading monitoring data...</div>
        ) : fetchError ? (
          <div className="ad-tableCard ad-tableCard--padded" style={{ color: "#b91c1c" }}>
            {fetchError} (Run migration 027, then reload.)
          </div>
        ) : tab === "activity" ? (
          <div className="ad-tableCard ad-tableCard--padded">
            <div className="ad-filterBar">
              <div className="ad-searchWrap">
                <input type="text" className="ad-searchInput" placeholder="Search actor, action, entity..." value={auditSearch} onChange={(e) => setAuditSearch(e.target.value)} />
              </div>
              <select className="ad-filterSelect" value={auditAction} onChange={(e) => setAuditAction(e.target.value)}>
                <option value="">All actions</option>
                {auditActions.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
              <span className="ad-filterCount">Showing <strong>{filteredAudit.length}</strong> of <strong>{audit.length}</strong> (latest 200)</span>
            </div>
            <div className="ad-tableWrap ad-tableWrap--bordered">
              <table className="ad-table ad-table--plain">
                <thead>
                  <tr><th>Time</th><th>Actor</th><th>Action</th><th>Entity</th><th>Details</th></tr>
                </thead>
                <tbody>
                  {filteredAudit.length === 0 ? (
                    <tr><td colSpan="5" style={{ textAlign: "center", padding: "24px", color: "#6b7280" }}>No audit entries yet.</td></tr>
                  ) : filteredAudit.map((a) => (
                    <tr key={a.id}>
                      <td className="ad-code">{new Date(a.created_at).toLocaleString()}</td>
                      <td>{actorLabel(a.actor_id)}</td>
                      <td><span className="ad-code">{a.action}</span></td>
                      <td>{a.entity}{a.entity_id ? ` · ${String(a.entity_id).slice(0, 8)}` : ""}</td>
                      <td style={{ maxWidth: "320px", overflow: "hidden", textOverflow: "ellipsis", fontSize: "12px", color: "#6b7280" }}>{JSON.stringify(a.details)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "12px", marginBottom: "16px" }}>
              {cards.map((c) => (
                <div key={c.label} className="ad-tableCard" style={{ padding: "16px 18px" }}>
                  <div style={{ fontSize: "26px", fontWeight: 800, color: c.value > 0 ? "#b45309" : "#16a34a" }}>{c.value}</div>
                  <div style={{ fontWeight: 700, fontSize: "13px" }}>{c.label}</div>
                  <div style={{ fontSize: "12px", color: "#6b7280" }}>{c.hint}</div>
                </div>
              ))}
            </div>
            {health.programLess.length > 0 && (
              <div className="ad-tableCard ad-tableCard--padded" style={{ marginBottom: "16px" }}>
                <h3 className="fd-tableTitle">Program-less accounts ({health.programLess.length})</h3>
                <div style={{ fontSize: "13px", color: "#374151" }}>
                  {health.programLess.slice(0, 20).map((u) => `${u.full_name || u.email} (${u.role})`).join(" · ")}
                  {health.programLess.length > 20 && ` · +${health.programLess.length - 20} more`}
                </div>
              </div>
            )}
            {health.dupes.length > 0 && (
              <div className="ad-tableCard ad-tableCard--padded" style={{ marginBottom: "16px" }}>
                <h3 className="fd-tableTitle">Duplicate program names</h3>
                {health.dupes.map((g) => (
                  <div key={g[0].id} style={{ fontSize: "13px", color: "#374151", marginBottom: "6px" }}>
                    <strong>{g[0].name}</strong> — {g.length} rows. Merge with SQL, keeping one id and repointing assignments:
                    <div className="ad-code" style={{ marginTop: "4px" }}>
                      {`UPDATE admin_program_assignments SET department_id = '${g[0].id}' WHERE department_id IN (${g.slice(1).map((d) => `'${d.id}'`).join(", ")});`}
                    </div>
                    {g.slice(1).map((d) => (
                      <div key={d.id} className="ad-code">{`-- then: UPDATE <table> SET department_id = '${g[0].id}' WHERE department_id = '${d.id}'; DELETE FROM departments WHERE id = '${d.id}';`}</div>
                    ))}
                  </div>
                ))}
              </div>
            )}
            {health.uncovered.length > 0 && (
              <div className="ad-tableCard ad-tableCard--padded">
                <h3 className="fd-tableTitle">Programs with no admin ({health.uncovered.length})</h3>
                <div style={{ fontSize: "13px", color: "#374151" }}>
                  {health.uncovered.map((d) => deptName(d.id)).join(" · ")} — assign in Program Assignments.
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </AdminLayout>
  );
}
