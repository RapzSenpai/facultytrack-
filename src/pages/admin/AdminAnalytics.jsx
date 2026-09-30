import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import AdminLayout from "./AdminLayout";
import { supabase } from "../../config/supabase";
import { useAuth } from "../../context/AuthContext";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

// Phase 4 SuperAdmin revamp: system-wide analytics (super-only).
// D13-safe by construction: only counts/averages/distributions are
// computed and shown — comment text and student identity never leave
// the anon view unaggregated and are never rendered here.
const normDept = (v) => String(v || "").trim().toLowerCase();

const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

export default function AdminAnalytics() {
  const { userProfile } = useAuth();
  const isSuper = userProfile?.role === "super_admin";
  const [loading, setLoading] = useState(true);
  const [evaluations, setEvaluations] = useState([]);
  const [users, setUsers] = useState([]);
  const [years, setYears] = useState([]);
  const [openPriority, setOpenPriority] = useState(0);
  const [fetchError, setFetchError] = useState("");
  const [period, setPeriod] = useState("");

  useEffect(() => {
    if (!isSuper) return;
    const load = async () => {
      try {
        const [evalRes, usersRes, yearRes, priRes] = await Promise.all([
          supabase.from("admin_evaluations_anon").select("id, faculty_id, student_token, student_department, academic_year, semester, ratings, is_priority"),
          supabase.from("users").select("id, role, status, department").in("role", ["faculty", "student"]),
          supabase.from("academic_years").select("id, year, semester").order("year", { ascending: false }),
          supabase.from("priority_reviews").select("id", { count: "exact", head: true }).in("status", ["new", "acknowledged"]),
        ]);
        const firstErr = [evalRes, usersRes, yearRes, priRes].find((r) => r.error);
        if (firstErr) throw new Error(firstErr.error.message);
        setEvaluations(evalRes.data || []);
        setUsers(usersRes.data || []);
        setYears(yearRes.data || []);
        setOpenPriority(priRes.count || 0);
        const periods = Array.from(new Set((evalRes.data || []).map((e) => `${e.academic_year}__${e.semester}`))).sort().reverse();
        if (periods.length > 0) {
          const [y, s] = periods[0].split("__");
          setPeriod(`${y}__${s}`);
        }
      } catch (err) {
        console.error("Analytics load error:", err);
        setFetchError(err.message || "Could not load analytics.");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [isSuper]);

  const periods = useMemo(
    () => Array.from(new Set(evaluations.map((e) => `${e.academic_year}__${e.semester}`))).sort().reverse(),
    [evaluations],
  );

  const programStats = useMemo(() => {
    const [py, ps] = period ? period.split("__") : [];
    const inPeriod = evaluations.filter((e) => (!py || e.academic_year === py) && (!ps || e.semester === ps));
    const activeStudents = users.filter((u) => u.role === "student" && (u.status || "active").toLowerCase() === "active");
    const depts = Array.from(new Set([
      ...inPeriod.map((e) => e.student_department).filter(Boolean),
      ...activeStudents.map((u) => u.department).filter(Boolean),
    ]));
    return depts.map((d) => {
      const rows = inPeriod.filter((e) => normDept(e.student_department) === normDept(d));
      const respondents = new Set(rows.map((e) => e.student_token)).size;
      const eligible = activeStudents.filter((u) => normDept(u.department) === normDept(d)).length;
      const scores = rows.flatMap((e) => Object.values(e.ratings || {}).map(Number).filter((n) => !Number.isNaN(n)));
      return {
        program: d,
        responses: rows.length,
        respondents,
        eligible,
        rate: eligible ? Math.round((respondents / eligible) * 100) : 0,
        avg: avg(scores) === null ? 0 : Number(avg(scores).toFixed(2)),
        priority: rows.filter((e) => e.is_priority).length,
      };
    }).sort((a, b) => a.program.localeCompare(b.program));
  }, [evaluations, users, period]);

  const trend = useMemo(() => periods.slice().reverse().map((p) => {
    const [y, s] = p.split("__");
    const rows = evaluations.filter((e) => e.academic_year === y && e.semester === s);
    const scores = rows.flatMap((e) => Object.values(e.ratings || {}).map(Number).filter((n) => !Number.isNaN(n)));
    return { period: `${y} ${s}`, avg: avg(scores) === null ? 0 : Number(avg(scores).toFixed(2)), responses: rows.length };
  }), [evaluations, periods]);

  if (!isSuper) {
    return <Navigate to="/admin/dashboard" replace />;
  }

  return (
    <AdminLayout title="System Analytics">
      <section className="ad-content">
        <div className="ad-welcomeHeader" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <h2 className="ad-title">System Analytics</h2>
            <p className="ad-subtitle">Aggregates only — no comments, no student identity. Open priority cases: <strong>{openPriority}</strong></p>
          </div>
          <select className="ad-filterSelect" value={period} onChange={(e) => setPeriod(e.target.value)}>
            <option value="">All periods</option>
            {periods.map((p) => {
              const [y, s] = p.split("__");
              return <option key={p} value={p}>{y} — {s}</option>;
            })}
          </select>
        </div>

        {loading ? (
          <div className="ad-tableCard" style={{ padding: "40px", textAlign: "center", color: "#6b7280" }}>Loading analytics...</div>
        ) : fetchError ? (
          <div className="ad-tableCard ad-tableCard--padded" style={{ color: "#b91c1c" }}>{fetchError}</div>
        ) : (
          <>
            <div className="ad-tableCard ad-tableCard--padded" style={{ marginBottom: "16px" }}>
              <h3 className="fd-tableTitle">Average rating per program</h3>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={programStats}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="program" />
                  <YAxis domain={[0, 5]} />
                  <Tooltip />
                  <Bar dataKey="avg" fill="#2563eb" name="Avg rating" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="ad-tableCard ad-tableCard--padded" style={{ marginBottom: "16px" }}>
              <h3 className="fd-tableTitle">Response rate per program (%)</h3>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={programStats}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="program" />
                  <YAxis domain={[0, 100]} />
                  <Tooltip />
                  <Bar dataKey="rate" fill="#16a34a" name="Response %" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="ad-tableCard ad-tableCard--padded" style={{ marginBottom: "16px" }}>
              <h3 className="fd-tableTitle">Average rating trend per period</h3>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="period" />
                  <YAxis domain={[0, 5]} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="avg" stroke="#7c3aed" name="Avg rating" />
                  <Line type="monotone" dataKey="responses" stroke="#f59e0b" name="Responses" />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="ad-tableCard ad-tableCard--padded">
              <h3 className="fd-tableTitle">Program detail</h3>
              <div className="ad-tableWrap ad-tableWrap--bordered">
                <table className="ad-table ad-table--plain">
                  <thead>
                    <tr><th>Program</th><th>Responses</th><th>Respondents</th><th>Eligible</th><th>Rate</th><th>Avg</th><th>Priority</th></tr>
                  </thead>
                  <tbody>
                    {programStats.length === 0 ? (
                      <tr><td colSpan="7" style={{ textAlign: "center", padding: "24px", color: "#6b7280" }}>No evaluation data yet.</td></tr>
                    ) : programStats.map((r) => (
                      <tr key={r.program}>
                        <td className="ad-cellPrimary">{r.program}</td>
                        <td>{r.responses}</td>
                        <td>{r.respondents}</td>
                        <td>{r.eligible}</td>
                        <td>{r.rate}%</td>
                        <td>{r.avg || "—"}</td>
                        <td>{r.priority}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </section>
    </AdminLayout>
  );
}
