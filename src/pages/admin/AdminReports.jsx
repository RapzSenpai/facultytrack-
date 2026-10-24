import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import AdminLayout from "./AdminLayout";
import { supabase } from "../../config/supabase";
import { useAuth } from "../../context/AuthContext";
import { isPeriodActive } from "../../utils/periodStatus";
import { Users, Calendar, Star, FileText, ChevronRight } from "lucide-react";

const normDept = (v) => String(v || "").trim().toLowerCase();

export default function AdminReports() {
  const { userProfile } = useAuth();
  const navigate = useNavigate();
  const isSuper = userProfile?.role === "super_admin";
  const [loading, setLoading] = useState(true);
  const [departments, setDepartments] = useState([]);
  const [faculty, setFaculty] = useState([]);
  const [years, setYears] = useState([]);
  const [evalScores, setEvalScores] = useState({});
  const [fetchError, setFetchError] = useState("");

  useEffect(() => {
    if (!isSuper) return;
    const load = async () => {
      try {
        const [deptRes, facRes, yearRes, evalRes, superEvalRes, assignRes] = await Promise.all([
          supabase.from("departments").select("id, name, description").order("name"),
          supabase.from("users").select("id, full_name, department, status").eq("role", "faculty"),
          supabase.from("academic_years").select("id, year, semester, status, end_date, department_id"),
          supabase.from("admin_evaluations_anon").select("id, assignment_id, faculty_id, student_department, ratings"),
          supabase.from("evaluations").select("id, faculty_id, assignment_id, ratings"),
          supabase.from("class_assignments").select("id, department, faculty_id"),
        ]);

        const firstErr = [deptRes, facRes, yearRes].find((r) => r?.error);
        if (firstErr) throw new Error(firstErr.error.message);

        const loadedDepts = deptRes.data || [];
        const loadedFaculty = (facRes.data || []).filter((f) => (f.status || "active").toLowerCase() === "active");
        const loadedYears = yearRes.data || [];

        setDepartments(loadedDepts);
        setFaculty(loadedFaculty);
        setYears(loadedYears);

        // Compute real department scores from evaluations
        const evals = (evalRes.data && evalRes.data.length > 0)
          ? evalRes.data
          : (superEvalRes.data || []);

        const assignMap = new Map((assignRes.data || []).map((a) => [a.id, a.department]));
        const facDeptMap = new Map(loadedFaculty.map((f) => [f.id, f.department]));

        const deptSums = {};
        const deptCounts = {};

        evals.forEach((ev) => {
          let dept = ev.student_department;
          if (!dept && ev.assignment_id) dept = assignMap.get(ev.assignment_id);
          if (!dept && ev.faculty_id) dept = facDeptMap.get(ev.faculty_id);
          if (!dept) return;

          const dKey = normDept(dept);
          const ratings = ev.ratings;
          if (!ratings) return;

          const vals = Object.values(ratings).map(Number).filter((v) => !isNaN(v) && v > 0);
          if (vals.length === 0) return;

          const evAvg = vals.reduce((a, b) => a + b, 0) / vals.length;
          deptSums[dKey] = (deptSums[dKey] || 0) + evAvg;
          deptCounts[dKey] = (deptCounts[dKey] || 0) + 1;
        });

        const scores = {};
        loadedDepts.forEach((d) => {
          const dKey = normDept(d.name);
          if (deptCounts[dKey]) {
            scores[d.id] = (deptSums[dKey] / deptCounts[dKey]).toFixed(2);
          }
        });
        setEvalScores(scores);
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

    return departments.map((d) => {
      const deptFaculty = faculty.filter((f) => normDept(f.department) === normDept(d.name));
      const score = evalScores[d.id] || null;

      return {
        id: d.id,
        name: d.name,
        description: d.description || "",
        facultyCount: deptFaculty.length,
        facultyList: deptFaculty,
        academicYear: activeYear ? `${activeYear.year} · ${activeYear.semester}` : "—",
        deptScore: score,
      };
    });
  }, [departments, faculty, years, evalScores]);

  if (!isSuper) {
    return <Navigate to="/admin/dashboard" replace />;
  }

  return (
    <AdminLayout title="Reports & Export">
      <section className="ad-content">
        <div className="ad-welcomeHeader">
          <div>
            <h2 className="ad-title">Reports &amp; Export</h2>
            <p className="ad-subtitle">Select a department to view evaluation results and analytics.</p>
          </div>
        </div>

        {loading ? (
          <div className="ad-tableCard" style={{ padding: "40px", textAlign: "center", color: "#6b7280" }}>
            Loading departments...
          </div>
        ) : fetchError ? (
          <div className="ad-tableCard ad-tableCard--padded" style={{ color: "#b91c1c" }}>
            {fetchError}
          </div>
        ) : cards.length === 0 ? (
          <div className="ad-tableCard ad-tableCard--padded" style={{ color: "#6b7280" }}>
            No departments defined yet.
          </div>
        ) : (
          <div className="ad-curr-grid">
            {cards.map((c) => (
              <div className="ad-curr-program-card" key={c.id}>
                <div>
                  <div className="ad-curr-program-top">
                    <h3 className="ad-curr-program-code">{c.name}</h3>
                    {c.deptScore ? (
                      <span
                        className="ad-curr-stat-pill ad-curr-stat-pill--sections"
                        title="Department Evaluation Score"
                      >
                        <Star size={11} fill="#166534" /> {c.deptScore}
                      </span>
                    ) : (
                      <span
                        className="ad-curr-stat-pill"
                        style={{ background: "#f8fafc", color: "#94a3b8", border: "1px solid #e2e8f0" }}
                      >
                        No evals
                      </span>
                    )}
                  </div>

                  <p className="ad-curr-program-desc">{c.description || "No description provided."}</p>

                  {/* Metric Pills */}
                  <div className="ad-curr-stats-row">
                    <span className="ad-curr-stat-pill ad-curr-stat-pill--years">
                      <Users size={12} /> {c.facultyCount} Faculty
                    </span>
                    <span className="ad-curr-stat-pill ad-curr-stat-pill--subjects">
                      <Calendar size={12} /> {c.academicYear}
                    </span>
                    <span
                      className={`ad-curr-stat-pill ${c.deptScore ? "ad-curr-stat-pill--sections" : ""}`}
                      style={!c.deptScore ? { background: "#f8fafc", color: "#94a3b8", border: "1px solid #e2e8f0" } : undefined}
                    >
                      <Star size={12} fill={c.deptScore ? "#166534" : "none"} />
                      {c.deptScore ? `★ ${c.deptScore} Score` : "No evals yet"}
                    </span>
                  </div>
                </div>

                {/* Main Action */}
                <button
                  type="button"
                  className="ad-curr-btn-manage"
                  onClick={() => navigate(`/admin/report?department=${encodeURIComponent(c.name)}`)}
                >
                  <FileText size={15} />
                  View Results
                  <ChevronRight size={15} style={{ marginLeft: "auto" }} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </AdminLayout>
  );
}
