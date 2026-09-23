import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { Clock, CheckCircle2, RefreshCw, ArrowRight, Upload } from "lucide-react";
import { supabase } from "../config/supabase";
import { useAuth } from "../context/AuthContext";
import { validateIdPhoto, uploadSchoolIdPhoto } from "../utils/idPhoto";
import "../styles/auth.css";

export default function PendingApproval() {
  const location = useLocation();
  const email = location.state?.email;
  const schoolId = location.state?.schoolId;
  const identifier = email || schoolId;

  const [status, setStatus] = useState("pending");
  const { currentUser, userProfile, refreshUserProfile } = useAuth();

  const needsPhotoUpload =
    currentUser &&
    userProfile &&
    userProfile.status === "pending" &&
    !userProfile.schoolIdPhotoPath &&
    (userProfile.role === "student" || userProfile.role === "faculty");

  const [photoFile, setPhotoFile] = useState(null);
  const [photoError, setPhotoError] = useState("");
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoDone, setPhotoDone] = useState(false);

  useEffect(() => {
    if (!identifier) return;

    let isMounted = true;

    const checkStatus = async () => {
      try {
        // Try secure RPC first
        const { data: rpcStatus, error: rpcError } = await supabase.rpc("check_account_status", {
          p_identifier: identifier,
        });

        if (!rpcError && rpcStatus) {
          if (isMounted && rpcStatus === "active") {
            setStatus("active");
          }
          return;
        }

        // Fallback to table query
        const query = identifier.includes("@")
          ? supabase.from("users").select("status").eq("email", identifier).single()
          : supabase.from("users").select("status").eq("school_id", identifier).single();

        const { data } = await query;
        if (isMounted && data?.status === "active") {
          setStatus("active");
        }
      } catch (err) {
        console.warn("Status check poll error:", err);
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 3000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [identifier]);

  const isApproved = status === "active";

  const restorePendingPhotoFromStorage = async () => {
    try {
      const raw = localStorage.getItem("pendingIdPhoto");
      if (!raw) return null;

      const parsed = JSON.parse(raw);
      if (!parsed?.dataUrl) return null;

      const blob = await fetch(parsed.dataUrl).then((res) => res.blob());
      return new File([blob], parsed.name || "school-id-photo", { type: parsed.type || "image/jpeg" });
    } catch {
      localStorage.removeItem("pendingIdPhoto");
      return null;
    }
  };

  useEffect(() => {
    const resumePendingPhotoUpload = async () => {
      if (!currentUser || !userProfile) return;
      if (userProfile.status !== "pending") return;
      if (userProfile.schoolIdPhotoPath) return;

      const shouldResume = Boolean(location.state?.photoPending || localStorage.getItem("pendingIdPhoto"));
      if (!shouldResume) return;

      try {
        const savedFile = await restorePendingPhotoFromStorage();
        if (!savedFile) return;

        setPhotoUploading(true);
        await uploadSchoolIdPhoto(currentUser.id, savedFile);
        localStorage.removeItem("pendingIdPhoto");
        await refreshUserProfile();
        setPhotoDone(true);
      } catch (err) {
        setPhotoError(err.message || "Upload failed. Please try again.");
      } finally {
        setPhotoUploading(false);
      }
    };

    resumePendingPhotoUpload();
  }, [currentUser, userProfile, refreshUserProfile, location.state]);

  const handlePhotoUpload = async () => {
    setPhotoError(validateIdPhoto(photoFile));
    if (!photoFile || validateIdPhoto(photoFile)) return;
    setPhotoUploading(true);
    try {
      await uploadSchoolIdPhoto(currentUser.id, photoFile);
      localStorage.removeItem("pendingIdPhoto");
      setPhotoDone(true);
      setPhotoFile(null);
      await supabase.auth.signOut();
      await refreshUserProfile();
    } catch (err) {
      setPhotoError(err.message || "Upload failed. Please try again.");
    } finally {
      setPhotoUploading(false);
    }
  };

  return (
    <div className="auth-page">
      <div style={{ width: "100%", maxWidth: 440 }}>
        <div className="auth-card auth-card--center" style={{ maxWidth: "none", padding: "40px 40px" }}>
          {isApproved ? (
            <>
              <div className="auth-icon-circle" style={{ background: '#dcfce7', color: '#16a34a', marginBottom: '16px' }}>
                <CheckCircle2 size={32} strokeWidth={2} aria-hidden="true" />
              </div>

              <h1 className="auth-title auth-title--status" style={{ color: '#111827' }}>Account Approved!</h1>
              <p className="auth-subtitle" style={{ marginTop: 12, color: '#374151', fontSize: '14.5px', lineHeight: '1.5' }}>
                Great news! Your account has been reviewed and approved by the Administrator. You can now log in to access your dashboard.
              </p>

              <div className="auth-status-pill-row" style={{ marginTop: 16 }}>
                <span className="auth-status-pill" style={{ background: '#dcfce7', color: '#15803d', borderColor: '#bbf7d0' }}>
                  <span className="dot" style={{ background: '#22c55e' }} aria-hidden="true" />
                  Status: Approved & Active
                </span>
              </div>

              <hr className="auth-divider" style={{ marginTop: 24, borderColor: "#F3F4F6" }} />

              <Link
                to="/login"
                className="auth-btn-link"
                style={{
                  background: '#2563eb',
                  color: '#ffffff',
                  textDecoration: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  padding: '12px 20px',
                  borderRadius: '10px',
                  fontWeight: '700',
                  marginTop: '20px',
                  boxShadow: '0 4px 12px rgba(37, 99, 235, 0.25)'
                }}
              >
                Proceed to Log In <ArrowRight size={18} />
              </Link>
            </>
          ) : (
            <>
              <div className="auth-icon-circle auth-icon-circle--amber" style={{ marginBottom: '16px' }}>
                <Clock size={28} strokeWidth={1.8} aria-hidden="true" />
              </div>

              <h1 className="auth-title auth-title--status">Account Pending Approval</h1>
              <p className="auth-subtitle" style={{ marginTop: 12, lineHeight: '1.5' }}>
                Thanks for signing up! Your account has been created and is awaiting review.
                An admin needs to approve your account before you can log in.
              </p>

              <div className="auth-status-pill-row" style={{ marginTop: 16 }}>
                <span className="auth-status-pill">
                  <span className="dot" aria-hidden="true" />
                  Status: Pending Approval
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', marginTop: '16px', fontSize: '12.5px', color: '#6b7280', fontWeight: '500' }}>
                <RefreshCw size={13} style={{ animation: 'spin 2s linear infinite' }} />
                <span>Checking status in real-time...</span>
              </div>

              {needsPhotoUpload && !photoDone && (
                <div style={{ marginTop: '20px', padding: '16px', background: '#fffbeb', border: '1px solid #fef3c7', borderRadius: '10px', textAlign: 'left' }}>
                  <strong style={{ display: 'block', fontSize: '13.5px', color: '#92400e', marginBottom: '8px' }}>
                    School ID photo still needed
                  </strong>
                  <p style={{ fontSize: '13px', color: '#78350f', margin: '0 0 10px', lineHeight: '1.5' }}>
                    Your registration is missing the required school ID photo. Upload it now — admins review it before approving your account.
                  </p>
                  {photoError && <p style={{ fontSize: '12.5px', color: '#b91c1c', margin: '0 0 8px' }}>{photoError}</p>}
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(e) => { setPhotoFile(e.target.files[0] || null); setPhotoError(""); }}
                      style={{ fontSize: '12.5px', flex: 1, minWidth: '180px' }}
                    />
                    <button
                      type="button"
                      onClick={handlePhotoUpload}
                      disabled={!photoFile || photoUploading}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '8px', padding: '8px 14px', fontSize: '12.5px', fontWeight: '600', cursor: photoFile && !photoUploading ? 'pointer' : 'not-allowed' }}
                    >
                      <Upload size={14} />
                      {photoUploading ? "Uploading..." : "Upload ID Photo"}
                    </button>
                  </div>
                </div>
              )}

              {photoDone && (
                <div style={{ marginTop: '20px', padding: '12px 16px', background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: '10px', fontSize: '13px', color: '#065f46', fontWeight: '600' }}>
                  School ID photo uploaded. Your account is ready for admin review.
                </div>
              )}

              <hr className="auth-divider" style={{ marginTop: 20, borderColor: "#F3F4F6" }} />

              <p className="auth-muted-note" style={{ marginTop: 16, fontSize: 13, color: '#6b7280' }}>
                This page will update automatically once the admin approves your account.
              </p>

              <Link to="/login" className="auth-btn-link" style={{ marginTop: '16px', display: 'inline-block', color: '#2563eb', fontWeight: '600' }}>
                Back to Login
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
