import { useState } from "react";
import { Link } from "react-router-dom";
import { Mail, Info, AlertCircle } from "lucide-react";
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
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
          <div style={{ background: '#EFF6FF', padding: '12px', borderRadius: '50%', color: '#2563EB' }}>
            <Mail size={24} />
          </div>
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

          <AuthField label="EMAIL ADDRESS" htmlFor="reset-identifier" required>
            <input
              id="reset-identifier"
              type="text"
              className="auth-input"
              placeholder="e.g. juan@email.com"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
            />
          </AuthField>

          <button type="submit" className="auth-btn" disabled={loading} style={{ marginTop: '8px' }}>
            {loading ? "Sending..." : "Send Reset Link"}
          </button>
        </form>

        <p className="auth-footer-text">
          <Link to="/login" className="auth-link" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
            <span>←</span> Back to Login
          </Link>
        </p>
      </div>
    </div>
  );
}
