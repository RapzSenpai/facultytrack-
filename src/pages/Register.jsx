import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { User, Users, ChevronDown, AlertCircle, ArrowLeft, Mail, Lock, Hash, IdCard } from "lucide-react";
import { supabase } from "../config/supabase";
import AuthField from "../components/auth/AuthField";
import { validateIdPhoto, uploadSchoolIdPhoto } from "../utils/idPhoto";
import "../styles/auth.css";
import logo from "../assets/Logo (3).png";

const SUFFIXES = ["None", "Jr.", "Sr.", "II", "III"];
const YEAR_LEVELS = [
  { value: "1st", label: "1st Year" },
  { value: "2nd", label: "2nd Year" },
  { value: "3rd", label: "3rd Year" },
  { value: "4th", label: "4th Year" },
];
const SECTIONS = ["A", "B", "C", "D", "E"];

const EMPTY_FORM = {
  firstName: "",
  lastName: "",
  suffix: "None",
  schoolId: "",
  email: "",
  department: "",
  yearLevel: "",
  section: "",
  password: "",
  confirmPassword: "",
};

function SelectWrap({ children }) {
  return (
    <div className="auth-select-wrap">
      {children}
      <ChevronDown size={16} className="auth-select-caret" aria-hidden="true" />
    </div>
  );
}

export default function Register() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("student");
  const [form, setForm] = useState(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [departmentOptions, setDepartmentOptions] = useState([]);
  const [idPhoto, setIdPhoto] = useState(null);
  const [idPhotoPreview, setIdPhotoPreview] = useState("");
  const [availableSections, setAvailableSections] = useState(SECTIONS);

  const isStudent = activeTab === "student";
  const idLabel = isStudent ? "STUDENT ID" : "FACULTY ID";

  useEffect(() => {
    supabase
      .from("departments")
      .select("id, name")
      .then(({ data, error }) => {
        if (error) {
          console.error("Dept fetch error from Supabase:", error);
          return;
        }
        if (Array.isArray(data) && data.length > 0) {
          setDepartmentOptions(data);
        }
      })
      .catch((err) => console.error("Dept fetch exception:", err));
  }, []);

  // Dynamically load active sections for the student's chosen program and year level
  useEffect(() => {
    if (!form.department || !form.yearLevel) {
      setAvailableSections(SECTIONS);
      return;
    }
    const norm = (y) => {
      const str = String(y).toLowerCase().replace(/[^a-z0-9]/g, "");
      if (str.includes("1")) return "1st";
      if (str.includes("2")) return "2nd";
      if (str.includes("3")) return "3rd";
      if (str.includes("4")) return "4th";
      return y;
    };
    supabase
      .from("sections")
      .select("name")
      .ilike("department", form.department)
      .eq("year_level", norm(form.yearLevel))
      .order("name")
      .then(({ data, error }) => {
        if (!error && data && data.length > 0) {
          setAvailableSections(data.map((d) => d.name));
        } else {
          setAvailableSections(SECTIONS);
        }
      })
      .catch(() => setAvailableSections(SECTIONS));
  }, [form.department, form.yearLevel]);

  const switchTab = (tab) => {
    setActiveTab(tab);
    setForm(EMPTY_FORM);
    setFieldErrors({});
    setFormError("");
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setFieldErrors((prev) => (prev[name] ? { ...prev, [name]: "" } : prev));
  };

  const validate = () => {
    const errors = {};
    if (!form.firstName.trim()) errors.firstName = "First name is required.";
    if (!form.lastName.trim()) errors.lastName = "Last name is required.";
    if (!/^\d{8}$/.test(form.schoolId.trim())) errors.schoolId = "Enter your 8-digit ID number.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errors.email = "Enter a valid email address.";
    if (isStudent) {
      if (!form.department) errors.department = "Select your program.";
      if (!form.yearLevel) errors.yearLevel = "Select your year level.";
      if (!form.section) errors.section = "Select your section.";
    }
    if (form.password.length < 6) errors.password = "Password must be at least 6 characters.";
    if (form.confirmPassword !== form.password) errors.confirmPassword = "Passwords do not match.";
    const photoError = validateIdPhoto(idPhoto);
    if (photoError) errors.idPhoto = photoError;
    return errors;
  };

  const handleIdPhotoChange = (e) => {
    const file = e.target.files[0];
    setIdPhoto(file || null);
    setIdPhotoPreview(file ? URL.createObjectURL(file) : "");
    setFieldErrors((prev) => ({ ...prev, idPhoto: "" }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError("");

    const errors = validate();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    try {
      setLoading(true);

      const fullName = `${form.firstName.trim()} ${form.lastName.trim()}${form.suffix !== "None" ? " " + form.suffix : ""}`;

      const { error: signUpError, data: signUpData } = await supabase.auth.signUp({
        email: form.email.trim(),
        password: form.password,
        options: {
          data: {
            full_name: fullName,
            first_name: form.firstName.trim(),
            last_name: form.lastName.trim(),
            suffix: form.suffix,
            role: activeTab,
            school_id: form.schoolId.trim(),
            department: isStudent ? form.department : "",
            year_level: isStudent ? form.yearLevel : "",
            section: isStudent ? form.section : "",
          },
        },
      });

      if (signUpError) throw signUpError;

      // ID photo upload (D12). With a session at signUp the upload
      // happens now; if email confirmation is enabled there is no
      // session yet — Login/PendingApproval pick the photo up after
      // the user verifies and signs in (photoPending flag).
      let photoPending = false;
      if (idPhoto) {
        try {
          await uploadSchoolIdPhoto(signUpData.user.id, idPhoto);
        } catch (uploadErr) {
          if (signUpData.session) {
            throw new Error("Account created, but the ID photo failed to upload: " + uploadErr.message);
          }
          photoPending = true;
        }
      }

      setSuccessMsg("Registration successful! Your account is currently pending admin approval.");
      setTimeout(() => {
        navigate("/pending-approval", {
          state: { email: form.email.trim(), schoolId: form.schoolId.trim(), photoPending },
        });
      }, 1500);
    } catch (err) {
      console.error("Register error:", err);
      if (err.message?.includes("already")) {
        setFormError("An account with this email already exists.");
      } else {
        setFormError(err.message || "Registration failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card auth-card--wide">
        <div style={{ marginBottom: "12px", textAlign: "left" }}>
          <Link to="/login" className="auth-back-link" style={{ color: '#475569', fontWeight: '500' }}>
            <ArrowLeft size={16} style={{ marginRight: '4px' }} /> Back to Login
          </Link>
        </div>

        <div className="auth-header-logo-container">
          <img src={logo} alt="CCTC Logo" className="auth-header-logo" />
        </div>

        <h1 className="auth-title auth-title--center">{isStudent ? "Student" : "Faculty"} Sign Up</h1>
        <p className="auth-subtitle auth-subtitle--center">
          Create your CCTC Evaluation System account
        </p>

        <div className="auth-tabs" role="tablist" aria-label="Register as">
          <button
            type="button"
            role="tab"
            aria-selected={isStudent}
            className={`auth-tab ${isStudent ? "active" : ""}`}
            onClick={() => switchTab("student")}
          >
            <User size={16} aria-hidden="true" />
            Student
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={!isStudent}
            className={`auth-tab ${!isStudent ? "active" : ""}`}
            onClick={() => switchTab("faculty")}
          >
            <Users size={16} aria-hidden="true" />
            Faculty
          </button>
        </div>

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          {successMsg && (
            <div className="auth-alert" role="alert" style={{ background: '#ecfdf5', color: '#065f46', borderColor: '#a7f3d0' }}>
              <User size={16} aria-hidden="true" />
              <span>{successMsg}</span>
            </div>
          )}

          {formError && (
            <div className="auth-alert" role="alert">
              <AlertCircle size={16} aria-hidden="true" />
              <span>{formError}</span>
            </div>
          )}

          <h2 className="auth-section-heading">Personal Information</h2>

          <div className="auth-grid">
            <AuthField
              label={idLabel}
              htmlFor="schoolId"
              required
              error={fieldErrors.schoolId}
              icon={Hash}
            >
              <input
                id="schoolId"
                name="schoolId"
                type="text"
                inputMode="numeric"
                maxLength={8}
                className={`auth-input ${fieldErrors.schoolId ? "auth-input--invalid" : ""}`}
                placeholder="e.g. 20232205"
                value={form.schoolId}
                onChange={handleChange}
              />
            </AuthField>

            <AuthField
              label="EMAIL ADDRESS"
              htmlFor="email"
              required
              error={fieldErrors.email}
              icon={Mail}
            >
              <input
                id="email"
                name="email"
                type="email"
                className={`auth-input ${fieldErrors.email ? "auth-input--invalid" : ""}`}
                placeholder="e.g. juan.delacruz@email.com"
                autoComplete="email"
                value={form.email}
                onChange={handleChange}
              />
            </AuthField>

            <AuthField label="FIRST NAME" htmlFor="firstName" required error={fieldErrors.firstName} icon={User}>
              <input
                id="firstName"
                name="firstName"
                type="text"
                className={`auth-input ${fieldErrors.firstName ? "auth-input--invalid" : ""}`}
                placeholder="e.g. Juan"
                autoComplete="given-name"
                value={form.firstName}
                onChange={handleChange}
              />
            </AuthField>

            <AuthField label="LAST NAME" htmlFor="lastName" required error={fieldErrors.lastName} icon={User}>
              <input
                id="lastName"
                name="lastName"
                type="text"
                className={`auth-input ${fieldErrors.lastName ? "auth-input--invalid" : ""}`}
                placeholder="e.g. dela Cruz"
                autoComplete="family-name"
                value={form.lastName}
                onChange={handleChange}
              />
            </AuthField>

            <AuthField label="SUFFIX" htmlFor="suffix" optional span2={!isStudent}>
              <SelectWrap>
                <select id="suffix" name="suffix" className="auth-select" value={form.suffix} onChange={handleChange}>
                  {SUFFIXES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </SelectWrap>
            </AuthField>

            {isStudent && (
              <AuthField label="PROGRAM" htmlFor="department" required error={fieldErrors.department}>
                <SelectWrap>
                  <select
                    id="department"
                    name="department"
                    className={`auth-select ${fieldErrors.department ? "auth-select--invalid" : ""}`}
                    value={form.department}
                    onChange={handleChange}
                  >
                    <option value="">Select your program</option>
                    {(departmentOptions.length > 0 ? departmentOptions : [
                      { id: "bsit", name: "BSIT - BACHELOR OF SCIENCE IN INFORMATION TECHNOLOGY" },
                      { id: "bsentrep", name: "BSEntrep - BACHELOR OF SCIENCE IN ENTREPRENEURSHIP" },
                      { id: "bped", name: "BPED - BACHELOR OF SCIENCE PHYSICAL EDUCATION" },
                      { id: "bshm", name: "BSHM - BACHELOR OF SCIENCE IN HOSPITALITY MANAGEMENT" },
                      { id: "bsed", name: "BSED - BACHELOR OF SECONDARY EDUCATION" },
                      { id: "beed", name: "BEED - BACHELOR OF ELEMENTARY EDUCATION" },
                    ]).map((d) => (
                      <option key={d.id} value={d.name}>{d.name}</option>
                    ))}
                  </select>
                </SelectWrap>
              </AuthField>
            )}

            {isStudent && (
              <>
                <AuthField label="YEAR LEVEL" htmlFor="yearLevel" required error={fieldErrors.yearLevel}>
                  <SelectWrap>
                    <select
                      id="yearLevel"
                      name="yearLevel"
                      className={`auth-select ${fieldErrors.yearLevel ? "auth-select--invalid" : ""}`}
                      value={form.yearLevel}
                      onChange={handleChange}
                    >
                      <option value="">Select year level</option>
                      {YEAR_LEVELS.map((y) => (
                        <option key={y.value} value={y.value}>{y.label}</option>
                      ))}
                    </select>
                  </SelectWrap>
                </AuthField>

                <AuthField label="SECTION" htmlFor="section" required error={fieldErrors.section}>
                  <SelectWrap>
                    <select
                      id="section"
                      name="section"
                      className={`auth-select ${fieldErrors.section ? "auth-select--invalid" : ""}`}
                      value={form.section}
                      onChange={handleChange}
                    >
                      <option value="">Select section</option>
                      {availableSections.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </SelectWrap>
                </AuthField>
              </>
            )}

            <AuthField
              label="SCHOOL ID PHOTO"
              htmlFor="idPhoto"
              required
              error={fieldErrors.idPhoto}
              span2
            >
              <div className="auth-id-upload">
                <input
                  id="idPhoto"
                  name="idPhoto"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="auth-id-file-input"
                  onChange={handleIdPhotoChange}
                />
                <label htmlFor="idPhoto" className={`auth-id-dropzone ${fieldErrors.idPhoto ? "auth-id-dropzone--invalid" : ""}`}>
                  {idPhotoPreview ? (
                    <div className="auth-id-preview-row">
                      <img
                        src={idPhotoPreview}
                        alt="ID preview"
                        className="auth-id-preview-img"
                      />
                      <div className="auth-id-preview-info">
                        <span className="auth-id-preview-name">{idPhoto?.name || "School ID Photo Selected"}</span>
                        <span className="auth-id-preview-action">Click to change photo</span>
                      </div>
                    </div>
                  ) : (
                    <div className="auth-id-placeholder">
                      <div className="auth-id-icon-circle">
                        <IdCard size={20} />
                      </div>
                      <div className="auth-id-text">
                        <strong>Upload School ID Photo</strong>
                        <span>JPG, PNG or WebP, up to 5MB</span>
                      </div>
                    </div>
                  )}
                </label>
              </div>
            </AuthField>

            <AuthField label="PASSWORD" htmlFor="reg-password" required error={fieldErrors.password} icon={Lock}>
              <input
                id="reg-password"
                name="password"
                type="password"
                className={`auth-input ${fieldErrors.password ? "auth-input--invalid" : ""}`}
                placeholder="Min. 6 characters"
                autoComplete="new-password"
                value={form.password}
                onChange={handleChange}
              />
            </AuthField>

            <AuthField label="CONFIRM PASSWORD" htmlFor="confirmPassword" required error={fieldErrors.confirmPassword} icon={Lock}>
              <input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                className={`auth-input ${fieldErrors.confirmPassword ? "auth-input--invalid" : ""}`}
                placeholder="Re-enter password"
                autoComplete="new-password"
                value={form.confirmPassword}
                onChange={handleChange}
              />
            </AuthField>
          </div>

          <button type="submit" className="auth-btn auth-btn-yellow" disabled={loading} style={{ marginTop: '0px' }}>
            {loading ? "Creating account..." : "Sign Up"}
          </button>
        </form>

        <p className="auth-footer-text" style={{ marginTop: '16px', color: '#64748B' }}>
          Already have an account?{" "}
          <Link to="/login" className="auth-link" style={{ color: '#2563EB', fontWeight: '600' }}>Log In</Link>
        </p>
      </div>
    </div>
  );
}
