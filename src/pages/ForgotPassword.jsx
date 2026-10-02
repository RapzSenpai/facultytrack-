import { useState } from "react";
import { Link } from "react-router-dom";
import { Mail, Info, AlertCircle, ArrowLeft } from "lucide-react";
import { supabase } from "../config/supabase";
import AuthField from "../components/auth/AuthField";
import "../styles/auth.css";

export default function ForgotPassword() {
  const [identifier, setIdentifier] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setNotice("");

    if (!identifier.trim()) {
      setError("Enter your email address to reset your password.");
      return;
    }

    try {
      setLoading(true);
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(identifier.trim(), {
        redirectTo: `${window.location.origin}/login`,
      });
      if (resetError) throw resetError;
      setNotice("Password reset email sent! Check your inbox.");
      setIdentifier("");
    } catch (err) {
      console.error("Reset password error:", err);
      setError(err.message || "Could not send the reset email.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div style={{ marginBottom: "16px", textAlign: "left" }}>
          <Link to="/login" className="auth-back-link">
            <ArrowLeft size={16} /> Back to Login
          </Link>
        </div>

        <div className="admin-header-icon-container">
          <Mail size={44} strokeWidth={1.5} className="admin-header-icon" />
        </div>

        <h1 className="auth-title">Forgot your Password?</h1>
        <p className="auth-subtitle">
          Reset password by entering your email address
        </p>

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          {error && (
            <div className="auth-alert" role="alert">
              <AlertCircle size={16} aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}
          {notice && (
            <div className="auth-info-banner" role="status" style={{ backgroundColor: '#ECFDF5', color: '#065F46', borderColor: '#A7F3D0' }}>
              <Info size={16} aria-hidden="true" />
              <p>{notice}</p>
            </div>
          )}

          <AuthField label="EMAIL ADDRESS" htmlFor="reset-identifier" required icon={Mail}>
            <input
              id="reset-identifier"
              type="email"
              className="auth-input"
              placeholder="e.g. juan@email.com"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
            />
          </AuthField>

          <button type="submit" className="auth-btn auth-btn-yellow" disabled={loading} style={{ marginTop: '8px' }}>
            {loading ? "Sending..." : "Send Reset Link"}
          </button>
        </form>

        <p className="auth-footer-text">
          Remember your password?{" "}
          <Link to="/login" className="auth-link">
            Log In
          </Link>
        </p>
      </div>
    </div>
  );
}
