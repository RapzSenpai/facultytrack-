import { useState, useEffect } from "react";
import { supabase } from "../config/supabase";
import { isAssignmentMatch } from "../utils/assignmentMatch";
import { pickActivePeriod, matchDepartment } from "../utils/periodStatus";

/**
 * Loads the student's active academic period, matched assigned subjects/faculty
 * and evaluation stats. Logic moved verbatim from StudentDashboard so the
 * Dashboard and My Reports pages share identical behaviour.
 */
export function useStudentAssignments(currentUser, userProfile) {
  const [stats, setStats] = useState({ total: 0, evaluated: 0, pending: 0, open: 0 });
  const [activeYear, setActiveYear] = useState(null);
  const [loading, setLoading] = useState(true);
  const [assignedFaculty, setAssignedFaculty] = useState([]);

  useEffect(() => {
    if (!currentUser || !userProfile) return;

    const studentDept = userProfile.department || userProfile.dept || "";
    const studentYear = userProfile.yearLevel || userProfile.year || "";
    const studentSection = userProfile.section || "";

    (async () => {
      try {
        const [assignmentsRes, submissionsRes, yearsRes, enrollmentRes] = await Promise.all([
          supabase.from("class_assignments").select("*"),
          supabase.from("evaluations").select("*").eq("student_id", currentUser.id),
          supabase.from("academic_years").select("*, departments(name)"),
          supabase.from("student_enrollments")
            .select("confirmed_assignments, excluded_assignments, enrollment_kind, academic_year, semester")
            .eq("student_id", currentUser.id),
        ]);

        const assignments = (assignmentsRes.data || []).map((a) => ({
          id: a.id,
          facultyId: a.faculty_id,
          facultyName: a.faculty_name,
          subjectCode: a.subject_code,
          subjectName: a.subject_name,
          department: a.department,
          yearLevel: a.year_level,
          section: a.section,
          semester: a.semester,
          academicYear: a.academic_year,
        }));

        const submissions = (submissionsRes.data || []).map((s) => ({
          assignmentId: s.assignment_id,
          ratings: s.ratings,
          comment: s.comment,
          submittedAt: s.submitted_at,
        }));

        const years = (yearsRes.data || []).map((y) => ({
          id: y.id,
          year: y.year,
          semester: y.semester,
          startDate: y.start_date,
          endDate: y.end_date,
          end_date: y.end_date,
          status: y.status,
          department_id: y.department_id,
          departments: y.departments,
        }));

        const active = pickActivePeriod(years, studentDept) || null;
        console.log("[StudentDashboard] Profile dept:", studentDept, "Academic years from DB:", yearsRes.data, "Resolved active period:", active);
        setActiveYear(active);

        const subMap = new Map();
        submissions.forEach((s) => {
          subMap.set(s.assignmentId, s);
        });

        if (!active) {
          setStats({ total: 0, evaluated: 0, pending: 0, open: 0 });
          setAssignedFaculty([]);
          return;
        }

        const activeAssignments = assignments.filter(
          (a) => a.academicYear === active.year && a.semester === active.semester
        );

        // Admin per-student overrides (Phase 3): same semantics as
        // the submit-evaluation Edge Function — an admin/exception
        // list governs fully, otherwise section match ∪ confirmed
        // minus excluded.
        const enrollment = (enrollmentRes.data || []).find(
          (r) => r.academic_year === active.year && r.semester === active.semester
        ) || null;
        const confirmedSet = new Set(enrollment?.confirmed_assignments || []);
        const excludedSet = new Set(enrollment?.excluded_assignments || []);
        const isAdminList =
          enrollment?.enrollment_kind === "admin" ||
          enrollment?.enrollment_kind === "exception";

        // Automatic matching: directly match the student's department, year, and section
        // (exact normalized equality — mirrors the server gate).
        const matchedRaw = activeAssignments.filter((a) => {
          // Strict program restriction: Never display subjects from another program
          if (!matchDepartment(a.department, studentDept)) return false;
          if (excludedSet.has(a.id)) return false;
          if (isAdminList) return confirmedSet.has(a.id);
          if (confirmedSet.has(a.id)) return true;
          return isAssignmentMatch(a, studentDept, studentYear, studentSection);
        });

        // Group by facultyId + section so a faculty handling multiple subjects in 1 section is evaluated once
        const facultyGroups = new Map();
        matchedRaw.forEach((a) => {
          const key = a.facultyId ? `${a.facultyId}__${a.section || ""}` : a.id;
          if (!facultyGroups.has(key)) {
            facultyGroups.set(key, {
              assignmentId: a.id,
              assignmentIds: [a.id],
              facultyId: a.facultyId,
              name: a.facultyName || null,
              subjectCodes: a.subjectCode ? [a.subjectCode] : [],
              subjectNames: a.subjectName ? [a.subjectName] : [],
              dept: a.department,
              year: a.yearLevel,
              section: a.section,
              semester: a.semester,
            });
          } else {
            const entry = facultyGroups.get(key);
            entry.assignmentIds.push(a.id);
            if (a.subjectCode && !entry.subjectCodes.includes(a.subjectCode)) {
              entry.subjectCodes.push(a.subjectCode);
            }
            if (a.subjectName && !entry.subjectNames.includes(a.subjectName)) {
              entry.subjectNames.push(a.subjectName);
            }
          }
        });

        const matchedFaculty = Array.from(facultyGroups.values()).map((g) => {
          const subData = g.assignmentIds.map((id) => subMap.get(id)).find(Boolean);
          const subject = g.subjectCodes.length > 0 ? g.subjectCodes.join(", ") : (g.subjectNames.join(", ") || "—");
          return {
            assignmentId: g.assignmentId,
            assignmentIds: g.assignmentIds,
            facultyId: g.facultyId,
            name: g.name,
            subject,
            subjectCode: g.subjectCodes.join(", "),
            subjectCodes: g.subjectCodes,
            subjectName: g.subjectNames.join(" / "),
            subjectNames: g.subjectNames,
            dept: g.dept,
            year: g.year,
            section: g.section,
            semester: g.semester,
            status: subData ? "submitted" : "pending",
            submittedAt: subData?.submittedAt || null,
          };
        });

        setAssignedFaculty(matchedFaculty);

        const evaluatedCount = matchedFaculty.filter((f) => f.status === "submitted").length;
        const openCount = matchedFaculty.filter((f) => f.status === "pending" && f.name).length;
        setStats({
          total: matchedFaculty.length,
          evaluated: evaluatedCount,
          pending: matchedFaculty.length - evaluatedCount,
          open: openCount,
        });
      } catch (err) {
        console.error("StudentDashboard fetch error:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, [currentUser, userProfile]);

  return { stats, activeYear, loading, assignedFaculty };
}
