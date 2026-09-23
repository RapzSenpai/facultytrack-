import { useState, useEffect } from "react";
import {
  Mail,
  GraduationCap,
  BarChart3,
  Users,
  CheckCircle2,
  Phone,
  Camera,
  Upload,
  Info,
  UserCheck,
  ChevronDown
} from "lucide-react";
import { supabase } from "../../config/supabase";
import { useAuth } from "../../context/AuthContext";
import StudentLayout from "./StudentLayout";

const YEAR_LEVEL_OPTIONS = [
  { value: "1st", label: "1st Year" },
  { value: "2nd", label: "2nd Year" },
  { value: "3rd", label: "3rd Year" },
  { value: "4th", label: "4th Year" },
];

const SECTION_OPTIONS = ["A", "B", "C", "D", "E"];

export default function StudentProfile() {
  const { currentUser, userProfile, refreshUserProfile } = useAuth();

  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [departmentOptions, setDepartmentOptions] = useState([]);

  const [form, setForm] = useState({
    fullName: "",
    email: "",
    department: "",
    yearLevel: "4th Year",
    section: "D",
    contactNumber: "",
    photoUrl: "",
  });

  const [profileData, setProfileData] = useState(userProfile);

  useEffect(() => {
    let isMounted = true;
    if (userProfile) {
      setProfileData(userProfile);
      setForm({
        fullName: userProfile.fullName || currentUser?.displayName || "",
        email: userProfile.email || currentUser?.email || "",
        department: userProfile.department || userProfile.dept || "BSIT",
        yearLevel: userProfile.yearLevel || userProfile.year || "4th Year",
        section: userProfile.section || "D",
        contactNumber: userProfile.contactNumber || "",
        photoUrl: userProfile.photoUrl || "",
      });
    }

    if (currentUser?.id) {
      supabase
        .from("users")
        .select("*")
        .eq("id", currentUser.id)
        .maybeSingle()
        .then(({ data }) => {
          if (data && isMounted) {
            setProfileData({
              fullName: data.full_name,
              email: data.email,
              department: data.department,
              yearLevel: data.year_level,
              section: data.section,
              contactNumber: data.contact_number,
              photoUrl: data.photo_url,
              schoolId: data.school_id,
              role: data.role,
              status: data.status,
            });
            const rawYear = data.year_level || "";
            const normYear = rawYear.includes("2") ? "2nd" : rawYear.includes("3") ? "3rd" : rawYear.includes("4") ? "4th" : "1st";
            setForm({
              fullName: data.full_name || currentUser?.displayName || "",
              email: data.email || currentUser?.email || "",
              department: data.department || "BSIT",
              yearLevel: normYear,
              section: data.section || "A",
              contactNumber: data.contact_number || "",
              photoUrl: data.photo_url || "",
            });
          }
        })
        .catch((err) => console.warn("Direct profile fetch warning:", err));
    }
    return () => { isMounted = false; };
  }, [userProfile, currentUser]);

  useEffect(() => {
    const fetchDepartments = async () => {
      try {
        const { data, error } = await supabase.from("departments").select("name");
        if (!error && Array.isArray(data) && data.length > 0) {
          const unique = [...new Set(data.map((d) => d.name).filter(Boolean))].sort();
          setDepartmentOptions(unique.map((d) => ({ code: d, name: d })));
        } else {
          const fallbacks = [
            "BSIT - BACHELOR OF SCIENCE IN INFORMATION TECHNOLOGY",
            "BSEntrep - BACHELOR OF SCIENCE IN ENTREPRENEURSHIP",
            "BPED - BACHELOR OF SCIENCE PHYSICAL EDUCATION",
            "BSHM - BACHELOR OF SCIENCE IN HOSPITALITY MANAGEMENT",
            "BSED - BACHELOR OF SECONDARY EDUCATION",
            "BEED - BACHELOR OF ELEMENTARY EDUCATION"
          ];
          setDepartmentOptions(fallbacks.map((d) => ({ code: d, name: d })));
        }
      } catch (err) {
        console.error("Failed to load departments:", err);
      }
    };
    fetchDepartments();
  }, []);

  const handleChange = (field, val) => {
    setForm((prev) => ({ ...prev, [field]: val }));
  };

  const handleCancel = () => {
    setForm({
      fullName: userProfile?.fullName || "",
      email: userProfile?.email || currentUser?.email || "",
      department: userProfile?.department || userProfile?.dept || "BSIT",
      yearLevel: userProfile?.yearLevel || userProfile?.year || "4th Year",
      section: userProfile?.section || "D",
      contactNumber: userProfile?.contactNumber || "",
      photoUrl: userProfile?.photoUrl || "",
    });
    setSuccessMsg("");
    setErrorMsg("");
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

  const handleSave = async (e) => {
    if (e) e.preventDefault();
    if (!currentUser) return;
    setSaving(true);
    setSuccessMsg("");
    setErrorMsg("");

    try {
      const updatedData = {
        full_name: form.fullName.trim(),
        email: form.email.trim(),
        department: form.department,
        year_level: form.yearLevel,
        section: form.section,
        contact_number: form.contactNumber.trim(),
        photo_url: form.photoUrl,
      };

      const { error } = await supabase
        .from("users")
        .update(updatedData)
        .eq("id", currentUser.id);

      if (error) throw new Error(error.message);

      setProfileData((prev) => ({ ...prev, ...updatedData }));
      if (refreshUserProfile) {
        await refreshUserProfile();
      }

      setSuccessMsg("Profile updated successfully!");
      setTimeout(() => {
        setSuccessMsg("");
      }, 3500);
    } catch (err) {
      console.error("Save profile error:", err);
      setErrorMsg("Failed to save profile: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const getInitials = (name) => {
    if (!name) return "ST";
    const parts = name.trim().split(" ");
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  const displayName = form.fullName || profileData?.fullName || userProfile?.fullName || currentUser?.displayName || "Student";
  const studentId = profileData?.schoolId || userProfile?.schoolId || userProfile?.studentId || userProfile?.idNumber || "20232208";

  return (
    <StudentLayout breadcrumb="My Profile">
      <div className="sp-container">
        {successMsg && <div className="sp-alert sp-alert--success">{successMsg}</div>}
        {errorMsg && <div className="sp-alert sp-alert--error">{errorMsg}</div>}

        <div className="sp-grid">
          <div className="sp-card sp-overviewCard">
            <div className="sp-overviewHeader">
              <div className="sp-avatarWrap">
                {form.photoUrl ? (
                  <img src={form.photoUrl} alt="Avatar" className="sp-avatarImg" />
                ) : (
                  <div className="sp-avatarText">{getInitials(displayName)}</div>
                )}
                <label className="sp-cameraBadge" title="Change Photo">
                  <Camera size={14} />
                  <input type="file" accept="image/*" onChange={handleImageChange} hidden />
                </label>
              </div>

              <div className="sp-overviewTitleBlock">
                <h3 className="sp-overviewName">{displayName}</h3>
                <div className="sp-overviewPills">
                  <span className="sp-rolePill">STUDENT</span>
                  <span className="sp-idPill">Student ID: {studentId}</span>
                </div>
              </div>
            </div>

            <div className="sp-detailsList">
              <div className="sp-detailRow">
                <div className="sp-iconBox"><Mail size={18} /></div>
                <div className="sp-detailBody">
                  <span className="sp-detailLabel">Email Address</span>
                  <span className="sp-detailValue">{form.email || "—"}</span>
                </div>
              </div>

              <div className="sp-detailRow">
                <div className="sp-iconBox"><GraduationCap size={18} /></div>
                <div className="sp-detailBody">
                  <span className="sp-detailLabel">Program</span>
                  <span className="sp-detailValue">{form.department || "—"}</span>
                </div>
              </div>

              <div className="sp-detailRow">
                <div className="sp-iconBox"><BarChart3 size={18} /></div>
                <div className="sp-detailBody">
                  <span className="sp-detailLabel">Year Level</span>
                  <span className="sp-detailValue">{form.yearLevel || "—"}</span>
                </div>
              </div>

              <div className="sp-detailRow">
                <div className="sp-iconBox"><Users size={18} /></div>
                <div className="sp-detailBody">
                  <span className="sp-detailLabel">Section</span>
                  <span className="sp-detailValue">{form.section || "—"}</span>
                </div>
              </div>

              <div className="sp-detailRow">
                <div className="sp-iconBox sp-iconBox--green"><CheckCircle2 size={18} /></div>
                <div className="sp-detailBody">
                  <span className="sp-detailLabel">Enrollment Status</span>
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
            </div>
          </div>

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
                    onChange={(e) => handleChange("fullName", e.target.value)}
                    placeholder="Enter full name"
                  />
                </div>

                <div className="sp-formGroup">
                  <label className="sp-label">Email Address (Gmail)</label>
                  <input
                    type="email"
                    className="sp-input"
                    value={form.email}
                    onChange={(e) => handleChange("email", e.target.value)}
                    placeholder="Enter email address"
                  />
                </div>
              </div>

              <div className="sp-formRow sp-formRow--3col">
                <div className="sp-formGroup">
                  <label className="sp-label">Program</label>
                  <div className="sp-selectWrap">
                    <select
                      className="sp-select"
                      value={form.department}
                      onChange={(e) => handleChange("department", e.target.value)}
                    >
                      {departmentOptions.length > 0 ? (
                        departmentOptions.map((d) => (
                          <option key={d.code} value={d.code}>
                            {d.code} - {d.name}
                          </option>
                        ))
                      ) : (
                        <>
                          <option value="BSIT">BSIT</option>
                          <option value="BSCS">BSCS</option>
                          <option value="BSIS">BSIS</option>
                          <option value="BSED">BSED</option>
                        </>
                      )}
                    </select>
                    <ChevronDown size={16} className="sp-selectCaret" />
                  </div>
                </div>

                <div className="sp-formGroup">
                  <label className="sp-label">Year Level</label>
                  <div className="sp-selectWrap">
                    <select
                      className="sp-select"
                      value={form.yearLevel}
                      onChange={(e) => handleChange("yearLevel", e.target.value)}
                    >
                      {YEAR_LEVEL_OPTIONS.map((y) => (
                        <option key={y.value} value={y.value}>{y.label}</option>
                      ))}
                    </select>
                    <ChevronDown size={16} className="sp-selectCaret" />
                  </div>
                </div>

                <div className="sp-formGroup">
                  <label className="sp-label">Section</label>
                  <div className="sp-selectWrap">
                    <select
                      className="sp-select"
                      value={form.section}
                      onChange={(e) => handleChange("section", e.target.value)}
                    >
                      {SECTION_OPTIONS.map((sec) => (
                        <option key={sec} value={sec}>{sec}</option>
                      ))}
                    </select>
                    <ChevronDown size={16} className="sp-selectCaret" />
                  </div>
                </div>
              </div>

              <div className="sp-formRow">
                <div className="sp-formGroup">
                  <label className="sp-label">Contact Number</label>
                  <input
                    type="text"
                    className="sp-input"
                    value={form.contactNumber}
                    onChange={(e) => handleChange("contactNumber", e.target.value)}
                    placeholder="Enter contact number (optional)"
                  />
                </div>
              </div>

              <div className="sp-formGroup" style={{ marginTop: "12px" }}>
                <label className="sp-label">Profile Picture</label>
                <div className="sp-photoUploadCard">
                  <div className="sp-photoMiniAvatar">
                    {form.photoUrl ? (
                      <img src={form.photoUrl} alt="Avatar Preview" className="sp-photoMiniImg" />
                    ) : (
                      <span>{getInitials(displayName)}</span>
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
          <span>Keep your information up to date to ensure accurate records and communication.</span>
        </div>
      </div>
    </StudentLayout>
  );
}
