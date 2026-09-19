import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { User, Users, Shield, Eye, EyeOff, AlertCircle, ArrowLeft, Mail, Lock, ArrowRight } from "lucide-react";
import { supabase } from "../config/supabase";
import "../styles/auth.css";
import logo from "../assets/Logo (3).png";

const ROLE_CONTENT = {
  student: {
    title: "Student Log In",
    subtitle: "Sign in to the CCTC Evaluation System",
    label: "STUDENT ID OR EMAIL",
    placeholder: "Enter your student ID or email",
    showBanner: false,
    showForgot: true,
  },
  faculty: {
    title: "Faculty Log In",
    subtitle: "Sign in with your Faculty ID and password",
    label: "FACULTY ID NUMBER",
    placeholder: "Enter your faculty ID number",
    showBanner: true,
    showForgot: true,
  },
  admin: {
    title: "Administrator Log In",
    subtitle: "Sign in to access the admin dashboard",
    label: "ADMIN EMAIL",
    placeholder: "Enter admin email",
    showBanner: false,
    showForgot: false,
  },
};

const ROLE_TABS = [
  { key: "student", label: "Student", Icon: User },
  { key: "faculty", label: "Faculty", Icon: Users },
];

async function resolveEmail(identifier) {
  if (identifier.includes("@")) return identifier;
  
  // Try secure RPC first
  const { data: rpcEmail, error: rpcError } = await supabase.rpc("resolve_school_id", {
    p_school_id: identifier,
  });

  if (!rpcError && rpcEmail) return rpcEmail;

  // Fallback to table query if RPC not yet deployed
  const { data, error } = await supabase
    .from("users")
    .select("email")
    .eq("school_id", identifier)
    .maybeSingle();

  if (error) {
    console.warn("ID lookup failed (RLS may block pre-auth queries). Try using email instead.");
    throw new Error("Unable to look up ID. Please use your email address to log in.");
  }
  if (!data) throw new Error("No account found with this ID number.");
  return data.email;
}

export default function Login() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("student");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const content = ROLE_CONTENT[activeTab];

  const switchTab = (tab) => {
    setActiveTab(tab);
    setError("");
    setNotice("");
    setIdentifier("");
    setPassword("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setNotice("");

    if (!identifier.trim() || !password) {
      setError(`Please enter your ${content.label.toLowerCase()} and password.`);
      return;
    }

    try {
      setLoading(true);

      const email = await resolveEmail(identifier.trim());
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) throw signInError;

      let { data: userData, error: profileError } = await supabase
        .from("users")
        .select("*")
        .eq("id", data.user.id)
        .single();

      if (profileError || !userData) {
        const userRole = data.user.user_metadata?.role || "student";
        const initialStatus = userRole === "admin" ? "active" : "pending";

        const { error: insertError } = await supabase.from("users").insert({
          id: data.user.id,
          email: data.user.email,
          full_name: data.user.user_metadata?.full_name || data.user.email,
          first_name: data.user.user_metadata?.first_name || "",
          last_name: data.user.user_metadata?.last_name || "",
          role: userRole,
          status: initialStatus,
          email_verified: true,
        });
        if (insertError) {
          console.error("Profile creation error:", insertError);
          await supabase.auth.signOut();
          setError("User record not found and could not be created.");
          return;
        }
        const { data: newUserData } = await supabase
          .from("users")
          .select("*")
          .eq("id", data.user.id)
          .single();
        userData = newUserData;
      }

      if (userData.status === "pending") {
        await supabase.auth.signOut();
        navigate("/pending-approval", { state: { email: userData.email, schoolId: userData.school_id } });
        return;
      }

      if (userData.status !== "active") {
        await supabase.auth.signOut();
        setError("Your account is inactive. Please contact the administrator.");
        return;
      }

      if (userData.role !== activeTab) {
        await supabase.auth.signOut();
        setError(`This account is not registered as a ${activeTab}. Please switch to the correct login.`);
        return;
      }

      navigate(`/${userData.role}/dashboard`);
    } catch (err) {
      console.error("Login error:", err);
      setError(err.message || "Invalid credentials. Please check your details and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div style={{ marginBottom: "16px", textAlign: "left" }}>
          {activeTab !== "admin" ? (
            <Link to="/" className="auth-back-link" style={{ color: '#475569', fontWeight: '500' }}>
              <ArrowLeft size={16} style={{ marginRight: '4px' }} /> Back to Home
            </Link>
          ) : (
            <button type="button" onClick={() => switchTab("student")} className="auth-back-link" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', color: '#2563EB', fontWeight: '500' }}>
              <ArrowLeft size={16} style={{ marginRight: '4px' }} /> Back to User Login
            </button>
          )}
        </div>

        {activeTab !== "admin" ? (
          <div className="auth-header-logo-container">
            <img src={logo} alt="CCTC Logo" className="auth-header-logo" />
          </div>
        ) : (
          <div className="admin-header-icon-container">
            <Shield size={56} strokeWidth={1.5} className="admin-header-icon" />
          </div>
        )}

        <h1 className="auth-title">{content.title}</h1>
        <p className="auth-subtitle">{content.subtitle}</p>

        {activeTab !== "admin" && (
          <div className="auth-tabs" role="tablist" aria-label="Select your role">
            {ROLE_TABS.map(({ key, label, Icon }) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={activeTab === key}
                className={`auth-tab ${activeTab === key ? "active" : ""}`}
                onClick={() => switchTab(key)}
              >
                <Icon size={16} aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
        )}

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          {error && (
            <div className="auth-alert" role="alert">
              <AlertCircle size={16} aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}
          {notice && (
            <div className="auth-info-banner" role="status">
              <AlertCircle size={16} aria-hidden="true" />
              <p>{notice}</p>
            </div>
          )}

          <div className="auth-field-group">
            <label className="auth-label" htmlFor="login-identifier">{content.label}</label>
            <div className="auth-input-with-icon">
              <Mail className="auth-input-icon-left" size={16} />
              <input
                id="login-identifier"
                type="text"
                className="auth-input"
                placeholder={content.placeholder}
                autoComplete="username"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
              />
            </div>
          </div>

          <div className="auth-field-group">
            <label className="auth-label" htmlFor="login-password">PASSWORD</label>
            <div className="auth-input-with-icon auth-input-wrap">
              <Lock className="auth-input-icon-left" size={16} />
              <input
                id="login-password"
                type={showPassword ? "text" : "password"}
                className="auth-input"
                placeholder="Enter your password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="auth-password-toggle"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
            {content.showForgot && (
              <div className="auth-forgot-row">
                <Link to="/forgot-password" className="auth-link auth-link--sm" style={{ color: '#2563EB', fontWeight: '500' }}>
                  Forgot Password?
                </Link>
              </div>
            )}
          </div>

          <button type="submit" className="auth-btn auth-btn-yellow" disabled={loading}>
            {loading ? "Logging in..." : "Log In"}
          </button>
        </form>

        {activeTab !== "admin" && (
          <>
            <p className="auth-footer-text" style={{ marginTop: '20px', color: '#64748B' }}>
              Don't have an account?{" "}
              <Link to="/register" className="auth-link" style={{ color: '#2563EB', fontWeight: '600' }}>Sign Up</Link>
            </p>
            
            <div className="auth-or-divider">or</div>
            
            <div className="admin-prompt-box">
              <div className="admin-prompt-content">
                <Shield className="admin-prompt-icon" size={24} />
                <div className="admin-prompt-text">
                  <strong>Administrator?</strong>
                  <span>For system administrators only.</span>
                </div>
              </div>
              <button type="button" onClick={() => switchTab("admin")} className="admin-prompt-link">
                Admin Login <ArrowRight size={14} style={{ marginLeft: '4px' }} />
              </button>
            </div>
          </>
        )}

        {activeTab === "admin" && (
          <div className="admin-authorized-box">
            <Shield className="admin-authorized-icon" size={20} />
            <div className="admin-authorized-text">
              <strong>Authorized personnel only.</strong>
              <span>All admin activities are monitored.</span>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
