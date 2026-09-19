import { useAuth } from "../../context/AuthContext";
import FacultyLayout from "./FacultyLayout";

export default function FacultyProfile() {
  const { currentUser, userProfile } = useAuth();

  const profile = userProfile || {};
  const displayName = profile.fullName || "Faculty";
  const initials = displayName.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();

  return (
    <FacultyLayout breadcrumb="My Profile">
      <section className="fd-content">
        <div className="fd-welcomeHeader">
          <div>
            <h2 className="fd-title">My Profile</h2>
            <p className="fd-subtitle">View and manage your account information</p>
          </div>
        </div>

        <div className="fd-profileCard">
          <div className="fd-profileHeader">
            <div className="fd-profileAvatar">{initials}</div>
            <div className="fd-profileInfo">
              <h3 className="fd-profileName">{displayName}</h3>
              <span className="fd-profileRole">Faculty</span>
            </div>
          </div>

          <div className="fd-profileDetails">
            {[
              { label: "Faculty ID", value: profile.schoolId || currentUser?.id?.slice(0, 8).toUpperCase() || "—" },
              { label: "Email Address", value: profile.email || currentUser?.email || "—" },
              { label: "Program", value: profile.department || profile.dept || "—" },
              { label: "Position", value: profile.position || "Faculty" },
              { label: "Specialization", value: profile.specialization || "—" },
              { label: "Employment Status", value: profile.status === "active" ? "Active" : profile.status || "—" },
              { label: "Contact Number", value: profile.contactNumber || "—" },
              { label: "Office Location", value: profile.officeLocation || "—" },
            ].map(field => (
              <div className="fd-profileField" key={field.label}>
                <label className="fd-profileLabel">{field.label}</label>
                <div className="fd-profileValue">{field.value}</div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </FacultyLayout>
  );
}
