import { useState, useEffect, useMemo } from "react";
import AdminLayout from "./AdminLayout";
import { supabase } from "../../config/supabase";
import { useAuth } from "../../context/AuthContext";
import { useScopedAdmin } from "../../hooks/useScopedAdmin";
import { useSuperScope } from "../../context/SuperScopeContext";
import { parseFunctionError } from "../../utils/audit";
import { pickActivePeriod, isPeriodActive } from "../../utils/periodStatus";
import { normalizeYear } from "../../utils/assignmentMatch";
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

const parseAiSummaryText = (text) => {
  if (!text || typeof text !== "string" || !text.trim()) {
    return { hasSummary: false, overview: "", strengths: [], recommendations: [] };
  }

  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  let curSec = "overview";
  const oLines = [];
  const strengths = [];
  const recommendations = [];

  for (const line of lines) {
    const l = line.toLowerCase();
    if (l.includes("strength")) {
      curSec = "strengths";
    } else if (l.includes("recommend") || l.includes("improve") || l.includes("actionable") || l.includes("growth")) {
      curSec = "recommendations";
    } else if (curSec === "strengths") {
      const clean = line.replace(/^[•\-\*\d\.\)]\s*/, "").trim();
      if (clean) strengths.push(clean);
    } else if (curSec === "recommendations") {
      const clean = line.replace(/^[•\-\*\d\.\)]\s*/, "").trim();
      if (clean) recommendations.push(clean);
    } else {
      oLines.push(line);
    }
  }

  const overview = oLines.length > 0 ? oLines.join(" ") : text.trim();
  return {
    hasSummary: true,
    overview,
    strengths,
    recommendations,
  };
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

const RosterIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
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
  const { isSuper, myDeptIds, myDeptNames, inScopeName, loading: scopeLoading } = useScopedAdmin();
  const { scopeDeptId, scopeDeptName } = useSuperScope();
  const canExport = userProfile?.role === "admin" || userProfile?.role === "super_admin"; // D11
  const [evaluations, setEvaluations] = useState([]);
  const [facultyUsers, setFacultyUsers] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [viewingReport, setViewingReport] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");

  const [filterAY, setFilterAY] = useState("");
  const [filterSem, setFilterSem] = useState("");
  const [filterFaculty, setFilterFaculty] = useState("");
  const [filterDept, setFilterDept] = useState("");
  const [departmentsList, setDepartmentsList] = useState([]);
  const [academicYearsList, setAcademicYearsList] = useState([]);
  const [leftChartMode, setLeftChartMode] = useState("yearLevel"); // 'yearLevel' | 'ayTrend' | 'program'
  const [leftChartOrientation, setLeftChartOrientation] = useState("horizontal"); // 'horizontal' | 'vertical'
  const [distYearFilter, setDistYearFilter] = useState("all"); // 'all' | '1' | '2' | '3' | '4'
  const [rosterTierFilter, setRosterTierFilter] = useState("all"); // 'all' | 'high' | 'mid' | 'low'
  const [selectedFacultyId, setSelectedFacultyId] = useState(null); // null = no faculty selected | facultyId
  const [activeReportTab, setActiveReportTab] = useState("analytics"); // 'analytics' | 'roster'

  const deptKey = myDeptIds.join("|");

  useEffect(() => {
    if (scopeLoading) return;
    setLoadError("");

    Promise.all([
      supabase.from('admin_evaluations_anon').select('*'),
      supabase.from('users').select('*').eq('role', 'faculty'),
      // Report assignments through the role-scoped view so this page has the
      // complete roster (including sections with no submissions) for both
      // super admins and program admins.
      supabase.from('admin_report_assignments').select('*'),
      supabase.from('academic_years').select('*, departments(name)'),
      supabase.from('departments').select('*'),
      isSuper
        ? supabase.from('evaluations').select('id, faculty_id, assignment_id, student_id, academic_year, semester, ratings, comment, submitted_at, moderation_status, is_priority')
        : Promise.resolve({ data: [], error: null }),
    ])
      .then(([evalsRes, facultyRes, assignRes, yearsRes, deptsRes, superEvalsRes]) => {
        const failedQuery = [facultyRes, assignRes, yearsRes, deptsRes]
          .find((result) => result?.error);
        if (failedQuery?.error) throw failedQuery.error;
        if (evalsRes?.error && (!isSuper || superEvalsRes?.error || !superEvalsRes?.data)) {
          throw evalsRes.error;
        }

        const baseEvals = evalsRes.data || [];
        const fallbackEvals = (isSuper && (!baseEvals || baseEvals.length === 0) && superEvalsRes?.data && superEvalsRes.data.length > 0)
          ? superEvalsRes.data.map((e) => ({
            ...e,
            student_token: e.student_id ? `anon_${e.student_id}` : e.id,
            submitted_on: e.submitted_at ? String(e.submitted_at).slice(0, 10) : null,
          }))
          : baseEvals;

        const evals = fallbackEvals.map(e => ({
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
        const assignmentMap = new Map((assignRes.data || []).map(a => [`${a.id}|${a.faculty_id}`, {
          ...a,
          facultyId: a.faculty_id,
          facultyName: a.faculty_name,
          subjectCode: a.subject_code,
          subjectName: a.subject_name,
          yearLevel: a.year_level,
          academicYear: a.academic_year,
        }]));

        // The evaluation view carries safe assignment labels so reports still
        // work when assignment-table RLS hides rows from this client. Keep a
        // historical entry per evaluated faculty in case the assignment was
        // later moved to someone else.
        evals.forEach((evaluation) => {
          if (!evaluation.assignmentId || !(
            evaluation.assignment_subject_code || evaluation.assignment_subject_name
            || evaluation.assignment_year_level || evaluation.assignment_section
          )) return;

          const key = `${evaluation.assignmentId}|${evaluation.facultyId}`;
          const existing = assignmentMap.get(key) || {};
          assignmentMap.set(key, {
            ...existing,
            id: evaluation.assignmentId,
            facultyId: evaluation.facultyId,
            facultyName: existing.facultyName || "",
            subjectCode: evaluation.assignment_subject_code || existing.subjectCode || "",
            subjectName: evaluation.assignment_subject_name || existing.subjectName || "",
            department: evaluation.assignment_department || existing.department || "",
            department_id: evaluation.assignment_department_id || existing.department_id || null,
            yearLevel: evaluation.assignment_year_level || existing.yearLevel || "",
            section: evaluation.assignment_section || existing.section || "",
            academicYear: evaluation.academicYear || existing.academicYear || "",
            semester: evaluation.semester || existing.semester || "",
          });
        });
        const assign = Array.from(assignmentMap.values());
        const years = yearsRes.data || [];
        const depts = deptsRes.data || [];

        const inScopePeriod = (r) => (isSuper && !scopeDeptId)
          || !r.department_id
          || (myDeptIds && myDeptIds.includes(r.department_id))
          || (scopeDeptId && r.department_id === scopeDeptId);
        const scopedYears = (isSuper && !scopeDeptId) ? years : years.filter(inScopePeriod);

        setEvaluations(evals);
        setFacultyUsers(faculty);
        setAssignments(assign);
        setDepartmentsList(depts);
        setAcademicYearsList(scopedYears);

        const targetDept = myDeptNames?.[0] || filterDept;
        let active = pickActivePeriod(scopedYears, targetDept);

        if (evals.length > 0) {
          const hasEvalsInActive = active && evals.some(e =>
            String(e.academicYear || "").trim().toLowerCase() === String(active.year || "").trim().toLowerCase() &&
            String(e.semester || "").trim().toLowerCase() === String(active.semester || "").trim().toLowerCase()
          );
          if (!hasEvalsInActive) {
            const evalAY = scopedYears.find(y =>
              String(y.year || "").trim().toLowerCase() === String(evals[0].academicYear || "").trim().toLowerCase() &&
              String(y.semester || "").trim().toLowerCase() === String(evals[0].semester || "").trim().toLowerCase()
            );
            active = evalAY || { year: evals[0].academicYear, semester: evals[0].semester };
          }
        }

        if (active) {
          setFilterAY(active.year);
          setFilterSem(active.semester);
        } else {
          setFilterAY("");
          setFilterSem("");
        }
      })
      .catch(err => {
        console.error("Report fetch error:", err);
        setLoadError(err?.message || "The evaluation report could not be loaded.");
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeLoading, isSuper, deptKey, scopeDeptId]);

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
      const active = pickActivePeriod(academicYearsList, hit.name);
      if (active) {
        setFilterAY(active.year);
        setFilterSem(active.semester);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeLoading, isSuper, departmentsList, scopeDeptId, scopeDeptName, academicYearsList]);

  // Registered period keys from academic_years (filters out deleted/orphaned periods)
  const registeredAYs = useMemo(() => new Set(academicYearsList.map(y => y.year)), [academicYearsList]);
  const registeredPeriods = useMemo(() => new Set(academicYearsList.map(y => `${y.year}___${y.semester}`)), [academicYearsList]);

  // Only show registered academic years and semesters in dropdowns
  const uniqueAYs = [...registeredAYs].sort().reverse();
  const uniqueSems = [...new Set(academicYearsList.map(y => y.semester).filter(Boolean))].sort();

  // Auto-reset filterAY if current selection was deleted from academicYearsList
  useEffect(() => {
    if (uniqueAYs.length > 0) {
      if (filterAY && !registeredAYs.has(filterAY)) {
        setFilterAY(uniqueAYs[0] || "");
      }
    } else if (filterAY) {
      setFilterAY("");
    }
  }, [uniqueAYs, filterAY, registeredAYs]);

  const normAYKey = (y, s) => `${String(y || "").trim().toLowerCase()}___${String(s || "").trim().toLowerCase().replace(/semester/g, "").replace(/[^a-z0-9]/g, "")}`;
  const registeredPeriodsNorm = useMemo(() => new Set(academicYearsList.map(y => normAYKey(y.year, y.semester))), [academicYearsList]);

  const periodEvals = evaluations
    .filter(e => registeredPeriods.has(`${e.academicYear}___${e.semester}`) || registeredPeriodsNorm.has(normAYKey(e.academicYear, e.semester)))
    .filter(e => {
      if (filterAY && String(e.academicYear || "").trim().toLowerCase() !== String(filterAY || "").trim().toLowerCase()) return false;
      if (!filterSem) return true;
      const eSem = String(e.semester || "").trim().toLowerCase();
      const fSem = String(filterSem || "").trim().toLowerCase();
      return eSem === fSem || eSem.includes(fSem) || fSem.includes(eSem);
    });
  const evaluatedAssignmentIds = new Set(periodEvals.map((evaluation) => evaluation.assignmentId).filter(Boolean));

  // Strip orphaned data from period calculations, while retaining assignment
  // records directly referenced by evaluations in the selected period.
  const periodAssignments = assignments
    .filter(a => registeredPeriods.has(`${a.academicYear}___${a.semester}`) || registeredPeriodsNorm.has(normAYKey(a.academicYear, a.semester)) || evaluatedAssignmentIds.has(a.id))
    .filter(a => evaluatedAssignmentIds.has(a.id) || !filterAY || String(a.academicYear || "").trim().toLowerCase() === String(filterAY || "").trim().toLowerCase())
    .filter(a => {
      if (evaluatedAssignmentIds.has(a.id) || !filterSem) return true;
      const aSem = String(a.semester || "").trim().toLowerCase();
      const fSem = String(filterSem || "").trim().toLowerCase();
      return aSem === fSem || aSem.includes(fSem) || fSem.includes(aSem);
    });

  // Department labels on faculty profiles can be stale or empty. Assignment
  // department data is the reliable fallback, especially for super admins.
  const facultyHasDepartmentAssignment = (faculty, departmentName) => {
    const department = departmentsList.find((d) => sameDept(d.name, departmentName));
    return assignments.some((assignment) => assignment.facultyId === faculty.id && (
      sameDept(assignment.department, departmentName)
      || (department?.id && assignment.department_id === department.id)
    ));
  };

  // Lookup map for assignments
  const assignMap = new Map(assignments.map(a => [a.id, a]));

  // Consolidated Overall Data: Aggregated across all assigned sections per faculty
  const inScopeFaculty = facultyUsers
    .filter(f => !filterFaculty || f.id === filterFaculty)
    .filter(f => !filterDept || sameDept(f.department, filterDept) || facultyHasDepartmentAssignment(f, filterDept))
    .filter(f => isSuper || inScopeName(f.department) || myDeptNames.some((name) => facultyHasDepartmentAssignment(f, name)));

  const consolidatedData = inScopeFaculty
    .map(faculty => {
      const facEvals = periodEvals.filter(e => e.facultyId === faculty.id);
      const facultyEvalAssignmentIds = new Set(facEvals.map((evaluation) => evaluation.assignmentId).filter(Boolean));
      // Use the assignment IDs recorded on evaluations as historical truth.
      // A class assignment may later be reassigned to another faculty member.
      const facAssignments = periodAssignments.filter(a =>
        a.facultyId === faculty.id || facultyEvalAssignmentIds.has(a.id)
      );

      const subjects = [...new Set(facAssignments.map(a => a.subjectCode || a.subjectName).filter(Boolean))];
      const sections = [...new Set(facAssignments.map(a => a.yearLevel && a.section ? `${a.yearLevel} - ${a.section}` : a.section).filter(Boolean))];

      const uniqueStudents = new Set(facEvals.map(e => e.studentId)).size;
      const allScores = facEvals.flatMap(e => Object.values(e.ratings || {}).map(Number));

      const sectionBreakdown = facAssignments.map(assign => {
        const assignSec = assign.yearLevel && assign.section ? `${assign.yearLevel} - ${assign.section}` : assign.section || "—";
        const aEvals = facEvals.filter(e => {
          if (e.assignmentId === assign.id) return true;
          const evAssign = periodAssignments.find(a => a.id === e.assignmentId);
          if (!evAssign) return false;
          const evSec = evAssign.yearLevel && evAssign.section ? `${evAssign.yearLevel} - ${evAssign.section}` : evAssign.section || "—";
          return evAssign.facultyId === faculty.id && evSec === assignSec;
        });
        const aScores = aEvals.flatMap(e => Object.values(e.ratings || {}).map(Number));
        return {
          assignmentId: assign.id,
          subject: assign.subjectCode || assign.subjectName || "—",
          subjectName: assign.subjectName || "",
          section: assignSec,
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
        comments: facEvals
          .filter(e => e.comment && e.comment.trim().length > 0)
          .filter(e => e.moderation_status === "allow")
          .map(e => {
            const assign = assignMap.get(e.assignmentId);
            return {
              id: e.id,
              comment: e.comment.trim(),
              subject: e.assignment_subject_code || assign?.subjectCode || assign?.subjectName || "",
              date: e.submitted_on || "",
              moderationStatus: e.moderation_status || "allow",
            };
          }),
        isConsolidated: true,
      };
    })
    .filter(r => r.formCount > 0 || r.sectionsCount > 0);

  const reportData = consolidatedData;

  const selectedReport = consolidatedData.find(f => f.id === selectedFacultyId) || null;

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
    const active = academicYearsList.find(y => isPeriodActive(y)) || academicYearsList[0];
    if (active) {
      setFilterAY(active.year);
      setFilterSem(active.semester);
    } else {
      setFilterAY("");
      setFilterSem("");
    }
  };

  // Filter table by live search query and tier filter
  const displayedReportData = reportData.filter(item => {
    if (rosterTierFilter === "high") {
      const r = parseFloat(item.rating);
      if (isNaN(r) || r < 4.0) return false;
    } else if (rosterTierFilter === "mid") {
      const r = parseFloat(item.rating);
      if (isNaN(r) || r < 3.0 || r >= 4.0) return false;
    } else if (rosterTierFilter === "low") {
      const r = parseFloat(item.rating);
      if (isNaN(r) || r >= 3.0) return false;
    }

    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase().trim();
    const nameMatch = (item.faculty || "").toLowerCase().includes(term);
    const deptMatch = (item.department || "").toLowerCase().includes(term);
    const subjMatch = (item.subjects || item.subject || "").toLowerCase().includes(term);
    const secMatch = (item.sectionsList || item.section || "").toLowerCase().includes(term);
    return nameMatch || deptMatch || subjMatch || secMatch;
  });



  // 1. Year Level Performance Data (1st, 2nd, 3rd, 4th Year)
  const yearLevelOrder = [
    { key: "1", label: "1st Year" },
    { key: "2", label: "2nd Year" },
    { key: "3", label: "3rd Year" },
    { key: "4", label: "4th Year" },
  ];
  const yearLevelStats = {
    "1": { label: "1st Year", total: 0, count: 0 },
    "2": { label: "2nd Year", total: 0, count: 0 },
    "3": { label: "3rd Year", total: 0, count: 0 },
    "4": { label: "4th Year", total: 0, count: 0 },
  };

  periodEvals.forEach(e => {
    const a = assignMap.get(e.assignmentId);
    if (!a) return;
    if (filterDept && !sameDept(a.department, filterDept)) return;
    if (!isSuper && !inScopeName(a.department)) return;

    const yNorm = normalizeYear(a.yearLevel);
    if (!yearLevelStats[yNorm]) return;

    const scores = Object.values(e.ratings || {}).map(Number).filter(n => !isNaN(n));
    if (scores.length > 0) {
      const avgScore = scores.reduce((s, c) => s + c, 0) / scores.length;
      yearLevelStats[yNorm].total += avgScore;
      yearLevelStats[yNorm].count++;
    }
  });

  const hasAnyYearResponses = yearLevelOrder.some(y => yearLevelStats[y.key].count > 0);
  const yearLevelData = yearLevelOrder
    .filter(y => !hasAnyYearResponses || yearLevelStats[y.key].count > 0)
    .map(y => {
      const stat = yearLevelStats[y.key];
      return {
        name: stat.label,
        avg: stat.count > 0 ? parseFloat((stat.total / stat.count).toFixed(2)) : 0,
        responses: stat.count,
      };
    });

  // 2. Academic Year Trend Data (semester-by-semester evolution)
  const ayMap = {};
  evaluations.forEach(e => {
    const a = assignMap.get(e.assignmentId);
    if (a && filterDept && !sameDept(a.department, filterDept)) return;
    if (a && !isSuper && !inScopeName(a.department)) return;
    if (!registeredPeriods.has(`${e.academicYear}___${e.semester}`)) return;

    const shortSem = (e.semester || "").toLowerCase().includes("1st")
      ? "1st Sem"
      : (e.semester || "").toLowerCase().includes("2nd")
        ? "2nd Sem"
        : e.semester;
    const label = `${e.academicYear} (${shortSem})`;

    if (!ayMap[label]) {
      ayMap[label] = { total: 0, count: 0, ay: e.academicYear, sem: e.semester };
    }

    const scores = Object.values(e.ratings || {}).map(Number).filter(n => !isNaN(n));
    if (scores.length > 0) {
      const avgScore = scores.reduce((s, c) => s + c, 0) / scores.length;
      ayMap[label].total += avgScore;
      ayMap[label].count++;
    }
  });

  const ayTrendData = Object.entries(ayMap)
    .sort(([, aV], [, bV]) => {
      if (aV.ay !== bV.ay) return aV.ay.localeCompare(bV.ay);
      return aV.sem.localeCompare(bV.sem);
    })
    .map(([label, v]) => ({
      name: label,
      avg: parseFloat((v.total / v.count).toFixed(2)),
      responses: v.count,
    }));

  // 3. Program comparison data (for Super Admin across departments)
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
    name: deptLabel[key],
    avg: parseFloat((v.total / v.count).toFixed(2)),
    responses: v.count,
  }));

  // Active dataset for left chart based on user selection
  const activeLeftChartData =
    leftChartMode === "yearLevel"
      ? yearLevelData
      : leftChartMode === "ayTrend"
        ? ayTrendData
        : deptData;

  // 4. Rating Distribution data (interactive filter: Overall or specific Year Level)
  const tierMap = {
    "Excellent (4.0-5.0)": 0,
    "Very Good (3.5-3.9)": 0,
    "Good (3.0-3.4)": 0,
    "Needs Improvement (<3.0)": 0,
  };

  if (distYearFilter === "all") {
    reportData.forEach(r => {
      const n = parseFloat(r.rating);
      if (isNaN(n)) return;
      if (n >= 4.0) tierMap["Excellent (4.0-5.0)"]++;
      else if (n >= 3.5) tierMap["Very Good (3.5-3.9)"]++;
      else if (n >= 3.0) tierMap["Good (3.0-3.4)"]++;
      else tierMap["Needs Improvement (<3.0)"]++;
    });
  } else {
    periodEvals.forEach(e => {
      const a = assignMap.get(e.assignmentId);
      if (!a) return;
      if (filterDept && !sameDept(a.department, filterDept)) return;
      if (!isSuper && !inScopeName(a.department)) return;
      if (normalizeYear(a.yearLevel) !== distYearFilter) return;

      const scores = Object.values(e.ratings || {}).map(Number).filter(n => !isNaN(n));
      if (scores.length > 0) {
        const n = scores.reduce((s, c) => s + c, 0) / scores.length;
        if (n >= 4.0) tierMap["Excellent (4.0-5.0)"]++;
        else if (n >= 3.5) tierMap["Very Good (3.5-3.9)"]++;
        else if (n >= 3.0) tierMap["Good (3.0-3.4)"]++;
        else tierMap["Needs Improvement (<3.0)"]++;
      }
    });
  }

  const pieData = Object.entries(tierMap)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({ name, value }));

  const hasChartData = activeLeftChartData.length > 0 || pieData.length > 0 || reportData.length > 0;

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
            sectionBreakdown: localMatch?.sectionBreakdown || [],
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

      // Fetch AI summaries & allowed qualitative comments for all reporting teachers (Option A)
      const facIds = facultiesToReport.map(f => f.faculty_id);
      const [aiSumRes, anonCommRes] = await Promise.all([
        supabase
          .from("faculty_ai_summaries")
          .select("faculty_id, summary, subject_code")
          .in("faculty_id", facIds)
          .eq("academic_year", ayLabel)
          .eq("semester", semLabel),
        supabase
          .from("admin_evaluations_anon")
          .select("faculty_id, comment, ratings, submitted_on")
          .in("faculty_id", facIds)
          .eq("academic_year", ayLabel)
          .eq("semester", semLabel)
          .eq("moderation_status", "allow")
          .not("comment", "is", null),
      ]);

      const summariesByFaculty = new Map();
      (aiSumRes.data || []).forEach(s => {
        if (!summariesByFaculty.has(s.faculty_id) || !s.subject_code) {
          summariesByFaculty.set(s.faculty_id, s.summary);
        }
      });

      const commentsByFaculty = new Map();
      (anonCommRes.data || []).forEach(c => {
        const text = (c.comment || "").trim();
        if (text) {
          if (!commentsByFaculty.has(c.faculty_id)) commentsByFaculty.set(c.faculty_id, []);
          commentsByFaculty.get(c.faculty_id).push(text);
        }
      });

      // Attempt live Groq synthesis for faculty with comments who lack cached summaries
      const missingFacs = facultiesToReport.filter(f =>
        !summariesByFaculty.has(f.faculty_id) &&
        (commentsByFaculty.get(f.faculty_id) || []).length > 0
      );

      if (missingFacs.length > 0) {
        await Promise.allSettled(
          missingFacs.map(async (f) => {
            try {
              const res = await supabase.functions.invoke("summarize-comments", {
                body: {
                  faculty_id: f.faculty_id,
                  academic_year: ayLabel,
                  semester: semLabel,
                  subject_code: "",
                },
              });
              if (res.data?.summary) {
                summariesByFaculty.set(f.faculty_id, res.data.summary);
              }
            } catch {
              // Gracefully continue if period not released or network issue
            }
          })
        );
      }

      // Build Faculty Evaluation Dossiers (Option A + Comments all together under each teacher)
      const facultyDossiersHtml = facultiesToReport.map((f, i) => {
        const ratingNum = f.average_rating === null ? null : Number(f.average_rating);
        const ratingStr = ratingNum !== null ? ratingNum.toFixed(2) : "—";
        const classification = f.performance_label || (ratingNum !== null ? getPerformanceLabel(ratingNum) : "—");

        const rawAiSummary = summariesByFaculty.get(f.faculty_id) || "";
        const aiParsed = parseAiSummaryText(rawAiSummary);

        const rawComments = commentsByFaculty.get(f.faculty_id) || [];
        const distinctQuotes = Array.from(new Set(rawComments)).slice(0, 8);

        const sectionRowsHtml = (f.sectionBreakdown || []).map((sec, sIdx) => `
          <tr style="background: ${sIdx % 2 === 0 ? '#ffffff' : '#f8fafc'};">
            <td style="padding: 6px 10px; font-weight: 700; color: #1e293b;">
              <span style="font-family: monospace; font-size: 10px; background: #e0e7ff; color: #3730a3; padding: 2px 5px; border-radius: 4px; margin-right: 5px;">
                ${escapeHtml(sec.subject || "")}
              </span>
              ${escapeHtml(sec.subjectName || "")}
            </td>
            <td style="padding: 6px 10px; font-weight: 600; color: #334155;">
              ${escapeHtml(sec.section || "—")}
            </td>
            <td style="padding: 6px 10px; text-align: center; font-weight: 700; color: #0f172a;">
              ${sec.formCount || 0}
            </td>
            <td style="padding: 6px 10px; text-align: right; font-weight: 800; color: ${getPerformanceColor(sec.rating)};">
              ${sec.rating !== "—" ? `${sec.rating} / 5.0` : "—"}
            </td>
          </tr>
        `).join("");

        const quotesHtml = distinctQuotes.length > 0 ? distinctQuotes.map(q => `
          <div style="background: #f8fafc; border-left: 3.5px solid #2563eb; border-radius: 0 6px 6px 0; padding: 8px 12px; margin-bottom: 6px; font-size: 10.5px; color: #334155; font-style: italic; line-height: 1.45;">
            “${escapeHtml(q)}”
          </div>
        `).join("") : `
          <div style="color: #94a3b8; font-style: italic; font-size: 10.5px; padding: 4px 0;">
            No qualitative comments submitted for this evaluation period.
          </div>
        `;

        const aiBoxHtml = aiParsed.hasSummary ? `
          <!-- Option A: Real Groq AI Qualitative Synthesis -->
          <div style="border: 1.5px solid #cbd5e1; border-radius: 8px; padding: 12px 14px; background: #fbfcfe; margin-bottom: 14px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <span style="font-size: 10.5px; font-weight: 800; color: #1e3a8a; text-transform: uppercase; letter-spacing: 0.5px; display: inline-flex; align-items: center; gap: 6px;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                Groq LLaMA 3 Qualitative Synthesis
              </span>
              <span style="font-size: 9px; font-weight: 800; background: #4f46e5; color: #ffffff; padding: 2px 7px; border-radius: 999px;">
                AI Synthesis &bull; Verified
              </span>
            </div>
            <div style="font-size: 11px; color: #334155; line-height: 1.5; margin-bottom: 10px;">
              ${escapeHtml(aiParsed.overview)}
            </div>

            <!-- Strengths & Recommendations Columns -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
              <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 8px 10px;">
                <div style="font-size: 9.5px; font-weight: 800; color: #15803d; text-transform: uppercase; margin-bottom: 4px;">
                  Demonstrated Strengths
                </div>
                ${aiParsed.strengths.length > 0 ? `
                  <ul style="margin: 0; padding-left: 14px; font-size: 10.5px; color: #166534; line-height: 1.4;">
                    ${aiParsed.strengths.map(s => `<li>${escapeHtml(s)}</li>`).join("")}
                  </ul>
                ` : `<div style="font-size: 10px; color: #166534; font-style: italic;">No specific strengths extracted.</div>`}
              </div>
              <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 8px 10px;">
                <div style="font-size: 9.5px; font-weight: 800; color: #b45309; text-transform: uppercase; margin-bottom: 4px;">
                  Actionable Recommendations
                </div>
                ${aiParsed.recommendations.length > 0 ? `
                  <ul style="margin: 0; padding-left: 14px; font-size: 10.5px; color: #92400e; line-height: 1.4;">
                    ${aiParsed.recommendations.map(r => `<li>${escapeHtml(r)}</li>`).join("")}
                  </ul>
                ` : `<div style="font-size: 10px; color: #92400e; font-style: italic;">No specific recommendations extracted.</div>`}
              </div>
            </div>
          </div>
        ` : distinctQuotes.length >= 2 ? `
          <div style="border: 1px dashed #cbd5e1; border-radius: 8px; padding: 10px 14px; background: #f8fafc; margin-bottom: 14px; color: #475569; font-size: 10.5px;">
            <strong style="color: #1e3a8a;">AI Qualitative Synthesis:</strong> Pending evaluation period release or Groq AI batch generation. Anonymized student feedback quotes are displayed directly below.
          </div>
        ` : `
          <div style="border: 1px dashed #e2e8f0; border-radius: 8px; padding: 10px 14px; background: #f8fafc; margin-bottom: 14px; color: #64748b; font-size: 10.5px;">
            <strong style="color: #475569;">AI Qualitative Synthesis:</strong> Insufficient qualitative student comments submitted for this evaluation period to produce an AI synthesis.
          </div>
        `;

        return `
          <div class="faculty-dossier" style="page-break-inside: avoid; border: 1.5px solid #cbd5e1; border-radius: 10px; padding: 16px 18px; margin-bottom: 22px; background: #ffffff;">
            <!-- Faculty Header -->
            <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px; margin-bottom: 12px;">
              <div>
                <div style="font-size: 9.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.8px; color: #64748b; margin-bottom: 2px;">
                  FACULTY PERFORMANCE DOSSIER &bull; #${i + 1}
                </div>
                <h3 style="font-size: 17px; font-weight: 900; color: #0f172a; margin: 0 0 4px 0; letter-spacing: -0.3px;">
                  ${escapeHtml(f.faculty_name)}
                </h3>
                <div style="font-size: 11px; font-weight: 600; color: #475569; display: flex; gap: 8px; align-items: center;">
                  <span>${escapeHtml(f.department || "Academic Program")}</span>
                  <span style="color: #cbd5e1;">&bull;</span>
                  <span>${f.forms_received || 0} Submissions</span>
                  <span style="color: #cbd5e1;">&bull;</span>
                  <span>${f.sectionsCount || 0} Class Sections</span>
                </div>
              </div>
              <div style="text-align: right;">
                <div style="font-size: 24px; font-weight: 900; color: ${ratingColor(ratingNum)}; line-height: 1;">
                  ${ratingStr} <span style="font-size: 11px; font-weight: 700; color: #94a3b8;">/ 5.00</span>
                </div>
                <div style="margin-top: 4px;">
                  <span class="classification-badge" style="background:${ratingBg(ratingNum)};border:1px solid ${ratingBorder(ratingNum)};color:${ratingColor(ratingNum)};">
                    ${escapeHtml(classification)}
                  </span>
                </div>
              </div>
            </div>

            <!-- Subject / Section Breakdown Table (if available) -->
            ${(f.sectionBreakdown && f.sectionBreakdown.length > 0) ? `
              <div style="margin-bottom: 14px;">
                <div style="font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; color: #1e3a8a; margin-bottom: 6px;">
                  Assigned Classes & Section Ratings
                </div>
                <table style="width: 100%; border-collapse: collapse; font-size: 10px; border: 1px solid #e2e8f0; margin-bottom: 0;">
                  <thead>
                    <tr style="background: #0f172a; color: #fff;">
                      <th style="padding: 6px 10px; text-align: left; font-size: 9px; font-weight: 700;">Subject / Course</th>
                      <th style="padding: 6px 10px; text-align: left; font-size: 9px; font-weight: 700;">Section</th>
                      <th style="padding: 6px 10px; text-align: center; font-size: 9px; font-weight: 700;">Evaluations</th>
                      <th style="padding: 6px 10px; text-align: right; font-size: 9px; font-weight: 700;">Class Rating</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${sectionRowsHtml}
                  </tbody>
                </table>
              </div>
            ` : ""}

            ${aiBoxHtml}

            <!-- Student Feedback Highlights All Together Under This Teacher -->
            <div>
              <div style="font-size: 10px; font-weight: 800; color: #1e293b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">
                Student Feedback Highlights (${distinctQuotes.length} Quotes &bull; Anonymized)
              </div>
              ${quotesHtml}
            </div>
          </div>
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
            <span><strong>Compliance:</strong> Statistical Aggregation</span>
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

          <!-- Comprehensive Faculty Evaluation Dossiers (Option A + Comments all together under teacher) -->
          <div class="page-break" style="page-break-before: always; margin-top: 28px; padding-top: 18px; border-top: 2px dashed #cbd5e1;">
            <div class="table-section-title" style="margin-bottom: 14px;">
              <span>Faculty Performance Dossiers & Qualitative Feedback</span>
              <span style="font-size: 10px; color: #64748b; font-weight: 600; text-transform: none;">
                Option A: Groq AI Qualitative Synthesis & Anonymized Student Comments
              </span>
            </div>
            ${facultyDossiersHtml}
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
            Official Academic Record Notice: This document is generated directly from FacultyTrack evaluation records. In strict compliance with institutional student anonymity policy, all student identities and tokens are completely protected. Qualitative student comments are screened through content moderation filters and synthesized via Groq LLaMA 3 AI. Server audit log action: report.export.
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

  // ── Individual Faculty Report Export (PDF + AI Synthesis & Comments) ──
  const [exportingFacultyPdf, setExportingFacultyPdf] = useState(false);

  const handleExportIndividualFacultyPDF = async (targetReport) => {
    if (!targetReport) return;
    const ayLabel = filterAY || targetReport.academic_year || "Current Period";
    const semLabel = filterSem || targetReport.semester || "";

    const win = window.open("", "_blank");
    if (!win) {
      alert("Popup blocked. Please allow popups for this site to export the PDF.");
      return;
    }

    win.document.open();
    win.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Generating Faculty Report (PDF)...</title>
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
          <h2>Generating Faculty Performance Evaluation Report</h2>
          <p>Compiling quantitative scores, AI qualitative synthesis, and student feedback quotes...</p>
        </body>
      </html>
    `);
    win.document.close();

    setExportingFacultyPdf(true);
    try {
      // 1. Fetch AI Summary & Comments in parallel
      const [sumRes, commRes] = await Promise.all([
        supabase.functions.invoke("summarize-comments", {
          body: {
            faculty_id: targetReport.facultyId,
            academic_year: ayLabel,
            semester: semLabel,
            subject_code: "",
          },
        }).catch(() => ({ data: null })),
        supabase
          .from("admin_evaluations_anon")
          .select("comment, ratings, submitted_on")
          .eq("faculty_id", targetReport.facultyId)
          .eq("academic_year", ayLabel)
          .eq("semester", semLabel)
          .eq("moderation_status", "allow")
          .not("comment", "is", null),
      ]);

      const now = new Date().toLocaleDateString("en-PH", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

      const summaryData = sumRes.data;
      const rawComments = (commRes.data || [])
        .map(r => (r.comment || "").trim())
        .filter(c => c.length > 0);

      // Clean, filter, and pick top 4-6 representative quotes
      const distinctQuotes = Array.from(new Set(rawComments)).slice(0, 6);

      const ratingNum = targetReport.rating !== "—" ? Number(targetReport.rating) : null;
      const ratingColor = ratingNum ? getPerformanceColor(ratingNum) : "#64748b";
      const ratingClassLabel = ratingNum ? getPerformanceLabel(ratingNum) : "Unclassified";

      const aiParsed = parseAiSummaryText(summaryData?.summary || "");
      const overviewText = aiParsed.overview;
      const strengthsList = aiParsed.strengths;
      const recommendationsList = aiParsed.recommendations;

      const sectionRows = (targetReport.sectionBreakdown || []).map((sec, i) => `
        <tr style="background: ${i % 2 === 0 ? '#ffffff' : '#f8fafc'};">
          <td style="padding: 8px 12px; font-weight: 700; color: #1e293b;">
            <span style="font-family: monospace; font-size: 11px; background: #e0e7ff; color: #3730a3; padding: 2px 6px; border-radius: 4px; margin-right: 6px;">
              ${escapeHtml(sec.subject)}
            </span>
            ${sec.subjectName ? escapeHtml(sec.subjectName) : ""}
          </td>
          <td style="padding: 8px 12px; font-weight: 600; color: #334155;">
            ${escapeHtml(sec.section)}
          </td>
          <td style="padding: 8px 12px; text-align: center; font-weight: 700; color: #0f172a;">
            ${sec.formCount}
          </td>
          <td style="padding: 8px 12px; text-align: right; font-weight: 800; color: ${getPerformanceColor(sec.rating)};">
            ${sec.rating !== "—" ? `${sec.rating} / 5.0` : "—"}
          </td>
        </tr>
      `).join("");

      const quotesHtml = distinctQuotes.length > 0 ? distinctQuotes.map(q => `
        <div style="background: #f8fafc; border-left: 3px solid #2563eb; border-radius: 0 8px 8px 0; padding: 10px 14px; margin-bottom: 8px; font-size: 11px; color: #334155; font-style: italic; line-height: 1.5;">
          “${escapeHtml(q)}”
        </div>
      `).join("") : `<div style="color: #94a3b8; font-style: italic; font-size: 11px; padding: 8px;">No qualitative feedback comments recorded for this period.</div>`;

      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8"/>
          <title>Individual Faculty Evaluation Report — ${escapeHtml(targetReport.faculty)}</title>
          <style>
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
              color: #0f172a;
              font-size: 11px;
              line-height: 1.45;
              background: #ffffff;
              padding: 24px 30px;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            @page { size: portrait; margin: 10mm 12mm; }
            @media print {
              body { padding: 0; }
              .no-print { display: none !important; }
            }
            .no-print-bar {
              background: #0f172a; color: #fff; padding: 10px 18px; display: flex; justify-content: space-between; align-items: center; border-radius: 8px; margin-bottom: 18px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            }
            .inst-header { text-align: center; padding-bottom: 12px; border-bottom: 2.5px solid #1e3a8a; margin-bottom: 14px; }
            .inst-pretitle { font-size: 10px; font-weight: 800; letter-spacing: 1.2px; text-transform: uppercase; color: #475569; margin-bottom: 3px; }
            .inst-title { font-size: 19px; font-weight: 900; color: #1e3a8a; letter-spacing: -0.4px; margin-bottom: 4px; }
            .inst-subtitle { font-size: 11.5px; font-weight: 600; color: #334155; margin-bottom: 8px; }
            .inst-tags { display: flex; justify-content: center; flex-wrap: wrap; gap: 6px; }
            .tag { display: inline-block; padding: 3px 9px; background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 10.5px; color: #1e293b; }
            
            .hero-card { display: flex; justify-content: space-between; align-items: center; background: #f8fafc; border: 1.5px solid #e2e8f0; border-radius: 10px; padding: 14px 20px; margin-bottom: 14px; }
            .hero-score { font-size: 30px; font-weight: 900; line-height: 1; }
            .hero-badge { display: inline-block; padding: 5px 14px; border-radius: 999px; color: #fff; font-weight: 800; font-size: 12px; letter-spacing: 0.3px; }
            
            .meta-tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 14px; }
            .meta-tile { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 12px; }
            .meta-tile-label { font-size: 9px; font-weight: 800; text-transform: uppercase; color: #64748b; margin-bottom: 2px; }
            .meta-tile-val { font-size: 13.5px; font-weight: 800; color: #0f172a; }

            .section-title { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.6px; color: #1e3a8a; margin: 14px 0 8px; display: flex; align-items: center; gap: 6px; }
            table { width: 100%; border-collapse: collapse; font-size: 10.5px; margin-bottom: 14px; }
            th { background: #0f172a; color: #ffffff; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; padding: 8px 12px; text-align: left; }
            td { border: 1px solid #e2e8f0; }

            .ai-box { border: 1.5px solid #cbd5e1; border-radius: 10px; padding: 14px; margin-bottom: 14px; background: #ffffff; }
            .ai-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
            .ai-badge { background: #4f46e5; color: #ffffff; font-size: 9.5px; font-weight: 800; padding: 3px 8px; border-radius: 999px; letter-spacing: 0.5px; }

            .strength-box { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 10px 14px; margin-bottom: 10px; }
            .rec-box { background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 10px 14px; margin-bottom: 10px; }
            
            .sig-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-top: 18px; padding-top: 12px; border-top: 1px solid #e2e8f0; }
            .sig-card { text-align: center; }
            .sig-space { height: 40px; border-bottom: 1px solid #0f172a; margin-bottom: 6px; }
            .sig-name { font-weight: 800; font-size: 10.5px; color: #0f172a; }
            .sig-role { font-size: 9.5px; color: #64748b; }
          </style>
        </head>
        <body>
          <div class="no-print no-print-bar">
            <span style="font-weight: 700; font-size: 13px;">FacultyTrack &bull; Individual Faculty Evaluation Report</span>
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
            <h1 class="inst-title">INDIVIDUAL FACULTY PERFORMANCE EVALUATION REPORT</h1>
            <div class="inst-subtitle">Comprehensive Performance Classification, Quantitative Metrics & Qualitative AI Synthesis</div>
            <div class="inst-tags">
              <span class="tag">Faculty: <strong>${escapeHtml(targetReport.faculty)}</strong></span>
              <span class="tag">Department / Program: <strong>${escapeHtml(targetReport.department)}</strong></span>
              <span class="tag">Academic Year: <strong>${escapeHtml(ayLabel)}</strong></span>
              <span class="tag">Semester: <strong>${escapeHtml(semLabel)}</strong></span>
            </div>
          </div>

          <!-- Hero Scorecard -->
          <div class="hero-card">
            <div>
              <div style="font-size: 10px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">Consolidated Overall Rating</div>
              <div style="display: flex; align-items: baseline; gap: 6px; margin-top: 3px;">
                <span class="hero-score" style="color: ${ratingColor};">${targetReport.rating !== "—" ? targetReport.rating : "—"}</span>
                <span style="font-size: 13px; font-weight: 700; color: #64748b;">/ 5.00</span>
              </div>
            </div>
            <div>
              <span class="hero-badge" style="background: ${ratingColor};">
                ${escapeHtml(ratingClassLabel)}
              </span>
            </div>
          </div>

          <!-- Meta Tiles -->
          <div class="meta-tiles">
            <div class="meta-tile">
              <div class="meta-tile-label">Students Participated</div>
              <div class="meta-tile-val">${targetReport.students} unique</div>
            </div>
            <div class="meta-tile">
              <div class="meta-tile-label">Submissions Received</div>
              <div class="meta-tile-val">${targetReport.formCount} forms</div>
            </div>
            <div class="meta-tile">
              <div class="meta-tile-label">Assigned Subjects</div>
              <div class="meta-tile-val" style="font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(targetReport.subjects)}</div>
            </div>
            <div class="meta-tile">
              <div class="meta-tile-label">Class Sections</div>
              <div class="meta-tile-val">${targetReport.sectionsCount} (${escapeHtml(targetReport.sectionsList)})</div>
            </div>
          </div>

          <!-- Section Breakdown -->
          <div class="section-title">Class Section Performance Breakdown</div>
          <table>
            <thead>
              <tr>
                <th style="width: 48%;">SUBJECT CODE &amp; TITLE</th>
                <th style="width: 20%;">SECTION</th>
                <th style="width: 16%; text-align: center;">SUBMISSIONS</th>
                <th style="width: 16%; text-align: right;">MEAN RATING</th>
              </tr>
            </thead>
            <tbody>
              ${sectionRows || '<tr><td colspan="4" style="text-align: center; padding: 12px; color: #94a3b8;">No section records.</td></tr>'}
            </tbody>
          </table>

          <!-- AI Qualitative Synthesis (Option A) -->
          ${aiParsed.hasSummary ? `
            <div class="ai-box">
              <div class="ai-header">
                <span class="ai-badge">★ GROQ LLaMA 3 QUALITATIVE SYNTHESIS</span>
                <span style="font-size: 10px; color: #64748b; font-weight: 600;">Based on Anonymized Student Submissions</span>
              </div>

              <div style="font-size: 11px; color: #334155; line-height: 1.55; margin-bottom: 12px;">
                <strong>Executive Synthesis:</strong> ${escapeHtml(overviewText)}
              </div>

              <div class="strength-box">
                <div style="font-size: 10.5px; font-weight: 800; color: #15803d; text-transform: uppercase; margin-bottom: 6px;">
                  ✓ Demonstrated Strengths:
                </div>
                ${strengthsList.length > 0 ? `
                  <ul style="padding-left: 16px; font-size: 10.5px; color: #166534; line-height: 1.5;">
                    ${strengthsList.map(s => `<li>${escapeHtml(s)}</li>`).join("")}
                  </ul>
                ` : `<div style="font-size: 10.5px; color: #166534; font-style: italic;">No specific strengths highlighted.</div>`}
              </div>

              <div class="rec-box">
                <div style="font-size: 10.5px; font-weight: 800; color: #b45309; text-transform: uppercase; margin-bottom: 6px;">
                  ➔ Actionable Recommendations:
                </div>
                ${recommendationsList.length > 0 ? `
                  <ul style="padding-left: 16px; font-size: 10.5px; color: #92400e; line-height: 1.5;">
                    ${recommendationsList.map(r => `<li>${escapeHtml(r)}</li>`).join("")}
                  </ul>
                ` : `<div style="font-size: 10.5px; color: #92400e; font-style: italic;">No specific recommendations highlighted.</div>`}
              </div>
            </div>
          ` : distinctQuotes.length >= 2 ? `
            <div style="border: 1px dashed #cbd5e1; border-radius: 8px; padding: 12px 14px; background: #f8fafc; margin-bottom: 14px; color: #475569; font-size: 11px;">
              <strong style="color: #1e3a8a;">AI Qualitative Synthesis:</strong> Pending evaluation period release / Groq AI batch generation. Anonymized student feedback quotes are displayed directly below.
            </div>
          ` : `
            <div style="border: 1px dashed #e2e8f0; border-radius: 8px; padding: 10px 14px; background: #f8fafc; margin-bottom: 14px; color: #64748b; font-size: 10.5px;">
              <strong style="color: #475569;">AI Qualitative Synthesis:</strong> Insufficient qualitative student comments submitted for this faculty member during this evaluation period to produce an AI synthesis.
            </div>
          `}

          <!-- Student Comments Annex (Option A: Highlights under teacher) -->
          <div class="section-title">Identity-Stripped Student Feedback Quotes (Anonymized)</div>
          <div style="margin-bottom: 14px;">
            ${quotesHtml}
          </div>

          <!-- Signatures -->
          <div class="sig-grid">
            <div class="sig-card">
              <div class="sig-space"></div>
              <div class="sig-name">${escapeHtml(userProfile?.full_name || "Evaluation Administrator")}</div>
              <div class="sig-role">Prepared by / Academic Coordinator</div>
            </div>
            <div class="sig-card">
              <div class="sig-space"></div>
              <div class="sig-name">Department Chairperson / Program Head</div>
              <div class="sig-role">Reviewed &amp; Verified by</div>
            </div>
            <div class="sig-card">
              <div class="sig-space"></div>
              <div class="sig-name">Dean / VP Academic Affairs</div>
              <div class="sig-role">Approved by</div>
            </div>
          </div>

          <div style="margin-top: 14px; font-size: 9px; color: #94a3b8; text-align: center; border-top: 1px solid #f1f5f9; padding-top: 8px;">
            FacultyTrack Academic Management & Evaluation System &bull; Generated: ${escapeHtml(now)} &bull; Student anonymity strictly guaranteed.
          </div>

          <script>
            window.onload = function() {
              setTimeout(function() {
                window.focus();
                window.print();
              }, 350);
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
      alert("Individual report export failed: " + (err.message || "unknown error"));
    } finally {
      setExportingFacultyPdf(false);
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

                </span>
              )}
            </p>
          </div>
          {canExport && (
            <button
              className="ad-btnPrimary"
              onClick={handleExportPDF}
              disabled={loading || scopeLoading || exportingPdf || !filterAY || !filterSem}
              title={!filterAY || !filterSem ? "Pick a year and semester first" : "Generate official summary report (Audited)"}
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

        {loadError && (
          <div role="alert" style={{ marginBottom: 16, padding: "12px 16px", border: "1px solid #fecaca", borderRadius: 10, color: "#991b1b", background: "#fef2f2" }}>
            Could not load the complete evaluation report: {loadError}
          </div>
        )}

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
              const val = e.target.value;
              setFilterDept(val);
              setFilterFaculty(""); // Reset faculty when changing department
              const active = pickActivePeriod(academicYearsList, val);
              if (active) {
                setFilterAY(active.year);
                setFilterSem(active.semester);
              }
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

        {/* TAB WORKSTATION NAVIGATION */}
        <div className="ad-tabs" style={{ marginTop: "20px", marginBottom: "20px" }}>
          <button
            type="button"
            onClick={() => setActiveReportTab("analytics")}
            className={`ad-tab ${activeReportTab === "analytics" ? "ad-tab--active" : ""}`}
            style={{ padding: "9px 22px", fontSize: "13.5px" }}
          >
            <BarChartIcon />
            Department Analytics &amp; Trends
            <span className="ad-tabBadge">
              {hasChartData ? (leftChartMode === "yearLevel" ? "By Year" : leftChartMode === "ayTrend" ? "Trend" : "Program") : "Empty"}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setActiveReportTab("roster")}
            className={`ad-tab ${activeReportTab === "roster" ? "ad-tab--active" : ""}`}
            style={{ padding: "9px 22px", fontSize: "13.5px" }}
          >
            <RosterIcon />
            Faculty Reports
            <span className="ad-tabBadge">{consolidatedData.length}</span>
          </button>
        </div>

        {/* TAB WORKSTATION */}
        <div className="ad-splitWorkstation" style={activeReportTab === "analytics" ? { gridTemplateColumns: "minmax(0, 1fr)" } : undefined}>

          {/* TAB 2 LEFT: Faculty Directory */}
          {activeReportTab === "roster" && (
            <div className="ad-tableCard" style={{ padding: "16px", marginBottom: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <RosterIcon />
                  <h3 style={{ margin: 0, fontSize: "13.5px", fontWeight: 700, color: "#1e293b", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                    Faculty Directory
                  </h3>
                </div>
                <span style={{ fontSize: "11px", fontWeight: 700, padding: "2px 8px", background: "#e0e7ff", color: "#4338ca", borderRadius: "999px" }}>
                  {displayedReportData.length}
                </span>
              </div>

              {/* Search Input */}
              <div className="ad-searchFilterWrap" style={{ width: "100%", marginBottom: "10px" }}>
                <svg className="ad-searchFilterIcon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  type="text"
                  className="ad-searchFilterInput"
                  placeholder="Search faculty, subject..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  style={{ width: "100%", fontSize: "12px", padding: "7px 10px 7px 32px" }}
                />
              </div>

              {/* Tier Filter Pills */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "4px", background: "#f8fafc", padding: "3px", borderRadius: "8px", marginBottom: "12px" }}>
                <button
                  type="button"
                  onClick={() => setRosterTierFilter("all")}
                  style={{
                    padding: "4px 2px",
                    fontSize: "10.5px",
                    fontWeight: 700,
                    borderRadius: "6px",
                    border: "none",
                    cursor: "pointer",
                    textAlign: "center",
                    background: rosterTierFilter === "all" ? "#ffffff" : "transparent",
                    color: rosterTierFilter === "all" ? "#0f172a" : "#64748b",
                    boxShadow: rosterTierFilter === "all" ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
                  }}
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => setRosterTierFilter("high")}
                  style={{
                    padding: "4px 2px",
                    fontSize: "10.5px",
                    fontWeight: 700,
                    borderRadius: "6px",
                    border: "none",
                    cursor: "pointer",
                    textAlign: "center",
                    background: rosterTierFilter === "high" ? "#ffffff" : "transparent",
                    color: rosterTierFilter === "high" ? "#15803d" : "#64748b",
                    boxShadow: rosterTierFilter === "high" ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
                  }}
                >
                  ★ 4.0+
                </button>
                <button
                  type="button"
                  onClick={() => setRosterTierFilter("mid")}
                  style={{
                    padding: "4px 2px",
                    fontSize: "10.5px",
                    fontWeight: 700,
                    borderRadius: "6px",
                    border: "none",
                    cursor: "pointer",
                    textAlign: "center",
                    background: rosterTierFilter === "mid" ? "#ffffff" : "transparent",
                    color: rosterTierFilter === "mid" ? "#b45309" : "#64748b",
                    boxShadow: rosterTierFilter === "mid" ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
                  }}
                >
                  3.0-3.9
                </button>
                <button
                  type="button"
                  onClick={() => setRosterTierFilter("low")}
                  style={{
                    padding: "4px 2px",
                    fontSize: "10.5px",
                    fontWeight: 700,
                    borderRadius: "6px",
                    border: "none",
                    cursor: "pointer",
                    textAlign: "center",
                    background: rosterTierFilter === "low" ? "#ffffff" : "transparent",
                    color: rosterTierFilter === "low" ? "#b91c1c" : "#64748b",
                    boxShadow: rosterTierFilter === "low" ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
                  }}
                >
                  &lt;3.0
                </button>
              </div>

              {/* Scrollable Faculty Card List */}
              <div style={{ maxHeight: "calc(100vh - 300px)", overflowY: "auto", paddingRight: "4px" }}>
                {displayedReportData.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "30px 10px", color: "#94a3b8", fontSize: "12px" }}>
                    No faculty records match filters.
                  </div>
                ) : (
                  displayedReportData.map(report => {
                    const isSelected = selectedFacultyId === report.id;
                    const color = getPerformanceColor(report.rating);
                    return (
                      <div
                        key={report.id}
                        onClick={() => setSelectedFacultyId(report.id)}
                        className={`ad-facultyCardItem ${isSelected ? "ad-facultyCardItem--active" : ""}`}
                      >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", marginBottom: "6px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                            <div
                              className="ad-facultyMonogram"
                              style={{
                                width: "28px",
                                height: "28px",
                                fontSize: "11px",
                                flexShrink: 0,
                                background: isSelected ? "#1e3a8a" : undefined,
                                color: isSelected ? "#ffffff" : undefined,
                              }}
                            >
                              {getInitials(report.faculty)}
                            </div>
                            <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              <div style={{ fontSize: "12.5px", fontWeight: 700, color: isSelected ? "#1e3a8a" : "#1e293b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {report.faculty}
                              </div>
                              <div style={{ fontSize: "11px", color: "#64748b" }}>
                                {report.department}
                              </div>
                            </div>
                          </div>

                          {/* Rating pill */}
                          {report.rating !== "—" ? (
                            <div
                              style={{
                                padding: "3px 8px",
                                borderRadius: "999px",
                                fontSize: "11px",
                                fontWeight: 800,
                                background: `${color}15`,
                                color: color,
                                border: `1px solid ${color}30`,
                                flexShrink: 0,
                              }}
                            >
                              ★ {report.rating}
                            </div>
                          ) : (
                            <span style={{ fontSize: "10.5px", color: "#9ca3af", flexShrink: 0 }}>—</span>
                          )}
                        </div>

                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "11px", color: "#64748b", borderTop: "1px solid #f1f5f9", paddingTop: "6px", marginTop: "4px" }}>
                          <span>{report.sectionsCount} {report.sectionsCount === 1 ? "Section" : "Sections"} &bull; {report.students} St.</span>
                          <span style={{ fontWeight: 600, color: isSelected ? "#2563eb" : "#475569" }}>
                            {report.formCount} {report.formCount === 1 ? "form" : "forms"} &rarr;
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* RIGHT: DETAIL PANEL */}
          <div style={{ minWidth: 0 }}>
            {activeReportTab === "roster" && selectedReport ? (
              /* INDIVIDUAL FACULTY DETAIL INSPECTOR */
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                {/* Faculty Hero Card */}
                <div className="ad-tableCard" style={{ padding: "20px 24px", marginBottom: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "14px", marginBottom: "18px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                      <div className="ad-facultyMonogram" style={{ width: "48px", height: "48px", fontSize: "16px", background: "#1e3a8a", color: "#ffffff" }}>
                        {getInitials(selectedReport.faculty)}
                      </div>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 800, color: "#0f172a" }}>
                            {selectedReport.faculty}
                          </h2>
                          <span style={{ fontSize: "11px", fontWeight: 700, padding: "2px 8px", background: "#e0e7ff", color: "#4338ca", borderRadius: "999px" }}>
                            {selectedReport.department}
                          </span>
                        </div>
                        <p style={{ margin: "4px 0 0", fontSize: "12.5px", color: "#64748b" }}>
                          Faculty Performance Evaluation Breakdown &bull; {filterAY || "All AY"} {filterSem || ""}
                        </p>
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <button
                        type="button"
                        className="ad-btnPrimary"
                        disabled={exportingFacultyPdf}
                        onClick={() => handleExportIndividualFacultyPDF(selectedReport)}
                        style={{
                          padding: "6px 14px",
                          fontSize: "12px",
                          fontWeight: 700,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                        {exportingFacultyPdf ? "Exporting..." : "Export PDF"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedFacultyId(null)}
                        style={{
                          padding: "6px 12px",
                          borderRadius: "6px",
                          border: "1px solid #cbd5e1",
                          background: "#ffffff",
                          color: "#475569",
                          fontSize: "12px",
                          fontWeight: 600,
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                        }}
                      >
                        &larr; Clear Selection
                      </button>
                    </div>
                  </div>

                  {/* Score Hero Ribbon */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "16px 20px",
                      borderRadius: "12px",
                      background: selectedReport.rating !== "—" ? `${getPerformanceColor(selectedReport.rating)}10` : "#f8fafc",
                      border: `1.5px solid ${selectedReport.rating !== "—" ? getPerformanceColor(selectedReport.rating) + '35' : '#e2e8f0'}`,
                      flexWrap: "wrap",
                      gap: "14px",
                      marginBottom: "18px",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: "11px", fontWeight: 800, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.6px" }}>
                        Consolidated Faculty Rating
                      </div>
                      <div style={{ display: "flex", alignItems: "baseline", gap: "8px", marginTop: "2px" }}>
                        <span style={{ fontSize: "32px", fontWeight: 900, color: getPerformanceColor(selectedReport.rating) }}>
                          {selectedReport.rating !== "—" ? selectedReport.rating : "—"}
                        </span>
                        <span style={{ fontSize: "14px", fontWeight: 700, color: "#64748b" }}>/ 5.00</span>
                      </div>
                    </div>

                    {selectedReport.rating !== "—" ? (
                      <span
                        style={{
                          padding: "6px 16px",
                          borderRadius: "999px",
                          fontSize: "13px",
                          fontWeight: 800,
                          background: getPerformanceColor(selectedReport.rating),
                          color: "#ffffff",
                          boxShadow: "0 2px 6px rgba(0,0,0,0.12)",
                        }}
                      >
                        {getPerformanceLabel(selectedReport.rating)}
                      </span>
                    ) : (
                      <span style={{ padding: "6px 14px", borderRadius: "999px", fontSize: "12px", background: "#9ca3af", color: "#fff" }}>
                        No Submissions Yet
                      </span>
                    )}
                  </div>

                  {/* 4 Summary Stat Tiles */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "10px" }}>
                    <div style={{ padding: "10px 12px", background: "#f8fafc", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                      <div style={{ fontSize: "10.5px", fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>Students</div>
                      <div style={{ fontSize: "16px", fontWeight: 800, color: "#0f172a", marginTop: "2px" }}>{selectedReport.students} unique</div>
                    </div>
                    <div style={{ padding: "10px 12px", background: "#f8fafc", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                      <div style={{ fontSize: "10.5px", fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>Forms</div>
                      <div style={{ fontSize: "16px", fontWeight: 800, color: "#0f172a", marginTop: "2px" }}>{selectedReport.formCount} submissions</div>
                    </div>
                    <div style={{ padding: "10px 12px", background: "#f8fafc", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                      <div style={{ fontSize: "10.5px", fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>Subjects</div>
                      <div style={{ fontSize: "13px", fontWeight: 700, color: "#0f172a", marginTop: "3px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={selectedReport.subjects}>
                        {selectedReport.subjects}
                      </div>
                    </div>
                    <div style={{ padding: "10px 12px", background: "#f8fafc", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                      <div style={{ fontSize: "10.5px", fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>Sections</div>
                      <div style={{ fontSize: "13px", fontWeight: 700, color: "#0f172a", marginTop: "3px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={selectedReport.sectionsList}>
                        {selectedReport.sectionsCount} ({selectedReport.sectionsList})
                      </div>
                    </div>
                  </div>
                </div>

                {/* Section Breakdown Table */}
                <div className="ad-tableCard" style={{ padding: "20px 24px", marginBottom: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
                    <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 800, color: "#1e293b", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                      Class Section Performance Breakdown
                    </h3>
                    <span style={{ fontSize: "12px", color: "#64748b", fontWeight: 600 }}>
                      {selectedReport.sectionBreakdown?.length || 0} Assigned Section{(selectedReport.sectionBreakdown?.length || 0) === 1 ? "" : "s"}
                    </span>
                  </div>

                  {(!selectedReport.sectionBreakdown || selectedReport.sectionBreakdown.length === 0) ? (
                    <div style={{ padding: "40px 20px", textAlign: "center", color: "#94a3b8", fontSize: "13px" }}>
                      No section assignments recorded for this faculty member.
                    </div>
                  ) : (
                    <div className="ad-tableWrap" style={{ border: "1px solid #e2e8f0", borderRadius: "8px" }}>
                      <table className="ad-table" style={{ margin: 0 }}>
                        <thead>
                          <tr>
                            <th>SUBJECT CODE & NAME</th>
                            <th>SECTION</th>
                            <th style={{ textAlign: "center" }}>SUBMISSIONS</th>
                            <th style={{ textAlign: "right" }}>MEAN RATING</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedReport.sectionBreakdown.map((sec, idx) => {
                            const secRating = sec.rating;
                            const secColor = getPerformanceColor(secRating);
                            return (
                              <tr key={idx}>
                                <td>
                                  <div style={{ fontWeight: 700, color: "#1e293b" }}>{sec.subject}</div>
                                  {sec.subjectName && <div style={{ fontSize: "11px", color: "#64748b" }}>{sec.subjectName}</div>}
                                </td>
                                <td>
                                  <span className="ad-sectionBadge">{sec.section}</span>
                                </td>
                                <td style={{ textAlign: "center", fontWeight: 600 }}>
                                  {sec.formCount}
                                </td>
                                <td style={{ textAlign: "right" }}>
                                  {secRating !== "—" ? (
                                    <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end" }}>
                                      <span style={{ fontWeight: 800, color: secColor, fontSize: "13px" }}>
                                        {secRating} / 5.0
                                      </span>
                                      <div style={{ width: "70px", height: "4px", background: "#f1f5f9", borderRadius: "999px", overflow: "hidden", marginTop: "3px" }}>
                                        <div style={{ width: `${Math.min(100, (parseFloat(secRating) / 5) * 100)}%`, height: "100%", background: secColor }} />
                                      </div>
                                    </div>
                                  ) : (
                                    <span style={{ color: "#9ca3af", fontSize: "12px" }}>No data</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Qualitative Student Comments Card */}
                <div className="ad-tableCard" style={{ padding: "20px 24px", marginBottom: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px", flexWrap: "wrap", gap: "8px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 800, color: "#1e293b", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                        Student Feedback & Qualitative Comments
                      </h3>
                      <span style={{ fontSize: "11px", fontWeight: 800, padding: "2px 8px", background: "#e0e7ff", color: "#3730a3", borderRadius: "999px" }}>
                        {selectedReport.comments?.length || 0}
                      </span>
                    </div>
                    <span style={{ fontSize: "11.5px", color: "#64748b" }}>
                      Identity-stripped student feedback
                    </span>
                  </div>

                  {(!selectedReport.comments || selectedReport.comments.length === 0) ? (
                    <div style={{ padding: "30px 20px", textAlign: "center", color: "#94a3b8", fontSize: "12.5px", background: "#f8fafc", borderRadius: "8px", border: "1px dashed #cbd5e1" }}>
                      No qualitative comments submitted for this faculty member in this period.
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "10px", maxHeight: "420px", overflowY: "auto", paddingRight: "4px" }}>
                      {selectedReport.comments.map((c, cIdx) => (
                        <div
                          key={c.id || cIdx}
                          style={{
                            background: "#f8fafc",
                            border: "1px solid #e2e8f0",
                            borderLeft: "3.5px solid #2563eb",
                            borderRadius: "0 8px 8px 0",
                            padding: "12px 14px",
                          }}
                        >
                          <div style={{ fontSize: "13px", color: "#1e293b", lineHeight: "1.5", fontStyle: "italic", marginBottom: "8px" }}>
                            &ldquo;{c.comment}&rdquo;
                          </div>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "6px", fontSize: "11px", color: "#64748b" }}>
                            <span style={{ fontStyle: "italic", color: "#94a3b8" }}>Anonymous Student Feedback</span>
                            {c.date && <span>{c.date}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : activeReportTab === "analytics" ? (
              /* DEPARTMENT OVERVIEW CHARTS */
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                <div className="ad-tableCard" style={{ padding: "16px 20px", marginBottom: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 800, color: "#1e293b" }}>
                        Department Analytics & Visual Insights
                      </h3>
                      <p style={{ margin: "2px 0 0", fontSize: "12px", color: "#64748b" }}>
                        Open the Faculty Reports tab to inspect each faculty member's evaluation breakdown
                      </p>
                    </div>
                    <div style={{ fontSize: "12px", fontWeight: 700, color: "#334155", background: "#f1f5f9", padding: "4px 10px", borderRadius: "6px" }}>
                      Dept Scope Avg: <strong style={{ color: getPerformanceColor(instAvgRating) }}>{instAvgRating} / 5.0</strong>
                    </div>
                  </div>
                </div>

                {!loading && !scopeLoading && hasChartData ? (
                  <>
                    {/* 2-COLUMN ROW: The Graph (Card 1) & The Distribution (Card 2) */}
                    <div className="ad-chartsRow" style={{ marginBottom: 0 }}>
                      {/* CARD 1: Performance Breakdown Graph */}
                      <div className="ad-tableCard" style={{ marginBottom: 0, display: 'flex', flexDirection: 'column' }}>
                        <div className="ad-chartHeader" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', borderBottom: '1.5px solid #e5e7eb', flexWrap: 'wrap', gap: '8px' }}>
                          <div className="ad-chartHeaderInner" style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                            <span className="ad-chartIcon" style={{ background: '#1e3a8a', borderRadius: 8, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', flexShrink: 0 }}>
                              <BarChartIcon />
                            </span>
                            <span className="ad-chartTitle" style={{ fontWeight: 700, fontSize: 13, letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>
                              {leftChartMode === "yearLevel"
                                ? "PERFORMANCE BY YEAR LEVEL"
                                : leftChartMode === "ayTrend"
                                  ? "ACADEMIC YEAR TREND"
                                  : "PROGRAM PERFORMANCE"}
                            </span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                            {/* Orientation Switcher */}
                            <div style={{ display: 'inline-flex', border: '1px solid #cbd5e1', borderRadius: 6, overflow: 'hidden' }}>
                              <button
                                type="button"
                                title="Horizontal Bars"
                                onClick={() => setLeftChartOrientation("horizontal")}
                                style={{
                                  padding: '4px 8px',
                                  fontSize: 11,
                                  fontWeight: 700,
                                  background: leftChartOrientation === "horizontal" ? "#1e3a8a" : "#ffffff",
                                  color: leftChartOrientation === "horizontal" ? "#ffffff" : "#64748b",
                                  border: 'none',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 4,
                                  transition: 'all 0.15s ease',
                                }}
                              >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                  <line x1="3" y1="6" x2="21" y2="6"/>
                                  <line x1="3" y1="12" x2="16" y2="12"/>
                                  <line x1="3" y1="18" x2="19" y2="18"/>
                                </svg>
                                Horizontal
                              </button>
                              <button
                                type="button"
                                title="Vertical Columns"
                                onClick={() => setLeftChartOrientation("vertical")}
                                style={{
                                  padding: '4px 8px',
                                  fontSize: 11,
                                  fontWeight: 700,
                                  background: leftChartOrientation === "vertical" ? "#1e3a8a" : "#ffffff",
                                  color: leftChartOrientation === "vertical" ? "#ffffff" : "#64748b",
                                  border: 'none',
                                  borderLeft: '1px solid #cbd5e1',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 4,
                                  transition: 'all 0.15s ease',
                                }}
                              >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                  <line x1="6" y1="21" x2="6" y2="3"/>
                                  <line x1="12" y1="21" x2="12" y2="8"/>
                                  <line x1="18" y1="21" x2="18" y2="5"/>
                                </svg>
                                Vertical
                              </button>
                            </div>

                            <select
                              value={leftChartMode}
                              onChange={(e) => setLeftChartMode(e.target.value)}
                              style={{
                                border: '1px solid #cbd5e1',
                                borderRadius: 6,
                                padding: '5px 10px',
                                fontSize: 12,
                                fontWeight: 600,
                                color: '#1e293b',
                                background: '#ffffff',
                                cursor: 'pointer',
                                outline: 'none',
                              }}
                            >
                              <option value="yearLevel">By Year Level</option>
                              <option value="ayTrend">By Academic Year (Trend)</option>
                              {(isSuper && !filterDept && deptData.length > 1) && (
                                <option value="program">By Program</option>
                              )}
                            </select>
                          </div>
                        </div>
                        <div className="ad-chartBody" style={{ flex: 1 }}>
                          {activeLeftChartData.length === 0 ? (
                            <div style={{ padding: '70px 20px', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
                              No evaluation data recorded for this view.
                            </div>
                          ) : (
                            <ResponsiveContainer width="100%" height={280}>
                              {leftChartOrientation === "horizontal" ? (
                                <BarChart
                                  data={activeLeftChartData}
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
                                    dataKey="name"
                                    tick={{ fontSize: 12, fill: "#374151", fontWeight: 600 }}
                                    axisLine={false}
                                    tickLine={false}
                                    width={leftChartMode === "ayTrend" ? 140 : 80}
                                  />
                                  <Tooltip
                                    formatter={(v, name, item) => [
                                      `${v} / 5.0 (${item?.payload?.responses || 0} response${item?.payload?.responses === 1 ? '' : 's'})`,
                                      "Average Rating"
                                    ]}
                                    contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 12 }}
                                  />
                                  <Bar
                                    dataKey="avg"
                                    name="Average Rating"
                                    fill={leftChartMode === "ayTrend" ? "#4f46e5" : "#2563eb"}
                                    radius={[0, 4, 4, 0]}
                                    barSize={22}
                                  />
                                </BarChart>
                              ) : (
                                <BarChart
                                  data={activeLeftChartData}
                                  layout="horizontal"
                                  margin={{ top: 10, right: 20, left: -10, bottom: 10 }}
                                >
                                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                                  <XAxis
                                    dataKey="name"
                                    tick={{ fontSize: 11, fill: "#374151", fontWeight: 600 }}
                                    axisLine={false}
                                    tickLine={false}
                                    interval={0}
                                  />
                                  <YAxis
                                    type="number"
                                    domain={[0, 5]}
                                    ticks={[1, 2, 3, 4, 5]}
                                    tick={{ fontSize: 11, fill: "#9ca3af" }}
                                    axisLine={false}
                                    tickLine={false}
                                  />
                                  <Tooltip
                                    formatter={(v, name, item) => [
                                      `${v} / 5.0 (${item?.payload?.responses || 0} response${item?.payload?.responses === 1 ? '' : 's'})`,
                                      "Average Rating"
                                    ]}
                                    contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 12 }}
                                  />
                                  <Bar
                                    dataKey="avg"
                                    name="Average Rating"
                                    fill={leftChartMode === "ayTrend" ? "#4f46e5" : "#2563eb"}
                                    radius={[4, 4, 0, 0]}
                                    barSize={leftChartMode === "ayTrend" ? 28 : 36}
                                  />
                                </BarChart>
                              )}
                            </ResponsiveContainer>
                          )}
                        </div>
                      </div>

                      {/* CARD 2: Rating Distribution */}
                      <div className="ad-tableCard" style={{ marginBottom: 0, display: 'flex', flexDirection: 'column' }}>
                        <div className="ad-chartHeader" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', borderBottom: '1.5px solid #e5e7eb' }}>
                          <div className="ad-chartHeaderInner" style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                            <span className="ad-chartIcon" style={{ background: '#1e3a8a', borderRadius: 8, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', flexShrink: 0 }}>
                              <PieChartIcon />
                            </span>
                            <span className="ad-chartTitle" style={{ fontWeight: 700, fontSize: 13, letterSpacing: '0.5px' }}>RATING DISTRIBUTION</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
                            <select
                              value={distYearFilter}
                              onChange={(e) => setDistYearFilter(e.target.value)}
                              style={{
                                border: '1px solid #cbd5e1',
                                borderRadius: 6,
                                padding: '5px 10px',
                                fontSize: 12,
                                fontWeight: 600,
                                color: '#1e293b',
                                background: '#ffffff',
                                cursor: 'pointer',
                                outline: 'none',
                              }}
                            >
                              <option value="all">All Year Levels</option>
                              <option value="1">1st Year Only</option>
                              <option value="2">2nd Year Only</option>
                              <option value="3">3rd Year Only</option>
                              <option value="4">4th Year Only</option>
                            </select>
                          </div>
                        </div>
                        <div className="ad-chartBody" style={{ display: 'flex', alignItems: 'center', gap: 16, flex: 1 }}>
                          {pieData.length === 0 ? (
                            <div style={{ flex: 1, padding: '70px 20px', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
                              No rating distribution recorded for this cohort.
                            </div>
                          ) : (
                            <>
                              {/* Donut */}
                              <div style={{ flexShrink: 0 }}>
                                <ResponsiveContainer width={170} height={170}>
                                  <PieChart>
                                    <Pie
                                      data={pieData}
                                      cx="50%"
                                      cy="50%"
                                      innerRadius={46}
                                      outerRadius={76}
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
                                      <th style={{ textAlign: 'left', color: '#6b7280', fontWeight: 700, fontSize: 10, letterSpacing: '0.5px', textTransform: 'uppercase', paddingBottom: 8, borderBottom: '1px solid #f3f4f6' }}>Range</th>
                                      <th style={{ textAlign: 'center', color: '#6b7280', fontWeight: 700, fontSize: 10, letterSpacing: '0.5px', textTransform: 'uppercase', paddingBottom: 8, borderBottom: '1px solid #f3f4f6' }}>{distYearFilter === "all" ? "Faculty" : "Submissions"}</th>
                                      <th style={{ textAlign: 'right', color: '#6b7280', fontWeight: 700, fontSize: 10, letterSpacing: '0.5px', textTransform: 'uppercase', paddingBottom: 8, borderBottom: '1px solid #f3f4f6' }}>% Share</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {pieData.map((entry, i) => {
                                      const total = pieData.reduce((s, e) => s + e.value, 0);
                                      const pct = total > 0 ? Math.round((entry.value / total) * 100) : 0;
                                      return (
                                        <tr key={i}>
                                          <td style={{ padding: '6px 0', borderBottom: '1px solid #f9fafb' }}>
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                              <span style={{ width: 7, height: 7, borderRadius: '50%', background: tierColors[entry.name] || '#9ca3af', flexShrink: 0 }} />
                                              <span>
                                              <span style={{ fontWeight: 600, color: '#1e293b' }}>{entry.name.replace(/\s*\(.*\)/, '').trim()}</span>
                                              <span style={{ fontSize: 10, color: '#94a3b8', marginLeft: 4 }}>{entry.name.match(/\(.*\)/)?.[0] || ''}</span>
                                            </span>
                                            </span>
                                          </td>
                                          <td style={{ textAlign: 'center', padding: '6px 0', borderBottom: '1px solid #f9fafb', fontWeight: 600 }}>{entry.value}</td>
                                          <td style={{ textAlign: 'right', padding: '6px 0', borderBottom: '1px solid #f9fafb', fontWeight: 700, color: tierColors[entry.name] || '#374151' }}>{pct}%</td>
                                        </tr>
                                      );
                                    })}
                                    <tr>
                                      <td style={{ padding: '8px 0 0', fontWeight: 700, color: '#111827' }}>Total</td>
                                      <td style={{ textAlign: 'center', padding: '8px 0 0', fontWeight: 700, color: '#111827' }}>{pieData.reduce((s, e) => s + e.value, 0)}</td>
                                      <td style={{ textAlign: 'right', padding: '8px 0 0', fontWeight: 700, color: '#111827' }}>100%</td>
                                    </tr>
                                  </tbody>
                                </table>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="ad-tableCard" style={{ padding: "60px 20px", textAlign: "center", color: "#94a3b8" }}>
                    <BarChartIcon />
                    <div style={{ fontSize: "14px", fontWeight: 700, color: "#334155", marginTop: "10px" }}>No Analytics Available</div>
                    <div style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>Select an academic period with submitted student evaluations.</div>
                  </div>
                )}
              </div>
            ) : (
              /* ROSTER TAB: nothing selected yet */
              <div className="ad-tableCard" style={{ padding: "60px 20px", textAlign: "center", color: "#94a3b8", marginBottom: 0 }}>
                <RosterIcon />
                <div style={{ fontSize: "14px", fontWeight: 700, color: "#334155", marginTop: "10px" }}>Select a faculty member</div>
                <div style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>Pick a name from the directory to view their scorecard and section breakdown.</div>
              </div>
            )}
          </div>
        </div>

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

              {/* Student Feedback & Qualitative Comments in Modal */}
              <div style={{ marginTop: "20px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                  <h4 style={{ fontSize: "11.5px", fontWeight: "700", color: "#475569", margin: 0, textTransform: "uppercase", letterSpacing: "0.6px" }}>
                    Student Feedback & Qualitative Comments
                  </h4>
                  <span style={{ fontSize: "11px", fontWeight: 700, padding: "2px 8px", background: "#e0e7ff", color: "#3730a3", borderRadius: "999px" }}>
                    {viewingReport.comments?.length || 0}
                  </span>
                </div>

                {(!viewingReport.comments || viewingReport.comments.length === 0) ? (
                  <div style={{ padding: "24px 14px", textAlign: "center", color: "#94a3b8", fontSize: "12.5px", background: "#f8fafc", borderRadius: "8px", border: "1px dashed #cbd5e1" }}>
                    No qualitative comments recorded for this evaluation period.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "280px", overflowY: "auto", paddingRight: "4px" }}>
                    {viewingReport.comments.map((c, cIdx) => (
                      <div
                        key={c.id || cIdx}
                        style={{
                          background: "#f8fafc",
                          border: "1px solid #e2e8f0",
                          borderLeft: "3px solid #2563eb",
                          borderRadius: "0 6px 6px 0",
                          padding: "10px 12px",
                        }}
                      >
                        <div style={{ fontSize: "12.5px", color: "#1e293b", lineHeight: "1.45", fontStyle: "italic", marginBottom: "6px" }}>
                          &ldquo;{c.comment}&rdquo;
                        </div>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "10.5px", color: "#64748b" }}>
                          <span style={{ fontStyle: "italic", color: "#94a3b8" }}>Anonymous Student Feedback</span>
                          {c.date && <span>{c.date}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>
            <div className="ad-modalFooter" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <button className="ad-btnSecondary" onClick={() => setViewingReport(null)}>Close</button>
              <button
                className="ad-btnPrimary"
                disabled={exportingFacultyPdf}
                onClick={() => handleExportIndividualFacultyPDF(viewingReport)}
                style={{ display: "inline-flex", alignItems: "center", gap: "8px", fontWeight: 700 }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                {exportingFacultyPdf ? "Compiling PDF..." : "Export Faculty PDF"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
