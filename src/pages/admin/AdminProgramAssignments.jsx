import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { createClient } from "@supabase/supabase-js";
import AdminLayout from "./AdminLayout";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../config/supabase";
import { logAdminAction } from "../../utils/audit";

// Phase 7 [D8/D9]: Program Head = Admin with a program assignment.
// Only the super admin manages assignments here; RLS enforces the
// same rule server-side (writes require is_super_admin()).
export default function AdminProgramAssignments() {
  const { userProfile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [admins, setAdmins] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [selectedAdmin, setSelectedAdmin] = useState("");
  const [checked, setChecked] = useState(new Set());

  // Add Program Head form (super-only): admins cannot self-register,
  // so creation lives here. Signup runs on an isolated client so the
  // new session never replaces the super admin's own session.
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newDeptIds, setNewDeptIds] = useState(new Set());
  const [creating, setCreating] = useState(false);
  const [createMsg, setCreateMsg] = useState("");
  const [createErr, setCreateErr] = useState("");

  const toggleNewDept = (deptId) => {
    setNewDeptIds((prev) => {
      const next = new Set(prev);
      if (next.has(deptId)) next.delete(deptId);
      else next.add(deptId);
      return next;
    });
  };

  const reloadAdmins = async () => {
    const [adminRes, assignRes] = await Promise.all([
      supabase.from("users").select("id, full_name, email, role").in("role", ["admin", "super_admin"]).order("full_name"),
      supabase.from("admin_program_assignments").select("admin_id, department_id"),
    ]);
    setAdmins(adminRes.data || []);
    setAssignments(assignRes.data || []);
  };

  const handleCreateHead = async () => {
    setCreateMsg("");
    setCreateErr("");
    const name = newName.trim();
    const email = newEmail.trim();
    if (!name || !email || newPassword.length < 6) {
      setCreateErr("Name, valid email, and a 6+ character temporary password are required.");
      return;
    }
    if (newDeptIds.size === 0) {
      setCreateErr("Pick at least one program — an admin with no programs sees nothing.");
      return;
    }
    setCreating(true);
    try {
      // Isolated client: persistSession false keeps everything in
      // memory, so the super admin stays signed in on the main client.
      const tempAuth = createClient(
        import.meta.env.VITE_SUPABASE_URL,
        import.meta.env.VITE_SUPABASE_ANON_KEY,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      const { data: signUpData, error: signUpError } = await tempAuth.auth.signUp({
        email,
        password: newPassword,
        options: { data: { full_name: name, role: "student" } },
      });
      if (signUpError) {
        if (signUpError.message?.toLowerCase().includes("already")) {
          throw new Error("That email is already registered — pick them from the admin list to adjust programs.");
        }
        throw signUpError;
      }
      const newId = signUpData?.user?.id;
      if (!newId) throw new Error("Signup returned no user. Please try again.");

      // Promote: the signup trigger clamps roles to student/faculty,
      // so elevation happens here, as super admin, via RLS-allowed update.
      const { data: promoted, error: promoteError } = await supabase
        .from("users")
        .update({ full_name: name, role: "admin", status: "active", approved_at: new Date().toISOString() })
        .eq("id", newId)
        .select("id");
      if (promoteError) throw promoteError;
      if (!promoted || promoted.length === 0) {
        throw new Error("Account created but promotion failed. Assign manually or remove the account and retry.");
      }

      const { error: assignError } = await supabase
        .from("admin_program_assignments")
        .insert([...newDeptIds].map((department_id) => ({ admin_id: newId, department_id })));
      if (assignError) throw assignError;

      logAdminAction("admin.create", "users", newId, { programs: newDeptIds.size });
      await reloadAdmins();
      setSelectedAdmin(newId);
      setNewName("");
      setNewEmail("");
      setNewPassword("");
      setNewDeptIds(new Set());
      setCreateMsg(`${name} is now a Program Head. Hand them the temporary password; if email confirmation is on, they must verify their inbox before first login.`);
    } catch (err) {
      setCreateErr(err.message || "Could not create the admin. Please try again.");
    } finally {
      setCreating(false);
    }
  };

  const isSuper = userProfile?.role === "super_admin";

  useEffect(() => {
    if (!isSuper) return;
    const load = async () => {
      try {
        const [adminRes, deptRes, assignRes] = await Promise.all([
          supabase.from("users").select("id, full_name, email, role").in("role", ["admin", "super_admin"]).order("full_name"),
          supabase.from("departments").select("id, name").order("name"),
          supabase.from("admin_program_assignments").select("admin_id, department_id"),
        ]);
        setAdmins(adminRes.data || []);
        setDepartments(deptRes.data || []);
        setAssignments(assignRes.data || []);
        const first = (adminRes.data || []).find((a) => a.role === "admin");
        if (first) setSelectedAdmin(first.id);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [isSuper]);

  const assignmentsByAdmin = useMemo(() => {
    const m = new Map();
    for (const a of assignments) {
      if (!m.has(a.admin_id)) m.set(a.admin_id, new Set());
      m.get(a.admin_id).add(a.department_id);
    }
    return m;
  }, [assignments]);

  useEffect(() => {
    setChecked(new Set(assignmentsByAdmin.get(selectedAdmin) || new Set()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAdmin, assignments]);

  const toggle = (deptId) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(deptId)) next.delete(deptId);
      else next.add(deptId);
      return next;
    });
  };

  const handleSave = async () => {
    if (!selectedAdmin || saving) return;
    setSaving(true);
    try {
      const current = assignmentsByAdmin.get(selectedAdmin) || new Set();
      const toAdd = [...checked].filter((id) => !current.has(id));
      const toRemove = [...current].filter((id) => !checked.has(id));

      if (toAdd.length > 0) {
        const { error } = await supabase
          .from("admin_program_assignments")
          .insert(toAdd.map((department_id) => ({ admin_id: selectedAdmin, department_id })));
        if (error) throw error;
      }
      for (const department_id of toRemove) {
        const { error } = await supabase
          .from("admin_program_assignments")
          .delete()
          .eq("admin_id", selectedAdmin)
          .eq("department_id", department_id);
        if (error) throw error;
      }
      setAssignments((prev) => [
        ...prev.filter((a) => a.admin_id !== selectedAdmin),
        ...[...checked].map((department_id) => ({ admin_id: selectedAdmin, department_id })),
      ]);
      logAdminAction("program_assignments.save", "admin_program_assignments", selectedAdmin, {
        added: toAdd.length,
        removed: toRemove.length,
      });
    } catch (err) {
      console.error("Failed to save assignments:", err);
      alert("Could not save the program assignments. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (!isSuper) {
    return <Navigate to="/admin/dashboard" replace />;
  }

  const selected = admins.find((a) => a.id === selectedAdmin);

  return (
    <AdminLayout title="Program Assignments">
      <section className="ad-content">
        <div className="ad-welcomeHeader">
          <div>
            <h2 className="ad-title">Program Assignments</h2>
            <p className="ad-subtitle">
              Program Head = Admin with a program assignment [D8]. Assigned admins manage ONLY their programs [D9];
              super admins see everything.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="ad-tableCard" style={{ padding: "40px", textAlign: "center", color: "#6b7280" }}>
            Loading assignments...
          </div>
        ) : (
          <>
          {/* Add Program Head: admins cannot self-register, so the
              super admin creates the account + programs in one step. */}
          <div className="ad-tableCard" style={{ marginBottom: "20px", padding: "20px 24px" }}>
            <h3 className="fd-tableTitle" style={{ fontSize: "14px", fontWeight: 800, textTransform: "uppercase", marginBottom: "4px" }}>
              Add Program Head
            </h3>
            <p style={{ fontSize: "13px", color: "#6b7280", margin: "0 0 14px" }}>
              Creates the login, promotes it to admin, and assigns programs — all at once.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px", marginBottom: "12px" }}>
              <input
                className="ad-filterSelect"
                placeholder="Full name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
              <input
                className="ad-filterSelect"
                placeholder="Email"
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
              />
              <input
                className="ad-filterSelect"
                placeholder="Temporary password (6+ chars)"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 18px", marginBottom: "12px" }}>
              {departments.map((d) => (
                <label key={d.id} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13.5px", color: "#374151", cursor: "pointer" }}>
                  <input type="checkbox" checked={newDeptIds.has(d.id)} onChange={() => toggleNewDept(d.id)} />
                  <span style={{ fontWeight: 600 }}>{d.name}</span>
                </label>
              ))}
            </div>
            {createErr && <p style={{ fontSize: "13px", color: "#b91c1c", margin: "0 0 8px" }}>{createErr}</p>}
            {createMsg && <p style={{ fontSize: "13px", color: "#065f46", margin: "0 0 8px" }}>{createMsg}</p>}
            <button
              type="button"
              className="ad-btnSearch"
              disabled={creating}
              onClick={handleCreateHead}
              style={{ opacity: creating ? 0.6 : 1 }}
            >
              {creating ? "Creating..." : "Create Program Head"}
            </button>
          </div>
          <div style={{ display: "flex", gap: "20px", flexWrap: "wrap", alignItems: "flex-start" }}>
            {/* Admin picker + overview */}
            <div className="ad-tableCard" style={{ flex: "1 1 300px" }}>
              <div className="fd-tableHeader" style={{ padding: "20px 24px", borderBottom: "1px solid #f1f5f9" }}>
                <h3 className="fd-tableTitle" style={{ fontSize: "14px", fontWeight: 800, textTransform: "uppercase" }}>
                  Admins
                </h3>
              </div>
              <div style={{ padding: "12px" }}>
                {admins.map((a) => {
                  const count = assignmentsByAdmin.get(a.id)?.size ?? 0;
                  const active = a.id === selectedAdmin;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setSelectedAdmin(a.id)}
                      style={{
                        display: "flex",
                        width: "100%",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: "10px",
                        padding: "10px 14px",
                        marginBottom: "6px",
                        borderRadius: "8px",
                        border: active ? "1.5px solid #1e3a5f" : "1px solid #e5e7eb",
                        background: active ? "#eff6ff" : "#fff",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <span>
                        <span style={{ display: "block", fontWeight: 700, fontSize: "13.5px", color: "#1f2937" }}>
                          {a.full_name || a.email}
                        </span>
                        <span style={{ display: "block", fontSize: "11.5px", color: "#6b7280" }}>
                          {a.role === "super_admin" ? "SUPER ADMIN — all programs" : `${count} program(s) assigned`}
                        </span>
                      </span>
                      {a.role === "super_admin" ? (
                        <span style={{ fontSize: "10px", fontWeight: 800, color: "#7c3aed", background: "#f3e8ff", padding: "2px 8px", borderRadius: "999px" }}>
                          SUPER
                        </span>
                      ) : (
                        <span style={{ fontSize: "11px", fontWeight: 700, color: count > 0 ? "#16a34a" : "#9ca3af" }}>
                          {count} ✓
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Assignment editor */}
            <div className="ad-tableCard" style={{ flex: "1 1 380px" }}>
              <div className="fd-tableHeader" style={{ padding: "20px 24px", borderBottom: "1px solid #f1f5f9" }}>
                <h3 className="fd-tableTitle" style={{ fontSize: "14px", fontWeight: 800, textTransform: "uppercase" }}>
                  Programs for {selected?.full_name || "—"}
                </h3>
              </div>
              <div style={{ padding: "16px 20px" }}>
                {selected?.role === "super_admin" ? (
                  <p style={{ fontSize: "13.5px", color: "#6b7280" }}>
                    Super admins implicitly hold every program — no assignment rows needed.
                  </p>
                ) : (
                  <>
                    {departments.length === 0 ? (
                      <p style={{ fontSize: "13.5px", color: "#6b7280" }}>No programs defined yet.</p>
                    ) : (
                      departments.map((d) => (
                        <label
                          key={d.id}
                          style={{ display: "flex", alignItems: "center", gap: "10px", padding: "9px 6px", fontSize: "14px", color: "#374151", cursor: "pointer", borderBottom: "1px solid #f3f4f6" }}
                        >
                          <input
                            type="checkbox"
                            checked={checked.has(d.id)}
                            onChange={() => toggle(d.id)}
                          />
                          <span style={{ fontWeight: 600 }}>{d.name}</span>
                        </label>
                      ))
                    )}
                    <button
                      type="button"
                      className="ad-btnSearch"
                      style={{ marginTop: "16px", opacity: saving ? 0.6 : 1 }}
                      disabled={saving}
                      onClick={handleSave}
                    >
                      {saving ? "Saving..." : "Save Program Assignments"}
                    </button>
                    <p style={{ marginTop: "10px", fontSize: "12.5px", color: "#6b7280" }}>
                      An admin with NO programs sees no program data at all [D9 strict].
                      Removes take effect immediately (RLS filters their queries).
                    </p>
                  </>
                )}
              </div>
            </div>
          </div>
          </>
        )}
      </section>
    </AdminLayout>
  );
}
