import { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import FacultyLayout from "./FacultyLayout";
import { Check, Copy, ShieldCheck } from "lucide-react";

export default function FacultyProfile() {
  const { currentUser, userProfile } = useAuth();
  const [copiedField, setCopiedField] = useState(null);

  const profile = userProfile || {};
  const displayName = profile.fullName || "Faculty";
  const initials = displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const facultyId = profile.schoolId || currentUser?.id?.slice(0, 8).toUpperCase() || "—";
  const email = profile.email || currentUser?.email || "—";

  const handleCopy = (field, text) => {
    if (!text || text === "—") return;
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  return (
    <FacultyLayout breadcrumb="My Profile">
      <section className="fd-content">
        <div className="fd-welcomeHeader">
          <div className="fd-welcomeText">
            <span className="fd-welcomeBadge">Account & Credentials</span>
            <h2 className="fd-title">Faculty Profile</h2>
            <p className="fd-subtitle">Verified institutional credentials and personal account information</p>
          </div>
        </div>

        <div className="fd-profileCard--executive">
          {/* Header Bar */}
          <div className="fd-profileHeader">
            <div className="fd-profileAvatar" style={{ background: "linear-gradient(135deg, #0f172a, #2563eb)" }}>
              {initials}
            </div>
            <div className="fd-profileInfo">
              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", marginBottom: "4px" }}>
                <h3 className="fd-profileName" style={{ margin: 0 }}>{displayName}</h3>
                <span className="fd-badgeVerified">
                  <ShieldCheck size={13} />
                  Active Faculty
                </span>
              </div>
              <span className="fd-profileRole" style={{ color: "#64748b", fontWeight: 500 }}>
                {profile.position || "Faculty Member"} • {profile.department || profile.dept || "Consolatrix College"}
              </span>
            </div>
          </div>

          {/* Group 1: Academic & Institutional Credentials */}
          <div style={{ marginBottom: "24px" }}>
            <h4 style={{ fontSize: "11.5px", fontWeight: "800", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.6px", margin: "0 0 14px" }}>
              Academic & Institutional Credentials
            </h4>
            <div className="fd-profileDetails" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px" }}>
              {/* Faculty ID */}
              <div className="fd-profileField" style={{ background: "#f8fafc", padding: "12px 14px", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <label className="fd-profileLabel" style={{ fontSize: "11px", fontWeight: "700", color: "#64748b", textTransform: "uppercase" }}>Faculty ID</label>
                  <button
                    type="button"
                    className="fd-copyBtn"
                    onClick={() => handleCopy("id", facultyId)}
                    title="Copy Faculty ID"
                  >
                    {copiedField === "id" ? <Check size={14} color="#16a34a" /> : <Copy size={14} />}
                  </button>
                </div>
                <div className="fd-profileValue" style={{ fontSize: "14px", fontWeight: "700", color: "#0f172a", marginTop: "4px" }}>
                  {facultyId}
                </div>
              </div>

              {/* Department / Program */}
              <div className="fd-profileField" style={{ background: "#f8fafc", padding: "12px 14px", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
                <label className="fd-profileLabel" style={{ fontSize: "11px", fontWeight: "700", color: "#64748b", textTransform: "uppercase" }}>Department / Program</label>
                <div className="fd-profileValue" style={{ fontSize: "14px", fontWeight: "700", color: "#0f172a", marginTop: "4px" }}>
                  {profile.department || profile.dept || "—"}
                </div>
              </div>

              {/* Academic Rank / Position */}
              <div className="fd-profileField" style={{ background: "#f8fafc", padding: "12px 14px", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
                <label className="fd-profileLabel" style={{ fontSize: "11px", fontWeight: "700", color: "#64748b", textTransform: "uppercase" }}>Academic Position</label>
                <div className="fd-profileValue" style={{ fontSize: "14px", fontWeight: "700", color: "#0f172a", marginTop: "4px" }}>
                  {profile.position || "Faculty Member"}
                </div>
              </div>

              {/* Specialization */}
              <div className="fd-profileField" style={{ background: "#f8fafc", padding: "12px 14px", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
                <label className="fd-profileLabel" style={{ fontSize: "11px", fontWeight: "700", color: "#64748b", textTransform: "uppercase" }}>Area of Specialization</label>
                <div className="fd-profileValue" style={{ fontSize: "14px", fontWeight: "700", color: "#0f172a", marginTop: "4px" }}>
                  {profile.specialization || "General Instruction"}
                </div>
              </div>
            </div>
          </div>

          {/* Group 2: Contact & Office Information */}
          <div>
            <h4 style={{ fontSize: "11.5px", fontWeight: "800", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.6px", margin: "0 0 14px" }}>
              Contact & Department Information
            </h4>
            <div className="fd-profileDetails" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px" }}>
              {/* Email Address */}
              <div className="fd-profileField" style={{ background: "#f8fafc", padding: "12px 14px", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <label className="fd-profileLabel" style={{ fontSize: "11px", fontWeight: "700", color: "#64748b", textTransform: "uppercase" }}>Institutional Email</label>
                  <button
                    type="button"
                    className="fd-copyBtn"
                    onClick={() => handleCopy("email", email)}
                    title="Copy Email Address"
                  >
                    {copiedField === "email" ? <Check size={14} color="#16a34a" /> : <Copy size={14} />}
                  </button>
                </div>
                <div className="fd-profileValue" style={{ fontSize: "13.5px", fontWeight: "700", color: "#0f172a", marginTop: "4px" }}>
                  {email}
                </div>
              </div>

              {/* Status */}
              <div className="fd-profileField" style={{ background: "#f8fafc", padding: "12px 14px", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
                <label className="fd-profileLabel" style={{ fontSize: "11px", fontWeight: "700", color: "#64748b", textTransform: "uppercase" }}>Employment Status</label>
                <div className="fd-profileValue" style={{ fontSize: "14px", fontWeight: "700", color: "#16a34a", marginTop: "4px" }}>
                  {profile.status === "active" ? "Active" : profile.status || "Active"}
                </div>
              </div>

              {/* Office Location */}
              <div className="fd-profileField" style={{ background: "#f8fafc", padding: "12px 14px", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
                <label className="fd-profileLabel" style={{ fontSize: "11px", fontWeight: "700", color: "#64748b", textTransform: "uppercase" }}>Office Location</label>
                <div className="fd-profileValue" style={{ fontSize: "14px", fontWeight: "600", color: "#0f172a", marginTop: "4px" }}>
                  {profile.officeLocation || "Faculty Room / Main Building"}
                </div>
              </div>

              {/* Contact Number */}
              <div className="fd-profileField" style={{ background: "#f8fafc", padding: "12px 14px", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
                <label className="fd-profileLabel" style={{ fontSize: "11px", fontWeight: "700", color: "#64748b", textTransform: "uppercase" }}>Contact Number</label>
                <div className="fd-profileValue" style={{ fontSize: "14px", fontWeight: "600", color: "#0f172a", marginTop: "4px" }}>
                  {profile.contactNumber || "—"}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </FacultyLayout>
  );
}
