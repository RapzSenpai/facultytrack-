import { useState, useEffect } from "react";
import AdminLayout from "./AdminLayout";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../config/supabase";
import {
  ShieldCheck,
  UserCheck,
  Copy,
  Check,
  Mail,
  Phone,
  Lock,
  Building2,
  Globe,
  CheckCircle2,
  Sparkles,
  Info
} from "lucide-react";

export default function AdminProfile() {
  const { currentUser, userProfile, refreshUserProfile } = useAuth();
  const [copiedField, setCopiedField] = useState(null);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const profile = userProfile || {};
  const isSuper = profile.role === "super_admin";

  const [form, setForm] = useState({
    fullName: "",
    contactNumber: "",
  });

  useEffect(() => {
    if (userProfile) {
      setForm({
        fullName: userProfile.fullName || currentUser?.displayName || "",
        contactNumber: userProfile.contactNumber || "",
      });
    }

    if (currentUser?.id) {
      supabase
        .from("users")
        .select("full_name, contact_number")
        .eq("id", currentUser.id)
        .maybeSingle()
        .then(({ data }) => {
          if (data) {
            setForm({
              fullName: data.full_name || currentUser?.displayName || "",
              contactNumber: data.contact_number || "",
            });
          }
        })
        .catch((err) => console.warn("Admin direct fetch warning:", err));
    }
  }, [userProfile, currentUser]);

  const displayName = form.fullName || profile.fullName || currentUser?.displayName || "Administrator";
  const initials = displayName
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "AD";

  const adminId = profile.schoolId || currentUser?.id?.slice(0, 8).toUpperCase() || "—";
  const email = profile.email || currentUser?.email || "—";
  const roleLabel = isSuper ? "Super Administrator" : "Program Head";
  const scopeLabel = isSuper ? "All Programs (Global)" : (profile.department || "Assigned Department");

  const handleCopy = (field, text) => {
    if (!text || text === "—") return;
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleCancel = () => {
    setForm({
      fullName: userProfile?.fullName || currentUser?.displayName || "",
      contactNumber: userProfile?.contactNumber || "",
    });
    setSuccessMsg("");
    setErrorMsg("");
  };

  const handleSave = async (e) => {
    if (e) e.preventDefault();
    if (!currentUser) return;

    if (!form.fullName.trim()) {
      setErrorMsg("Full Name is required.");
      return;
    }

    setSaving(true);
    setSuccessMsg("");
    setErrorMsg("");

    try {
      const updatedData = {
        full_name: form.fullName.trim(),
        contact_number: form.contactNumber.trim(),
      };

      const { error } = await supabase
        .from("users")
        .update(updatedData)
        .eq("id", currentUser.id);

      if (error) throw new Error(error.message);

      if (refreshUserProfile) {
        await refreshUserProfile();
      }

      setSuccessMsg("Profile updated successfully!");
      setTimeout(() => {
        setSuccessMsg("");
      }, 3500);
    } catch (err) {
      console.error("Save admin profile error:", err);
      setErrorMsg("Failed to save profile: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminLayout title="My Profile">
      <section className="ad-content">
        <div className="sp-container">
          {successMsg && <div className="sp-alert sp-alert--success">{successMsg}</div>}
          {errorMsg && <div className="sp-alert sp-alert--error">{errorMsg}</div>}

          <div className="sp-grid">
            {/* LEFT CARD: Overview */}
            <div className="sp-card sp-overviewCard">
              <div className="sp-overviewHeader">
                <div className="sp-avatarWrap">
                  <div
                    className="sp-avatarText"
                    style={
                      isSuper
                        ? { background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)", border: "2px solid #f59e0b", color: "#ffffff" }
                        : { background: "#0f2540", color: "#ffffff" }
                    }
                  >
                    {initials}
                  </div>
                </div>

                <div className="sp-overviewTitleBlock">
                  <h3 className="sp-overviewName">{displayName}</h3>
                  <div className="sp-overviewPills">
                    <span
                      className="sp-rolePill"
                      style={isSuper ? { background: "#fef3c7", color: "#92400e" } : {}}
                    >
                      {isSuper ? "SUPER ADMIN" : "PROGRAM HEAD"}
                    </span>
                    <span className="sp-idPill">Admin ID: {adminId}</span>
                  </div>
                </div>
              </div>

              <div className="sp-detailsList">
                <div className="sp-detailRow">
                  <div className="sp-iconBox"><Mail size={18} /></div>
                  <div className="sp-detailBody">
                    <span className="sp-detailLabel">Email Address</span>
                    <span className="sp-detailValue" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span>{email}</span>
                      <button
                        type="button"
                        className="fd-copyBtn"
                        onClick={() => handleCopy("email", email)}
                        title="Copy Email"
                        style={{ border: "none", background: "transparent", cursor: "pointer", padding: "2px" }}
                      >
                        {copiedField === "email" ? <Check size={14} color="#16a34a" /> : <Copy size={14} color="#64748b" />}
                      </button>
                    </span>
                  </div>
                </div>

                <div className="sp-detailRow">
                  <div className="sp-iconBox">
                    {isSuper ? <Globe size={18} /> : <Building2 size={18} />}
                  </div>
                  <div className="sp-detailBody">
                    <span className="sp-detailLabel">Administrative Scope</span>
                    <span className="sp-detailValue">{scopeLabel}</span>
                  </div>
                </div>

                <div className="sp-detailRow">
                  <div className="sp-iconBox sp-iconBox--green"><CheckCircle2 size={18} /></div>
                  <div className="sp-detailBody">
                    <span className="sp-detailLabel">System Status</span>
                    <span className="sp-statusPill">Active</span>
                  </div>
                </div>

                <div className="sp-detailRow">
                  <div className="sp-iconBox"><Phone size={18} /></div>
                  <div className="sp-detailBody">
                    <span className="sp-detailLabel">Contact Number</span>
                    <span className="sp-detailValue">{form.contactNumber || "—"}</span>
                  </div>
                </div>

                <div className="sp-detailRow">
                  <div className="sp-iconBox"><Lock size={18} /></div>
                  <div className="sp-detailBody">
                    <span className="sp-detailLabel">Role</span>
                    <span className="sp-detailValue">
                      {isSuper ? "Super Admin" : "Program Head"}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* RIGHT CARD: Edit Form */}
            <div className="sp-card sp-editCard">
              <div className="sp-editHeader">
                <div className="sp-editHeaderTitle">
                  <div className="sp-editHeaderIcon"><UserCheck size={20} /></div>
                  <div>
                    <h3 className="sp-editTitle">Edit Profile</h3>
                    <p className="sp-editSub">Update your administrator information</p>
                  </div>
                </div>
                <div className="sp-editActions">
                  <button type="button" className="sp-cancelBtn" onClick={handleCancel}>
                    Cancel
                  </button>
                  <button type="button" className="sp-saveBtn" onClick={handleSave} disabled={saving}>
                    {saving ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              </div>

              <form onSubmit={handleSave} className="sp-form">
                <div className="sp-formRow sp-formRow--2col">
                  <div className="sp-formGroup">
                    <label className="sp-label">Full Name</label>
                    <input
                      type="text"
                      className="sp-input"
                      value={form.fullName}
                      onChange={(e) => setForm((prev) => ({ ...prev, fullName: e.target.value }))}
                      autoComplete="off"
                      placeholder="Enter administrator full name"
                    />
                  </div>

                  <div className="sp-formGroup">
                    <label className="sp-label">Email Address</label>
                    <div style={{ position: "relative" }}>
                      <input
                        type="email"
                        className="sp-input"
                        value={email}
                        readOnly
                        style={{ background: "#f8fafc", color: "#64748b", cursor: "not-allowed" }}
                        title="Institutional email cannot be edited directly"
                      />
                      <button
                        type="button"
                        className="fd-copyBtn"
                        style={{ position: "absolute", right: "10px", top: "50%", transform: "translateY(-50%)" }}
                        onClick={() => handleCopy("inputEmail", email)}
                        title="Copy Email Address"
                      >
                        {copiedField === "inputEmail" ? <Check size={14} color="#16a34a" /> : <Copy size={14} />}
                      </button>
                    </div>
                    <span style={{ fontSize: "11px", color: "#64748b", marginTop: "2px", display: "block" }}>
                      Institutional email managed by root administrators.
                    </span>
                  </div>
                </div>

                <div className="sp-formRow sp-formRow--2col">
                  <div className="sp-formGroup">
                    <label className="sp-label">Contact Number</label>
                    <input
                      type="text"
                      className="sp-input"
                      value={form.contactNumber}
                      onChange={(e) => setForm((prev) => ({ ...prev, contactNumber: e.target.value }))}
                      autoComplete="off"
                      placeholder="Enter contact number (e.g. 09123456789)"
                    />
                  </div>
                </div>

                <div className="sp-academicSection" style={{ background: "#f8fafc", padding: "14px 16px", borderRadius: "12px", border: "1px solid #e2e8f0" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "10px" }}>
                    <ShieldCheck size={16} color="#2563eb" />
                    <span style={{ fontSize: "11.5px", fontWeight: "800", color: "#475569", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                      Verified Administrative Privileges
                    </span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "12px" }}>
                    <div>
                      <span style={{ display: "block", fontSize: "11px", fontWeight: "600", color: "#64748b" }}>Role Type</span>
                      <span style={{ fontSize: "13px", fontWeight: "700", color: isSuper ? "#d97706" : "#2563eb" }}>{roleLabel}</span>
                    </div>
                    <div>
                      <span style={{ display: "block", fontSize: "11px", fontWeight: "600", color: "#64748b" }}>Assigned Scope</span>
                      <span style={{ fontSize: "13px", fontWeight: "700", color: "#0f172a" }}>{scopeLabel}</span>
                    </div>
                    <div>
                      <span style={{ display: "block", fontSize: "11px", fontWeight: "600", color: "#64748b" }}>Administrator ID</span>
                      <span style={{ fontSize: "13px", fontWeight: "700", color: "#0f172a", display: "inline-flex", alignItems: "center", gap: "6px" }}>
                        {adminId}
                        <button
                          type="button"
                          className="fd-copyBtn"
                          onClick={() => handleCopy("adminId", adminId)}
                          title="Copy ID"
                          style={{ border: "none", background: "transparent", cursor: "pointer", padding: "2px" }}
                        >
                          {copiedField === "adminId" ? <Check size={12} color="#16a34a" /> : <Copy size={12} color="#64748b" />}
                        </button>
                      </span>
                    </div>
                  </div>
                </div>
              </form>
            </div>
          </div>

          <div className="sp-noticeBanner" style={{ marginTop: "24px" }}>
            <Info size={18} className="sp-noticeIcon" />
            <span>Administrative authority and institutional scope assignments are governed by FacultyTrack Core Administration.</span>
          </div>
        </div>
      </section>
    </AdminLayout>
  );
}
