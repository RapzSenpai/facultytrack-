import { useState, useEffect } from "react";
import AdminLayout from "./AdminLayout";
import { supabase } from "../../config/supabase";
import { useAuth } from "../../context/AuthContext";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";

const avg = (arr) => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2) : "—";

const getPerformanceLabel = (r) => {
  const n = Number(r);
  if (isNaN(n)) return "—";
  if (n >= 4.5) return "Outstanding";
  if (n >= 4.0) return "Excellent";
  if (n >= 3.5) return "Very Good";
  if (n >= 3.0) return "Good";
  return "Needs Improvement";
};

const getPerformanceColor = (r) => {
  const n = Number(r);
  if (isNaN(n)) return "#9ca3af";
  if (n >= 4.5) return "#22c55e";
  if (n >= 4.0) return "#3b82f6";
  if (n >= 3.0) return "#f59e0b";
  return "#ef4444";
};

// SVG Icons
const BarChartIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="20" x2="18" y2="10" />
    <line x1="12" y1="20" x2="12" y2="4" />
    <line x1="6" y1="20" x2="6" y2="14" />
    <line x1="2" y1="20" x2="22" y2="20" />
  </svg>
);

const PieChartIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
    <path d="M22 12A10 10 0 0 0 12 2v10z" />
  </svg>
);

const tierColors = {
  "Excellent (4.0-5.0)": "#22c55e",
  "Very Good (3.5-3.9)": "#3b82f6",
  "Good (3.0-3.4)": "#f59e0b",
  "Needs Improvement (<3.0)": "#ef4444",
};

export default function AdminReport() {
  const { userProfile } = useAuth();
  const canExport = userProfile?.role === "admin" || userProfile?.role === "super_admin"; // D11
  const [exporting, setExporting] = useState(false);
  const [evaluations, setEvaluations] = useState([]);
  const [facultyUsers, setFacultyUsers] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewingReport, setViewingReport] = useState(null);

  const [filterAY, setFilterAY] = useState("");
  const [filterSem, setFilterSem] = useState("");
  const [filterFaculty, setFilterFaculty] = useState("");
  const [filterDept, setFilterDept] = useState("");
  const [departmentsList, setDepartmentsList] = useState([]);
  const [academicYearsList, setAcademicYearsList] = useState([]);

  useEffect(() => {
    Promise.all([
      supabase.from('admin_evaluations_anon').select('*'),
      supabase.from('users').select('*').eq('role', 'faculty'),
      supabase.from('class_assignments').select('*'),
      supabase.from('academic_years').select('*'),
      supabase.from('departments').select('*'),
    ])
      .then(([evalsRes, facultyRes, assignRes, yearsRes, deptsRes]) => {
        const evals = (evalsRes.data || []).map(e => ({
          ...e,
          assignmentId: e.assignment_id,
          // Phase 4 anonymity: per-row MD5 token instead of student_id
          studentId: e.student_token,
          academicYear: e.academic_year,
          facultyId: e.faculty_id,
        }));
        const faculty = (facultyRes.data || []).map(f => ({
          ...f,
          fullName: f.full_name,
        })).filter(u => u.status === "active");
        const assign = (assignRes.data || []).map(a => ({
          ...a,
          facultyId: a.faculty_id,
          facultyName: a.faculty_name,
          subjectCode: a.subject_code,
          subjectName: a.subject_name,
          yearLevel: a.year_level,
          academicYear: a.academic_year,
        }));
        const years = yearsRes.data || [];
        const depts = deptsRes.data || [];

        setEvaluations(evals);
        setFacultyUsers(faculty);
        setAssignments(assign);
        setDepartmentsList(depts);
        setAcademicYearsList(years);

        if (years.length > 0) {
          const active = years.find(y => (y.status || "").toLowerCase().trim() === "on-going");
          if (active) {
            setFilterAY(active.year);
            setFilterSem(active.semester);
          }
        }
      })
      .catch(err => console.error("Report fetch error:", err))
      .finally(() => setLoading(false));
  }, []);

  const uniqueAYs = [...new Set(academicYearsList.map(y => y.year).filter(Boolean))].sort().reverse();
  const uniqueSems = [...new Set(academicYearsList.map(y => y.semester).filter(Boolean))].sort();

  const reportData = assignments
    .filter(a => !filterAY || a.academicYear === filterAY)
    .filter(a => !filterSem || a.semester === filterSem)
    .map(assignment => {
      const assignmentEvals = evaluations
        .filter(e => e.assignmentId === assignment.id)
        .filter(e => !filterAY || e.academicYear === filterAY)
        .filter(e => !filterSem || e.semester === filterSem);

      const faculty = facultyUsers.find(f => f.id === assignment.facultyId);
      const facultyName = faculty ? faculty.fullName : "Unknown Faculty";
      const subject = assignment.subjectCode || "—";
      const section = assignment.yearLevel && assignment.section
        ? `${assignment.yearLevel} - ${assignment.section}`
        : "—";

      const uniqueStudents = new Set(assignmentEvals.map(e => e.studentId)).size;
      const allScores = assignmentEvals.flatMap(e => Object.values(e.ratings || {}).map(Number));
      const comments = assignmentEvals.map(e => e.comment).filter(c => c && c.trim().length > 0);

      return {
        id: assignment.id,
        faculty: facultyName,
        facultyId: assignment.facultyId,
        department: assignment.department || "—",
        subject,
        section,
        students: uniqueStudents,
        formCount: assignmentEvals.length,
        rating: avg(allScores),
        comments,
      };
    })
    .filter(r => !filterFaculty || r.facultyId === filterFaculty)
    .filter(r => !filterDept || r.department === filterDept);

  // Department bar chart data
  const deptMap = {};
  reportData.forEach(r => {
    if (r.rating === "—") return;
    if (!deptMap[r.department]) deptMap[r.department] = { total: 0, count: 0 };
    deptMap[r.department].total += parseFloat(r.rating);
    deptMap[r.department].count++;
  });
  const deptData = Object.entries(deptMap).map(([dept, v]) => ({
    dept,
    avg: parseFloat((v.total / v.count).toFixed(2)),
  }));

  // Donut pie data
  const tierMap = {
    "Excellent (4.0-5.0)": 0,
    "Very Good (3.5-3.9)": 0,
    "Good (3.0-3.4)": 0,
    "Needs Improvement (<3.0)": 0,
  };
  reportData.forEach(r => {
    const n = parseFloat(r.rating);
    if (isNaN(n)) return;
    if (n >= 4.0) tierMap["Excellent (4.0-5.0)"]++;
    else if (n >= 3.5) tierMap["Very Good (3.5-3.9)"]++;
    else if (n >= 3.0) tierMap["Good (3.0-3.4)"]++;
    else tierMap["Needs Improvement (<3.0)"]++;
  });
  const pieData = Object.entries(tierMap)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({ name, value }));

  const hasChartData = deptData.length > 0 || pieData.length > 0;

  const handleSearch = () => { };

  // Phase 7 [D11/D13]: stats-only export via the export-report Edge
  // Function. The function returns numbers + labels only — comments,
  // AI summaries and identities are excluded server-side (D13).
  const handleExport = async () => {
    if (!filterAY || !filterSem) {
      alert("Pick a specific academic year and semester before exporting.");
      return;
    }
    setExporting(true);
    try {
      const { data, error } = await supabase.functions.invoke("export-report", {
        body: { academic_year: filterAY, semester: filterSem },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);

      // Build a CSV from the stats payload.
      const rows = [["Faculty", "Program", "Forms", "Average Rating", "Performance", "1★", "2★", "3★", "4★", "5★"]];
      for (const f of data.report.faculties) {
        rows.push([
          f.faculty_name,
          f.department || "—",
          String(f.forms_received),
          f.average_rating === null ? "—" : String(f.average_rating),
          f.performance_label || "—",
          String(f.rating_distribution["1"] ?? 0),
          String(f.rating_distribution["2"] ?? 0),
          String(f.rating_distribution["3"] ?? 0),
          String(f.rating_distribution["4"] ?? 0),
          String(f.rating_distribution["5"] ?? 0),
        ]);
      }
      rows.push([]);
      rows.push(["SUMMARY", "", String(data.report.summary.forms_total), data.report.summary.overall_average ?? "—", "", "", "", "", "", ""]);
      const csv = rows
        .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
        .join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `facultytrack-report-${filterAY}-${filterSem}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert("Export failed: " + (err.message || "unknown error"));
    } finally {
      setExporting(false);
  }
  };

  // ── PDF Export ──────────────────────────────────────────────
  const handleExportPDF = () => {
    if (reportData.length === 0) {
      alert("No data to export. Please adjust your filters.");
      return;
    }

    const ayLabel  = filterAY  || "All Academic Years";
    const semLabel = filterSem || "All Semesters";
    const deptLabel = filterDept || "All Programs";
    const now = new Date().toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" });

    const ratingColor = (r) => {
      const n = Number(r);
      if (isNaN(n)) return "#6b7280";
      if (n >= 4.5) return "#16a34a";
      if (n >= 4.0) return "#2563eb";
      if (n >= 3.0) return "#d97706";
      return "#dc2626";
    };

    const rows = reportData.map((r, i) => `
      <tr style="background:${i % 2 === 0 ? '#fff' : '#f9fafb'}">
        <td>${i + 1}</td>
        <td><strong>${r.faculty}</strong></td>
        <td>${r.department}</td>
        <td>${r.subject}</td>
        <td>${r.section}</td>
        <td style="text-align:center">${r.students}</td>
        <td style="text-align:center">${r.formCount}</td>
        <td style="text-align:center;font-weight:700;color:${ratingColor(r.rating)}">${r.rating !== "—" ? r.rating : "—"}</td>
        <td style="color:${ratingColor(r.rating)};font-weight:600">${getPerformanceLabel(r.rating)}</td>
      </tr>
    `).join("");

    const commentsSection = reportData
      .filter(r => r.comments.length > 0)
      .map(r => `
        <div style="margin-bottom:16px;page-break-inside:avoid">
          <div style="font-weight:700;color:#1e3a8a;margin-bottom:6px;font-size:13px">${r.faculty} — ${r.subject} (${r.section})</div>
          ${r.comments.map(c => `<div style="background:#f8fafc;border-left:3px solid #3b82f6;padding:8px 12px;margin-bottom:6px;font-size:12px;color:#374151;border-radius:4px">"${c}"</div>`).join("")}
        </div>
      `).join("");

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8"/>
        <title>Evaluation Report — ${ayLabel} ${semLabel}</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: 'Segoe UI', Arial, sans-serif; color: #1f2937; font-size: 13px; padding: 32px; }
          .header { text-align: center; margin-bottom: 24px; border-bottom: 2px solid #1e3a8a; padding-bottom: 16px; }
          .header h1 { font-size: 20px; color: #1e3a8a; font-weight: 800; letter-spacing: -0.5px; }
          .header h2 { font-size: 14px; color: #374151; font-weight: 600; margin-top: 4px; }
          .meta { display: flex; justify-content: space-between; margin-bottom: 20px; font-size: 12px; color: #6b7280; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 28px; font-size: 12px; }
          th { background: #1e3a8a; color: #fff; padding: 9px 10px; text-align: left; font-size: 11px; letter-spacing: 0.5px; text-transform: uppercase; }
          td { padding: 8px 10px; border-bottom: 1px solid #e5e7eb; vertical-align: middle; }
          .section-title { font-size: 14px; font-weight: 700; color: #1e3a8a; margin: 24px 0 12px; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; }
          .footer { margin-top: 32px; text-align: center; font-size: 11px; color: #9ca3af; border-top: 1px solid #e5e7eb; padding-top: 12px; }
          @media print { body { padding: 20px; } }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>FacultyTrack — Faculty Evaluation Report</h1>
          <h2>${ayLabel} &bull; ${semLabel} &bull; ${deptLabel}</h2>
        </div>
        <div class="meta">
          <span>Generated: ${now}</span>
          <span>Total Records: ${reportData.length}</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>#</th><th>Faculty Name</th><th>Program</th><th>Subject</th>
              <th>Section</th><th>Students</th><th>Forms</th><th>Avg Rating</th><th>Performance</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        ${commentsSection ? `<div class="section-title">Student Comments</div>${commentsSection}` : ""}
        <div class="footer">FacultyTrack Faculty Evaluation System &mdash; Confidential</div>
        <script>window.onload = () => { window.print(); }</script>
      </body>
      </html>
    `;

    const win = window.open("", "_blank", "width=900,height=700");
    win.document.write(html);
    win.document.close();
  };

  return (
    <AdminLayout title="Evaluation Report">
      <section className="ad-content">
       <div className="ad-welcomeHeader" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <h2 className="ad-title">Evaluation Report</h2>
            <p className="ad-subtitle">View and export faculty evaluation results.</p>
          </div>
          <button
            className="ad-btnPrimary"
            onClick={handleExportPDF}
            disabled={loading || reportData.length === 0}
            title={reportData.length === 0 ? "No data to export" : `Export ${reportData.length} records to PDF`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Export CSV
          </button>
        </div>

        <div className="ad-filterCard">
          <div className="ad-filterGroup" style={{ gridTemplateColumns: 'repeat(4, 1fr) auto' }}>
            <select className="ad-filterSelect" value={filterAY} onChange={e => setFilterAY(e.target.value)}>
              <option value="">All Academic Years</option>
              {uniqueAYs.map(ay => <option key={ay} value={ay}>{ay}</option>)}
            </select>
            <select className="ad-filterSelect" value={filterSem} onChange={e => setFilterSem(e.target.value)}>
              <option value="">All Semesters</option>
              {uniqueSems.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select className="ad-filterSelect" value={filterDept} onChange={e => {
              setFilterDept(e.target.value);
              setFilterFaculty(""); // Reset faculty when changing department
            }}>
              <option value="">All Programs</option>
              {departmentsList.map(d => (
                <option key={d.id || d.name} value={d.name}>{d.name}</option>
              ))}
            </select>
            <select className="ad-filterSelect" value={filterFaculty} onChange={e => setFilterFaculty(e.target.value)}>
              <option value="">All Faculty</option>
              {facultyUsers
                .filter(f => !filterDept || f.department === filterDept)
                .map(f => <option key={f.id} value={f.id}>{f.fullName}</option>)}
            </select>
            <button className="ad-btnSearch" onClick={handleSearch}>Search</button>
            {canExport && (
              <button
                className="ad-btnSearch"
                onClick={handleExport}
                disabled={exporting}
                title="Statistics-only export (D13): numbers, no comments, no identities"
                style={{ opacity: exporting ? 0.6 : 1 }}
              >
                {exporting ? "Exporting..." : "Export CSV"}
              </button>
            )}
          </div>
        </div>

        <div className="ad-tableCard">
          {loading ? (
            <div style={{ padding: "40px", textAlign: "center", color: "#6b7280" }}>Loading report data...</div>
          ) : (
            <div className="ad-tableWrap">
              <table className="ad-table">
                <thead>
                  <tr>
                    <th>FACULTY NAME</th>

                    <th>SUBJECT</th>
                    <th>SECTION</th>
                    <th>STUDENTS</th>
                    <th>FORMS</th>
                    <th>AVERAGE RATING</th>
                    <th style={{ textAlign: 'right' }}>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {reportData.length === 0 ? (
                    <tr>
                      <td colSpan="8" style={{ textAlign: "center", padding: "40px 20px", color: "#6b7280" }}>
                        <svg style={{ display: 'block', margin: '0 auto 12px auto', color: '#9ca3af' }} width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                          <circle cx="9" cy="7" r="4"></circle>
                          <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                          <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                        </svg>
                        <span style={{ fontSize: '15px', fontWeight: '500', color: '#4b5563' }}>No evaluation data found</span>
                        <p style={{ margin: '4px 0 0 0', fontSize: '13px' }}>Try adjusting your filters.</p>
                      </td>
                    </tr>
                  ) : (
                    reportData.map(report => (
                      <tr key={report.id}>
                        <td className="ad-name">{report.faculty}</td>

                        <td className="ad-engagement">{report.subject}</td>
                        <td className="ad-engagement">{report.section}</td>
                        <td className="ad-engagement">{report.students}</td>
                        <td className="ad-engagement">{report.formCount}</td>
                        <td className="ad-engagement">
                          {report.rating !== "—" ? (
                            <strong style={{ color: Number(report.rating) >= 4.5 ? "#22c55e" : Number(report.rating) >= 4.0 ? "#3b82f6" : "#f59e0b" }}>
                              {report.rating}
                            </strong>
                          ) : (
                            <span style={{ color: "#9ca3af" }}>No data</span>
                          )}
                        </td>
                        <td className="ad-tableActions" style={{ justifyContent: 'flex-end' }}>
                          <button className="ad-actionBtn ad-actionBtn--view" title="View" onClick={() => setViewingReport(report)}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Charts */}
        {!loading && hasChartData && (
          <div className="ad-chartsRow">

            {/* LEFT: Program Performance — horizontal bar chart */}
            <div className="ad-tableCard" style={{ marginBottom: 0 }}>
              <div className="ad-chartHeader">
                <div className="ad-chartHeaderInner">
                  <span className="ad-chartIcon" style={{ background: '#1e3a8a', borderRadius: 8, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', flexShrink: 0 }}>
                    <BarChartIcon />
                  </span>
                  <span className="ad-chartTitle">PROGRAM PERFORMANCE</span>
                </div>
                <span className="ad-chartBadge" style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: '4px 10px', fontSize: 12, color: '#374151', display: 'flex', alignItems: 'center', gap: 4 }}>
                  By Overall Rating
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
                </span>
              </div>
              <div className="ad-chartBody">
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart
                    data={deptData}
                    layout="vertical"
                    margin={{ top: 10, right: 30, left: 10, bottom: 10 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                    <XAxis
                      type="number"
                      domain={[0, 5]}
                      ticks={[1, 2, 3, 4, 5]}
                      tick={{ fontSize: 11, fill: "#9ca3af" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="dept"
                      tick={{ fontSize: 12, fill: "#374151", fontWeight: 600 }}
                      axisLine={false}
                      tickLine={false}
                      width={60}
                    />
                    <Tooltip
                      formatter={(v) => [v, "Average Rating"]}
                      contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 12 }}
                    />
                    <Bar dataKey="avg" name="Average Rating" fill="#2563eb" radius={[0, 4, 4, 0]} barSize={22} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* RIGHT: Rating Distribution — donut + custom table */}
            <div className="ad-tableCard" style={{ marginBottom: 0 }}>
              <div className="ad-chartHeader">
                <div className="ad-chartHeaderInner">
                  <span className="ad-chartIcon" style={{ background: '#1e3a8a', borderRadius: 8, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', flexShrink: 0 }}>
                    <PieChartIcon />
                  </span>
                  <span className="ad-chartTitle">RATING DISTRIBUTION</span>
                </div>
                <span className="ad-chartBadge" style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: '4px 10px', fontSize: 12, color: '#374151', display: 'flex', alignItems: 'center', gap: 4 }}>
                  Current Semester
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
                </span>
              </div>
              <div className="ad-chartBody" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                {/* Donut */}
                <div style={{ flexShrink: 0 }}>
                  <ResponsiveContainer width={200} height={200}>
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={90}
                        paddingAngle={2}
                        dataKey="value"
                        startAngle={90}
                        endAngle={-270}
                      >
                        {pieData.map((entry, i) => (
                          <Cell key={i} fill={tierColors[entry.name] || "#9ca3af"} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                {/* Custom legend table */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left', color: '#6b7280', fontWeight: 700, fontSize: 10, letterSpacing: '0.5px', textTransform: 'uppercase', paddingBottom: 8, borderBottom: '1px solid #f3f4f6' }}>Rating Range</th>
                        <th style={{ textAlign: 'center', color: '#6b7280', fontWeight: 700, fontSize: 10, letterSpacing: '0.5px', textTransform: 'uppercase', paddingBottom: 8, borderBottom: '1px solid #f3f4f6' }}>Responses</th>
                        <th style={{ textAlign: 'right', color: '#6b7280', fontWeight: 700, fontSize: 10, letterSpacing: '0.5px', textTransform: 'uppercase', paddingBottom: 8, borderBottom: '1px solid #f3f4f6' }}>Percentage</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pieData.map((entry, i) => {
                        const total = pieData.reduce((s, e) => s + e.value, 0);
                        const pct = total > 0 ? Math.round((entry.value / total) * 100) : 0;
                        return (
                          <tr key={i}>
                            <td style={{ padding: '8px 0', borderBottom: '1px solid #f9fafb' }}>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ width: 8, height: 8, borderRadius: '50%', background: tierColors[entry.name] || '#9ca3af', flexShrink: 0 }} />
                                {entry.name}
                              </span>
                            </td>
                            <td style={{ textAlign: 'center', padding: '8px 0', borderBottom: '1px solid #f9fafb', fontWeight: 600 }}>{entry.value}</td>
                            <td style={{ textAlign: 'right', padding: '8px 0', borderBottom: '1px solid #f9fafb', fontWeight: 700, color: tierColors[entry.name] || '#374151' }}>{pct}%</td>
                          </tr>
                        );
                      })}
                      <tr>
                        <td style={{ padding: '10px 0 0', fontWeight: 700, color: '#111827' }}>Total</td>
                        <td style={{ textAlign: 'center', padding: '10px 0 0', fontWeight: 700, color: '#111827' }}>{pieData.reduce((s, e) => s + e.value, 0)}</td>
                        <td style={{ textAlign: 'right', padding: '10px 0 0', fontWeight: 700, color: '#111827' }}>100%</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

          </div>
        )}

      </section>

      {viewingReport && (
        <div className="ad-modal">
          <div className="ad-modalOverlay" onClick={() => setViewingReport(null)} />
          <div className="ad-modalContent">
            <div className="ad-modalHeader">
              <h3 className="ad-modalTitle">Evaluation Report — {viewingReport.faculty}</h3>
              <button className="ad-modalClose" onClick={() => setViewingReport(null)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div className="ad-modalBody">
              {[
                { label: "Faculty Name", value: viewingReport.faculty },
                { label: "Program", value: viewingReport.department },
                { label: "Subject", value: viewingReport.subject },
                { label: "Section", value: viewingReport.section },
                { label: "Students Participated", value: viewingReport.students },
                { label: "Total Forms Submitted", value: viewingReport.formCount },
              ].map(f => (
                <div className="ad-formGroup" key={f.label} style={{ marginBottom: "12px" }}>
                  <label className="ad-label" style={{ marginBottom: "4px" }}>{f.label}</label>
                  <div style={{ padding: "8px 12px", background: "#f9fafb", borderRadius: "6px", border: "1px solid #e5e7eb", fontSize: "14px" }}>{f.value}</div>
                </div>
              ))}
              <div style={{ marginTop: "16px", padding: "16px", background: "#f0f9ff", borderRadius: "8px", border: "1px solid #bae6fd", textAlign: "center" }}>
                <div style={{ fontSize: "13px", color: "#6b7280", marginBottom: "4px" }}>Average Rating</div>
                <div style={{ fontSize: "32px", fontWeight: 700, color: getPerformanceColor(viewingReport.rating) }}>
                  {viewingReport.rating !== "—" ? viewingReport.rating : "No Data"}
                </div>
                {viewingReport.rating !== "—" && (
                  <div style={{ fontSize: "14px", fontWeight: 600, color: getPerformanceColor(viewingReport.rating), marginTop: "4px" }}>
                    {getPerformanceLabel(viewingReport.rating)}
                  </div>
                )}
              </div>

              <div style={{ marginTop: "24px" }}>
                <h4 style={{ fontSize: "14px", fontWeight: 700, color: "#1f2937", marginBottom: "12px", borderBottom: "1px solid #e5e7eb", paddingBottom: "8px" }}>
                  Anonymized Student Comments ({viewingReport.comments.length})
                </h4>
                {viewingReport.comments.length === 0 ? (
                  <div style={{ padding: "16px", background: "#f9fafb", borderRadius: "8px", color: "#6b7280", fontSize: "13px", textAlign: "center", fontStyle: "italic" }}>
                    No comments provided by students for this period.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "300px", overflowY: "auto", paddingRight: "4px" }}>
                    {viewingReport.comments.map((comment, idx) => (
                      <div key={idx} style={{ background: "#f8fafc", padding: "12px 16px", borderRadius: "8px", borderLeft: "3px solid #3b82f6", fontSize: "13.5px", color: "#374151", lineHeight: "1.5" }}>
                        "{comment}"
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>
            <div className="ad-modalFooter">
              <button className="ad-btnSecondary" onClick={() => setViewingReport(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
