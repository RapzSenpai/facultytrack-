import { GraduationCap } from "lucide-react";

/**
 * FacultyTrack brand element for auth pages.
 * variant "pill"   → centered rounded pill with graduation cap icon (login cards)
 * variant "mark"   → square "F" mark + wordmark, left aligned (sign up card header)
 * variant "header" → square "F" mark + dark wordmark, centered above card (status pages)
 */
export default function BrandBadge({ variant = "pill" }) {
  if (variant === "pill") {
    return (
      <div className="auth-badge-row">
        <span className="auth-badge">
          <GraduationCap size={14} aria-hidden="true" />
          FacultyTrack
        </span>
      </div>
    );
  }

  return (
    <div
      className={`auth-brand-row ${
        variant === "header" ? "auth-brand-row--page-header" : "auth-brand-row--card-header"
      }`}
    >
      <span className="auth-brand-mark" aria-hidden="true">F</span>
      <span className={`auth-brand-name ${variant === "header" ? "auth-brand-name--dark" : ""}`}>
        FacultyTrack
      </span>
    </div>
  );
}
