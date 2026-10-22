import { useState, useEffect } from "react";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../config/supabase";
import FacultyLayout from "./FacultyLayout";
import {
  Mail,
  GraduationCap,
  Briefcase,
  Award,
  Building2,
  CheckCircle2,
  Phone,
  Camera,
  Upload,
  Info,
  UserCheck,
  ShieldCheck,
  Copy,
  Check
} from "lucide-react";

export default function FacultyProfile() {
  const { currentUser, userProfile, refreshUserProfile } = useAuth();
  const [copiedField, setCopiedField] = useState(null);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const profile = userProfile || {};

  const [form, setForm] = useState({
    fullName: "",
    contactNumber: "",
    photoUrl: "",
  });

  useEffect(() => {
    if (userProfile) {
      setForm({
        fullName: userProfile.fullName || currentUser?.displayName || "",
        contactNumber: userProfile.contactNumber || "",
        photoUrl: userProfile.photoUrl || "",
      });
    }

    if (currentUser?.id) {
      supabase
        .from("users")
        .select("full_name, contact_number, photo_url")
        .eq("id", currentUser.id)
        .maybeSingle()
        .then(({ data }) => {
          if (data) {
            setForm({
              fullName: data.full_name || currentUser?.displayName || "",
              contactNumber: data.contact_number || "",
              photoUrl: data.photo_url || "",
            });
          }
        })
        .catch((err) => console.warn("Faculty direct fetch warning:", err));
    }
  }, [userProfile, currentUser]);

  const displayName = form.fullName || profile.fullName || currentUser?.displayName || "Faculty Member";
  const initials = displayName
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "FC";

  const facultyId = profile.schoolId || currentUser?.id?.slice(0, 8).toUpperCase() || "—";
  const email = profile.email || currentUser?.email || "—";

  const handleCopy = (field, text) => {
    if (!text || text === "—") return;
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      alert("Image size exceeds 2MB limit.");
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      setForm((prev) => ({ ...prev, photoUrl: reader.result }));
    };
    reader.readAsDataURL(file);
  };

  const handleCancel = () => {
    setForm({
      fullName: userProfile?.fullName || currentUser?.displayName || "",
      contactNumber: userProfile?.contactNumber || "",
      photoUrl: userProfile?.photoUrl || "",
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
        photo_url: form.photoUrl,
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
      console.error("Save faculty profile error:", err);
      setErrorMsg("Failed to save profile: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <FacultyLayout breadcrumb="My Profile">
      <section className="fd-content" style={{ minHeight: "100%", padding: "26px 26px 40px", boxSizing: "border-box" }}>
        <div className="sp-container">
          {successMsg && <div className="sp-alert sp-alert--success">{successMsg}</div>}
          {errorMsg && <div className="sp-alert sp-alert--error">{errorMsg}</div>}

          <div className="sp-grid">
            {/* LEFT CARD: Overview */}
            <div className="sp-card sp-overviewCard">
              <div className="sp-overviewHeader">
              <div className="sp-avatarWrap">
                {form.photoUrl ? (
                  <img src={form.photoUrl} alt="Avatar" className="sp-avatarImg" />
                ) : (
                  <div className="sp-avatarText" style={{ background: "linear-gradient(135deg, #0f172a, #2563eb)" }}>
                    {initials}
                  </div>
                )}
                <label className="sp-cameraBadge" title="Change Photo">
                  <Camera size={14} />
                  <input type="file" accept="image/*" onChange={handleImageChange} hidden />
                </label>
              </div>

              <div className="sp-overviewTitleBlock">
                <h3 className="sp-overviewName">{displayName}</h3>
                <div className="sp-overviewPills">
                  <span className="sp-rolePill">FACULTY</span>
                  <span className="sp-idPill">Faculty ID: {facultyId}</span>
                </div>
              </div>
            </div>

            <div className="sp-detailsList">
              <div className="sp-detailRow">
                <div className="sp-iconBox"><Mail size={18} /></div>
                <div className="sp-detailBody">
                  <span className="sp-detailLabel">Institutional Email</span>
                  <span className="sp-detailValue">{email}</span>
                </div>
              </div>

              <div className="sp-detailRow">
                <div className="sp-iconBox"><GraduationCap size={18} /></div>
                <div className="sp-detailBody">
                  <span className="sp-detailLabel">Department / Program</span>
                  <span className="sp-detailValue">{profile.department || profile.dept || "—"}</span>
                </div>
              </div>

              <div className="sp-detailRow">
                <div className="sp-iconBox"><Briefcase size={18} /></div>
                <div className="sp-detailBody">
                  <span className="sp-detailLabel">Academic Position</span>
                  <span className="sp-detailValue">{profile.position || "Faculty Member"}</span>
                </div>
              </div>

              <div className="sp-detailRow">
                <div className="sp-iconBox"><Award size={18} /></div>
                <div className="sp-detailBody">
                  <span className="sp-detailLabel">Area of Specialization</span>
                  <span className="sp-detailValue">{profile.specialization || "General Instruction"}</span>
                </div>
              </div>

              <div className="sp-detailRow">
                <div className="sp-iconBox"><Building2 size={18} /></div>
                <div className="sp-detailBody">
                  <span className="sp-detailLabel">Office Location</span>
                  <span className="sp-detailValue">{profile.officeLocation || "Faculty Room / Main Building"}</span>
                </div>
              </div>

              <div className="sp-detailRow">
                <div className="sp-iconBox sp-iconBox--green"><CheckCircle2 size={18} /></div>
                <div className="sp-detailBody">
                  <span className="sp-detailLabel">Employment Status</span>
                  <span className="sp-statusPill">{profile.status === "active" ? "Active" : profile.status || "Active"}</span>
                </div>
              </div>

              <div className="sp-detailRow">
                <div className="sp-iconBox"><Phone size={18} /></div>
                <div className="sp-detailBody">
                  <span className="sp-detailLabel">Contact Number</span>
                  <span className="sp-detailValue">{form.contactNumber || "—"}</span>
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT CARD: Edit Profile */}
          <div className="sp-card sp-editCard">
            <div className="sp-editHeader">
              <div className="sp-editHeaderTitle">
                <div className="sp-editHeaderIcon"><UserCheck size={20} /></div>
                <div>
                  <h3 className="sp-editTitle">Edit Profile</h3>
                  <p className="sp-editSub">Update your personal information</p>
                </div>
              </div>
              <div className="sp-editActions">
                <button type="button" className="sp-cancelBtn" onClick={handleCancel} disabled={saving}>
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
                    placeholder="Enter full name"
                  />
                </div>

                <div className="sp-formGroup">
                  <label className="sp-label">Institutional Email</label>
                  <div style={{ position: "relative" }}>
                    <input
                      type="email"
                      className="sp-input"
                      value={email}
                      readOnly
                      style={{ background: "#f8fafc", color: "#64748b", cursor: "not-allowed", paddingRight: "40px" }}
                      title="Institutional email cannot be edited directly"
                    />
                    <button
                      type="button"
                      className="fd-copyBtn"
                      style={{ position: "absolute", right: "10px", top: "50%", transform: "translateY(-50%)" }}
                      onClick={() => handleCopy("email", email)}
                      title="Copy Email Address"
                    >
                      {copiedField === "email" ? <Check size={14} color="#16a34a" /> : <Copy size={14} />}
                    </button>
                  </div>
                  <span style={{ fontSize: "11px", color: "#64748b", marginTop: "2px" }}>
                    Institutional email managed by administration.
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
                    Verified Institutional Credentials
                  </span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px" }}>
                  <div>
                    <span style={{ display: "block", fontSize: "11px", fontWeight: "600", color: "#64748b" }}>Faculty ID</span>
                    <span style={{ fontSize: "13px", fontWeight: "700", color: "#0f172a" }}>{facultyId}</span>
                  </div>
                  <div>
                    <span style={{ display: "block", fontSize: "11px", fontWeight: "600", color: "#64748b" }}>Department / Program</span>
                    <span style={{ fontSize: "13px", fontWeight: "700", color: "#0f172a" }}>{profile.department || profile.dept || "—"}</span>
                  </div>
                  <div>
                    <span style={{ display: "block", fontSize: "11px", fontWeight: "600", color: "#64748b" }}>Academic Position</span>
                    <span style={{ fontSize: "13px", fontWeight: "700", color: "#0f172a" }}>{profile.position || "Faculty Member"}</span>
                  </div>
                  <div>
                    <span style={{ display: "block", fontSize: "11px", fontWeight: "600", color: "#64748b" }}>Specialization</span>
                    <span style={{ fontSize: "13px", fontWeight: "700", color: "#0f172a" }}>{profile.specialization || "General Instruction"}</span>
                  </div>
                  <div>
                    <span style={{ display: "block", fontSize: "11px", fontWeight: "600", color: "#64748b" }}>Office Location</span>
                    <span style={{ fontSize: "13px", fontWeight: "700", color: "#0f172a" }}>{profile.officeLocation || "Faculty Room / Main Building"}</span>
                  </div>
                  <div>
                    <span style={{ display: "block", fontSize: "11px", fontWeight: "600", color: "#64748b" }}>Status</span>
                    <span style={{ fontSize: "13px", fontWeight: "700", color: "#16a34a" }}>{profile.status === "active" ? "Active" : profile.status || "Active"}</span>
                  </div>
                </div>
              </div>

              <div className="sp-formGroup" style={{ marginTop: "8px" }}>
                <label className="sp-label">Profile Picture</label>
                <div className="sp-photoUploadCard">
                  <div className="sp-photoMiniAvatar">
                    {form.photoUrl ? (
                      <img src={form.photoUrl} alt="Avatar Preview" className="sp-photoMiniImg" />
                    ) : (
                      <span>{initials}</span>
                    )}
                  </div>
                  <div className="sp-photoUploadInfo">
                    <span className="sp-photoUploadHint">JPG, PNG or GIF. Max size of 2MB.</span>
                    <label className="sp-uploadBtn">
                      <Upload size={15} />
                      <span>Change Photo</span>
                      <input type="file" accept="image/*" onChange={handleImageChange} hidden />
                    </label>
                  </div>
                </div>
              </div>
            </form>
          </div>
        </div>

        <div className="sp-noticeBanner">
          <Info size={18} className="sp-noticeIcon" />
          <span>Keep your contact information up to date to ensure accurate institutional records and communication.</span>
        </div>
      </div>
      </section>
    </FacultyLayout>
  );
}
