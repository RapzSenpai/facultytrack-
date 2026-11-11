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
          supabase.from("admin_evaluations_anon").select("id, assignment_id, faculty_id, student_department, academic_year, semester, ratings"),
          supabase.from("evaluations").select("id, faculty_id, assignment_id, academic_year, semester, ratings"),
          supabase.from("class_assignments").select("id, department, faculty_id, academic_year, semester"),
        ]);

        const firstErr = [deptRes, facRes, yearRes].find((r) => r?.error);
        if (firstErr) throw new Error(firstErr.error.message);

        const loadedDepts = deptRes.data || [];
        const loadedFaculty = (facRes.data || []).filter((f) => (f.status || "active").toLowerCase() === "active");
        const loadedYears = yearRes.data || [];

        setDepartments(loadedDepts);
        setFaculty(loadedFaculty);
        setYears(loadedYears);

        // Find active academic year and semester to strictly scope the scores
        const activeYear = loadedYears.find((y) => isPeriodActive(y)) || loadedYears[0];
        const activeAY = activeYear?.year;
        const activeSem = activeYear?.semester;

        const allEvals = (evalRes.data && evalRes.data.length > 0)
          ? evalRes.data
          : (superEvalRes.data || []);

        // Filter evaluations strictly by the active period, matching AdminReport exactly
        const evals = allEvals.filter((ev) => {
          if (!activeAY) return true;
          const matchY = String(ev.academic_year || "").trim().toLowerCase() === String(activeAY).trim().toLowerCase();
          if (!activeSem) return matchY;
          const evSem = String(ev.semester || "").trim().toLowerCase();
          const pSem = String(activeSem).trim().toLowerCase();
          return matchY && (evSem === pSem || evSem.includes(pSem) || pSem.includes(evSem));
        });

        const periodAssignments = (assignRes.data || []).filter((a) => {
          if (!activeAY) return true;
          const matchY = String(a.academic_year || "").trim().toLowerCase() === String(activeAY).trim().toLowerCase();
          if (!activeSem) return matchY;
          const aSem = String(a.semester || "").trim().toLowerCase();
          const pSem = String(activeSem).trim().toLowerCase();
          return matchY && (aSem === pSem || aSem.includes(pSem) || pSem.includes(aSem));
        });

        // Compute scores per department matching AdminReport faculty macro-average
        const scores = {};
        loadedDepts.forEach((d) => {
          const deptName = d.name;
          // In-scope faculty for this department (same matching logic as AdminReport)
          const deptFaculty = loadedFaculty.filter((f) => {
            if (normDept(f.department) === normDept(deptName)) return true;
            return periodAssignments.some((a) => a.faculty_id === f.id && normDept(a.department) === normDept(deptName));
          });

          // Faculty ratings inside this department for this period
          const facRatings = deptFaculty.map((f) => {
            const facEvals = evals.filter((e) => e.faculty_id === f.id);
            const fScores = facEvals.flatMap((e) => Object.values(e.ratings || {}).map(Number).filter((v) => !isNaN(v) && v > 0));
            return fScores.length > 0 ? fScores.reduce((a, b) => a + b, 0) / fScores.length : null;
          }).filter((r) => r !== null);

          if (facRatings.length > 0) {
            const mean = facRatings.reduce((a, b) => a + b, 0) / facRatings.length;
            scores[d.id] = mean.toFixed(2);
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
