import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import AdminLayout from "./AdminLayout";
import { supabase } from "../../config/supabase";
import { useAuth } from "../../context/AuthContext";
import { isPeriodActive } from "../../utils/periodStatus";

// Phase 3 SuperAdmin revamp: department cards shell. Clicking through
// deep-links into the existing Evaluation Report (?department=) so all
// filters, teacher search, and CSV export reuse one implementation.
const normDept = (v) => String(v || "").trim().toLowerCase();

export default function AdminReports() {
  const { userProfile } = useAuth();
  const navigate = useNavigate();
  const isSuper = userProfile?.role === "super_admin";
  const [loading, setLoading] = useState(true);
  const [departments, setDepartments] = useState([]);
  const [faculty, setFaculty] = useState([]);
  const [years, setYears] = useState([]);
  const [fetchError, setFetchError] = useState("");

  useEffect(() => {
    if (!isSuper) return;
    const load = async () => {
      try {
        const [deptRes, facRes, yearRes] = await Promise.all([
          supabase.from("departments").select("id, name").order("name"),
          supabase.from("users").select("id, full_name, department, status").eq("role", "faculty"),
          supabase.from("academic_years").select("id, year, semester, status, end_date, department_id"),
        ]);
        const firstErr = [deptRes, facRes, yearRes].find((r) => r.error);
        if (firstErr) throw new Error(firstErr.error.message);
        setDepartments(deptRes.data || []);
        setFaculty((facRes.data || []).filter((f) => (f.status || "active").toLowerCase() === "active"));
        setYears(yearRes.data || []);
      } catch (err) {
        console.error("Reports load error:", err);
        setFetchError(err.message || "Could not load departments.");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [isSuper]);

  const cards = useMemo(() => {
    const activeYear = years.find((y) => isPeriodActive(y)) || years[0];
    return departments.map((d) => ({
      id: d.id,
      name: d.name,
      facultyCount: faculty.filter((f) => normDept(f.department) === normDept(d.name)).length,
      academicYear: activeYear ? `${activeYear.year} · ${activeYear.semester}` : "—",
    }));
  }, [departments, faculty, years]);

  if (!isSuper) {
    return <Navigate to="/admin/dashboard" replace />;
  }

  return (
    <AdminLayout title="Reports & Export">
      <section className="ad-content">
        <div className="ad-welcomeHeader">
          <div>
            <h2 className="ad-title">Reports &amp; Export</h2>
            <p className="ad-subtitle">Pick a department to open its evaluation results — filters and export live there.</p>
          </div>
        </div>

        {loading ? (
          <div className="ad-tableCard" style={{ padding: "40px", textAlign: "center", color: "#6b7280" }}>Loading departments...</div>
        ) : fetchError ? (
          <div className="ad-tableCard ad-tableCard--padded" style={{ color: "#b91c1c" }}>{fetchError}</div>
        ) : cards.length === 0 ? (
          <div className="ad-tableCard ad-tableCard--padded" style={{ color: "#6b7280" }}>No departments defined yet.</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: "14px" }}>
            {cards.map((c) => (
              <div key={c.id} className="ad-tableCard" style={{ padding: "20px 22px" }}>
                <div style={{ fontWeight: 800, fontSize: "16px", color: "#1e3a5f" }}>{c.name}</div>
                <div style={{ fontSize: "13px", color: "#6b7280", margin: "6px 0 14px" }}>
                  {c.facultyCount} faculty · {c.academicYear}
                </div>
                <button
                  type="button"
                  className="ad-btnPrimary"
                  onClick={() => navigate(`/admin/report?department=${encodeURIComponent(c.name)}`)}
                >
                  View Results
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </AdminLayout>
  );
}
