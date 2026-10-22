import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import AdminLayout from "./AdminLayout";
import { supabase } from "../../config/supabase";
import { useAuth } from "../../context/AuthContext";
import { matchDepartment, isPeriodActive, pickActivePeriod } from "../../utils/periodStatus";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList,
} from "recharts";

// Phase 4 SuperAdmin revamp: system-wide analytics (super-only).
// D13-safe by construction: only counts/averages/distributions are
// computed and shown — comment text and student identity never leave
// the anon view unaggregated and are never rendered here.
const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
const normStr = (s) => String(s || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");

export default function AdminAnalytics() {
  const { userProfile } = useAuth();
  const isSuper = userProfile?.role === "super_admin";
  const [loading, setLoading] = useState(true);
  const [evaluations, setEvaluations] = useState([]);
  const [users, setUsers] = useState([]);
  const [years, setYears] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [openPriority, setOpenPriority] = useState(0);
  const [fetchError, setFetchError] = useState("");
  const [period, setPeriod] = useState("");
  const [selectedDept, setSelectedDept] = useState("all");

  useEffect(() => {
    if (!isSuper) return;
    const load = async () => {
      try {
        const [evalRes, usersRes, yearRes, priRes, deptRes, assignRes, superEvalsRes] = await Promise.all([
          supabase.from("admin_evaluations_anon").select("id, assignment_id, faculty_id, student_token, student_department, academic_year, semester, ratings, is_priority"),
          supabase.from("users").select("id, role, status, department").in("role", ["faculty", "student"]),
          supabase.from("academic_years").select("id, year, semester, status").order("year", { ascending: false }),
          supabase.from("priority_reviews").select("id", { count: "exact", head: true }).in("status", ["new", "acknowledged"]),
          supabase.from("departments").select("id, name"),
          supabase.from("class_assignments").select("id, department, faculty_id, academic_year, semester"),
          supabase.from("evaluations").select("id, faculty_id, assignment_id, student_id, academic_year, semester, ratings, is_priority"),
        ]);
        const firstErr = [usersRes, yearRes, priRes, deptRes, assignRes].find((r) => r?.error);
        if (firstErr) throw new Error(firstErr.error.message);

        const baseEvals = evalRes.data || [];
        const loadedEvals = (baseEvals.length > 0)
          ? baseEvals
          : (superEvalsRes.data && superEvalsRes.data.length > 0)
          ? superEvalsRes.data.map((e) => ({
              ...e,
              student_token: e.student_id ? `anon_${e.student_id}` : e.id,
            }))
          : [];
        const loadedYears = yearRes.data || [];
        setEvaluations(loadedEvals);
        setUsers(usersRes.data || []);
        setYears(loadedYears);
        setOpenPriority(priRes.count || 0);
        setDepartments(deptRes.data || []);
        setAssignments(assignRes.data || []);

        console.log("[AdminAnalytics] Loaded evals:", loadedEvals.length, loadedEvals);

        const combinedPeriods = Array.from(new Set([
          ...loadedYears.map((y) => `${y.year}__${y.semester}`).filter((p) => p && !p.startsWith("__")),
          ...loadedEvals.map((e) => `${e.academic_year}__${e.semester}`).filter((p) => p && !p.startsWith("__")),
        ])).sort().reverse();

        if (combinedPeriods.length > 0) {
          const evalPeriods = Array.from(new Set(loadedEvals.map((e) => `${e.academic_year}__${e.semester}`))).filter((p) => p && !p.startsWith("__"));
          const activeAY = pickActivePeriod(loadedYears, "") || loadedYears.find((y) => isPeriodActive(y) || (y.status || "").toLowerCase().includes("going") || (y.status || "").toLowerCase() === "active");
          const activeKey = activeAY ? `${activeAY.year}__${activeAY.semester}` : null;

          // If evaluation data exists in evalPeriods and activeKey has no data, pick evalPeriods[0]
          if (evalPeriods.length > 0 && (!activeKey || !loadedEvals.some((e) => `${e.academic_year}__${e.semester}` === activeKey))) {
            setPeriod(evalPeriods[0]);
          } else if (activeKey && combinedPeriods.includes(activeKey)) {
            setPeriod(activeKey);
          } else if (evalPeriods.length > 0) {
            setPeriod(evalPeriods[0]);
          } else {
            setPeriod(combinedPeriods[0]);
          }
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

  // Lookup maps for fast assignment and faculty department resolution
  const assignmentDeptMap = useMemo(() => {
    const map = new Map();
    (assignments || []).forEach((a) => {
      if (a.id && a.department) map.set(String(a.id), a.department);
    });
    return map;
  }, [assignments]);

  const facultyDeptMap = useMemo(() => {
    const map = new Map();
    (users || []).filter((u) => u.role === "faculty").forEach((f) => {
      if (f.id && f.department) map.set(String(f.id), f.department);
    });
    return map;
  }, [users]);

  // Resolves the evaluation's department: student dept -> assignment dept -> faculty dept
  const getEvalDept = useMemo(() => {
    return (e) => {
      if (e.student_department) return e.student_department;
      if (e.assignment_id && assignmentDeptMap.get(String(e.assignment_id))) {
        return assignmentDeptMap.get(String(e.assignment_id));
      }
      if (e.faculty_id && facultyDeptMap.get(String(e.faculty_id))) {
        return facultyDeptMap.get(String(e.faculty_id));
      }
      return "";
    };
  }, [assignmentDeptMap, facultyDeptMap]);

  // Helper to match evaluation against selected period
  const matchEvalPeriod = (e, py, ps) => {
    if (!py && !ps) return true;
    const matchY = !py || normStr(e.academic_year) === normStr(py);
    const eSem = normStr(e.semester);
    const pSem = normStr(ps);
    const matchS = !ps || eSem === pSem || eSem.includes(pSem) || pSem.includes(eSem);
    return matchY && matchS;
  };

  const periods = useMemo(() => {
    const set = new Set();
    (years || []).forEach((y) => {
      if (y.year && y.semester) set.add(`${y.year}__${y.semester}`);
    });
    (evaluations || []).forEach((e) => {
      if (e.academic_year && e.semester) set.add(`${e.academic_year}__${e.semester}`);
    });
    return Array.from(set).sort().reverse();
  }, [years, evaluations]);

  const allPrograms = useMemo(() => {
    return Array.from(new Set([
      ...(departments || []).map((d) => d.name).filter(Boolean),
      ...evaluations.map((e) => getEvalDept(e)).filter(Boolean),
      ...users.map((u) => u.department).filter(Boolean),
    ])).sort();
  }, [departments, evaluations, users, getEvalDept]);

  // Filtered evaluations based on active period and selected program
  const filteredEvaluations = useMemo(() => {
    const [py, ps] = period ? period.split("__") : [];
    return evaluations.filter((e) => {
      const matchP = matchEvalPeriod(e, py, ps);
      const evalDept = getEvalDept(e);
      const matchD = selectedDept === "all" || matchDepartment(evalDept, selectedDept);
      return matchP && matchD;
    });
  }, [evaluations, period, selectedDept, getEvalDept]);

  const programStats = useMemo(() => {
    const [py, ps] = period ? period.split("__") : [];
    const inPeriod = evaluations.filter((e) => matchEvalPeriod(e, py, ps));
    const activeStudents = users.filter((u) => u.role === "student" && (u.status || "active").toLowerCase() === "active");
    const activeFaculty = users.filter((u) => u.role === "faculty" && (u.status || "active").toLowerCase() === "active");

    const depts = Array.from(new Set([
      ...(departments || []).map((d) => d.name).filter(Boolean),
      ...inPeriod.map((e) => getEvalDept(e)).filter(Boolean),
      ...activeStudents.map((u) => u.department).filter(Boolean),
      ...activeFaculty.map((u) => u.department).filter(Boolean),
    ])).sort();

    return depts.map((d) => {
      const rows = inPeriod.filter((e) => matchDepartment(getEvalDept(e), d));
      const respondents = new Set(rows.map((e) => e.student_token)).size;
      const eligible = activeStudents.filter((u) => matchDepartment(u.department, d)).length;
      const facultyCount = activeFaculty.filter((u) => matchDepartment(u.department, d)).length;
      const scores = rows.flatMap((e) => Object.values(e.ratings || {}).map(Number).filter((n) => !Number.isNaN(n)));
      return {
        program: d,
        facultyCount,
        responses: rows.length,
        respondents,
        eligible,
        rate: eligible ? Math.round((respondents / eligible) * 100) : 0,
        avg: avg(scores) === null ? 0 : Number(avg(scores).toFixed(1)),
        priority: rows.filter((e) => e.is_priority).length,
      };
    });
  }, [evaluations, users, departments, period, getEvalDept]);

  // Overall metrics for the top cards
  const totalEvalsSubmitted = useMemo(() => {
    return filteredEvaluations.length;
  }, [filteredEvaluations]);

  const overallAvgRating = useMemo(() => {
    const scores = filteredEvaluations.flatMap((e) => Object.values(e.ratings || {}).map(Number).filter((n) => !Number.isNaN(n)));
    return avg(scores) === null ? "—" : avg(scores).toFixed(1);
  }, [filteredEvaluations]);

  const overallResponseRate = useMemo(() => {
    const respondents = new Set(filteredEvaluations.map((e) => e.student_token)).size;
    const eligibleStudents = users.filter(
      (u) => u.role === "student" &&
        (u.status || "active").toLowerCase() === "active" &&
        (selectedDept === "all" || matchDepartment(u.department, selectedDept)),
    ).length;
    return eligibleStudents > 0 ? Math.round((respondents / eligibleStudents) * 100) : 0;
  }, [filteredEvaluations, users, selectedDept]);

  const programsReportingCount = useMemo(() => {
    const reporting = programStats.filter((p) => p.responses > 0).length;
    return { reporting, total: programStats.length };
  }, [programStats]);

  const trend = useMemo(() => {
    const sortedPeriods = periods.slice().reverse();
    return sortedPeriods.map((p) => {
      const [y, s] = p.split("__");
      const rows = evaluations.filter((e) => {
        const matchP = matchEvalPeriod(e, y, s);
        const evalDept = getEvalDept(e);
        const matchD = selectedDept === "all" || matchDepartment(evalDept, selectedDept);
        return matchP && matchD;
      });
      const scores = rows.flatMap((e) => Object.values(e.ratings || {}).map(Number).filter((n) => !Number.isNaN(n)));
      const semShort = (s || "").toLowerCase().includes("2nd") ? "2nd" : (s || "").toLowerCase().includes("summer") ? "Sum" : "1st";
      const yearShort = (y || "").replace(/20(\d\d)-20(\d\d)/, "$1-$2").replace(/20(\d\d)/, "$1");
      const label = `${semShort} ${yearShort}`.trim();

      return {
        period: label,
        fullPeriod: `${y} ${s}`,
        avg: avg(scores) === null ? 0 : Number(avg(scores).toFixed(1)),
        responses: rows.length,
      };
    });
  }, [evaluations, periods, selectedDept, getEvalDept]);

  const ratingDistribution = useMemo(() => {
    const counts = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    for (const e of filteredEvaluations) {
      if (!e.ratings) continue;
      for (const val of Object.values(e.ratings)) {
        const num = Math.round(Number(val));
        if (counts[num] !== undefined) counts[num]++;
      }
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const LABELS = {
      5: "Strongly Agree (5)",
      4: "Agree (4)",
      3: "Neutral (3)",
      2: "Disagree (2)",
      1: "Strongly Disagree (1)",
    };
    const COLORS = {
      5: "#10b981",
      4: "#34d399",
      3: "#facc15",
      2: "#f97316",
      1: "#ef4444",
    };
    return [5, 4, 3, 2, 1].map((r) => ({
      name: LABELS[r],
      rating: r,
      value: counts[r],
      pct: total > 0 ? Math.round((counts[r] / total) * 100) : 0,
      fill: COLORS[r],
    }));
  }, [filteredEvaluations]);

  const filteredProgramStats = useMemo(() => {
    if (selectedDept === "all") return programStats;
    return programStats.filter((p) => matchDepartment(p.program, selectedDept));
  }, [programStats, selectedDept]);

  if (!isSuper) {
    return <Navigate to="/admin/dashboard" replace />;
  }

  return (
    <AdminLayout title="System Analytics">
      <section className="ad-content">
        {/* Header with Title and Dropdown Filters */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "16px", marginBottom: "24px" }}>
          <div>
            <h2 style={{ fontSize: "24px", fontWeight: "800", color: "#0f172a", margin: "0 0 6px 0" }}>System Analytics</h2>
            <p style={{ fontSize: "13px", color: "#64748b", margin: 0 }}>
              Aggregates only: no comments, no student identity. Open priority cases: <strong style={{ color: "#0f172a" }}>{openPriority}</strong>
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
            <select
              className="ad-filterSelect"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              style={{
                padding: "8px 16px",
                borderRadius: "8px",
                border: "1px solid #d1d5db",
                background: "#ffffff",
                fontSize: "13px",
                fontWeight: "500",
                color: "#1e293b",
                outline: "none",
                cursor: "pointer",
                boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
              }}
            >
              <option value="">All Periods</option>
              {periods.map((p) => {
                const [y, s] = p.split("__");
                return (
                  <option key={p} value={p}>
                    {s} {y}
                  </option>
                );
              })}
            </select>
            <select
              className="ad-filterSelect"
              value={selectedDept}
              onChange={(e) => setSelectedDept(e.target.value)}
              style={{
                padding: "8px 16px",
                borderRadius: "8px",
                border: "1px solid #d1d5db",
                background: "#ffffff",
                fontSize: "13px",
                fontWeight: "500",
                color: "#1e293b",
                outline: "none",
                cursor: "pointer",
                boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
              }}
            >
              <option value="all">All Programs</option>
              {allPrograms.map((prog) => (
                <option key={prog} value={prog}>
                  {prog}
                </option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <div style={{ background: "#fff", borderRadius: "12px", padding: "48px", textAlign: "center", color: "#64748b", border: "1px solid #e2e8f0" }}>
            Loading analytics...
          </div>
        ) : fetchError ? (
          <div style={{ background: "#fef2f2", borderRadius: "12px", padding: "20px", color: "#b91c1c", border: "1px solid #fecaca" }}>
            {fetchError}
          </div>
        ) : (
          <>
            {/* Row 1: Top 4 Metric Cards - Strict 4 columns */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                gap: "16px",
                marginBottom: "20px",
              }}
            >
              <div
                style={{
                  background: "#ffffff",
                  borderRadius: "10px",
                  padding: "18px 20px",
                  border: "1px solid #e5e7eb",
                  borderTop: "3.5px solid #2563eb",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
                  minWidth: 0,
                }}
              >
                <div style={{ fontSize: "12px", fontWeight: "600", color: "#64748b", marginBottom: "6px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  Evaluations Submitted
                </div>
                <div style={{ fontSize: "28px", fontWeight: "800", color: "#0f172a", lineHeight: "1.2" }}>{totalEvalsSubmitted}</div>
              </div>

              <div
                style={{
                  background: "#ffffff",
                  borderRadius: "10px",
                  padding: "18px 20px",
                  border: "1px solid #e5e7eb",
                  borderTop: "3.5px solid #2563eb",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
                  minWidth: 0,
                }}
              >
                <div style={{ fontSize: "12px", fontWeight: "600", color: "#64748b", marginBottom: "6px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  Average Rating
                </div>
                <div style={{ fontSize: "28px", fontWeight: "800", color: "#0f172a", lineHeight: "1.2" }}>
                  {overallAvgRating} <span style={{ fontSize: "16px", fontWeight: "500", color: "#94a3b8" }}>/ 5</span>
                </div>
              </div>

              <div
                style={{
                  background: "#ffffff",
                  borderRadius: "10px",
                  padding: "18px 20px",
                  border: "1px solid #e5e7eb",
                  borderTop: "3.5px solid #2563eb",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
                  minWidth: 0,
                }}
              >
                <div style={{ fontSize: "12px", fontWeight: "600", color: "#64748b", marginBottom: "6px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  Response Rate
                </div>
                <div style={{ fontSize: "28px", fontWeight: "800", color: "#0f172a", lineHeight: "1.2" }}>{overallResponseRate}%</div>
              </div>

              <div
                style={{
                  background: "#ffffff",
                  borderRadius: "10px",
                  padding: "18px 20px",
                  border: "1px solid #e5e7eb",
                  borderTop: "3.5px solid #2563eb",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
                  minWidth: 0,
                }}
              >
                <div style={{ fontSize: "12px", fontWeight: "600", color: "#64748b", marginBottom: "6px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  Programs Reporting
                </div>
                <div style={{ fontSize: "28px", fontWeight: "800", color: "#0f172a", lineHeight: "1.2" }}>
                  {programsReportingCount.reporting} <span style={{ fontSize: "16px", fontWeight: "500", color: "#64748b" }}>of {programsReportingCount.total}</span>
                </div>
              </div>
            </div>

            {/* Row 2: Middle 2x2 Grid - Strict 2 columns */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: "20px",
                marginBottom: "20px",
              }}
            >
              {/* Card 1: Average rating per program */}
              <div
                style={{
                  background: "#ffffff",
                  borderRadius: "12px",
                  padding: "22px 24px",
                  border: "1px solid #e5e7eb",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
                  display: "flex",
                  flexDirection: "column",
                  minWidth: 0,
                }}
              >
                <h3 style={{ fontSize: "15px", fontWeight: "700", color: "#0f172a", margin: "0 0 2px 0" }}>Average rating per program</h3>
                <p style={{ fontSize: "12px", color: "#64748b", margin: "0 0 16px 0" }}>Bar graph, scale 0 to 5</p>
                <div style={{ flex: 1, minHeight: "220px", width: "100%" }}>
                  <ResponsiveContainer width="100%" height={230}>
                    <BarChart data={programStats} margin={{ top: 25, right: 15, left: -25, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis
                        dataKey="program"
                        tick={{ fontSize: 11, fill: "#64748b", fontWeight: 700 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        domain={[0, 5]}
                        ticks={[0, 2.5, 5.0]}
                        tick={{ fontSize: 11, fill: "#94a3b8" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        formatter={(v) => [`${v} / 5.0`, "Average Rating"]}
                        contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }}
                      />
                      <Bar dataKey="avg" radius={[4, 4, 0, 0]} maxBarSize={48}>
                        {programStats.map((entry) => (
                          <Cell
                            key={`cell-${entry.program}`}
                            fill={selectedDept === "all" || matchDepartment(entry.program, selectedDept) ? "#2563eb" : "#cbd5e1"}
                          />
                        ))}
                        <LabelList
                          dataKey="avg"
                          position="top"
                          fill="#0f172a"
                          fontSize={11}
                          fontWeight={700}
                          offset={6}
                          formatter={(v) => (Number(v) > 0 ? v : "")}
                        />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Card 2: Rating distribution */}
              <div
                style={{
                  background: "#ffffff",
                  borderRadius: "12px",
                  padding: "22px 24px",
                  border: "1px solid #e5e7eb",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
                  display: "flex",
                  flexDirection: "column",
                  minWidth: 0,
                }}
              >
                <h3 style={{ fontSize: "15px", fontWeight: "700", color: "#0f172a", margin: "0 0 2px 0" }}>Rating distribution</h3>
                <p style={{ fontSize: "12px", color: "#64748b", margin: "0 0 16px 0" }}>Pie chart, share of all ratings given</p>
                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "space-between", gap: "20px", flexWrap: "wrap", minHeight: "220px" }}>
                  <div style={{ width: "170px", height: "170px", margin: "0 auto", flexShrink: 0 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={ratingDistribution}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          outerRadius={75}
                          innerRadius={45}
                          stroke="#ffffff"
                          strokeWidth={2}
                          paddingAngle={1}
                        >
                          {ratingDistribution.map((entry) => (
                            <Cell key={`cell-${entry.rating}`} fill={entry.fill} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v, name) => [`${v} ratings`, name]} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "9px", minWidth: "180px" }}>
                    {ratingDistribution.map((d) => (
                      <div key={d.rating} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "12px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ width: "10px", height: "10px", borderRadius: "2px", background: d.fill, display: "inline-block", flexShrink: 0 }} />
                          <span style={{ color: "#334155", fontWeight: 500 }}>{d.name}</span>
                        </div>
                        <span style={{ color: "#0f172a", fontWeight: 700 }}>{d.pct}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Card 3: Response rate per program */}
              <div
                style={{
                  background: "#ffffff",
                  borderRadius: "12px",
                  padding: "22px 24px",
                  border: "1px solid #e5e7eb",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  minWidth: 0,
                }}
              >
                <div>
                  <h3 style={{ fontSize: "15px", fontWeight: "700", color: "#0f172a", margin: "0 0 2px 0" }}>Response rate per program</h3>
                  <p style={{ fontSize: "12px", color: "#64748b", margin: "0 0 18px 0" }}>Share of assigned evaluations submitted</p>
                  <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                    {filteredProgramStats.length === 0 ? (
                      <div style={{ fontSize: "13px", color: "#94a3b8", textAlign: "center", padding: "20px 0" }}>No program data available.</div>
                    ) : (
                      filteredProgramStats.map((p) => {
                        const isLow = p.rate < 50;
                        const barColor = isLow ? "#f97316" : "#10b981";
                        return (
                          <div key={p.program} style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                            <span style={{ width: "60px", fontSize: "12px", fontWeight: 700, color: "#1e293b", flexShrink: 0 }}>
                              {p.program}
                            </span>
                            <div style={{ flex: 1, height: "11px", background: "#f1f5f9", borderRadius: "999px", overflow: "hidden" }}>
                              <div
                                style={{
                                  width: `${Math.min(100, p.rate)}%`,
                                  height: "100%",
                                  background: barColor,
                                  borderRadius: "999px",
                                  transition: "width 0.4s ease",
                                }}
                              />
                            </div>
                            <span style={{ width: "38px", textAlign: "right", fontSize: "12px", fontWeight: 700, color: "#0f172a", flexShrink: 0 }}>
                              {p.rate}%
                            </span>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
                <p style={{ marginTop: "18px", marginBottom: 0, fontSize: "11px", color: "#64748b" }}>Orange means below 50%.</p>
              </div>

              {/* Card 4: Average rating trend */}
              <div
                style={{
                  background: "#ffffff",
                  borderRadius: "12px",
                  padding: "22px 24px",
                  border: "1px solid #e5e7eb",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
                  display: "flex",
                  flexDirection: "column",
                  minWidth: 0,
                }}
              >
                <h3 style={{ fontSize: "15px", fontWeight: "700", color: "#0f172a", margin: "0 0 2px 0" }}>Average rating trend</h3>
                <p style={{ fontSize: "12px", color: "#64748b", margin: "0 0 16px 0" }}>Trend line across evaluation periods</p>
                <div style={{ flex: 1, minHeight: "220px", width: "100%" }}>
                  <ResponsiveContainer width="100%" height={230}>
                    <LineChart data={trend} margin={{ top: 25, right: 15, left: -25, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis
                        dataKey="period"
                        tick={{ fontSize: 10, fill: "#64748b", fontWeight: 600 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        domain={[3.0, 5.0]}
                        ticks={[3.0, 3.5, 4.0, 4.5, 5.0]}
                        tick={{ fontSize: 10, fill: "#94a3b8" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        formatter={(v) => [`${v} / 5.0`, "Average Rating"]}
                        labelFormatter={(_, arr) => arr?.[0]?.payload?.fullPeriod || ""}
                        contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="avg"
                        stroke="#2563eb"
                        strokeWidth={2.5}
                        dot={{ r: 4.5, fill: "#ffffff", stroke: "#2563eb", strokeWidth: 2 }}
                        activeDot={{ r: 6 }}
                      >
                        <LabelList
                          dataKey="avg"
                          position="top"
                          fill="#0f172a"
                          fontSize={10}
                          fontWeight={700}
                          offset={8}
                          formatter={(v) => (Number(v) > 0 ? v : "")}
                        />
                      </Line>
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Row 3: Bottom Program Detail Table */}
            <div
              style={{
                background: "#ffffff",
                borderRadius: "12px",
                padding: "22px 24px",
                border: "1px solid #e5e7eb",
                boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
              }}
            >
              <h3 style={{ fontSize: "15px", fontWeight: "700", color: "#0f172a", margin: "0 0 2px 0" }}>Program detail</h3>
              <p style={{ fontSize: "12px", color: "#64748b", margin: "0 0 16px 0" }}>One row per program</p>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "13px" }}>
                  <thead>
                    <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                      <th style={{ padding: "12px 16px", fontSize: "11px", fontWeight: "700", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        PROGRAM
                      </th>
                      <th style={{ padding: "12px 16px", fontSize: "11px", fontWeight: "700", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        FACULTY
                      </th>
                      <th style={{ padding: "12px 16px", fontSize: "11px", fontWeight: "700", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        EVALUATIONS
                      </th>
                      <th style={{ padding: "12px 16px", fontSize: "11px", fontWeight: "700", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        AVG RATING
                      </th>
                      <th style={{ padding: "12px 16px", fontSize: "11px", fontWeight: "700", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        RESPONSE RATE
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProgramStats.length === 0 ? (
                      <tr>
                        <td colSpan="5" style={{ textAlign: "center", padding: "28px", color: "#94a3b8" }}>
                          No evaluation data yet.
                        </td>
                      </tr>
                    ) : (
                      filteredProgramStats.map((r, idx) => (
                        <tr
                          key={r.program}
                          style={{
                            borderBottom: idx === filteredProgramStats.length - 1 ? "none" : "1px solid #f1f5f9",
                            transition: "background 0.15s ease",
                          }}
                        >
                          <td style={{ padding: "14px 16px", fontWeight: "700", color: "#0f172a" }}>{r.program}</td>
                          <td style={{ padding: "14px 16px", color: "#334155" }}>{r.facultyCount}</td>
                          <td style={{ padding: "14px 16px", color: "#334155" }}>{r.responses}</td>
                          <td style={{ padding: "14px 16px", color: "#334155" }}>{r.avg || "—"}</td>
                          <td style={{ padding: "14px 16px", color: "#334155" }}>{r.rate}%</td>
                        </tr>
                      ))
                    )}
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


