import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { createClient } from "@supabase/supabase-js";
import AdminLayout from "./AdminLayout";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../config/supabase";
import { logAdminAction } from "../../utils/audit";
import {
  Users,
  ShieldCheck,
  GraduationCap,
  AlertTriangle,
  CheckCircle2,
  Search,
  Plus,
  Check,
  X,
  Eye,
  EyeOff,
  RotateCcw,
  Building2,
  ChevronRight,
  Sparkles,
  LayoutGrid,
  User,
  Mail,
  Lock,
  UserPlus,
  Pencil,
  Trash2,
  Copy,
  Wand2,
  Power,
  ShieldAlert,
  CheckCheck,
} from "lucide-react";

function getInitials(name, email) {
  const str = (name || email || "?").trim();
  const parts = str.split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return str.slice(0, 2).toUpperCase();
}

export default function AdminProgramAssignments() {
  const { currentUser, userProfile } = useAuth();
  const isSuper = userProfile?.role === "super_admin";

  // Tab switch: 'admin' (person-centric) | 'program' (degree-centric matrix)
  const [activeView, setActiveView] = useState("admin");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [admins, setAdmins] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [selectedAdmin, setSelectedAdmin] = useState("");
  const [checked, setChecked] = useState(new Set());

  // Search & filter states
  const [searchAdmin, setSearchAdmin] = useState("");
  const [adminStatusFilter, setAdminStatusFilter] = useState("all");
  const [searchDept, setSearchDept] = useState("");

  // Program Matrix tab filters
  const [matrixSearch, setMatrixSearch] = useState("");
  const [matrixFilter, setMatrixFilter] = useState("all"); // 'all' | 'unassigned' | 'assigned'

  // Modal creation states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [newDeptIds, setNewDeptIds] = useState(new Set());
  const [modalProgramSearch, setModalProgramSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [createMsg, setCreateMsg] = useState("");
  const [createErr, setCreateErr] = useState("");
  const [createdCredentials, setCreatedCredentials] = useState(null);
  const [copiedCreds, setCopiedCreds] = useState(false);

  // Edit Program Head states
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingAdmin, setEditingAdmin] = useState(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editStatus, setEditStatus] = useState("active");
  const [savingEdit, setSavingEdit] = useState(false);
  const [editErr, setEditErr] = useState("");

  // Delete / Demote states
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletingAdmin, setDeletingAdmin] = useState(null);
  const [deleteMode, setDeleteMode] = useState("demote"); // 'demote' | 'permanent'
  const [deleting, setDeleting] = useState(false);
  const [deleteErr, setDeleteErr] = useState("");

  const toggleNewDept = (deptId) => {
    setNewDeptIds((prev) => {
      const next = new Set(prev);
      if (next.has(deptId)) next.delete(deptId);
      else next.add(deptId);
      return next;
    });
  };

  const handleGeneratePassword = () => {
    const chars = "abcdefghjkmnpqrstuvwxyz";
    const caps = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    const nums = "23456789";
    const syms = "!@#$%&*";
    let pass = "";
    pass += caps[Math.floor(Math.random() * caps.length)];
    for (let i = 0; i < 4; i++) pass += chars[Math.floor(Math.random() * chars.length)];
    pass += nums[Math.floor(Math.random() * nums.length)];
    pass += nums[Math.floor(Math.random() * nums.length)];
    pass += syms[Math.floor(Math.random() * syms.length)];
    setNewPassword(pass);
    setShowPassword(true);
  };

  const handleApplyTitle = (prefix) => {
    const titles = ["Dr.", "Prof.", "Dean", "Engr.", "Mr.", "Ms."];
    let current = newName.trim();
    for (const t of titles) {
      if (current.startsWith(t)) {
        current = current.replace(t, "").trim();
        break;
      }
    }
    setNewName(`${prefix} ${current}`.trim());
  };

  const handleCopyCredentials = () => {
    if (!createdCredentials) return;
    const text = `FacultyTrack Program Head Credentials\nName: ${createdCredentials.name}\nEmail: ${createdCredentials.email}\nTemporary Password: ${createdCredentials.password}\nAssigned Programs: ${createdCredentials.programs.join(", ") || "None"}\nPortal: ${window.location.origin}/login`;
    navigator.clipboard.writeText(text);
    setCopiedCreds(true);
    setTimeout(() => setCopiedCreds(false), 2500);
  };

  const reloadAdmins = async () => {
    const [adminRes, deptRes, assignRes] = await Promise.all([
      supabase.from("users").select("id, full_name, email, role, status").in("role", ["admin", "super_admin"]).order("full_name"),
      supabase.from("departments").select("id, name, description").order("name"),
      supabase.from("admin_program_assignments").select("admin_id, department_id"),
    ]);
    setAdmins(adminRes.data || []);
    setDepartments(deptRes.data || []);
    setAssignments(assignRes.data || []);
  };

  useEffect(() => {
    if (!isSuper) return;
    const load = async () => {
      try {
        setLoading(true);
        const [adminRes, deptRes, assignRes] = await Promise.all([
          supabase.from("users").select("id, full_name, email, role, status").in("role", ["admin", "super_admin"]).order("full_name"),
          supabase.from("departments").select("id, name, description").order("name"),
          supabase.from("admin_program_assignments").select("admin_id, department_id"),
        ]);
        setAdmins(adminRes.data || []);
        setDepartments(deptRes.data || []);
        setAssignments(assignRes.data || []);
        const first = (adminRes.data || []).find((a) => a.role === "admin") || adminRes.data?.[0];
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

  const assignmentsByDept = useMemo(() => {
    const m = new Map();
    for (const a of assignments) {
      if (!m.has(a.department_id)) m.set(a.department_id, []);
      m.get(a.department_id).push(a.admin_id);
    }
    return m;
  }, [assignments]);

  const adminMap = useMemo(() => {
    const m = new Map();
    for (const a of admins) m.set(a.id, a);
    return m;
  }, [admins]);

  useEffect(() => {
    setChecked(new Set(assignmentsByAdmin.get(selectedAdmin) || new Set()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAdmin, assignments]);

  const initialChecked = useMemo(() => {
    return assignmentsByAdmin.get(selectedAdmin) || new Set();
  }, [assignmentsByAdmin, selectedAdmin]);

  const toAdd = useMemo(() => {
    return [...checked].filter((id) => !initialChecked.has(id));
  }, [checked, initialChecked]);

  const toRemove = useMemo(() => {
    return [...initialChecked].filter((id) => !checked.has(id));
  }, [checked, initialChecked]);

  const isDirty = toAdd.length > 0 || toRemove.length > 0;

  const toggle = (deptId) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(deptId)) next.delete(deptId);
      else next.add(deptId);
      return next;
    });
  };

  const handleSelectAll = () => {
    setChecked(new Set(departments.map((d) => d.id)));
  };

  const handleClearAll = () => {
    setChecked(new Set());
  };

  const handleDiscard = () => {
    setChecked(new Set(initialChecked));
  };

  const handleSave = async () => {
    if (!selectedAdmin || saving) return;
    setSaving(true);
    try {
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
      alert("Could not save the program assignments: " + (err.message || "Please try again."));
    } finally {
      setSaving(false);
    }
  };

  // Matrix direct quick assign
  const handleAssignHeadToProgram = async (deptId, adminId) => {
    if (!adminId) return;
    try {
      const { error } = await supabase
        .from("admin_program_assignments")
        .insert({ admin_id: adminId, department_id: deptId });
      if (error) throw error;
      setAssignments((prev) => [...prev, { admin_id: adminId, department_id: deptId }]);
      logAdminAction("program_assignments.assign", "admin_program_assignments", adminId, { department_id: deptId });
    } catch (err) {
      console.error("Quick assign error:", err);
      alert("Could not assign head: " + (err.message || "Unknown error"));
    }
  };

  // Matrix direct quick unassign
  const handleUnassignHeadFromProgram = async (deptId, adminId) => {
    const admin = adminMap.get(adminId);
    const dept = departments.find((d) => d.id === deptId);
    if (!window.confirm(`Unassign ${admin?.full_name || "this admin"} from ${dept?.name || "this program"}?`)) return;
    try {
      const { error } = await supabase
        .from("admin_program_assignments")
        .delete()
        .eq("admin_id", adminId)
        .eq("department_id", deptId);
      if (error) throw error;
      setAssignments((prev) => prev.filter((a) => !(a.admin_id === adminId && a.department_id === deptId)));
      logAdminAction("program_assignments.remove", "admin_program_assignments", adminId, { department_id: deptId });
    } catch (err) {
      console.error("Quick unassign error:", err);
      alert("Could not unassign head: " + (err.message || "Unknown error"));
    }
  };

  const handleCreateHead = async (e) => {
    if (e) e.preventDefault();
    setCreateMsg("");
    setCreateErr("");
    const name = newName.trim();
    const email = newEmail.trim();
    if (!name || !email || newPassword.length < 6) {
      setCreateErr("Full name, valid email, and a 6+ character password are required.");
      return;
    }
    if (newDeptIds.size === 0) {
      setCreateErr("Please select at least one program to assign.");
      return;
    }
    setCreating(true);
    try {
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
          throw new Error("That email is already registered. You can find them in the admin list.");
        }
        throw signUpError;
      }
      const newId = signUpData?.user?.id;
      if (!newId) throw new Error("Signup did not return a user record. Please try again.");

      const { data: promoted, error: promoteError } = await supabase
        .from("users")
        .update({ full_name: name, role: "admin", status: "active", approved_at: new Date().toISOString() })
        .eq("id", newId)
        .select("id");
      if (promoteError) throw promoteError;
      if (!promoted || promoted.length === 0) {
        throw new Error("User created but role elevation failed. Check RLS policies.");
      }

      const { error: assignError } = await supabase
        .from("admin_program_assignments")
        .insert([...newDeptIds].map((department_id) => ({ admin_id: newId, department_id })));
      if (assignError) throw assignError;

      logAdminAction("admin.create", "users", newId, { programs: newDeptIds.size });
      await reloadAdmins();
      setCreatedCredentials({
        name,
        email,
        password: newPassword,
        programs: departments.filter((d) => newDeptIds.has(d.id)).map((d) => d.name || d.id),
      });
      setNewName("");
      setNewEmail("");
      setNewPassword("");
      setNewDeptIds(new Set());
      setShowCreateModal(false);
    } catch (err) {
      setCreateErr(err.message || "Failed to create program head.");
    } finally {
      setCreating(false);
    }
  };

  const handleOpenEdit = (admin) => {
    if (!admin) return;
    setEditingAdmin(admin);
    setEditName(admin.full_name || "");
    setEditEmail(admin.email || "");
    setEditStatus((admin.status || "active").toLowerCase());
    setEditErr("");
    setShowEditModal(true);
  };

  const handleSaveEdit = async (e) => {
    if (e) e.preventDefault();
    if (!editingAdmin || savingEdit) return;
    const name = editName.trim();
    const email = editEmail.trim();
    if (!name || !email) {
      setEditErr("Full name and institutional email are required.");
      return;
    }
    setSavingEdit(true);
    setEditErr("");
    try {
      const { data, error } = await supabase
        .from("users")
        .update({
          full_name: name,
          email: email,
          status: editStatus,
        })
        .eq("id", editingAdmin.id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error("No records updated. Check database permissions / RLS policies.");
      }

      logAdminAction("admin.update", "users", editingAdmin.id, {
        full_name: name,
        email: email,
        status: editStatus,
      });

      setAdmins((prev) =>
        prev.map((a) =>
          a.id === editingAdmin.id ? { ...a, full_name: name, email, status: editStatus } : a
        )
      );
      setShowEditModal(false);
      setEditingAdmin(null);
    } catch (err) {
      console.error("Save edit error:", err);
      setEditErr(err.message || "Failed to save changes.");
    } finally {
      setSavingEdit(false);
    }
  };

  const handleOpenDelete = (admin) => {
    if (!admin) return;
    if (admin.id === currentUser?.id || admin.role === "super_admin") {
      alert("Super Admin accounts cannot be demoted or removed.");
      return;
    }
    setDeletingAdmin(admin);
    setDeleteMode("demote");
    setDeleteErr("");
    setShowDeleteModal(true);
  };

  const handleConfirmDelete = async () => {
    if (!deletingAdmin || deleting) return;
    setDeleting(true);
    setDeleteErr("");
    try {
      if (deleteMode === "demote") {
        await supabase
          .from("admin_program_assignments")
          .delete()
          .eq("admin_id", deletingAdmin.id);

        const { error } = await supabase
          .from("users")
          .update({ role: "faculty" })
          .eq("id", deletingAdmin.id);
        if (error) throw error;

        logAdminAction("admin.demote_to_faculty", "users", deletingAdmin.id, {
          previous_role: deletingAdmin.role,
        });

        setAssignments((prev) => prev.filter((a) => a.admin_id !== deletingAdmin.id));
        setAdmins((prev) => prev.filter((a) => a.id !== deletingAdmin.id));
        if (selectedAdmin === deletingAdmin.id) {
          const remaining = admins.filter((a) => a.id !== deletingAdmin.id);
          setSelectedAdmin(remaining[0]?.id || "");
        }
        setShowDeleteModal(false);
        setDeletingAdmin(null);
      } else {
        await supabase
          .from("admin_program_assignments")
          .delete()
          .eq("admin_id", deletingAdmin.id);

        const { error: rpcErr } = await supabase.rpc("delete_user_account", {
          target_user_id: deletingAdmin.id,
        });
        if (rpcErr) {
          const { error: tblErr } = await supabase.from("users").delete().eq("id", deletingAdmin.id);
          if (tblErr) throw tblErr;
        }

        logAdminAction("admin.permanent_delete", "users", deletingAdmin.id, {});

        setAssignments((prev) => prev.filter((a) => a.admin_id !== deletingAdmin.id));
        setAdmins((prev) => prev.filter((a) => a.id !== deletingAdmin.id));
        if (selectedAdmin === deletingAdmin.id) {
          const remaining = admins.filter((a) => a.id !== deletingAdmin.id);
          setSelectedAdmin(remaining[0]?.id || "");
        }
        setShowDeleteModal(false);
        setDeletingAdmin(null);
      }
    } catch (err) {
      console.error("Delete error:", err);
      setDeleteErr(err.message || "Failed to remove program head.");
    } finally {
      setDeleting(false);
    }
  };

  const handleToggleActive = async (admin) => {
    if (admin.id === currentUser?.id || admin.role === "super_admin") return;
    const next = (admin.status || "active").toLowerCase() === "active" ? "inactive" : "active";
    if (!window.confirm(`${next === "active" ? "Reactivate" : "Deactivate"} ${admin.full_name || admin.email}?`)) return;
    try {
      const { data, error } = await supabase.from("users").update({ status: next }).eq("id", admin.id).select("id");
      if (error) throw error;
      if (!data || data.length === 0) {
        alert("No change saved — check RLS policies.");
        return;
      }
      setAdmins((prev) => prev.map((a) => (a.id === admin.id ? { ...a, status: next } : a)));
      logAdminAction(next === "active" ? "admin.reactivate" : "admin.deactivate", "users", admin.id, {});
    } catch (err) {
      console.error("Toggle admin error:", err);
      alert("Could not update the admin status: " + (err.message || "unknown error."));
    }
  };

  // Programs without any active admin
  const uncovered = useMemo(() => {
    const covered = new Set(
      assignments
        .filter((a) => {
          const u = admins.find((adm) => adm.id === a.admin_id);
          return u && (u.status || "active").toLowerCase() === "active";
        })
        .map((a) => a.department_id)
    );
    return departments.filter((d) => !covered.has(d.id));
  }, [assignments, admins, departments]);

  const activeHeads = useMemo(() => {
    return admins.filter((a) => a.role === "admin" && (a.status || "active").toLowerCase() === "active");
  }, [admins]);

  const filteredAdmins = useMemo(() => {
    return admins.filter((a) => {
      const q = searchAdmin.trim().toLowerCase();
      const matchText = !q || (a.full_name || "").toLowerCase().includes(q) || (a.email || "").toLowerCase().includes(q);
      if (!matchText) return false;
      const st = (a.status || "active").toLowerCase();
      if (adminStatusFilter === "active") return st === "active";
      if (adminStatusFilter === "inactive") return st === "inactive";
      return true;
    });
  }, [admins, searchAdmin, adminStatusFilter]);

  const filteredDepartments = useMemo(() => {
    const q = searchDept.trim().toLowerCase();
    if (!q) return departments;
    return departments.filter(
      (d) => (d.name || "").toLowerCase().includes(q) || (d.description || "").toLowerCase().includes(q)
    );
  }, [departments, searchDept]);

  // Program Matrix filtered items
  const matrixPrograms = useMemo(() => {
    return departments.filter((d) => {
      const q = matrixSearch.trim().toLowerCase();
      const matchText = !q || (d.name || "").toLowerCase().includes(q) || (d.description || "").toLowerCase().includes(q);
      if (!matchText) return false;

      const activeHeadIds = (assignmentsByDept.get(d.id) || []).filter((id) => {
        const u = adminMap.get(id);
        return u && (u.status || "active").toLowerCase() === "active";
      });

      if (matrixFilter === "unassigned") return activeHeadIds.length === 0;
      if (matrixFilter === "assigned") return activeHeadIds.length > 0;
      return true;
    });
  }, [departments, matrixSearch, matrixFilter, assignmentsByDept, adminMap]);

  if (!isSuper) {
    return <Navigate to="/admin/dashboard" replace />;
  }

  const selected = admins.find((a) => a.id === selectedAdmin);
  const coveragePct = departments.length > 0 ? Math.round(((departments.length - uncovered.length) / departments.length) * 100) : 100;

  return (
    <AdminLayout title="Program Assignments">
      <section className="ad-content">
        {/* TOP HEADER & ACTION */}
        <div className="ad-welcomeHeader" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "16px", marginBottom: "20px" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
              <span style={{ fontSize: "11px", fontWeight: 800, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Super Admin Oversight
              </span>
              <span style={{ color: "#cbd5e1" }}>/</span>
              <span style={{ fontSize: "11px", fontWeight: 800, color: "#2563eb", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Program Leadership
              </span>
            </div>
            <h2 className="ad-title" style={{ fontSize: "24px", fontWeight: 800, color: "#0f172a", margin: 0 }}>
              Program Assignments
            </h2>
            <p className="ad-subtitle" style={{ fontSize: "13.5px", color: "#64748b", margin: "4px 0 0" }}>
              Designate and manage academic program leadership. Program Heads manage only their assigned curricula.
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              setShowCreateModal(true);
              setCreateErr("");
              setCreateMsg("");
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              padding: "10px 18px",
              fontSize: "13.5px",
              fontWeight: 700,
              borderRadius: "10px",
              background: "linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%)",
              color: "#fff",
              border: "none",
              cursor: "pointer",
              boxShadow: "0 4px 14px rgba(37, 99, 235, 0.25)",
              transition: "all 0.2s ease",
            }}
          >
            <Plus size={16} />
            <span>Add Program Head</span>
          </button>
        </div>

        {/* 4 TOP KPI METRIC CARDS */}
        <div className="ad-pa-kpi-grid">
          <div className="ad-pa-kpi-card">
            <div>
              <div className="ad-pa-kpi-label">Program Heads</div>
              <div className="ad-pa-kpi-val">{admins.filter((a) => a.role === "admin").length}</div>
              <div className="ad-pa-kpi-sub">{admins.filter((a) => a.role === "super_admin").length} Super Admin(s)</div>
            </div>
            <div className="ad-pa-kpi-icon" style={{ background: "#eff6ff", color: "#2563eb" }}>
              <Users size={22} />
            </div>
          </div>

          <div className="ad-pa-kpi-card">
            <div>
              <div className="ad-pa-kpi-label">Active Heads</div>
              <div className="ad-pa-kpi-val" style={{ color: "#16a34a" }}>{activeHeads.length}</div>
              <div className="ad-pa-kpi-sub">Authorized to supervise</div>
            </div>
            <div className="ad-pa-kpi-icon" style={{ background: "#f0fdf4", color: "#16a34a" }}>
              <ShieldCheck size={22} />
            </div>
          </div>

          <div className="ad-pa-kpi-card">
            <div>
              <div className="ad-pa-kpi-label">Program Coverage</div>
              <div className="ad-pa-kpi-val">{departments.length - uncovered.length} / {departments.length}</div>
              <div className="ad-pa-kpi-sub">{coveragePct}% covered by active heads</div>
            </div>
            <div className="ad-pa-kpi-icon" style={{ background: "#f5f3ff", color: "#7c3aed" }}>
              <GraduationCap size={22} />
            </div>
          </div>

          <div
            className="ad-pa-kpi-card"
            style={{
              borderColor: uncovered.length > 0 ? "#fde68a" : "#bbf7d0",
              background: uncovered.length > 0 ? "#fffdf5" : "#ffffff",
            }}
          >
            <div>
              <div className="ad-pa-kpi-label">Coverage Status</div>
              <div className="ad-pa-kpi-val" style={{ color: uncovered.length > 0 ? "#d97706" : "#16a34a" }}>
                {uncovered.length > 0 ? `${uncovered.length} Unassigned` : "Full Coverage"}
              </div>
              <div className="ad-pa-kpi-sub">
                {uncovered.length > 0 ? "Requires head assignment" : "All degree programs staffed"}
              </div>
            </div>
            <div
              className="ad-pa-kpi-icon"
              style={{
                background: uncovered.length > 0 ? "#fef3c7" : "#dcfce7",
                color: uncovered.length > 0 ? "#d97706" : "#16a34a",
              }}
            >
              {uncovered.length > 0 ? <AlertTriangle size={22} /> : <CheckCircle2 size={22} />}
            </div>
          </div>
        </div>

        {/* UNCOVERED WARNING BANNER */}
        {uncovered.length > 0 && (
          <div className="ad-pa-banner-alert">
            <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
              <div style={{ background: "#fef3c7", padding: "8px", borderRadius: "8px", color: "#b45309" }}>
                <AlertTriangle size={20} />
              </div>
              <div>
                <div style={{ fontWeight: 800, fontSize: "14px", color: "#92400e" }}>
                  Action Needed: {uncovered.length} Degree Program(s) have no active Program Head
                </div>
                <div style={{ fontSize: "12.5px", color: "#b45309", marginTop: "2px" }}>
                  Accounts and student evaluations in{" "}
                  <strong>{uncovered.map((d) => d.name).join(", ")}</strong> will remain unmonitored until an active Program Head is assigned.
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setActiveView("program");
                setMatrixFilter("unassigned");
              }}
              style={{
                fontSize: "12px",
                fontWeight: 700,
                background: "#fef3c7",
                color: "#92400e",
                padding: "6px 14px",
                borderRadius: "999px",
                border: "1px solid #fde68a",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              View Unassigned &rarr;
            </button>
          </div>
        )}

        {/* DUAL-TAB SWITCHER */}
        <div className="ad-pa-tabs">
          <button
            type="button"
            className={`ad-pa-tab-btn ${activeView === "admin" ? "ad-pa-tab-btn--active" : ""}`}
            onClick={() => setActiveView("admin")}
          >
            <Users size={16} />
            <span>By Administrator</span>
            <span style={{ fontSize: "11px", padding: "1px 6px", borderRadius: "999px", background: activeView === "admin" ? "#2563eb" : "#e2e8f0", color: activeView === "admin" ? "#ffffff" : "#475569" }}>
              {admins.length}
            </span>
          </button>

          <button
            type="button"
            className={`ad-pa-tab-btn ${activeView === "program" ? "ad-pa-tab-btn--active" : ""}`}
            onClick={() => setActiveView("program")}
          >
            <LayoutGrid size={16} />
            <span>By Program Coverage</span>
            {uncovered.length > 0 ? (
              <span style={{ fontSize: "11px", padding: "1px 6px", borderRadius: "999px", background: "#f59e0b", color: "#ffffff", fontWeight: 800 }}>
                {uncovered.length} Uncovered
              </span>
            ) : (
              <span style={{ fontSize: "11px", padding: "1px 6px", borderRadius: "999px", background: "#10b981", color: "#ffffff", fontWeight: 800 }}>
                100%
              </span>
            )}
          </button>
        </div>

        {loading ? (
          <div className="ad-tableCard" style={{ padding: "48px", textAlign: "center", color: "#64748b" }}>
            <div style={{ fontWeight: 600, fontSize: "15px" }}>Loading program assignments...</div>
          </div>
        ) : activeView === "admin" ? (
          /* ========================================================= */
          /* TAB 1: DUAL-PANE STUDIO (BY ADMIN)                        */
          /* ========================================================= */
          <div className="ad-pa-layout">
            {/* LEFT PANE: ADMIN DIRECTORY */}
            <div className="ad-pa-pane">
              <div className="ad-pa-pane-header">
                <h3 className="ad-pa-pane-title">
                  <Users size={16} />
                  <span>Program Heads</span>
                </h3>
                <span style={{ background: "#e2e8f0", color: "#334155", fontSize: "11px", fontWeight: 800, padding: "2px 8px", borderRadius: "999px" }}>
                  {filteredAdmins.length}
                </span>
              </div>

              {/* Search & Status Filters */}
              <div style={{ padding: "12px 14px", borderBottom: "1px solid #f1f5f9", display: "flex", flexDirection: "column", gap: "8px" }}>
                <div style={{ position: "relative" }}>
                  <Search size={14} style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: "#94a3b8" }} />
                  <input
                    type="text"
                    value={searchAdmin}
                    onChange={(e) => setSearchAdmin(e.target.value)}
                    placeholder="Search admin name or email..."
                    style={{
                      width: "100%",
                      padding: "8px 10px 8px 30px",
                      borderRadius: "8px",
                      border: "1px solid #cbd5e1",
                      fontSize: "12.5px",
                      outline: "none",
                      boxSizing: "border-box",
                    }}
                  />
                  {searchAdmin && (
                    <button
                      type="button"
                      onClick={() => setSearchAdmin("")}
                      style={{ position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#94a3b8", cursor: "pointer", padding: "2px" }}
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>

                <div style={{ display: "flex", gap: "4px" }}>
                  {[
                    { key: "all", label: "All" },
                    { key: "active", label: "Active" },
                    { key: "inactive", label: "Inactive" },
                  ].map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setAdminStatusFilter(tab.key)}
                      style={{
                        flex: 1,
                        padding: "5px 8px",
                        fontSize: "11px",
                        fontWeight: 700,
                        borderRadius: "6px",
                        border: "1px solid",
                        borderColor: adminStatusFilter === tab.key ? "#2563eb" : "#e2e8f0",
                        background: adminStatusFilter === tab.key ? "#2563eb" : "#ffffff",
                        color: adminStatusFilter === tab.key ? "#ffffff" : "#64748b",
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      }}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Admins List */}
              <div className="ad-pa-admin-list">
                {filteredAdmins.length === 0 ? (
                  <div style={{ padding: "24px 12px", textAlign: "center", color: "#94a3b8", fontSize: "13px" }}>
                    No administrators match the search filter.
                  </div>
                ) : (
                  filteredAdmins.map((a) => {
                    const count = assignmentsByAdmin.get(a.id)?.size ?? 0;
                    const isSelected = a.id === selectedAdmin;
                    const isActive = (a.status || "active").toLowerCase() === "active";
                    const isSuperRole = a.role === "super_admin";

                    return (
                      <div
                        key={a.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedAdmin(a.id)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedAdmin(a.id); }}
                        className={`ad-pa-admin-card ${isSelected ? "ad-pa-admin-card--active" : ""}`}
                        style={{ outline: "none" }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
                          <div className={`ad-pa-avatar ${isSuperRole ? "ad-pa-avatar--super" : ""}`}>
                            {getInitials(a.full_name, a.email)}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                              <span style={{ fontWeight: 700, fontSize: "13.5px", color: isSelected ? "#1d4ed8" : "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                {a.full_name || "Unnamed Admin"}
                              </span>
                            </div>
                            <div style={{ fontSize: "11.5px", color: "#64748b", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {a.email}
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "4px" }}>
                              {isSuperRole ? (
                                <span style={{ fontSize: "10px", fontWeight: 800, color: "#7c3aed", background: "#f3e8ff", padding: "1px 6px", borderRadius: "999px" }}>
                                  SUPER ADMIN
                                </span>
                              ) : (
                                <span style={{ fontSize: "10.5px", fontWeight: 700, color: count > 0 ? "#16a34a" : "#94a3b8", background: count > 0 ? "#f0fdf4" : "#f1f5f9", padding: "1px 6px", borderRadius: "999px" }}>
                                  {count} Program{count === 1 ? "" : "s"}
                                </span>
                              )}
                              <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "10.5px", color: isActive ? "#16a34a" : "#dc2626", fontWeight: 600 }}>
                                <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: isActive ? "#22c55e" : "#ef4444" }} />
                                {isActive ? "Active" : "Inactive"}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          {!isSuperRole && a.id !== currentUser?.id && (
                            <button
                              type="button"
                              title={isActive ? "Deactivate this head" : "Reactivate this head"}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleActive(a);
                              }}
                              style={{
                                fontSize: "10.5px",
                                fontWeight: 700,
                                color: isActive ? "#dc2626" : "#16a34a",
                                background: isActive ? "#fef2f2" : "#f0fdf4",
                                border: `1px solid ${isActive ? "#fecaca" : "#bbf7d0"}`,
                                borderRadius: "6px",
                                padding: "3px 8px",
                                cursor: "pointer",
                              }}
                            >
                              {isActive ? "Turn Off" : "Turn On"}
                            </button>
                          )}
                          <ChevronRight size={16} style={{ color: isSelected ? "#2563eb" : "#cbd5e1" }} />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* RIGHT PANE: ASSIGNMENT CANVAS */}
            <div className="ad-pa-pane" style={{ position: "relative" }}>
              {/* Selected Admin Banner */}
              <div className="ad-pa-hero-banner">
                <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                  <div
                    style={{
                      width: "48px",
                      height: "48px",
                      borderRadius: "12px",
                      background: selected?.role === "super_admin" ? "#f3e8ff" : "#ffffff",
                      color: selected?.role === "super_admin" ? "#7c3aed" : "#1e3a5f",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "16px",
                      fontWeight: 800,
                      boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                    }}
                  >
                    {getInitials(selected?.full_name, selected?.email)}
                  </div>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                      <span style={{ fontSize: "18px", fontWeight: 800 }}>{selected?.full_name || "—"}</span>
                      {selected?.role === "super_admin" ? (
                        <span style={{ background: "#7c3aed", color: "#ffffff", fontSize: "10px", fontWeight: 800, padding: "2px 8px", borderRadius: "999px" }}>
                          SUPER ADMIN
                        </span>
                      ) : (
                        <span style={{ background: "rgba(255,255,255,0.2)", color: "#ffffff", fontSize: "10.5px", fontWeight: 700, padding: "2px 8px", borderRadius: "999px" }}>
                          PROGRAM HEAD
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: "12.5px", color: "#93c5fd", marginTop: "2px" }}>
                      {selected?.email} • Status:{" "}
                      <strong style={{ color: (selected?.status || "active").toLowerCase() === "active" ? "#4ade80" : "#fca5a5" }}>
                        {(selected?.status || "active").toUpperCase()}
                      </strong>
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  <div style={{ fontSize: "12px", background: "rgba(255,255,255,0.1)", padding: "6px 14px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.15)" }}>
                    {selected?.role === "super_admin" ? (
                      <span>Global Scope</span>
                    ) : (
                      <span>
                        <strong>{checked.size}</strong> of {departments.length} Programs
                      </span>
                    )}
                  </div>

                  {selected?.role !== "super_admin" && (
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <button
                        type="button"
                        className="ad-pa-btn-glass"
                        onClick={() => handleOpenEdit(selected)}
                        title="Edit Full Name, Email, or Status"
                      >
                        <Pencil size={13} />
                        <span>Edit</span>
                      </button>

                      <button
                        type="button"
                        className="ad-pa-btn-glass"
                        onClick={() => handleToggleActive(selected)}
                        title={(selected?.status || "active").toLowerCase() === "active" ? "Deactivate Program Head" : "Reactivate Program Head"}
                      >
                        <Power size={13} />
                        <span>{(selected?.status || "active").toLowerCase() === "active" ? "Deactivate" : "Activate"}</span>
                      </button>

                      <button
                        type="button"
                        className="ad-pa-btn-glass-danger"
                        onClick={() => handleOpenDelete(selected)}
                        title="Demote to Faculty or Permanently Remove Account"
                      >
                        <Trash2 size={13} />
                        <span>Remove</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Assignment Controls */}
              {selected?.role === "super_admin" ? (
                <div style={{ padding: "48px 32px", textAlign: "center" }}>
                  <div style={{ width: "56px", height: "56px", borderRadius: "50%", background: "#f3e8ff", color: "#7c3aed", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: "14px" }}>
                    <Sparkles size={28} />
                  </div>
                  <h4 style={{ fontSize: "16px", fontWeight: 800, color: "#1e293b", margin: "0 0 6px" }}>
                    Global Super Administrator Access
                  </h4>
                  <p style={{ fontSize: "13.5px", color: "#64748b", maxWidth: "480px", margin: "0 auto", lineHeight: 1.5 }}>
                    Super administrators implicitly possess universal administrative rights across every academic program, degree, and curriculum. No program assignment rows are necessary.
                  </p>
                </div>
              ) : (
                <>
                  <div style={{ padding: "16px 24px", borderBottom: "1px solid #f1f5f9", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px", background: "#fafbfc" }}>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: "13.5px", color: "#1e293b" }}>
                        Academic Degree Programs
                      </div>
                      <div style={{ fontSize: "12px", color: "#64748b" }}>
                        Click any program card to grant or revoke management authorization.
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <div style={{ position: "relative" }}>
                        <Search size={13} style={{ position: "absolute", left: "9px", top: "50%", transform: "translateY(-50%)", color: "#94a3b8" }} />
                        <input
                          type="text"
                          value={searchDept}
                          onChange={(e) => setSearchDept(e.target.value)}
                          placeholder="Filter programs..."
                          style={{
                            padding: "6px 10px 6px 28px",
                            borderRadius: "6px",
                            border: "1px solid #cbd5e1",
                            fontSize: "12px",
                            outline: "none",
                            width: "160px",
                          }}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={handleSelectAll}
                        style={{ fontSize: "11.5px", fontWeight: 700, color: "#2563eb", background: "#eff6ff", border: "1px solid #bfdbfe", padding: "6px 12px", borderRadius: "6px", cursor: "pointer" }}
                      >
                        Select All
                      </button>
                      <button
                        type="button"
                        onClick={handleClearAll}
                        style={{ fontSize: "11.5px", fontWeight: 700, color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", padding: "6px 12px", borderRadius: "6px", cursor: "pointer" }}
                      >
                        Clear All
                      </button>
                    </div>
                  </div>

                  {/* Program Cards Grid */}
                  <div className="ad-pa-prog-grid">
                    {filteredDepartments.length === 0 ? (
                      <div style={{ gridColumn: "1 / -1", padding: "40px", textAlign: "center", color: "#94a3b8", fontSize: "13.5px" }}>
                        No programs found matching &quot;{searchDept}&quot;.
                      </div>
                    ) : (
                      filteredDepartments.map((d) => {
                        const isChecked = checked.has(d.id);
                        const assignedAdmins = assignmentsByDept.get(d.id) || [];
                        const otherHeads = assignedAdmins
                          .filter((adminId) => adminId !== selectedAdmin)
                          .map((adminId) => adminMap.get(adminId)?.full_name || "Admin")
                          .filter(Boolean);

                        return (
                          <div
                            key={d.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => toggle(d.id)}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggle(d.id); }}
                            className={`ad-pa-prog-card ${isChecked ? "ad-pa-prog-card--checked" : ""}`}
                            style={{ outline: "none" }}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                <div style={{ background: isChecked ? "#eff6ff" : "#f1f5f9", color: isChecked ? "#2563eb" : "#64748b", padding: "6px", borderRadius: "8px" }}>
                                  <GraduationCap size={18} />
                                </div>
                                <div>
                                  <div style={{ fontWeight: 800, fontSize: "14px", color: isChecked ? "#1d4ed8" : "#0f172a" }}>
                                    {d.name}
                                  </div>
                                  <div style={{ fontSize: "11px", color: "#64748b" }}>Degree Program</div>
                                </div>
                              </div>

                              <div
                                style={{
                                  width: "22px",
                                  height: "22px",
                                  borderRadius: "50%",
                                  border: isChecked ? "2px solid #2563eb" : "2px solid #cbd5e1",
                                  background: isChecked ? "#2563eb" : "#ffffff",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  color: "#ffffff",
                                  transition: "all 0.15s ease",
                                  flexShrink: 0,
                                }}
                              >
                                {isChecked && <Check size={14} strokeWidth={3} />}
                              </div>
                            </div>

                            {d.description && (
                              <p style={{ fontSize: "12px", color: "#64748b", margin: 0, lineHeight: 1.4, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                                {d.description}
                              </p>
                            )}

                            {/* Co-Assignment Footer Pill */}
                            <div style={{ paddingTop: "8px", borderTop: "1px solid #f1f5f9", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "11px" }}>
                              {otherHeads.length > 0 ? (
                                <span style={{ color: "#6b21a8", background: "#f3e8ff", padding: "2px 8px", borderRadius: "6px", fontWeight: 600 }}>
                                  Also: {otherHeads.slice(0, 2).join(", ")}{otherHeads.length > 2 ? ` +${otherHeads.length - 2}` : ""}
                                </span>
                              ) : isChecked ? (
                                <span style={{ color: "#2563eb", background: "#eff6ff", padding: "2px 8px", borderRadius: "6px", fontWeight: 700 }}>
                                  Sole Program Head
                                </span>
                              ) : (
                                <span style={{ color: "#d97706", background: "#fef3c7", padding: "2px 8px", borderRadius: "6px", fontWeight: 700 }}>
                                  No Active Head Assigned
                                </span>
                              )}

                              <span style={{ fontWeight: 700, color: isChecked ? "#16a34a" : "#94a3b8" }}>
                                {isChecked ? "Assigned" : "Unassigned"}
                              </span>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* STICKY BOTTOM SAVE TOOLBAR */}
                  <div className="ad-pa-save-toolbar">
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <span
                        style={{
                          width: "8px",
                          height: "8px",
                          borderRadius: "50%",
                          background: isDirty ? "#f59e0b" : "#22c55e",
                        }}
                      />
                      {isDirty ? (
                        <span style={{ fontSize: "12.5px", fontWeight: 700, color: "#b45309" }}>
                          Unsaved changes:{" "}
                          <strong>
                            {toAdd.length > 0 && `+${toAdd.length} added`}
                            {toAdd.length > 0 && toRemove.length > 0 && ", "}
                            {toRemove.length > 0 && `-${toRemove.length} removed`}
                          </strong>{" "}
                          ({checked.size} programs selected)
                        </span>
                      ) : (
                        <span style={{ fontSize: "12.5px", color: "#64748b", fontWeight: 600 }}>
                          All program assignments saved and up to date ({checked.size} assigned).
                        </span>
                      )}
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      {isDirty && (
                        <button
                          type="button"
                          className="ad-btnSecondary"
                          onClick={handleDiscard}
                          disabled={saving}
                          style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12.5px" }}
                        >
                          <RotateCcw size={14} />
                          <span>Discard</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleSave}
                        disabled={saving || !isDirty}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          opacity: saving || !isDirty ? 0.6 : 1,
                          fontSize: "12.5px",
                          fontWeight: 700,
                          padding: "8px 18px",
                          borderRadius: "8px",
                          background: "linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%)",
                          color: "#fff",
                          border: "none",
                          cursor: saving || !isDirty ? "not-allowed" : "pointer",
                          boxShadow: "0 4px 12px rgba(37, 99, 235, 0.2)",
                          transition: "all 0.2s ease",
                        }}
                      >
                        <Check size={15} />
                        <span>{saving ? "Saving Changes..." : "Save Program Assignments"}</span>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        ) : (
          /* ========================================================= */
          /* TAB 2: PROGRAM COVERAGE MATRIX (DEGREE-CENTRIC)           */
          /* ========================================================= */
          <div>
            {/* Matrix Filters Bar */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "14px", marginBottom: "18px" }}>
              <div style={{ position: "relative", minWidth: "260px" }}>
                <Search size={14} style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: "#94a3b8" }} />
                <input
                  type="text"
                  value={matrixSearch}
                  onChange={(e) => setMatrixSearch(e.target.value)}
                  placeholder="Search degree program..."
                  style={{
                    width: "100%",
                    padding: "8px 12px 8px 32px",
                    borderRadius: "8px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
                {matrixSearch && (
                  <button
                    type="button"
                    onClick={() => setMatrixSearch("")}
                    style={{ position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#94a3b8", cursor: "pointer" }}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              <div style={{ display: "flex", gap: "6px" }}>
                {[
                  { key: "all", label: `All Programs (${departments.length})` },
                  { key: "unassigned", label: `Unassigned (${uncovered.length})` },
                  { key: "assigned", label: `Staffed (${departments.length - uncovered.length})` },
                ].map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setMatrixFilter(f.key)}
                    style={{
                      padding: "7px 14px",
                      borderRadius: "8px",
                      fontSize: "12px",
                      fontWeight: 700,
                      border: "1px solid",
                      borderColor: matrixFilter === f.key ? "#2563eb" : "#e2e8f0",
                      background: matrixFilter === f.key ? "#2563eb" : "#ffffff",
                      color: matrixFilter === f.key ? "#ffffff" : "#475569",
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                    }}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Matrix Cards Grid */}
            <div className="ad-pa-matrix-grid">
              {matrixPrograms.length === 0 ? (
                <div style={{ gridColumn: "1 / -1", padding: "60px 20px", textAlign: "center", background: "#ffffff", borderRadius: "14px", border: "1px solid #e2e8f0", color: "#64748b" }}>
                  <div style={{ fontWeight: 700, fontSize: "15px" }}>No degree programs match the filter criteria.</div>
                  <button
                    type="button"
                    onClick={() => { setMatrixSearch(""); setMatrixFilter("all"); }}
                    style={{ marginTop: "12px", background: "none", border: "none", color: "#2563eb", fontWeight: 700, fontSize: "13px", cursor: "pointer" }}
                  >
                    Reset Filters
                  </button>
                </div>
              ) : (
                matrixPrograms.map((dept) => {
                  const assignedAdminIds = assignmentsByDept.get(dept.id) || [];
                  const activeAdminIds = assignedAdminIds.filter((id) => {
                    const u = adminMap.get(id);
                    return u && (u.status || "active").toLowerCase() === "active";
                  });
                  const isUncovered = activeAdminIds.length === 0;

                  // List of admins not yet assigned to this program (excluding super_admin)
                  const availableAdmins = admins.filter(
                    (a) => a.role === "admin" && !assignedAdminIds.includes(a.id)
                  );

                  return (
                    <div
                      key={dept.id}
                      className={`ad-pa-matrix-card ${isUncovered ? "ad-pa-matrix-card--uncovered" : ""}`}
                    >
                      <div>
                        {/* Card Header */}
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px", marginBottom: "8px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                            <div style={{ width: "36px", height: "36px", borderRadius: "8px", background: isUncovered ? "#fef3c7" : "#eff6ff", color: isUncovered ? "#d97706" : "#2563eb", display: "flex", alignItems: "center", justifyContent: "center" }}>
                              <GraduationCap size={20} />
                            </div>
                            <div>
                              <h4 style={{ margin: 0, fontSize: "16px", fontWeight: 800, color: "#0f172a" }}>
                                {dept.name}
                              </h4>
                              <span style={{ fontSize: "11px", color: "#64748b" }}>Academic Department</span>
                            </div>
                          </div>

                          {isUncovered ? (
                            <span style={{ background: "#fef3c7", color: "#b45309", border: "1px solid #fde68a", padding: "3px 8px", borderRadius: "999px", fontSize: "10.5px", fontWeight: 800 }}>
                              UNASSIGNED
                            </span>
                          ) : activeAdminIds.length === 1 ? (
                            <span style={{ background: "#f0fdf4", color: "#16a34a", border: "1px solid #bbf7d0", padding: "3px 8px", borderRadius: "999px", fontSize: "10.5px", fontWeight: 800 }}>
                              1 ACTIVE HEAD
                            </span>
                          ) : (
                            <span style={{ background: "#f3e8ff", color: "#7c3aed", border: "1px solid #e9d5ff", padding: "3px 8px", borderRadius: "999px", fontSize: "10.5px", fontWeight: 800 }}>
                              {activeAdminIds.length} CO-MANAGERS
                            </span>
                          )}
                        </div>

                        {dept.description && (
                          <p style={{ fontSize: "12.5px", color: "#64748b", margin: "0 0 14px", lineHeight: 1.4 }}>
                            {dept.description}
                          </p>
                        )}

                        {/* Assigned Heads List */}
                        <div style={{ marginBottom: "14px" }}>
                          <div style={{ fontSize: "11px", fontWeight: 800, textTransform: "uppercase", color: "#64748b", letterSpacing: "0.05em", marginBottom: "8px" }}>
                            Assigned Program Heads ({assignedAdminIds.length})
                          </div>

                          {assignedAdminIds.length === 0 ? (
                            <div style={{ padding: "12px", background: "#fffbeb", borderRadius: "8px", border: "1px solid #fde68a", fontSize: "12px", color: "#92400e", textAlign: "center" }}>
                              ⚠️ No program head assigned. Accounts in this department are unmanaged.
                            </div>
                          ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                              {assignedAdminIds.map((adminId) => {
                                const adm = adminMap.get(adminId);
                                if (!adm) return null;
                                const isActive = (adm.status || "active").toLowerCase() === "active";

                                return (
                                  <div key={adminId} className="ad-pa-head-pill">
                                    <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                                      <div style={{ width: "26px", height: "26px", borderRadius: "6px", background: "#e0e7ff", color: "#3730a3", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10.5px", fontWeight: 800, flexShrink: 0 }}>
                                        {getInitials(adm.full_name, adm.email)}
                                      </div>
                                      <div style={{ minWidth: 0 }}>
                                        <div style={{ fontSize: "12.5px", fontWeight: 700, color: "#1e293b", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                          {adm.full_name || adm.email}
                                        </div>
                                        <div style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "10.5px", color: isActive ? "#16a34a" : "#dc2626" }}>
                                          <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: isActive ? "#22c55e" : "#ef4444" }} />
                                          {isActive ? "Active" : "Inactive"}
                                        </div>
                                      </div>
                                    </div>

                                    <button
                                      type="button"
                                      title="Unassign this head from this program"
                                      onClick={() => handleUnassignHeadFromProgram(dept.id, adminId)}
                                      style={{
                                        background: "none",
                                        border: "none",
                                        color: "#94a3b8",
                                        cursor: "pointer",
                                        padding: "4px",
                                        borderRadius: "4px",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                      }}
                                    >
                                      <X size={14} />
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Quick Assign Dropdown */}
                      <div style={{ borderTop: "1px solid #f1f5f9", paddingTop: "12px" }}>
                        <select
                          className="ad-pa-assign-select"
                          value=""
                          onChange={(e) => {
                            if (e.target.value) handleAssignHeadToProgram(dept.id, e.target.value);
                          }}
                        >
                          <option value="">+ Assign an Admin to {dept.name}...</option>
                          {availableAdmins.map((adm) => (
                            <option key={adm.id} value={adm.id}>
                              {adm.full_name || adm.email} ({(adm.status || "active").toLowerCase()})
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* ENHANCED ADD PROGRAM HEAD MODAL                           */}
        {/* ========================================================= */}
        {showCreateModal && (
          <div className="ad-modal">
            <div className="ad-modalOverlay" onClick={() => !creating && setShowCreateModal(false)} />
            <div className="ad-pa-modal-card">
              {/* Modal Header */}
              <div className="ad-pa-modal-header">
                <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                  <div className="ad-pa-modal-hero-icon">
                    <UserPlus size={22} />
                  </div>
                  <div>
                    <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 800, color: "#0f172a", letterSpacing: "-0.01em" }}>
                      Add Program Head
                    </h3>
                    <p style={{ margin: "3px 0 0", fontSize: "12.5px", color: "#64748b" }}>
                      Create login credentials, promote to admin, and assign initial programs.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  className="ad-pa-modal-close"
                  disabled={creating}
                  onClick={() => setShowCreateModal(false)}
                >
                  <X size={16} />
                </button>
              </div>

              <form onSubmit={handleCreateHead}>
                <div style={{ padding: "24px 26px", display: "flex", flexDirection: "column", gap: "18px" }}>
                  {createErr && (
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", padding: "12px 14px", borderRadius: "10px", fontSize: "13px" }}>
                      <AlertTriangle size={16} style={{ flexShrink: 0 }} />
                      <span>{createErr}</span>
                    </div>
                  )}

                  {/* Full Name with Title Chips */}
                  <div>
                    <label className="ad-pa-form-label">
                      <span>Full Name <strong style={{ color: "#ef4444" }}>*</strong></span>
                      <span style={{ fontWeight: 500, color: "#94a3b8", textTransform: "none", fontSize: "11px" }}>Official name</span>
                    </label>
                    <div style={{ display: "flex", gap: "6px", marginBottom: "8px", flexWrap: "wrap", alignItems: "center" }}>
                      <span style={{ fontSize: "11px", color: "#64748b", marginRight: "2px" }}>Prefix:</span>
                      {["Dr.", "Prof.", "Dean", "Engr."].map((prefix) => (
                        <button
                          key={prefix}
                          type="button"
                          className="ad-pa-title-tag"
                          onClick={() => handleApplyTitle(prefix)}
                        >
                          + {prefix}
                        </button>
                      ))}
                    </div>
                    <div className="ad-pa-input-wrap">
                      <User size={16} className="ad-pa-input-icon" />
                      <input
                        type="text"
                        className="ad-pa-input"
                        placeholder="e.g. Dr. Jane Doe"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  {/* Email Address */}
                  <div>
                    <label className="ad-pa-form-label">
                      <span>Institutional Email <strong style={{ color: "#ef4444" }}>*</strong></span>
                      <span style={{ fontWeight: 500, color: "#94a3b8", textTransform: "none", fontSize: "11px" }}>Used for sign in</span>
                    </label>
                    <div className="ad-pa-input-wrap">
                      <Mail size={16} className="ad-pa-input-icon" />
                      <input
                        type="email"
                        className="ad-pa-input"
                        placeholder="e.g. jdoe@institution.edu"
                        value={newEmail}
                        onChange={(e) => setNewEmail(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  {/* Temporary Password with Auto Generator */}
                  <div>
                    <label className="ad-pa-form-label">
                      <span>Temporary Password <strong style={{ color: "#ef4444" }}>*</strong></span>
                      <button
                        type="button"
                        onClick={handleGeneratePassword}
                        style={{ background: "none", border: "none", color: "#2563eb", fontSize: "11px", fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "4px", padding: 0 }}
                      >
                        <Wand2 size={12} /> Generate Secure
                      </button>
                    </label>
                    <div className="ad-pa-input-wrap">
                      <Lock size={16} className="ad-pa-input-icon" />
                      <input
                        type={showPassword ? "text" : "password"}
                        className="ad-pa-input"
                        placeholder="Set an initial password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        required
                        style={{ paddingRight: "44px" }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        style={{ position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#64748b", cursor: "pointer", display: "flex", padding: "4px" }}
                        title={showPassword ? "Hide password" : "Show password"}
                      >
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>

                  {/* Program Scope Selector with Search */}
                  <div>
                    <div className="ad-pa-form-label">
                      <span>
                        Assign Initial Programs <strong style={{ color: "#ef4444" }}>*</strong>{" "}
                        <span style={{ color: newDeptIds.size > 0 ? "#2563eb" : "#94a3b8", fontWeight: 700 }}>
                          ({newDeptIds.size} of {departments.length} selected)
                        </span>
                      </span>
                      <div style={{ display: "flex", gap: "10px" }}>
                        <button
                          type="button"
                          onClick={() => setNewDeptIds(new Set(departments.map((d) => d.id)))}
                          style={{ background: "none", border: "none", color: "#2563eb", fontSize: "11px", fontWeight: 700, cursor: "pointer", padding: 0 }}
                        >
                          Select All
                        </button>
                        <span style={{ color: "#cbd5e1" }}>·</span>
                        <button
                          type="button"
                          onClick={() => setNewDeptIds(new Set())}
                          style={{ background: "none", border: "none", color: "#64748b", fontSize: "11px", fontWeight: 700, cursor: "pointer", padding: 0 }}
                        >
                          Clear
                        </button>
                      </div>
                    </div>

                    {departments.length > 4 && (
                      <div style={{ position: "relative", marginBottom: "8px" }}>
                        <Search size={13} style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: "#94a3b8" }} />
                        <input
                          type="text"
                          placeholder="Filter programs in modal..."
                          value={modalProgramSearch}
                          onChange={(e) => setModalProgramSearch(e.target.value)}
                          style={{ width: "100%", padding: "6px 10px 6px 30px", borderRadius: "8px", border: "1px solid #cbd5e1", fontSize: "12px", outline: "none", boxSizing: "border-box" }}
                        />
                      </div>
                    )}

                    <div className="ad-pa-chips-container">
                      {departments
                        .filter((d) => !modalProgramSearch || (d.name || "").toLowerCase().includes(modalProgramSearch.toLowerCase()) || (d.id || "").toLowerCase().includes(modalProgramSearch.toLowerCase()))
                        .map((d) => {
                          const active = newDeptIds.has(d.id);
                          return (
                            <button
                              key={d.id}
                              type="button"
                              onClick={() => toggleNewDept(d.id)}
                              className={`ad-pa-chip ${active ? "ad-pa-chip--selected" : ""}`}
                            >
                              <GraduationCap size={13} style={{ color: active ? "#2563eb" : "#64748b" }} />
                              <span>{d.name}</span>
                              {active && <Check size={12} strokeWidth={3} />}
                            </button>
                          );
                        })}
                    </div>
                    {newDeptIds.size === 0 && (
                      <div style={{ fontSize: "11.5px", color: "#d97706", marginTop: "5px", fontWeight: 500 }}>
                        Select at least one degree program so this administrator has an active supervision scope.
                      </div>
                    )}
                  </div>

                  {/* Security Notice */}
                  <div className="ad-pa-security-callout">
                    <ShieldCheck size={20} style={{ color: "#16a34a", flexShrink: 0, marginTop: "1px" }} />
                    <div style={{ fontSize: "12px", lineHeight: 1.45 }}>
                      <strong style={{ display: "block", color: "#14532d", marginBottom: "1px" }}>
                        Isolated Session Protocol
                      </strong>
                      Account creation executes on an isolated authentication client. Your current super administrator session remains uninterrupted.
                    </div>
                  </div>
                </div>

                {/* Modal Footer */}
                <div style={{ padding: "16px 26px", borderTop: "1px solid #f1f5f9", background: "#f8fafc", borderRadius: "0 0 20px 20px", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "12px" }}>
                  <button
                    type="button"
                    className="ad-pa-btn-secondary"
                    disabled={creating}
                    onClick={() => setShowCreateModal(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="ad-pa-btn-primary"
                    disabled={creating}
                  >
                    <UserPlus size={16} />
                    <span>{creating ? "Creating Program Head..." : "Create Program Head"}</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* POST-CREATION CREDENTIALS SUCCESS MODAL                   */}
        {/* ========================================================= */}
        {createdCredentials && (
          <div className="ad-modal">
            <div className="ad-modalOverlay" onClick={() => setCreatedCredentials(null)} />
            <div className="ad-pa-modal-card" style={{ maxWidth: "520px" }}>
              <div className="ad-pa-modal-header">
                <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                  <div className="ad-pa-modal-hero-icon" style={{ background: "linear-gradient(135deg, #15803d 0%, #22c55e 100%)", boxShadow: "0 4px 12px rgba(34, 197, 94, 0.25)" }}>
                    <CheckCircle2 size={24} />
                  </div>
                  <div>
                    <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 800, color: "#0f172a" }}>
                      Program Head Created
                    </h3>
                    <p style={{ margin: "3px 0 0", fontSize: "12.5px", color: "#64748b" }}>
                      Account elevated to administrator. Copy initial login credentials.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  className="ad-pa-modal-close"
                  onClick={() => setCreatedCredentials(null)}
                >
                  <X size={16} />
                </button>
              </div>

              <div style={{ padding: "24px 26px", display: "flex", flexDirection: "column", gap: "16px" }}>
                <div className="ad-pa-copy-box">
                  <div><strong style={{ color: "#93c5fd" }}>Name:</strong> {createdCredentials.name}</div>
                  <div><strong style={{ color: "#93c5fd" }}>Email:</strong> {createdCredentials.email}</div>
                  <div><strong style={{ color: "#93c5fd" }}>Temp Password:</strong> {createdCredentials.password}</div>
                  <div><strong style={{ color: "#93c5fd" }}>Assigned Scope:</strong> {createdCredentials.programs.join(", ") || "None"}</div>
                  <div style={{ marginTop: "10px", paddingTop: "8px", borderTop: "1px dashed #334155", color: "#94a3b8", fontSize: "11px" }}>
                    Sign in at: {window.location.origin}/login
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleCopyCredentials}
                  className="ad-pa-btn-primary"
                  style={{ width: "100%", justifyContent: "center" }}
                >
                  {copiedCreds ? <CheckCheck size={16} /> : <Copy size={16} />}
                  <span>{copiedCreds ? "Copied to Clipboard!" : "Copy All Login Credentials"}</span>
                </button>
              </div>

              <div style={{ padding: "14px 26px", borderTop: "1px solid #f1f5f9", background: "#f8fafc", borderRadius: "0 0 20px 20px", display: "flex", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  className="ad-pa-btn-secondary"
                  onClick={() => setCreatedCredentials(null)}
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* EDIT PROGRAM HEAD MODAL (UPDATE - U)                      */}
        {/* ========================================================= */}
        {showEditModal && editingAdmin && (
          <div className="ad-modal">
            <div className="ad-modalOverlay" onClick={() => !savingEdit && setShowEditModal(false)} />
            <div className="ad-pa-modal-card">
              <div className="ad-pa-modal-header">
                <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                  <div className="ad-pa-modal-hero-icon" style={{ background: "linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%)" }}>
                    <Pencil size={20} />
                  </div>
                  <div>
                    <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 800, color: "#0f172a" }}>
                      Edit Program Head
                    </h3>
                    <p style={{ margin: "3px 0 0", fontSize: "12.5px", color: "#64748b" }}>
                      Update official name, institutional email, and status.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  className="ad-pa-modal-close"
                  disabled={savingEdit}
                  onClick={() => setShowEditModal(false)}
                >
                  <X size={16} />
                </button>
              </div>

              <form onSubmit={handleSaveEdit}>
                <div style={{ padding: "24px 26px", display: "flex", flexDirection: "column", gap: "18px" }}>
                  {editErr && (
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", padding: "12px 14px", borderRadius: "10px", fontSize: "13px" }}>
                      <AlertTriangle size={16} style={{ flexShrink: 0 }} />
                      <span>{editErr}</span>
                    </div>
                  )}

                  <div>
                    <label className="ad-pa-form-label">
                      <span>Full Name <strong style={{ color: "#ef4444" }}>*</strong></span>
                    </label>
                    <div className="ad-pa-input-wrap">
                      <User size={16} className="ad-pa-input-icon" />
                      <input
                        type="text"
                        className="ad-pa-input"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label className="ad-pa-form-label">
                      <span>Institutional Email <strong style={{ color: "#ef4444" }}>*</strong></span>
                      <span style={{ fontWeight: 500, color: "#94a3b8", textTransform: "none", fontSize: "11px" }}>Synchronizes with login</span>
                    </label>
                    <div className="ad-pa-input-wrap">
                      <Mail size={16} className="ad-pa-input-icon" />
                      <input
                        type="email"
                        className="ad-pa-input"
                        value={editEmail}
                        onChange={(e) => setEditEmail(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label className="ad-pa-form-label">
                      <span>Account Status <strong style={{ color: "#ef4444" }}>*</strong></span>
                    </label>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                      <button
                        type="button"
                        onClick={() => setEditStatus("active")}
                        className={`ad-pa-chip ${editStatus === "active" ? "ad-pa-chip--selected" : ""}`}
                        style={{ justifyContent: "center", padding: "10px", borderRadius: "10px" }}
                      >
                        <CheckCircle2 size={16} style={{ color: editStatus === "active" ? "#16a34a" : "#64748b" }} />
                        <span>Active Account</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditStatus("inactive")}
                        className={`ad-pa-chip ${editStatus === "inactive" ? "ad-pa-chip--selected" : ""}`}
                        style={{ justifyContent: "center", padding: "10px", borderRadius: "10px", borderColor: editStatus === "inactive" ? "#ef4444" : undefined, color: editStatus === "inactive" ? "#dc2626" : undefined, background: editStatus === "inactive" ? "#fef2f2" : undefined }}
                      >
                        <Power size={16} style={{ color: editStatus === "inactive" ? "#dc2626" : "#64748b" }} />
                        <span>Inactive / Disabled</span>
                      </button>
                    </div>
                  </div>
                </div>

                <div style={{ padding: "16px 26px", borderTop: "1px solid #f1f5f9", background: "#f8fafc", borderRadius: "0 0 20px 20px", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "12px" }}>
                  <button
                    type="button"
                    className="ad-pa-btn-secondary"
                    disabled={savingEdit}
                    onClick={() => setShowEditModal(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="ad-pa-btn-primary"
                    disabled={savingEdit}
                  >
                    <Check size={16} />
                    <span>{savingEdit ? "Saving Changes..." : "Save Changes"}</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* DELETE / DEMOTE PROGRAM HEAD MODAL (DELETE - D)           */}
        {/* ========================================================= */}
        {showDeleteModal && deletingAdmin && (
          <div className="ad-modal">
            <div className="ad-modalOverlay" onClick={() => !deleting && setShowDeleteModal(false)} />
            <div className="ad-pa-modal-card" style={{ maxWidth: "540px" }}>
              <div className="ad-pa-modal-header" style={{ borderBottomColor: "#fee2e2" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                  <div className="ad-pa-modal-hero-icon" style={{ background: "linear-gradient(135deg, #b91c1c 0%, #ef4444 100%)", boxShadow: "0 4px 12px rgba(239, 68, 68, 0.25)" }}>
                    <Trash2 size={22} />
                  </div>
                  <div>
                    <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 800, color: "#991b1b" }}>
                      Remove Program Head
                    </h3>
                    <p style={{ margin: "3px 0 0", fontSize: "12.5px", color: "#64748b" }}>
                      Action for <strong>{deletingAdmin.full_name}</strong> ({deletingAdmin.email})
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  className="ad-pa-modal-close"
                  disabled={deleting}
                  onClick={() => setShowDeleteModal(false)}
                >
                  <X size={16} />
                </button>
              </div>

              <div style={{ padding: "24px 26px", display: "flex", flexDirection: "column", gap: "16px" }}>
                {deleteErr && (
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", padding: "12px 14px", borderRadius: "10px", fontSize: "13px" }}>
                    <AlertTriangle size={16} style={{ flexShrink: 0 }} />
                    <span>{deleteErr}</span>
                  </div>
                )}

                <div className="ad-pa-danger-callout">
                  <ShieldAlert size={22} style={{ flexShrink: 0, marginTop: "2px" }} />
                  <div style={{ fontSize: "12.5px", lineHeight: 1.5 }}>
                    <strong style={{ display: "block", marginBottom: "2px" }}>Leadership Scope Revocation</strong>
                    Removing this head will immediately vacate all their assigned degree programs. Choose your removal method:
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <label
                    onClick={() => setDeleteMode("demote")}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "12px",
                      padding: "14px",
                      borderRadius: "12px",
                      border: deleteMode === "demote" ? "2px solid #2563eb" : "1.5px solid #e2e8f0",
                      background: deleteMode === "demote" ? "#eff6ff" : "#ffffff",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="radio"
                      name="deleteMode"
                      checked={deleteMode === "demote"}
                      onChange={() => setDeleteMode("demote")}
                      style={{ marginTop: "3px" }}
                    />
                    <div>
                      <strong style={{ fontSize: "13px", color: "#0f172a", display: "block" }}>
                        Demote to Regular Faculty (Recommended)
                      </strong>
                      <span style={{ fontSize: "12px", color: "#64748b", lineHeight: 1.4, display: "block", marginTop: "2px" }}>
                        Revokes administrator access and unassigns all programs, but preserves their user account, course history, and teaching records.
                      </span>
                    </div>
                  </label>

                  <label
                    onClick={() => setDeleteMode("permanent")}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "12px",
                      padding: "14px",
                      borderRadius: "12px",
                      border: deleteMode === "permanent" ? "2px solid #dc2626" : "1.5px solid #e2e8f0",
                      background: deleteMode === "permanent" ? "#fef2f2" : "#ffffff",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="radio"
                      name="deleteMode"
                      checked={deleteMode === "permanent"}
                      onChange={() => setDeleteMode("permanent")}
                      style={{ marginTop: "3px" }}
                    />
                    <div>
                      <strong style={{ fontSize: "13px", color: "#b91c1c", display: "block" }}>
                        Permanently Delete User Account
                      </strong>
                      <span style={{ fontSize: "12px", color: "#64748b", lineHeight: 1.4, display: "block", marginTop: "2px" }}>
                        Completely removes the user account and login credentials via the system deletion RPC. This cannot be undone.
                      </span>
                    </div>
                  </label>
                </div>
              </div>

              <div style={{ padding: "16px 26px", borderTop: "1px solid #f1f5f9", background: "#f8fafc", borderRadius: "0 0 20px 20px", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "12px" }}>
                <button
                  type="button"
                  className="ad-pa-btn-secondary"
                  disabled={deleting}
                  onClick={() => setShowDeleteModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDelete}
                  className="ad-pa-btn-danger"
                  disabled={deleting}
                >
                  <Trash2 size={16} />
                  <span>
                    {deleting
                      ? "Processing..."
                      : deleteMode === "demote"
                      ? "Confirm Demote to Faculty"
                      : "Permanently Delete Account"}
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </AdminLayout>
  );
}
