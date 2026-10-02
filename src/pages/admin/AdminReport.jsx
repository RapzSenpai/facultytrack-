import { useState, useEffect } from "react";
import AdminLayout from "./AdminLayout";
import { supabase } from "../../config/supabase";
import { useAuth } from "../../context/AuthContext";
import { useScopedAdmin } from "../../hooks/useScopedAdmin";
import { useSuperScope } from "../../context/SuperScopeContext";
import { parseFunctionError } from "../../utils/audit";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";

const avg = (arr) => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2) : "—";

// Department names come from mixed sources (users, assignments,
// departments table) with inconsistent casing/whitespace — compare
// normalized so "BSIT" matches "bsit ".
const normDept = (v) => String(v || "").trim().toLowerCase();
const sameDept = (a, b) => normDept(a) === normDept(b) && normDept(a) !== "";

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

const getHeroTierClass = (r) => {
  const n = Number(r);
  if (isNaN(n)) return "";
  if (n >= 4.5) return "ad-modalScoreHero--green";
  if (n >= 4.0) return "ad-modalScoreHero--blue";
  if (n >= 3.0) return "ad-modalScoreHero--amber";
  return "ad-modalScoreHero--red";
};

const getInitials = (name) => {
  if (!name) return "—";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const escapeHtml = (value) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

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
  // D9: scoped admins are locked to their assigned program(s).
  // Backend (export-report + anon view RLS) enforces the same.
  const { isSuper, myDeptNames, inScopeName, loading: scopeLoading } = useScopedAdmin();
  const { scopeDeptId, scopeDeptName } = useSuperScope();
  const canExport = userProfile?.role === "admin" || userProfile?.role === "super_admin"; // D11
  const [evaluations, setEvaluations] = useState([]);
  const [facultyUsers, setFacultyUsers] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewingReport, setViewingReport] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");

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

  // Lock scoped admins into their assigned program.
  useEffect(() => {
    if (scopeLoading || isSuper) return;
    if (myDeptNames.length > 0 && !myDeptNames.includes(filterDept)) {
      setFilterDept(myDeptNames[0]);
      setFilterFaculty("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeLoading, isSuper, myDeptNames]);

  // Deep link from super Reports cards (?department=): preset the
  // program filter once departments load. Super stays unlocked.
  // Active super scope pick presets the same way.
  useEffect(() => {
    if (scopeLoading || !isSuper || departmentsList.length === 0) return;
    const want = new URLSearchParams(window.location.search).get("department") || scopeDeptName;
    if (!want) return;
    const hit = departmentsList.find((d) => sameDept(d.name, want));
    if (hit && !sameDept(filterDept, hit.name)) {
      setFilterDept(hit.name);
      setFilterFaculty("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeLoading, isSuper, departmentsList, scopeDeptId, scopeDeptName]);

  const uniqueAYs = [...new Set(academicYearsList.map(y => y.year).filter(Boolean))].sort().reverse();
  const uniqueSems = [...new Set(academicYearsList.map(y => y.semester).filter(Boolean))].sort();

  const periodAssignments = assignments
    .filter(a => !filterAY || a.academicYear === filterAY)
    .filter(a => !filterSem || a.semester === filterSem);

  const periodEvals = evaluations
    .filter(e => (!filterAY || e.academicYear === filterAY) && (!filterSem || e.semester === filterSem));

  // Consolidated Overall Data: Aggregated across all assigned sections per faculty
  const inScopeFaculty = facultyUsers
    .filter(f => !filterFaculty || f.id === filterFaculty)
    .filter(f => !filterDept || sameDept(f.department, filterDept))
    .filter(f => isSuper || inScopeName(f.department));

  const consolidatedData = inScopeFaculty
    .map(faculty => {
      const facAssignments = periodAssignments.filter(a => a.facultyId === faculty.id);
      const facEvals = periodEvals.filter(e => e.facultyId === faculty.id);

      const subjects = [...new Set(facAssignments.map(a => a.subjectCode).filter(Boolean))];
      const sections = [...new Set(facAssignments.map(a => a.yearLevel && a.section ? `${a.yearLevel} - ${a.section}` : a.section).filter(Boolean))];

      const uniqueStudents = new Set(facEvals.map(e => e.studentId)).size;
      const allScores = facEvals.flatMap(e => Object.values(e.ratings || {}).map(Number));

      const sectionBreakdown = facAssignments.map(assign => {
        const aEvals = facEvals.filter(e => e.assignmentId === assign.id);
        const aScores = aEvals.flatMap(e => Object.values(e.ratings || {}).map(Number));
        return {
          assignmentId: assign.id,
          subject: assign.subjectCode || "—",
          subjectName: assign.subjectName || "",
          section: assign.yearLevel && assign.section ? `${assign.yearLevel} - ${assign.section}` : assign.section || "—",
          students: new Set(aEvals.map(e => e.studentId)).size,
          formCount: aEvals.length,
          rating: avg(aScores),
        };
      });

      return {
        id: `cons_${faculty.id}`,
        facultyId: faculty.id,
        faculty: faculty.fullName,
        department: faculty.department || (facAssignments[0]?.department) || "—",
        subjects: subjects.length > 0 ? subjects.join(", ") : "—",
        subjectList: subjects,
        sectionsList: sections.length > 0 ? sections.join(", ") : "—",
        sectionsCount: sections.length,
        students: uniqueStudents,
        formCount: facEvals.length,
        rating: avg(allScores),
        sectionBreakdown,
        isConsolidated: true,
      };
    })
    .filter(r => r.formCount > 0 || r.sectionsCount > 0);

  const reportData = consolidatedData;

  // 3. Executive KPI Metrics (scoped to current filters)
  const evaluatedCount = consolidatedData.filter(f => f.formCount > 0).length;
  const totalFacultyCount = inScopeFaculty.length;
  const evalCoveragePct = totalFacultyCount > 0 ? Math.round((evaluatedCount / totalFacultyCount) * 100) : 0;

  const validRatings = consolidatedData
    .map(f => parseFloat(f.rating))
    .filter(r => !isNaN(r));
  const instAvgRating = validRatings.length > 0
    ? (validRatings.reduce((a, b) => a + b, 0) / validRatings.length).toFixed(2)
    : "—";

  const totalFormsCount = periodEvals.filter(e => {
    const fac = facultyUsers.find(f => f.id === e.facultyId);
    if (!fac) return false;
    if (filterFaculty && fac.id !== filterFaculty) return false;
    if (filterDept && !sameDept(fac.department, filterDept)) return false;
    return isSuper || inScopeName(fac.department);
  }).length;

  const handleResetFilters = () => {
    setSearchTerm("");
    setFilterFaculty("");
    if (isSuper) {
      setFilterDept("");
    }
    const active = academicYearsList.find(y => (y.status || "").toLowerCase().trim() === "on-going");
    if (active) {
      setFilterAY(active.year);
      setFilterSem(active.semester);
    } else {
      setFilterAY("");
      setFilterSem("");
    }
  };

  // Filter table by live search query
  const displayedReportData = reportData.filter(item => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase().trim();
    const nameMatch = (item.faculty || "").toLowerCase().includes(term);
    const deptMatch = (item.department || "").toLowerCase().includes(term);
    const subjMatch = (item.subjects || item.subject || "").toLowerCase().includes(term);
    const secMatch = (item.sectionsList || item.section || "").toLowerCase().includes(term);
    return nameMatch || deptMatch || subjMatch || secMatch;
  });


  // Department bar chart data (grouped by normalized name so
  // "BSIT" vs "bsit" casing variants don't split into two bars).
  const deptMap = {};
  const deptLabel = {};
  reportData.forEach(r => {
    if (r.rating === "—") return;
    const key = normDept(r.department);
    if (!key) return;
    if (!deptMap[key]) {
      deptMap[key] = { total: 0, count: 0 };
      deptLabel[key] = r.department;
    }
    deptMap[key].total += parseFloat(r.rating);
    deptMap[key].count++;
  });
  const deptData = Object.entries(deptMap).map(([key, v]) => ({
    dept: deptLabel[key],
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

  // ── Summary Report Export (PDF) (D13: statistics only) ────
  // Goes through the export-report Edge Function so program scope
  // is enforced server-side and every export is audit-logged (D11).
  const [exportingPdf, setExportingPdf] = useState(false);
  const handleExportPDF = async () => {
    if (!filterAY || !filterSem) {
      alert("Pick a specific academic year and semester before generating the PDF report.");
      return;
    }

    const win = window.open("", "_blank");
    if (!win) {
      alert("Popup blocked. Please allow popups for this site to generate the PDF report.");
      return;
    }

    // Immediate feedback in the new window
    win.document.open();
    win.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Generating Summary Evaluation Report...</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 80vh; color: #334155; }
            .spinner { width: 44px; height: 44px; border: 4px solid #e2e8f0; border-top-color: #1e3a8a; border-radius: 50%; animation: spin 0.8s linear infinite; margin-bottom: 20px; }
            @keyframes spin { to { transform: rotate(360deg); } }
            h2 { margin: 0 0 8px 0; color: #0f172a; font-size: 20px; }
            p { margin: 0; color: #64748b; font-size: 14px; }
          </style>
        </head>
        <body>
          <div class="spinner"></div>
          <h2>Generating Summary Evaluation Report (PDF)</h2>
          <p>Compiling audited faculty performance ratings and classification summary...</p>
        </body>
      </html>
    `);
    win.document.close();

    setExportingPdf(true);
    try {
      const { data, error } = await supabase.functions.invoke("export-report", {
        body: { academic_year: filterAY, semester: filterSem },
      });
      if (error) throw new Error(await parseFunctionError(error, "Report generation failed."));
      if (data?.error) throw new Error(data.error);

      // Map server-audited statistics with client-side scope filters
      const rawFaculties = data.report?.faculties || [];
      const facultiesToReport = rawFaculties
        .map((f, i) => {
          const localMatch = consolidatedData.find(c => c.facultyId === f.faculty_id);
          return {
            ...f,
            index: i + 1,
            sectionsList: localMatch?.sectionsList || "—",
            sectionsCount: localMatch?.sectionsCount || 0,
            students: localMatch?.students ?? "—",
          };
        })
        .filter(f => !filterFaculty || f.faculty_id === filterFaculty)
        .filter(f => !filterDept || sameDept(f.department, filterDept));

      if (facultiesToReport.length === 0) {
        win.close();
        alert("No evaluation records found matching the active criteria.");
        return;
      }

      // Sort faculties by average_rating descending (highest rating first)
      facultiesToReport.sort((a, b) => {
        const rA = a.average_rating === null ? -1 : Number(a.average_rating);
        const rB = b.average_rating === null ? -1 : Number(b.average_rating);
        return rB - rA;
      });

      const ayLabel = filterAY;
      const semLabel = filterSem;
      const selectedFacultyObj = facultyUsers.find(f => f.id === filterFaculty);
      const selectedFacultyName = selectedFacultyObj ? selectedFacultyObj.fullName : "";
      const scopeLabel = isSuper
        ? (filterDept || "All Academic Programs")
        : (myDeptNames.join(", ") || filterDept || "Assigned Program");

      const now = new Date().toLocaleDateString("en-PH", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

      const totalFacultyCount = facultiesToReport.length;
      const totalForms = facultiesToReport.reduce((acc, f) => acc + (f.forms_received || 0), 0);
      const validRatingList = facultiesToReport
        .map(f => f.average_rating)
        .filter(r => r !== null && !isNaN(Number(r)));
      const overallAvg = validRatingList.length > 0
        ? (validRatingList.reduce((a, b) => a + Number(b), 0) / validRatingList.length).toFixed(2)
        : (data.report?.summary?.overall_average ?? "—");

      const ratingColor = (r) => {
        const n = Number(r);
        if (isNaN(n) || r === null) return "#64748b";
        if (n >= 4.5) return "#15803d";
        if (n >= 4.0) return "#1d4ed8";
        if (n >= 3.5) return "#0284c7";
        if (n >= 3.0) return "#b45309";
        return "#b91c1c";
      };

      const ratingBg = (r) => {
        const n = Number(r);
        if (isNaN(n) || r === null) return "#f1f5f9";
        if (n >= 4.5) return "#f0fdf4";
        if (n >= 4.0) return "#eff6ff";
        if (n >= 3.5) return "#f0f9ff";
        if (n >= 3.0) return "#fffbeb";
        return "#fef2f2";
      };

      const ratingBorder = (r) => {
        const n = Number(r);
        if (isNaN(n) || r === null) return "#e2e8f0";
        if (n >= 4.5) return "#bbf7d0";
        if (n >= 4.0) return "#bfdbfe";
        if (n >= 3.5) return "#bae6fd";
        if (n >= 3.0) return "#fde68a";
        return "#fecaca";
      };

      // Summary distribution tiers
      const tierStats = {
        outstanding: facultiesToReport.filter(f => Number(f.average_rating) >= 4.5).length,
        excellent: facultiesToReport.filter(f => Number(f.average_rating) >= 4.0 && Number(f.average_rating) < 4.5).length,
        veryGood: facultiesToReport.filter(f => Number(f.average_rating) >= 3.5 && Number(f.average_rating) < 4.0).length,
        good: facultiesToReport.filter(f => Number(f.average_rating) >= 3.0 && Number(f.average_rating) < 3.5).length,
        needsImprovement: facultiesToReport.filter(f => f.average_rating !== null && Number(f.average_rating) < 3.0).length,
      };

      // Summary Report Table Rows: Faculty Name, Program, Rating, Performance Classification
      const facultyRows = facultiesToReport.map((f, i) => {
        const ratingNum = f.average_rating === null ? null : Number(f.average_rating);
        const ratingStr = ratingNum !== null ? ratingNum.toFixed(2) : "—";
        const classification = f.performance_label || (ratingNum !== null ? getPerformanceLabel(ratingNum) : "—");
        return `
          <tr style="background:${i % 2 === 0 ? '#ffffff' : '#f8fafc'};">
            <td style="text-align:center;font-weight:700;color:#64748b;font-size:11px;">${i + 1}</td>
            <td>
              <div style="font-weight:700;color:#0f172a;font-size:12px;letter-spacing:-0.2px;">${escapeHtml(f.faculty_name)}</div>
            </td>
            <td>
              <span style="font-size:11px;font-weight:600;color:#334155;">${escapeHtml(f.department || "—")}</span>
            </td>
            <td style="text-align:center;">
              ${ratingNum !== null ? `
                <div class="rating-badge" style="background:${ratingBg(ratingNum)};border:1px solid ${ratingBorder(ratingNum)};color:${ratingColor(ratingNum)};">
                  <span style="font-weight:800;font-size:12px;">${ratingStr}</span>
                  <span style="font-size:9.5px;font-weight:600;opacity:0.8;">/ 5.00</span>
                </div>
              ` : `<span style="color:#94a3b8;font-size:11px;font-style:italic;">No Data</span>`}
            </td>
            <td style="text-align:center;">
              <span class="classification-badge" style="background:${ratingBg(ratingNum)};border:1px solid ${ratingBorder(ratingNum)};color:${ratingColor(ratingNum)};">
                ${escapeHtml(classification)}
              </span>
            </td>
          </tr>
        `;
      }).join("");

      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8"/>
          <title>Faculty Evaluation Summary Report — ${escapeHtml(ayLabel)} ${escapeHtml(semLabel)}</title>
          <style>
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
              color: #0f172a;
              font-size: 11.5px;
              line-height: 1.4;
              background: #ffffff;
              padding: 24px 30px;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            @page {
              size: portrait;
              margin: 10mm 12mm;
            }
            @media print {
              body { padding: 0; }
              .no-print { display: none !important; }
              .page-break { page-break-before: always; }
              tr { page-break-inside: avoid; }
            }
            .no-print-bar {
              position: sticky;
              top: 0;
              background: #0f172a;
              color: #ffffff;
              padding: 10px 20px;
              display: flex;
              justify-content: space-between;
              align-items: center;
              border-radius: 8px;
              margin-bottom: 20px;
              box-shadow: 0 4px 12px rgba(0,0,0,0.15);
              z-index: 999;
            }
            .inst-header {
              text-align: center;
              padding-bottom: 14px;
              border-bottom: 2.5px solid #1e3a8a;
              margin-bottom: 14px;
            }
            .inst-pretitle {
              font-size: 10px;
              font-weight: 800;
              letter-spacing: 1.2px;
              text-transform: uppercase;
              color: #475569;
              margin-bottom: 3px;
            }
            .inst-title {
              font-size: 20px;
              font-weight: 900;
              color: #1e3a8a;
              letter-spacing: -0.5px;
              margin-bottom: 4px;
            }
            .inst-subtitle {
              font-size: 12px;
              font-weight: 600;
              color: #334155;
              margin-bottom: 8px;
            }
            .inst-tags {
              display: flex;
              justify-content: center;
              flex-wrap: wrap;
              gap: 6px;
              margin-top: 6px;
            }
            .tag {
              display: inline-block;
              padding: 3px 10px;
              background: #f1f5f9;
              border: 1px solid #cbd5e1;
              border-radius: 6px;
              font-size: 11px;
              color: #1e293b;
            }
            .meta-bar {
              display: flex;
              justify-content: space-between;
              align-items: center;
              font-size: 10.5px;
              color: #64748b;
              padding-bottom: 8px;
              border-bottom: 1px solid #e2e8f0;
              margin-bottom: 14px;
            }
            .kpi-grid {
              display: grid;
              grid-template-columns: repeat(3, 1fr);
              gap: 10px;
              margin-bottom: 14px;
            }
            .kpi-card {
              border: 1.5px solid #e2e8f0;
              border-radius: 8px;
              padding: 9px 12px;
              background: #f8fafc;
            }
            .kpi-label {
              font-size: 9.5px;
              font-weight: 800;
              text-transform: uppercase;
              letter-spacing: 0.5px;
              color: #64748b;
              margin-bottom: 3px;
            }
            .kpi-value {
              font-size: 18px;
              font-weight: 900;
              color: #0f172a;
              line-height: 1.1;
            }
            .kpi-sub {
              font-size: 10px;
              color: #64748b;
              margin-top: 2px;
            }
            .scale-grid {
              display: grid;
              grid-template-columns: repeat(5, 1fr);
              gap: 6px;
              margin-bottom: 14px;
            }
            .scale-card {
              border: 1px solid #e2e8f0;
              border-radius: 6px;
              padding: 6px 8px;
              background: #f8fafc;
              text-align: center;
              font-size: 10px;
            }
            .table-section-title {
              font-size: 12px;
              font-weight: 800;
              text-transform: uppercase;
              letter-spacing: 0.6px;
              color: #1e3a8a;
              margin: 16px 0 8px 0;
              display: flex;
              justify-content: space-between;
              align-items: baseline;
            }
            .summary-table {
              width: 100%;
              border-collapse: collapse;
              font-size: 11px;
              margin-bottom: 16px;
            }
            .summary-table th {
              background: #0f172a;
              color: #ffffff;
              font-size: 9.5px;
              font-weight: 700;
              text-transform: uppercase;
              letter-spacing: 0.6px;
              padding: 9px 12px;
              border: 1px solid #0f172a;
              text-align: left;
            }
            .summary-table td {
              padding: 8px 12px;
              border: 1px solid #e2e8f0;
              vertical-align: middle;
            }
            .rating-badge {
              display: inline-flex;
              align-items: center;
              gap: 4px;
              padding: 3px 8px;
              border-radius: 6px;
            }
            .classification-badge {
              display: inline-block;
              padding: 3px 10px;
              border-radius: 9999px;
              font-weight: 700;
              font-size: 10.5px;
              letter-spacing: 0.2px;
            }
            .matrix-table {
              width: 100%;
              border-collapse: collapse;
              font-size: 10.5px;
              border: 1px solid #e2e8f0;
              margin-top: 6px;
            }
            .matrix-table th {
              background: #f8fafc;
              padding: 6px 10px;
              border: 1px solid #e2e8f0;
              text-align: left;
              font-size: 9.5px;
              font-weight: 700;
              color: #475569;
              text-transform: uppercase;
            }
            .matrix-table td {
              padding: 6px 10px;
              border: 1px solid #e2e8f0;
            }
            .signature-grid {
              display: grid;
              grid-template-columns: repeat(3, 1fr);
              gap: 24px;
              margin-top: 28px;
              page-break-inside: avoid;
            }
            .sig-card {
              text-align: center;
            }
            .sig-space {
              height: 38px;
              border-bottom: 1.5px solid #0f172a;
              margin-bottom: 6px;
            }
            .sig-title {
              font-size: 11px;
              font-weight: 700;
              color: #0f172a;
            }
            .sig-role {
              font-size: 10px;
              color: #64748b;
            }
            .sig-date {
              font-size: 9.5px;
              color: #94a3b8;
              margin-top: 2px;
            }
            .notice-card {
              margin-top: 16px;
              padding: 8px 12px;
              border-radius: 6px;
              background: #f8fafc;
              border: 1px solid #e2e8f0;
              text-align: center;
              font-size: 10px;
              color: #64748b;
              font-style: italic;
            }
            .footer-card {
              margin-top: 12px;
              border-top: 1px solid #e2e8f0;
              padding-top: 8px;
              text-align: center;
              font-size: 9.5px;
              color: #94a3b8;
            }
          </style>
        </head>
        <body>
          <div class="no-print no-print-bar">
            <span style="font-weight: 700; font-size: 13px;">Faculty Evaluation Summary Report</span>
            <div style="display: flex; gap: 8px;">
              <button onclick="window.print()" style="background: #2563eb; color: #fff; border: none; padding: 7px 16px; border-radius: 6px; font-weight: 700; font-size: 12px; cursor: pointer;">
                Print / Save as PDF
              </button>
              <button onclick="window.close()" style="background: #475569; color: #fff; border: none; padding: 7px 14px; border-radius: 6px; font-weight: 600; font-size: 12px; cursor: pointer;">
                Close
              </button>
            </div>
          </div>

          <div class="inst-header">
            <div class="inst-pretitle">FACULTYTRACK ACADEMIC PERFORMANCE & EVALUATION SYSTEM</div>
            <h1 class="inst-title">FACULTY EVALUATION SUMMARY REPORT</h1>
            <div class="inst-subtitle">Official Performance Summary & Classification Overview</div>
            <div class="inst-tags">
              <span class="tag">Academic Year: <strong>${escapeHtml(ayLabel)}</strong></span>
              <span class="tag">Semester: <strong>${escapeHtml(semLabel)}</strong></span>
              <span class="tag">Program Scope: <strong>${escapeHtml(scopeLabel)}</strong></span>
              ${selectedFacultyName ? `<span class="tag">Faculty: <strong>${escapeHtml(selectedFacultyName)}</strong></span>` : ''}
            </div>
          </div>

          <div class="meta-bar">
            <span><strong>Generated:</strong> ${escapeHtml(now)}</span>
            <span><strong>Report Scope:</strong> ${totalFacultyCount} Faculty Member${totalFacultyCount === 1 ? '' : 's'} &bull; ${totalForms} Submissions</span>
            <span><strong>Compliance:</strong> Statistical Aggregation (Policy D13)</span>
          </div>

          <!-- Executive KPI Strip -->
          <div class="kpi-grid">
            <div class="kpi-card">
              <div class="kpi-label">Faculty Evaluated</div>
              <div class="kpi-value">${totalFacultyCount}</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-label">Institutional Mean Rating</div>
              <div class="kpi-value" style="color: ${ratingColor(overallAvg)};">${overallAvg} / 5.00</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-label">Total Student Submissions</div>
              <div class="kpi-value">${totalForms}</div>
            </div>
          </div>

          <!-- Performance Distribution Summary -->
          <div class="scale-grid">
            <div class="scale-card" style="border-top: 3px solid #15803d;">
              <div style="font-weight: 800; color: #15803d;">Outstanding (≥4.5)</div>
              <div style="font-size: 15px; font-weight: 900; color: #0f172a; margin: 2px 0;">${tierStats.outstanding}</div>
              <div style="color: #64748b;">${totalFacultyCount > 0 ? Math.round((tierStats.outstanding / totalFacultyCount) * 100) : 0}% of faculty</div>
            </div>
            <div class="scale-card" style="border-top: 3px solid #1d4ed8;">
              <div style="font-weight: 800; color: #1d4ed8;">Excellent (4.0-4.49)</div>
              <div style="font-size: 15px; font-weight: 900; color: #0f172a; margin: 2px 0;">${tierStats.excellent}</div>
              <div style="color: #64748b;">${totalFacultyCount > 0 ? Math.round((tierStats.excellent / totalFacultyCount) * 100) : 0}% of faculty</div>
            </div>
            <div class="scale-card" style="border-top: 3px solid #0284c7;">
              <div style="font-weight: 800; color: #0284c7;">Very Good (3.5-3.99)</div>
              <div style="font-size: 15px; font-weight: 900; color: #0f172a; margin: 2px 0;">${tierStats.veryGood}</div>
              <div style="color: #64748b;">${totalFacultyCount > 0 ? Math.round((tierStats.veryGood / totalFacultyCount) * 100) : 0}% of faculty</div>
            </div>
            <div class="scale-card" style="border-top: 3px solid #b45309;">
              <div style="font-weight: 800; color: #b45309;">Good (3.0-3.49)</div>
              <div style="font-size: 15px; font-weight: 900; color: #0f172a; margin: 2px 0;">${tierStats.good}</div>
              <div style="color: #64748b;">${totalFacultyCount > 0 ? Math.round((tierStats.good / totalFacultyCount) * 100) : 0}% of faculty</div>
            </div>
            <div class="scale-card" style="border-top: 3px solid #b91c1c;">
              <div style="font-weight: 800; color: #b91c1c;">Needs Imprv. (&lt;3.0)</div>
              <div style="font-size: 15px; font-weight: 900; color: #0f172a; margin: 2px 0;">${tierStats.needsImprovement}</div>
              <div style="color: #64748b;">${totalFacultyCount > 0 ? Math.round((tierStats.needsImprovement / totalFacultyCount) * 100) : 0}% of faculty</div>
            </div>
          </div>

          <!-- Summary Report Table -->
          <div class="table-section-title">
            <span>Faculty Evaluation Summary Report Table</span>
            <span style="font-size: 10.5px; color: #64748b; font-weight: 600; text-transform: none;">
              ${totalFacultyCount} Faculty Member${totalFacultyCount === 1 ? '' : 's'} &bull; Ranked by Average Rating
            </span>
          </div>

          <table class="summary-table">
            <thead>
              <tr>
                <th style="width: 36px; text-align: center;">#</th>
                <th style="width: 38%;">FACULTY NAME</th>
                <th style="width: 28%;">PROGRAM</th>
                <th style="width: 17%; text-align: center;">RATING</th>
                <th style="width: 17%; text-align: center;">PERFORMANCE CLASSIFICATION</th>
              </tr>
            </thead>
            <tbody>
              ${facultyRows}
            </tbody>
            <tfoot>
              <tr style="background: #f1f5f9; font-weight: 800; border-top: 2px solid #cbd5e1;">
                <td colspan="2" style="text-align: right; padding: 10px 14px; font-size: 11.5px; color: #0f172a;">
                  Institutional / Program Scope Average:
                </td>
                <td style="padding: 10px 12px; font-size: 11px; color: #334155;">
                  ${escapeHtml(scopeLabel)}
                </td>
                <td style="text-align: center; padding: 10px;">
                  <div class="rating-badge" style="background: ${ratingBg(overallAvg)}; border: 1px solid ${ratingBorder(overallAvg)}; color: ${ratingColor(overallAvg)};">
                    <span style="font-weight: 800; font-size: 12.5px;">${overallAvg}</span>
                    <span style="font-size: 9.5px; font-weight: 600; opacity: 0.8;">/ 5.00</span>
                  </div>
                </td>
                <td style="text-align: center; padding: 10px;">
                  <span class="classification-badge" style="background: ${ratingBg(overallAvg)}; border: 1px solid ${ratingBorder(overallAvg)}; color: ${ratingColor(overallAvg)};">
                    ${overallAvg !== "—" ? getPerformanceLabel(overallAvg) : "—"}
                  </span>
                </td>
              </tr>
            </tfoot>
          </table>

          <!-- Official Rating Scale & Qualitative Interpretation Matrix -->
          <div style="margin-top: 18px; page-break-inside: avoid;">
            <div style="font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; color: #1e3a8a; margin-bottom: 6px;">
              Rating Scale & Performance Classification Reference
            </div>
            <table class="matrix-table">
              <thead>
                <tr>
                  <th style="width: 20%;">Rating Range</th>
                  <th style="width: 25%;">Performance Classification</th>
                  <th>Qualitative Interpretation</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style="font-weight: 700; color: #15803d;">4.50 – 5.00</td>
                  <td style="font-weight: 700; color: #15803d;">Outstanding</td>
                  <td style="color: #475569;">Consistently demonstrates highest quality instructional delivery, mastery, and student engagement.</td>
                </tr>
                <tr style="background: #fcfdfe;">
                  <td style="font-weight: 700; color: #1d4ed8;">4.00 – 4.49</td>
                  <td style="font-weight: 700; color: #1d4ed8;">Excellent</td>
                  <td style="color: #475569;">High degree of competence in curriculum delivery, clarity, and classroom management.</td>
                </tr>
                <tr>
                  <td style="font-weight: 700; color: #0284c7;">3.50 – 3.99</td>
                  <td style="font-weight: 700; color: #0284c7;">Very Good</td>
                  <td style="color: #475569;">Consistently meets and frequently exceeds required academic teaching standards.</td>
                </tr>
                <tr style="background: #fcfdfe;">
                  <td style="font-weight: 700; color: #b45309;">3.00 – 3.49</td>
                  <td style="font-weight: 700; color: #b45309;">Good</td>
                  <td style="color: #475569;">Meets basic minimum institutional criteria for teaching and student supervision.</td>
                </tr>
                <tr>
                  <td style="font-weight: 700; color: #b91c1c;">Below 3.00</td>
                  <td style="font-weight: 700; color: #b91c1c;">Needs Improvement</td>
                  <td style="color: #475569;">Falls below minimum benchmark; requires departmental mentoring and pedagogical intervention.</td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Official Sign-off Block -->
          <div class="signature-grid">
            <div class="sig-card">
              <div class="sig-space"></div>
              <div class="sig-title">${escapeHtml(userProfile?.full_name || "Evaluation Administrator")}</div>
              <div class="sig-role">Prepared by / Academic Coordinator</div>
              <div class="sig-date">Date: ${escapeHtml(now)}</div>
            </div>
            <div class="sig-card">
              <div class="sig-space"></div>
              <div class="sig-title">Department Chairperson / Program Head</div>
              <div class="sig-role">Reviewed & Verified by</div>
              <div class="sig-date">Date: ________________________</div>
            </div>
            <div class="sig-card">
              <div class="sig-space"></div>
              <div class="sig-title">Dean / VP Academic Affairs</div>
              <div class="sig-role">Approved by</div>
              <div class="sig-date">Date: ________________________</div>
            </div>
          </div>

          <div class="notice-card">
            Official Academic Record Notice: This document is generated directly from FacultyTrack evaluation records. In strict compliance with institutional student anonymity policy (D13), individual student identities and qualitative comments are excluded from exported reports. Server audit log action: report.export.
          </div>

          <div class="footer-card">
            FacultyTrack Academic Management & Evaluation System &bull; Confidential Administrative Summary Report
          </div>

          <script>
            window.onload = function() {
              setTimeout(function() {
                window.focus();
                window.print();
              }, 300);
            };
          </script>
        </body>
        </html>
      `;

      win.document.open();
      win.document.write(html);
      win.document.close();
    } catch (err) {
      if (win && !win.closed) win.close();
      alert("PDF export failed: " + (err.message || "unknown error"));
    } finally {
      setExportingPdf(false);
    }
  };

  return (
    <AdminLayout title="Evaluation Report">
      <section className="ad-content">
       <div className="ad-welcomeHeader" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px' }}>
          <div>
            <h2 className="ad-title">Evaluation Report</h2>
            <p className="ad-subtitle">View and export faculty evaluation results.
              {!scopeLoading && !isSuper && (
                <span style={{ display: "block", marginTop: 4, fontWeight: 700 }}>
                  Scope: {myDeptNames.join(", ") || "No program assigned — no data"}
                </span>
              )}
            </p>
          </div>
          {canExport && (
            <button
              className="ad-btnPrimary"
              onClick={handleExportPDF}
              disabled={loading || scopeLoading || exportingPdf || !filterAY || !filterSem}
              title={!filterAY || !filterSem ? "Pick a year and semester first" : "Generate official summary report (Audited, D13)"}
              style={{ display: "inline-flex", alignItems: "center", gap: "8px", padding: "10px 18px", fontWeight: 700 }}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
              {exportingPdf ? "Generating Report..." : "Generate Report"}
            </button>
          )}
        </div>

        {/* 3-Card Executive KPI Strip */}
        <div className="ad-kpiGrid">
          <div className="ad-kpiCard ad-kpiCard--primary">
            <div className="ad-kpiHeader">
              <span className="ad-kpiLabel">Faculty Evaluated</span>
              <span className="ad-kpiIcon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><polyline points="16 11 18 13 22 9" />
                </svg>
              </span>
            </div>
            <div className="ad-kpiBody">
              <span className="ad-kpiValue">{loading || scopeLoading ? "—" : evaluatedCount}</span>
              <span className={`ad-kpiBadge ${evaluatedCount > 0 ? "ad-kpiBadge--info" : ""}`}>
                {evalCoveragePct}% Coverage
              </span>
            </div>
          </div>

          <div className="ad-kpiCard ad-kpiCard--success">
            <div className="ad-kpiHeader">
              <span className="ad-kpiLabel">Institutional Avg Rating</span>
              <span className="ad-kpiIcon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              </span>
            </div>
            <div className="ad-kpiBody">
              <span className="ad-kpiValue" style={{ color: instAvgRating !== "—" ? getPerformanceColor(instAvgRating) : undefined }}>
                {loading || scopeLoading ? "—" : instAvgRating}
              </span>
              {instAvgRating !== "—" && (
                <span className="ad-kpiBadge ad-kpiBadge--success">
                  {getPerformanceLabel(instAvgRating)}
                </span>
              )}
            </div>
          </div>

          <div className="ad-kpiCard ad-kpiCard--info">
            <div className="ad-kpiHeader">
              <span className="ad-kpiLabel">Total Submissions</span>
              <span className="ad-kpiIcon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
                </svg>
              </span>
            </div>
            <div className="ad-kpiBody">
              <span className="ad-kpiValue">{loading || scopeLoading ? "—" : totalFormsCount}</span>
              <span className="ad-kpiBadge ad-kpiBadge--info">
                Audited Submissions
              </span>
            </div>
          </div>
        </div>

        {/* Enhanced Filter Grid */}
        <div className="ad-filterCardEnhanced">
          <div className="ad-filterGridEnhanced">
            <select className="ad-filterSelectEnhanced" value={filterAY} onChange={e => setFilterAY(e.target.value)}>
              <option value="">All Academic Years</option>
              {uniqueAYs.map(ay => <option key={ay} value={ay}>{ay}</option>)}
            </select>
            <select className="ad-filterSelectEnhanced" value={filterSem} onChange={e => setFilterSem(e.target.value)}>
              <option value="">All Semesters</option>
              {uniqueSems.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select className="ad-filterSelectEnhanced" value={filterDept} onChange={e => {
              setFilterDept(e.target.value);
              setFilterFaculty(""); // Reset faculty when changing department
            }}
              disabled={!isSuper && myDeptNames.length <= 1}
              title={!isSuper ? "Locked to your assigned program" : undefined}>
              {isSuper ? (
                <>
                  <option value="">All Programs</option>
                  {departmentsList.map(d => (
                    <option key={d.id || d.name} value={d.name}>{d.name}</option>
                  ))}
                </>
              ) : (
                myDeptNames.map(n => (
                  <option key={n} value={n}>{n}</option>
                ))
              )}
            </select>
            <select className="ad-filterSelectEnhanced" value={filterFaculty} onChange={e => setFilterFaculty(e.target.value)}>
              <option value="">All Faculty</option>
              {facultyUsers
                .filter(f => isSuper || inScopeName(f.department))
                .filter(f => !filterDept || sameDept(f.department, filterDept))
                .map(f => <option key={f.id} value={f.id}>{f.fullName}</option>)}
            </select>
            <button
              type="button"
              className="ad-resetFiltersBtn"
              onClick={handleResetFilters}
              title="Reset search and filters to active semester"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" />
              </svg>
              Reset
            </button>
          </div>
        </div>

        {/* Report Header Toolbar & Live Search Bar */}
        <div className="ad-reportToolbar">
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#1e293b", display: "flex", alignItems: "center", gap: "8px" }}>
              Faculty Evaluations
              <span style={{ fontSize: "12px", fontWeight: 600, padding: "2px 8px", background: "#e0e7ff", color: "#4338ca", borderRadius: "999px" }}>
                {consolidatedData.length}
              </span>
            </h3>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
            <div className="ad-searchFilterWrap">
              <svg className="ad-searchFilterIcon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                className="ad-searchFilterInput"
                placeholder="Search faculty, subject, section..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
            </div>
            {searchTerm && (
              <span style={{ fontSize: "12px", color: "#64748b", fontWeight: 500 }}>
                {displayedReportData.length} matching result{displayedReportData.length === 1 ? "" : "s"}
              </span>
            )}
          </div>
        </div>

        {/* Executive Data Table */}
        <div className="ad-tableCard">
          {loading || scopeLoading ? (
            <div style={{ padding: "40px", textAlign: "center", color: "#6b7280" }}>Loading report data...</div>
          ) : (
            <div className="ad-tableWrap">
              <table className="ad-table ad-table--executive">
                <thead>
                  <tr>
                    <th>FACULTY MEMBER</th>
                    <th>PROGRAM</th>
                    <th>SUBJECTS TAUGHT</th>
                    <th>SECTIONS</th>
                    <th style={{ textAlign: "center" }}>STUDENTS</th>
                    <th style={{ textAlign: "center" }}>FORMS</th>
                    <th>OVERALL RATING</th>
                    <th style={{ textAlign: 'right' }}>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedReportData.length === 0 ? (
                    <tr>
                      <td colSpan="8" style={{ textAlign: "center", padding: "48px 20px", color: "#6b7280" }}>
                        <svg style={{ display: 'block', margin: '0 auto 12px auto', color: '#9ca3af' }} width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                          <circle cx="9" cy="7" r="4"></circle>
                          <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                          <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                        </svg>
                        <span style={{ fontSize: '15px', fontWeight: '600', color: '#334155' }}>No evaluation records found</span>
                        <p style={{ margin: '6px 0 0 0', fontSize: '13px', color: '#64748b' }}>
                          {searchTerm ? `No results match "${searchTerm}". Try resetting your search.` : "No evaluation records available for the selected filters."}
                        </p>
                      </td>
                    </tr>
                  ) : (
                    displayedReportData.map(report => (
                      <tr key={report.id}>
                        <td>
                          <div className="ad-facultyCell">
                            <div className="ad-facultyMonogram" title={report.faculty}>
                              {getInitials(report.faculty)}
                            </div>
                            <div className="ad-facultyInfo">
                              <span className="ad-facultyName">{report.faculty}</span>
                              <span className="ad-facultyDept">{report.department}</span>
                            </div>
                          </div>
                        </td>
                        <td className="ad-engagement">
                          <span style={{ fontWeight: 600, color: "#334155", fontSize: "13px" }}>
                            {report.department}
                          </span>
                        </td>
                        <td className="ad-engagement">
                          <div className="ad-subjectChipsWrap">
                            {report.subjectList && report.subjectList.length > 0 ? (
                              report.subjectList.map((code, idx) => (
                                <span key={idx} className="ad-subjectChip">
                                  {code}
                                </span>
                              ))
                            ) : (
                              <span style={{ color: "#9ca3af" }}>—</span>
                            )}
                          </div>
                        </td>
                        <td className="ad-engagement">
                          <span className="ad-sectionBadge" title={report.sectionsList}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
                            </svg>
                            {report.sectionsCount} {report.sectionsCount === 1 ? "Section" : "Sections"}
                          </span>
                        </td>
                        <td className="ad-engagement" style={{ textAlign: "center", fontWeight: 600 }}>
                          {report.students}
                        </td>
                        <td className="ad-engagement" style={{ textAlign: "center", fontWeight: 600 }}>
                          {report.formCount}
                        </td>
                        <td className="ad-engagement">
                          {report.rating !== "—" ? (
                            <div className="ad-ratingBlock">
                              <div className="ad-ratingNumRow">
                                <span
                                  className="ad-ratingNum"
                                  style={{ color: getPerformanceColor(report.rating) }}
                                >
                                  {report.rating}
                                </span>
                                <span className="ad-ratingMax">/ 5.0</span>
                              </div>
                              <div className="ad-ratingMiniBar">
                                <div
                                  className="ad-ratingFillMini"
                                  style={{
                                    width: `${Math.min(100, (parseFloat(report.rating) / 5) * 100)}%`,
                                    backgroundColor: getPerformanceColor(report.rating),
                                  }}
                                />
                              </div>
                            </div>
                          ) : (
                            <span style={{ color: "#9ca3af", fontSize: "12px" }}>No data</span>
                          )}
                        </td>
                        <td className="ad-tableActions" style={{ justifyContent: 'flex-end' }}>
                          <button
                            className="ad-actionBtn ad-actionBtn--view"
                            title="View Class Section Breakdown"
                            onClick={() => setViewingReport(report)}
                          >
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
        {!loading && !scopeLoading && hasChartData && (
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
          <div className="ad-modalContent" style={{ maxWidth: "640px" }}>
            <div className="ad-modalHeader">
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <div className="ad-facultyMonogram" style={{ width: "36px", height: "36px", fontSize: "12.5px" }}>
                  {getInitials(viewingReport.faculty)}
                </div>
                <div>
                  <h3 className="ad-modalTitle" style={{ fontSize: "16px", marginBottom: "2px" }}>
                    Faculty Evaluation Report
                  </h3>
                  <div style={{ fontSize: "12.5px", color: "#64748b", fontWeight: 500 }}>
                    {viewingReport.faculty} • {viewingReport.department}
                  </div>
                </div>
              </div>
              <button className="ad-modalClose" onClick={() => setViewingReport(null)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div className="ad-modalBody">
              {/* Institutional Score Hero */}
              <div className={`ad-modalScoreHero ${getHeroTierClass(viewingReport.rating)}`}>
                <div className="ad-modalScoreHeroTitle">
                  Consolidated Overall Rating
                </div>
                <div className="ad-modalScoreValue" style={{ color: getPerformanceColor(viewingReport.rating) }}>
                  {viewingReport.rating !== "—" ? viewingReport.rating : "—"}
                </div>
                {viewingReport.rating !== "—" ? (
                  <div
                    className="ad-modalScoreTier"
                    style={{
                      background: getPerformanceColor(viewingReport.rating),
                      color: "#ffffff",
                    }}
                  >
                    {getPerformanceLabel(viewingReport.rating)}
                  </div>
                ) : (
                  <div className="ad-modalScoreTier" style={{ background: "#9ca3af", color: "#ffffff" }}>
                    No Evaluations Yet
                  </div>
                )}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "14px" }}>
                <div style={{ padding: "10px 12px", background: "#f8fafc", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "3px" }}>Students Participated</div>
                  <div style={{ fontSize: "16px", fontWeight: 800, color: "#0f172a" }}>{viewingReport.students} unique</div>
                </div>
                <div style={{ padding: "10px 12px", background: "#f8fafc", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "3px" }}>Total Forms Submitted</div>
                  <div style={{ fontSize: "16px", fontWeight: 800, color: "#0f172a" }}>{viewingReport.formCount} submissions</div>
                </div>
              </div>

              <div className="ad-formGroup" style={{ marginBottom: "10px" }}>
                <label className="ad-label" style={{ marginBottom: "3px", fontSize: "11.5px" }}>Assigned Subjects</label>
                <div style={{ padding: "8px 12px", background: "#f8fafc", borderRadius: "6px", border: "1px solid #e2e8f0", fontSize: "13px", fontWeight: 500 }}>
                  {viewingReport.subjects}
                </div>
              </div>

              <div className="ad-formGroup" style={{ marginBottom: "16px" }}>
                <label className="ad-label" style={{ marginBottom: "3px", fontSize: "11.5px" }}>Sections Taught</label>
                <div style={{ padding: "8px 12px", background: "#f8fafc", borderRadius: "6px", border: "1px solid #e2e8f0", fontSize: "13px", fontWeight: 500 }}>
                  {viewingReport.sectionsList}
                </div>
              </div>

              {viewingReport.sectionBreakdown && viewingReport.sectionBreakdown.length > 0 && (
                <div style={{ marginTop: "18px" }}>
                  <h4 style={{ fontSize: "11.5px", fontWeight: "700", color: "#475569", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.6px" }}>
                    Breakdown by Assigned Class Section
                  </h4>
                  <div style={{ border: "1.5px solid #e2e8f0", borderRadius: "10px", overflow: "hidden" }}>
                    <table className="ad-breakdownTable" style={{ margin: 0 }}>
                      <thead>
                        <tr>
                          <th>Subject</th>
                          <th>Section</th>
                          <th style={{ textAlign: "center" }}>Forms</th>
                          <th style={{ textAlign: "right" }}>Rating</th>
                        </tr>
                      </thead>
                      <tbody>
                        {viewingReport.sectionBreakdown.map((sec, idx) => (
                          <tr key={idx}>
                            <td>
                              <span className="ad-subjectChip" style={{ marginRight: 6 }}>{sec.subject}</span>
                              {sec.subjectName && <span style={{ fontSize: "11px", color: "#64748b" }}>{sec.subjectName}</span>}
                            </td>
                            <td>
                              <span className="ad-sectionBadge">{sec.section}</span>
                            </td>
                            <td style={{ textAlign: "center", fontWeight: 600 }}>{sec.formCount}</td>
                            <td style={{ textAlign: "right" }}>
                              {sec.rating !== "—" ? (
                                <strong style={{ color: getPerformanceColor(sec.rating), fontSize: "13.5px" }}>
                                  {sec.rating}
                                </strong>
                              ) : (
                                <span style={{ color: "#9ca3af", fontSize: "12px" }}>No data</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div style={{ marginTop: "20px", padding: "12px 16px", background: "#f8fafc", borderRadius: "8px", border: "1px solid #e2e8f0", color: "#64748b", fontSize: "12.5px", fontStyle: "italic", textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, color: "#94a3b8" }}>
                  <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
                <span>Written comments are excluded by policy (D13: statistics only). Flagged feedback is reviewed in Moderation.</span>
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
