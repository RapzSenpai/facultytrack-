import AdminLayout from "./AdminLayout";
import { useAuth } from "../../context/AuthContext";

export default function AdminProfile() {
  const { currentUser, userProfile } = useAuth();
  const profile = userProfile || {};
  const displayName = profile.fullName || "Admin";
  const initials = displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <AdminLayout title="My Profile">
      <section className="ad-content">
        <div className="ad-welcomeHeader">
          <div>
            <h2 className="ad-title">My Profile</h2>
            <p className="ad-subtitle">View your administrator account information</p>
          </div>
        </div>

        <div className="fd-profileCard">
          <div className="fd-profileHeader">
            <div className="fd-profileAvatar">{initials}</div>
            <div className="fd-profileInfo">
              <h3 className="fd-profileName">{displayName}</h3>
              <span className="fd-profileRole">Administrator</span>
            </div>
          </div>

          <div className="fd-profileDetails">
            {[
              {
                label: "Admin ID",
                value:
                  profile.schoolId ||
                  currentUser?.id?.slice(0, 8).toUpperCase() ||
                  "—",
              },
              {
                label: "Email Address",
                value: profile.email || currentUser?.email || "—",
              },
              { label: "Full Name", value: profile.fullName || "—" },
              {
                label: "Account Status",
                value:
                  profile.status === "active" ? "Active" : profile.status || "—",
              },
            ].map((field) => (
              <div className="fd-profileField" key={field.label}>
                <label className="fd-profileLabel">{field.label}</label>
                <div className="fd-profileValue">{field.value}</div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </AdminLayout>
  );
}
