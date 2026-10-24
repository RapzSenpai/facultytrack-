import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import AdminLayout from "./AdminLayout";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../config/supabase";
import { useScopedAdmin } from "../../hooks/useScopedAdmin";
import { useSuperScope } from "../../context/SuperScopeContext";
import { isPeriodActive, periodStatusLabel, pickActivePeriod, matchDepartment, periodNotStarted } from "../../utils/periodStatus";
import { is_period_released } from "../../utils/periodRelease";
import { ResponsiveContainer, PieChart, Pie } from "recharts";
import "../../styles/dashboard-mockup.css";

function timeAgo(dateStr) {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr${hours > 1 ? "s" : ""} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days > 1 ? "s" : ""} ago`;
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatAuditSentence(actorName, a) {
  const d = a?.details || {};
  if (d.summary) return d.summary;
  if (d.message) return d.message;

  const rawAction = String(a?.action || "").toLowerCase().trim();
  const entity = String(a?.entity || "").toLowerCase().trim();
  const actor = String(actorName || "Admin")
    .replace(/\bSuperAdmin\b/gi, "Super Admin")
    .trim();

  // 1. Report export (e.g. report.export on evaluations)
  if (rawAction.includes("export") || rawAction.includes("report")) {
    const dept = d.department || d.department_name || d.name || "";
    return `${actor} exported evaluation report${dept ? ` for ${dept}` : ""}`;
  }

  // 2. Account approved
  if (rawAction.includes("approve") || rawAction === "account.approve") {
    const target = d.user_name || d.name || d.full_name || d.target_user || (d.count ? `${d.count} user accounts` : "user account");
    return `${actor} approved ${target}`;
  }

  // 3. Account rejected
  if (rawAction.includes("reject") || rawAction === "account.reject") {
    const target = d.user_name || d.name || d.full_name || d.target_user || "user account";
    return `${actor} rejected ${target}`;
  }

  // 4. Program assigned / Admin created
  if (
    rawAction.includes("program_assignment") ||
    rawAction.includes("assign_program") ||
    rawAction === "program_assignments.save" ||
    rawAction.startsWith("admin.")
  ) {
    const prog = d.department || d.department_name || d.program || "program";
    const toUser = d.admin_name || d.target_name || "";
    return `${actor} assigned ${prog}${toUser ? ` to ${toUser}` : ""}`;
  }

  // 5. Results released
  if (rawAction.includes("release") || rawAction === "release.save") {
    const dept = d.department || d.target_department || "";
    return `${actor} released evaluations${dept ? ` for ${dept}` : ""}`;
  }

  // 6. Academic period
  if (
    rawAction.includes("period") ||
    rawAction.includes("academic") ||
    entity.includes("academic_year")
  ) {
    const sem = d.period_name || (d.year && d.semester ? `${d.year} ${d.semester}` : "") || "academic period";
    return `${actor} scheduled ${sem}`;
  }

  // 7. Moderation / Priority reviews
  if (rawAction.includes("moderate") || rawAction.includes("priority")) {
    return `${actor} reviewed evaluation comment`;
  }

  // 8. Blocked words
  if (rawAction.includes("blocked_words")) {
    return `${actor} ${rawAction.includes("add") ? "added word to" : "removed word from"} moderation filter`;
  }

  // 9. Subject correction requests
  if (rawAction.includes("correction")) {
    if (rawAction.includes("delete")) {
      return `${actor} deleted subject correction request`;
    }
    if (d.status === "rejected") {
      return `${actor} rejected subject correction request`;
    }
    if (d.status === "approved") {
      return `${actor} approved subject correction request`;
    }
    return `${actor} resolved subject correction request`;
  }

  // 10. Enrollment overrides
  if (rawAction.includes("enrollment")) {
    return `${actor} updated student enrollment records`;
  }

  // 11. Generic clean natural sentence converter
  const parts = rawAction.split(/[._]/).filter(Boolean);
  if (parts.length === 2) {
    const [noun, verb] = parts;
    const pastVerb = verb.endsWith("e") ? `${verb}d` : `${verb}ed`;
    return `${actor} ${pastVerb} ${noun}${entity ? ` for ${entity}` : ""}`;
  }

  const cleanAction = rawAction.replace(/[._]/g, " ");
  return `${actor} performed ${cleanAction}${entity ? ` on ${entity}` : ""}`;
}

function getAuditMeta(a, actorMap = {}) {
  const rawActor = (a?.actor_id && actorMap[a.actor_id]) ? actorMap[a.actor_id] : "Admin";
  const actorName = String(rawActor).replace(/\bSuperAdmin\b/gi, "Super Admin").trim();
  const rawAction = String(a?.action || "").toLowerCase().trim();
  const entity = String(a?.entity || "").toLowerCase();
  const d = a?.details || {};

  // 1. Report Export
  if (rawAction.includes("export") || rawAction.includes("report")) {
    return {
      title: "Report Exported",
      dotColor: "#2563eb",
      description: formatAuditSentence(actorName, a),
    };
  }

  // 2. Account Approved
  if (rawAction.includes("approve") || rawAction === "account.approve") {
    return {
      title: "Account Approved",
      dotColor: "#16a34a",
      description: formatAuditSentence(actorName, a),
    };
  }

  // 3. Account Rejected
  if (rawAction.includes("reject") || rawAction === "account.reject") {
    return {
      title: "Account Rejected",
      dotColor: "#dc2626",
      description: formatAuditSentence(actorName, a),
    };
  }

  // 4. Program Head Assigned
  if (
    rawAction.includes("program_assignment") ||
    rawAction.includes("assign_program") ||
    rawAction === "program_assignments.save" ||
    rawAction.startsWith("admin.")
  ) {
    return {
      title: "Program Head Assigned",
      dotColor: "#2563eb",
      description: formatAuditSentence(actorName, a),
    };
  }

  // 5. Results Released
  if (rawAction.includes("release") || rawAction === "release.save") {
    return {
      title: "Results Released",
      dotColor: "#9333ea",
      description: formatAuditSentence(actorName, a),
    };
  }

  // 6. Period Scheduled / Academic Year
  if (
    rawAction.includes("period") ||
    rawAction.includes("academic") ||
    entity.includes("academic_year")
  ) {
    return {
      title: "Period Scheduled",
      dotColor: "#ea580c",
      description: formatAuditSentence(actorName, a),
    };
  }

  // 7. Moderation / Priority Reviews
  if (rawAction.includes("moderate") || rawAction.includes("priority")) {
    return {
      title: "Comment Moderated",
      dotColor: "#9333ea",
      description: formatAuditSentence(actorName, a),
    };
  }

  // 8. Correction requests
  if (rawAction.includes("correction")) {
    if (rawAction.includes("delete")) {
      return {
        title: "Correction Deleted",
        dotColor: "#e11d48", // rose / red
        description: formatAuditSentence(actorName, a),
      };
    }
    if (d.status === "rejected") {
      return {
        title: "Correction Rejected",
        dotColor: "#dc2626",
        description: formatAuditSentence(actorName, a),
      };
    }
    if (d.status === "approved") {
      return {
        title: "Correction Approved",
        dotColor: "#16a34a",
        description: formatAuditSentence(actorName, a),
      };
    }
    return {
      title: "Correction Resolved",
      dotColor: "#0284c7",
      description: formatAuditSentence(actorName, a),
    };
  }

  // Fallback
  const cleanTitle = rawAction
    .replace(/[._]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return {
    title: cleanTitle || "Activity Logged",
    dotColor: "#2563eb",
    description: formatAuditSentence(actorName, a),
  };
}

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { userProfile } = useAuth();
  const { isSuper, myDeptIds, myDeptNames, inScopeName, loading: scopeLoading } = useScopedAdmin();
  const { scopeDeptId } = useSuperScope();

  const displayName = userProfile?.fullName || (isSuper ? "Super Admin" : "Admin");
  const firstName = displayName.split(" ")[0];

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  const [stats, setStats] = useState({ faculty: 0, students: 0, evaluations: 0, currentPeriodEvals: 0, uniqueParticipants: 0, completionRate: 0, pendingFaculty: 0, pendingStudents: 0, programs: 0, periodsActive: 0, periodsScheduled: 0, resultsReleased: 0 });
  const [activeYear, setActiveYear] = useState(null);
  const [loading, setLoading] = useState(true);

  // Phase 2 state
  const [recentRegistrations, setRecentRegistrations] = useState([]);
  const [sysActivity, setSysActivity] = useState([]);
  const [attentionData, setAttentionData] = useState({
    pendingApprovals: 0,
    uncoveredPrograms: 0,
    flaggedComments: 0,
  });
  const [actorMap, setActorMap] = useState({});
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const handleFocus = () => setRefreshKey((k) => k + 1);
    window.addEventListener("focus", handleFocus);

    const channel = supabase
      .channel("dashboard_realtime_releases")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "evaluation_releases" },
        () => setRefreshKey((k) => k + 1)
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "audit_log" },
        () => setRefreshKey((k) => k + 1)
      )
      .subscribe();

    return () => {
      window.removeEventListener("focus", handleFocus);
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (scopeLoading) return;
    Promise.all([
      supabase.from('users').select('*').eq('role', 'faculty'),
      supabase.from('users').select('*').eq('role', 'student'),
      supabase.from('admin_evaluations_anon').select('*'),
      supabase.from('academic_years').select('*, departments(name)'),
      supabase.from('class_assignments').select('*'),
      supabase.from('departments').select('id, name'),
      supabase.from('evaluation_releases').select('*'),
      // audit_log is super-readable only (029) — dept admins resolve empty
      // so the shared load never aborts on their RLS denial.
      isSuper
        ? supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(8)
        : Promise.resolve({ data: [], error: null }),
      isSuper
        ? supabase.from('admin_program_assignments').select('admin_id, department_id')
        : Promise.resolve({ data: [], error: null }),
      isSuper
        ? supabase.from('evaluations').select('id', { count: 'exact', head: true }).eq('moderation_status', 'flag')
        : Promise.resolve({ count: 0, error: null }),
      isSuper
        ? supabase.from('users').select('id, full_name, email, role')
        : Promise.resolve({ data: [], error: null }),
      isSuper
        ? supabase.from('evaluations').select('id, faculty_id, assignment_id, student_id, academic_year, semester, ratings, comment, submitted_at, moderation_status, is_priority')
        : Promise.resolve({ data: [], error: null }),
    ])
      .then(([facultyRes, studentsRes, evaluationsRes, yearsRes, assignmentsRes, deptRes, releaseRes, auditRes, assignProgRes, flagRes, allUsersRes, superEvalsRes]) => {
        // D9: RLS already scopes these server-side for dept admins;
        // client filter is a backstop so mixed-dept rows never render.
        const scopedDeptName = scopeDeptId ? (deptRes.data || []).find(d => d.id === scopeDeptId)?.name : null;
        const inScope = (d) => (isSuper && !scopeDeptId) || (scopeDeptId && matchDepartment(scopedDeptName, d)) || inScopeName(d);
        const inScopePeriod = (y) => (isSuper && !scopeDeptId)
          || !y.department_id
          || myDeptIds.includes(y.department_id)
          || y.department_id === scopeDeptId;
        // Maps for robust evaluation department fallback (student -> assignment -> faculty)
        const assignDeptMap = new Map((assignmentsRes.data || []).map((a) => [String(a.id), a.department]));
        const facDeptMap = new Map((facultyRes.data || []).map((f) => [String(f.id), f.department]));
        const getEvalDept = (e) => e.student_department || (e.assignment_id && assignDeptMap.get(String(e.assignment_id))) || (e.faculty_id && facDeptMap.get(String(e.faculty_id))) || "";

        const baseEvals = evaluationsRes.data || [];
        const fallbackEvals = (isSuper && (!baseEvals || baseEvals.length === 0) && superEvalsRes?.data && superEvalsRes.data.length > 0)
          ? superEvalsRes.data.map((e) => ({
              ...e,
              student_token: e.student_id ? `anon_${e.student_id}` : e.id,
              submitted_on: e.submitted_at ? String(e.submitted_at).slice(0, 10) : null,
            }))
          : baseEvals;

        const faculty = (facultyRes.data || []).filter((f) => inScope(f.department));
        const students = (studentsRes.data || []).filter((s) => inScope(s.department));
        const evaluations = fallbackEvals.filter((e) => inScope(getEvalDept(e)));
        const years = (yearsRes.data || []).filter(inScopePeriod);

        // Map snake_case to camelCase for faculty
        const facultyMapped = faculty.map(f => ({
          ...f,
          firstName: f.first_name,
          lastName: f.last_name,
          fullName: f.full_name,
          createdAt: f.created_at,
        }));

        // Map snake_case to camelCase for students
        const studentsMapped = students.map(s => ({
          ...s,
          firstName: s.first_name,
          lastName: s.last_name,
          fullName: s.full_name,
          createdAt: s.created_at,
        }));

        // Map snake_case to camelCase for evaluations.
        // Phase 4 anonymity: student_id is replaced by student_token
        // (per-row MD5) — distinct-count semantics without identity.
        const evaluationsMapped = evaluations.map(e => ({
          ...e,
          studentId: e.student_token,
          studentDepartment: getEvalDept(e),
          facultyId: e.faculty_id,
          assignmentId: e.assignment_id,
          academicYear: e.academic_year,
          submittedAt: e.submitted_on,
        }));

        // Map snake_case to camelCase for years
        const yearsMapped = years.map(y => ({
          ...y,
          startDate: y.start_date,
          endDate: y.end_date,
        }));

        // Count users by status
        const activeFaculty = facultyMapped.filter(u => (u.status || "active").toLowerCase() === "active").length;
        const pendingFaculty = facultyMapped.filter(u => (u.status || "").toLowerCase() === "pending").length;
        const activeStudents = studentsMapped.filter(u => (u.status || "active").toLowerCase() === "active").length;
        const pendingStudents = studentsMapped.filter(u => (u.status || "").toLowerCase() === "pending").length;

        // Extract recent registrations
        let allUsers = [];
        allUsers = [...allUsers, ...facultyMapped.map(f => ({ ...f, role: "Faculty" }))];
        allUsers = [...allUsers, ...studentsMapped.map(s => ({ ...s, role: "Student" }))];
        const sortedUsers = allUsers.reverse().slice(0, 5);
        setRecentRegistrations(sortedUsers);

        setSysActivity(auditRes.data || []);

        if (isSuper) {
          const am = {};
          (allUsersRes?.data || []).forEach(u => {
            am[u.id] = u.full_name || u.email || "";
          });
          setActorMap(am);

          const assignedDeptIds = new Set((assignProgRes?.data || []).map(a => a.department_id));
          const uncovered = (deptRes.data || []).filter(d => !assignedDeptIds.has(d.id)).length;
          setAttentionData({
            pendingApprovals: pendingFaculty + pendingStudents,
            uncoveredPrograms: uncovered,
            flaggedComments: flagRes?.count || 0,
          });
        }

        // Find current period for this admin's department scope
        const targetDept = myDeptNames[0] || scopedDeptName;
        let active = pickActivePeriod(yearsMapped, targetDept);

        // If active period has 0 evaluations but evaluationsMapped has live evaluations,
        // lock onto the active period containing evaluations so SuperAdmin isn't blinded.
        if (evaluationsMapped.length > 0) {
          const hasEvalsInActive = active && evaluationsMapped.some(e => {
            const matchY = !active.year || String(e.academicYear || "").trim().toLowerCase() === String(active.year || "").trim().toLowerCase();
            const eSem = String(e.semester || "").trim().toLowerCase();
            const aSem = String(active.semester || "").trim().toLowerCase();
            return matchY && (!active.semester || eSem === aSem || eSem.includes(aSem) || aSem.includes(eSem));
          });

          if (!hasEvalsInActive) {
            const evalAY = yearsMapped.find(y =>
              String(y.year || "").trim().toLowerCase() === String(evaluationsMapped[0].academicYear || "").trim().toLowerCase() &&
              String(y.semester || "").trim().toLowerCase() === String(evaluationsMapped[0].semester || "").trim().toLowerCase()
            );
            active = evalAY || {
              year: evaluationsMapped[0].academicYear,
              semester: evaluationsMapped[0].semester,
            };
          }
        } else if (!active && yearsMapped.length > 0) {
          active = yearsMapped[0];
        }

        setActiveYear(active);

        // Calculate evaluations specific to this period.
        // Anonymity note: admin_evaluations_anon carries student_token
        // (MD5), not users.id — so the student-exists check must NOT
        // compare against studentsMapped ids (it can never match).
        // Participants are counted as distinct student tokens.
        const normKey = (y, s) => `${String(y || "").trim().toLowerCase()}___${String(s || "").trim().toLowerCase().replace(/semester/g, "").replace(/[^a-z0-9]/g, "")}`;
        const activeKey = active ? normKey(active.year, active.semester) : "";

        const periodEvalsRaw = active
          ? evaluationsMapped.filter(e => {
            const matchY = !active.year || String(e.academicYear || "").trim().toLowerCase() === String(active.year || "").trim().toLowerCase();
            const eSem = String(e.semester || "").trim().toLowerCase();
            const aSem = String(active.semester || "").trim().toLowerCase();
            const matchS = !active.semester || eSem === aSem || eSem.includes(aSem) || aSem.includes(eSem) || (normKey(e.academicYear, e.semester) === activeKey);
            return matchY && matchS;
          })
          : [];

        const periodEvalsCount = periodEvalsRaw.length;
        const uniqueParticipantsCount = new Set(periodEvalsRaw.map(e => e.studentId || e.id)).size;
        const rawPct = activeStudents > 0 ? (uniqueParticipantsCount / activeStudents) * 100 : 0;
        const completionRate = rawPct > 0 && rawPct < 1 ? Number(rawPct.toFixed(1)) : Math.min(100, Math.round(rawPct));

        // Evaluation lifecycle (super overview): period states from
        // academic_years, release states from evaluation_releases.
        const periodsActive = yearsMapped.filter((y) => isPeriodActive(y)).length;
        const periodsScheduled = yearsMapped.filter((y) => periodNotStarted(y)).length;
        const sameStr = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
        const releases = releaseRes.data || [];
        const releasedReleases = releases.filter((r) => is_period_released(r));

        const isPeriodReleased = (year, sem) =>
          releasedReleases.some((r) => {
            const matchY = sameStr(r.academic_year || r.academicYear, year);
            const rSem = String(r.semester || "").trim().toLowerCase();
            const ySem = String(sem || "").trim().toLowerCase();
            const matchS = rSem === ySem || rSem.replace(/[^a-z0-9]/g, "") === ySem.replace(/[^a-z0-9]/g, "");
            return matchY && matchS;
          });

        const resultsReleased = releasedReleases.length;

        console.log("[Dashboard Lifecycle]", {
          isSuper,
          periodsActive,
          periodsScheduled,
          resultsReleased,
          releasesCount: releases.length,
          releasedReleasesCount: releasedReleases.length,
          releaseError: releaseRes.error?.message || null,
          releasesData: releases
        });

        setStats({
          faculty: activeFaculty,
          students: activeStudents,
          evaluations: evaluationsMapped.length,
          currentPeriodEvals: periodEvalsCount,
          uniqueParticipants: uniqueParticipantsCount,
          completionRate,
          pendingFaculty,
          pendingStudents,
          programs: (deptRes.data || []).length,
          periodsActive,
          periodsScheduled,
          resultsReleased,
        });
      })
      .catch(err => console.error("Dashboard fetch error:", err))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeLoading, isSuper, myDeptNames.join("|"), myDeptIds.join("|"), scopeDeptId, refreshKey]);

  return (
    <AdminLayout title="Dashboard">
      <div className="ad-content">
        <div className="mockup-dashboard">
          {/* Header Section */}
          <div className="mockup-header">
            <div>
              <div className="mockup-welcome">
                <h2>
                  {greeting}, {firstName}!
                </h2>
                <p>{isSuper ? "Oversee programs, reports, and result releases across the whole system." : "Monitor faculty evaluations, user activities, and academic management."}</p>
                {!scopeLoading && (
                  <p style={{ marginTop: 6, fontSize: 12, fontWeight: 700, color: "#1e3a5f" }}>

                  </p>
                )}
              </div>
              <div className="mockup-quick-actions">
                {isSuper ? (
                  <>
                    <button className="mockup-btn" onClick={() => navigate('/admin/reports')}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                      View Reports
                    </button>
                    <button className="mockup-btn" onClick={() => navigate('/admin/faculty')}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                      System Users
                    </button>
                    <button className="mockup-btn" onClick={() => navigate('/admin/program-assignments')}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
                      Program Assignments
                    </button>
                  </>
                ) : (
                  <>
                    <button className="mockup-btn" onClick={() => navigate('/admin/report')}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                      View Reports
                    </button>
                    <button className="mockup-btn" onClick={() => navigate('/admin/faculty')}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                      Manage Users
                    </button>
                    <button className="mockup-btn" onClick={() => navigate('/admin/questionnaire')}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
                      Questionnaire
                    </button>
                    <button className="mockup-btn" onClick={() => navigate('/admin/academic-year')}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                      Academic Year
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="mockup-period-card">
              <div className="mockup-period-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
              </div>
              <div className="mockup-period-info">
                <div className="mockup-period-label">Current Academic Period</div>
                <div className="mockup-period-title">
                  {activeYear ? `${activeYear.year} • ${activeYear.semester}` : "No active year"}
                </div>
                <div className="mockup-period-status">
                  Evaluation Status: <span className={`mockup-status-badge ${
                    periodStatusLabel(activeYear) === "Scheduled"
                      ? "mockup-status-badge--scheduled"
                      : periodStatusLabel(activeYear) === "Closed"
                      ? "mockup-status-badge--closed"
                      : ""
                  }`}>{periodStatusLabel(activeYear)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* 4 Stats Cards */}
          <div className="mockup-stats-grid">
            <div className="mockup-stat-card">
              <div className="mockup-stat-header">
                <span className="mockup-stat-title">Total Faculty</span>
                <div className="mockup-stat-icon blue">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                </div>
              </div>
              <div className="mockup-stat-value">{loading ? "—" : stats.faculty}</div>
              <div className="mockup-stat-desc">Active faculty members</div>
            </div>

            <div className="mockup-stat-card">
              <div className="mockup-stat-header">
                <span className="mockup-stat-title">Total Students</span>
                <div className="mockup-stat-icon green">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                </div>
              </div>
              <div className="mockup-stat-value">{loading ? "—" : stats.students}</div>
              <div className="mockup-stat-desc">Active enrolled students</div>
            </div>

            <div className="mockup-stat-card">
              <div className="mockup-stat-header">
                <span className="mockup-stat-title">Pending Approvals</span>
                <div className="mockup-stat-icon orange">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                </div>
              </div>
              <div className="mockup-stat-value">{stats.pendingFaculty + stats.pendingStudents}</div>
              <div className="mockup-stat-desc">Requires your action</div>
              <div className="mockup-stat-trend">
                {stats.pendingFaculty + stats.pendingStudents > 0 ? (
                  <Link to="/admin/faculty" style={{ color: '#ea580c', fontWeight: 'bold', textDecoration: 'none', background: '#ffedd5', padding: '2px 8px', borderRadius: '4px' }}>Review Now →</Link>
                ) : (
                  <span style={{ color: '#16a34a', background: '#dcfce7', padding: '2px 8px', borderRadius: '4px' }}>All caught up</span>
                )}
              </div>
            </div>

            <div className="mockup-stat-card">
              <div className="mockup-stat-header">
                <span className="mockup-stat-title">Completion Rate</span>
                <div className="mockup-stat-icon purple">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                </div>
              </div>
              <div className="mockup-stat-value">{loading ? "—" : `${stats.completionRate}%`}</div>
              <div className="mockup-stat-desc">
                {stats.uniqueParticipants} of {stats.students} students completed
              </div>
            </div>
          </div>

          {/* Evaluation Overview (super only): real lifecycle states */}
          {isSuper && (
            <div className="mockup-panel">
              <div className="mockup-panel-header">
                <div>
                  <h3 className="mockup-panel-title">Evaluation Overview</h3>
                  <p className="mockup-panel-subtitle">System-wide period and release states.</p>
                </div>
                <Link to="/admin/academic-year" className="mockup-panel-action">Manage periods</Link>
              </div>
              <div className="mockup-stats-grid mockup-stats-grid-3">
                <div className="mockup-stat-card">
                  <div className="mockup-stat-header">
                    <span className="mockup-stat-title">Active Periods</span>
                    <div className="mockup-stat-icon green">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                    </div>
                  </div>
                  <div className="mockup-stat-value">{loading ? "—" : stats.periodsActive}</div>
                  <div className="mockup-stat-desc">On-going and before deadline</div>
                </div>
                <div className="mockup-stat-card">
                  <div className="mockup-stat-header">
                    <span className="mockup-stat-title">Scheduled</span>
                    <div className="mockup-stat-icon orange">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                    </div>
                  </div>
                  <div className="mockup-stat-value">{loading ? "—" : stats.periodsScheduled}</div>
                  <div className="mockup-stat-desc">Periods starting later</div>
                </div>
                <div className="mockup-stat-card">
                  <div className="mockup-stat-header">
                    <span className="mockup-stat-title">Results Released</span>
                    <div className="mockup-stat-icon blue">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                    </div>
                  </div>
                  <div className="mockup-stat-value">{loading ? "—" : stats.resultsReleased}</div>
                  <div className="mockup-stat-desc">Approved + date reached</div>
                </div>
              </div>
            </div>
          )}

          {/* Split Row for Super Admin: Left = Attention Needed, Right = Live Activity Log */}
          {isSuper && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
                gap: "16px",
              }}
            >
              {/* Left Column: Attention Needed */}
              <div className="mockup-panel" style={{ display: "flex", flexDirection: "column" }}>
                <div className="mockup-panel-header">
                  <div>
                    <h3 className="mockup-panel-title">Attention Needed</h3>
                    <p className="mockup-panel-subtitle">Items requiring administrative action.</p>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "10px", flex: 1 }}>
                  {/* Pending approvals */}
                  <div
                    style={{
                      background: attentionData.pendingApprovals > 0 ? "#fff7ed" : "#f0fdf4",
                      border: `1px solid ${attentionData.pendingApprovals > 0 ? "#fed7aa" : "#bbf7d0"}`,
                      borderRadius: "10px",
                      padding: "12px 16px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "baseline", gap: "10px" }}>
                      <span
                        style={{
                          fontSize: "19px",
                          fontWeight: "800",
                          color: attentionData.pendingApprovals > 0 ? "#c2410c" : "#15803d",
                        }}
                      >
                        {attentionData.pendingApprovals}
                      </span>
                      <span
                        style={{
                          fontWeight: "600",
                          fontSize: "13.5px",
                          color: attentionData.pendingApprovals > 0 ? "#9a3412" : "#166534",
                        }}
                      >
                        Pending approvals
                      </span>
                    </div>
                    {attentionData.pendingApprovals > 0 ? (
                      <Link
                        to="/admin/approvals"
                        style={{ color: "#c2410c", fontWeight: "700", fontSize: "13px", textDecoration: "underline" }}
                      >
                        Review
                      </Link>
                    ) : (
                      <span style={{ color: "#15803d", fontWeight: "600", fontSize: "13px" }}>All clear</span>
                    )}
                  </div>

                  {/* Programs with no admin */}
                  <div
                    style={{
                      background: attentionData.uncoveredPrograms > 0 ? "#fff7ed" : "#f0fdf4",
                      border: `1px solid ${attentionData.uncoveredPrograms > 0 ? "#fed7aa" : "#bbf7d0"}`,
                      borderRadius: "10px",
                      padding: "12px 16px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "baseline", gap: "10px" }}>
                      <span
                        style={{
                          fontSize: "19px",
                          fontWeight: "800",
                          color: attentionData.uncoveredPrograms > 0 ? "#c2410c" : "#15803d",
                        }}
                      >
                        {attentionData.uncoveredPrograms}
                      </span>
                      <span
                        style={{
                          fontWeight: "600",
                          fontSize: "13.5px",
                          color: attentionData.uncoveredPrograms > 0 ? "#9a3412" : "#166534",
                        }}
                      >
                        {attentionData.uncoveredPrograms === 1 ? "Program with no admin" : "Programs with no admin"}
                      </span>
                    </div>
                    {attentionData.uncoveredPrograms > 0 ? (
                      <Link
                        to="/admin/program-assignments"
                        style={{ color: "#c2410c", fontWeight: "700", fontSize: "13px", textDecoration: "underline" }}
                      >
                        Assign
                      </Link>
                    ) : (
                      <span style={{ color: "#15803d", fontWeight: "600", fontSize: "13px" }}>All clear</span>
                    )}
                  </div>

                  {/* Flagged comments (if any) */}
                  {attentionData.flaggedComments > 0 && (
                    <div
                      style={{
                        background: "#fef2f2",
                        border: "1px solid #fecaca",
                        borderRadius: "10px",
                        padding: "12px 16px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "baseline", gap: "10px" }}>
                        <span style={{ fontSize: "19px", fontWeight: "800", color: "#b91c1c" }}>
                          {attentionData.flaggedComments}
                        </span>
                        <span style={{ fontWeight: "600", fontSize: "13.5px", color: "#991b1b" }}>
                          Flagged comments
                        </span>
                      </div>
                      <Link
                        to="/admin/moderation"
                        style={{ color: "#b91c1c", fontWeight: "700", fontSize: "13px", textDecoration: "underline" }}
                      >
                        Moderate
                      </Link>
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column: Live Activity Log */}
              <div className="mockup-panel" style={{ display: "flex", flexDirection: "column" }}>
                <div
                  className="mockup-panel-header"
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div>
                    <h3 className="mockup-panel-title" style={{ fontSize: "15px", fontWeight: "800", color: "#0f172a", margin: 0 }}>
                      Live Activity Log
                    </h3>
                  </div>
                  <Link
                    to="/admin/monitor"
                    className="mockup-panel-action"
                    style={{ color: "#2563eb", fontWeight: "700", fontSize: "12.5px", textDecoration: "none" }}
                  >
                    View All →
                  </Link>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "12px", flex: 1 }}>
                  {loading ? (
                    <div style={{ textAlign: "center", color: "#64748b", padding: "24px 0", fontSize: "13px" }}>
                      Loading live activity...
                    </div>
                  ) : sysActivity.length === 0 ? (
                    <div style={{ textAlign: "center", color: "#94a3b8", padding: "24px 0", fontSize: "13px" }}>
                      No activity recorded yet
                    </div>
                  ) : (
                    sysActivity.slice(0, 5).map((a) => {
                      const meta = getAuditMeta(a, actorMap);
                      return (
                        <div key={a.id} style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                              <span
                                style={{
                                  width: "8px",
                                  height: "8px",
                                  borderRadius: "50%",
                                  backgroundColor: meta.dotColor,
                                  display: "inline-block",
                                  flexShrink: 0,
                                }}
                              />
                              <span style={{ fontWeight: "700", fontSize: "13.5px", color: "#0f172a" }}>
                                {meta.title}
                              </span>
                            </div>
                            <span style={{ fontSize: "12px", color: "#64748b", whiteSpace: "nowrap" }}>
                              {timeAgo(a.created_at)}
                            </span>
                          </div>
                          <div
                            style={{
                              fontSize: "12.5px",
                              color: "#64748b",
                              paddingLeft: "16px",
                              lineHeight: "1.3",
                            }}
                          >
                            {meta.description}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Middle Row (Scoped Admins only) */}
          {!isSuper && (
            <div className="mockup-grid-3">
              <div className="mockup-panel">
                <div className="mockup-panel-header">
                  <div>
                    <h3 className="mockup-panel-title">Recent Registrations</h3>
                    <p className="mockup-panel-subtitle">Latest faculty and student accounts.</p>
                  </div>
                  <Link to="/admin/approvals" className="mockup-panel-action">View all →</Link>
                </div>
                <div className="mockup-table-wrapper">
                  <table className="mockup-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Role</th>
                        <th>Department</th>
                        <th>Status</th>
                        <th>Registered On</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentRegistrations.length === 0 ? (
                        <tr><td colSpan="5" style={{ textAlign: 'center', padding: '20px', color: '#6b7280' }}>No recent registrations</td></tr>
                      ) : (
                        recentRegistrations.map((user, i) => (
                          <tr key={user.id || user.uid || i}>
                            <td><span className="mockup-avatar">{(user.fullName || user.firstName || 'U').substring(0, 2).toUpperCase()}</span> {user.fullName || `${user.firstName} ${user.lastName}`}</td>
                            <td>{user.role}</td>
                            <td>{user.department || '—'}</td>
                            <td><span className={`mockup-badge ${user.status?.toLowerCase() === 'pending' ? 'pending' : 'approved'}`}>{user.status || 'Active'}</span></td>
                            <td>{user.createdAt ? new Date(user.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Recently'}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="mockup-panel">
                <div className="mockup-panel-header">
                  <div>
                    <h3 className="mockup-panel-title">Evaluation Summary</h3>
                    <p className="mockup-panel-subtitle">Overview of the ongoing semester.</p>
                  </div>
                  <Link to="/admin/report" className="mockup-panel-action">View details →</Link>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '100%' }}>
                  <div className="mockup-donut-container" style={{ width: '120px' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={[
                            { name: 'Participated', value: stats.uniqueParticipants, fill: '#0f1f3a' },
                            { name: 'Remaining', value: Math.max(0, stats.students - stats.uniqueParticipants), fill: '#e5e7eb' }
                          ]}
                          innerRadius={50}
                          outerRadius={60}
                          paddingAngle={0}
                          dataKey="value"
                          stroke="none"
                        >
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="mockup-donut-text">
                      <div className="mockup-donut-pct">{stats.students > 0 ? Math.round((stats.uniqueParticipants / stats.students) * 100) : 0}%</div>
                      <div className="mockup-donut-lbl">Participation</div>
                    </div>
                  </div>
                  <div className="mockup-donut-legend" style={{ flex: 1, paddingLeft: '20px' }}>
                    <div className="mockup-legend-item">
                      <span className="mockup-legend-label">Total Students</span>
                      <span className="mockup-legend-value">{stats.students}</span>
                    </div>
                    <div className="mockup-legend-item">
                      <span className="mockup-legend-label">Students Participated</span>
                      <span className="mockup-legend-value">{stats.uniqueParticipants}</span>
                    </div>
                    <div className="mockup-legend-item">
                      <span className="mockup-legend-label">Forms Submitted</span>
                      <span className="mockup-legend-value">{stats.currentPeriodEvals}</span>
                    </div>
                    <div className="mockup-legend-item">
                      <span className="mockup-legend-label">Remaining</span>
                      <span className="mockup-legend-value">{Math.max(0, stats.students - stats.uniqueParticipants)}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mockup-panel">
                <div className="mockup-panel-header" style={{ marginBottom: '12px' }}>
                  <div>
                    <h3 className="mockup-panel-title">Upcoming Tasks</h3>
                    <p className="mockup-panel-subtitle">Tasks that require your attention.</p>
                  </div>
                </div>
                <div className="mockup-tasks-list">
                  <div className="mockup-task-item">
                    <div className="mockup-task-icon blue">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                    </div>
                    <div className="mockup-task-content">
                      <h4 className="mockup-task-title">Review faculty accounts</h4>
                      <p className="mockup-task-desc">{stats.pendingFaculty} new registration{stats.pendingFaculty !== 1 ? 's' : ''}</p>
                    </div>
                    <div className={`mockup-task-count ${stats.pendingFaculty > 0 ? 'blue' : ''}`}>{stats.pendingFaculty}</div>
                  </div>
                  <div className="mockup-task-item">
                    <div className="mockup-task-icon green">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                    </div>
                    <div className="mockup-task-content">
                      <h4 className="mockup-task-title">Review student accounts</h4>
                      <p className="mockup-task-desc">{stats.pendingStudents} new registration{stats.pendingStudents !== 1 ? 's' : ''}</p>
                    </div>
                    <div className={`mockup-task-count ${stats.pendingStudents > 0 ? 'green' : ''}`} style={stats.pendingStudents > 0 ? { background: '#dcfce7', color: '#16a34a' } : {}}>{stats.pendingStudents}</div>
                  </div>
                </div>
              </div>
            </div>
          )}


        </div>
      </div>
    </AdminLayout>
  );
}
