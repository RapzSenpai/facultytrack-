import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import AdminLayout from "./AdminLayout";
import { supabase } from "../../config/supabase";
import { useScopedAdmin } from "../../hooks/useScopedAdmin";
import { useSuperScope } from "../../context/SuperScopeContext";
import { pickActivePeriod, isPeriodActive, isStatusOngoing, matchDepartment } from "../../utils/periodStatus";

const sameDept = (a, b) => {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (String(a).trim().toLowerCase() === String(b).trim().toLowerCase()) return true;
  return matchDepartment(a, b);
};

const normYear = (y) => {
  if (!y) return "";
  const str = String(y).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (str.includes("1") || str.includes("first")) return "1st";
  if (str.includes("2") || str.includes("second")) return "2nd";
  if (str.includes("3") || str.includes("third")) return "3rd";
  if (str.includes("4") || str.includes("fourth")) return "4th";
  return y;
};

const normSem = (s) => {
  if (!s) return "";
  const str = String(s).toLowerCase();
  if (str.includes("1") || str.includes("first")) return "1st";
  if (str.includes("2") || str.includes("second")) return "2nd";
  if (str.includes("summer") || str.includes("mid") || str.includes("elective")) return "summer";
  return str.trim();
};

const sameAY = (a, b) => {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const clean = (s) => String(s).trim().toLowerCase().replace(/^a\.?y\.?\s*/i, "").replace(/\s+/g, "");
  return clean(a) === clean(b);
};

const matchSemester = (subjectSem, filterSem) => {
  if (!filterSem) return true;
  if (!subjectSem) return true;
  const str = String(subjectSem).toLowerCase();
  if (str.includes("all") || str.includes("both")) return true;
  const sNorm = normSem(str);
  const fNorm = normSem(filterSem);
  return sNorm === fNorm;
};

export default function AdminClassAssignment() {
  const { isSuper, myDeptIds, myDeptNames, inScopeName, loading: scopeLoading } = useScopedAdmin();
  const { scopeDeptId, scopeDeptName } = useSuperScope();

  // Super pick overrides the always-true super branch of inScopeName.
  const scopeNameMatch = (name) => isSuper
    ? (!scopeDeptId || sameDept(name, scopeDeptName))
    : inScopeName(name);

  // D9 strict: scoped admin sees only own program(s). Super sees all,
  // or only the picked program when the super scope is set.
  const inScope = (r) => (isSuper && !scopeDeptId)
    || (r.department_id && myDeptIds.includes(r.department_id))
    || scopeNameMatch(r.department)
    || (scopeDeptId && (r.department_id === scopeDeptId || sameDept(r.department, scopeDeptName)));

  // View Mode: 'card' (Subject Board) or 'table' (Classic Table)
  const [viewMode, setViewMode] = useState("card");
  const [selectedYearTab, setSelectedYearTab] = useState("1st");
  const [showUnassignedOnly, setShowUnassignedOnly] = useState(false);
  const [highlightedFacultyId, setHighlightedFacultyId] = useState(null);

  // Filter States
  const [searchQuery, setSearchQuery] = useState("");
  const [filterDept, setFilterDept] = useState("");
  const [filterYear, setFilterYear] = useState("");
  const [filterSemester, setFilterSemester] = useState("");
  const [filterAY, setFilterAY] = useState("");

  // Modals
  const [showModal, setShowModal] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState(null);
  const [slotModal, setSlotModal] = useState(null); // { open, subject, section, allSections, existingAssignment }
  const [slotSearch, setSlotSearch] = useState("");

  // Real Data States
  const [assignmentList, setAssignmentList] = useState([]);
  const [facultyOptions, setFacultyOptions] = useState([]);
  const [subjectOptions, setSubjectOptions] = useState([]);
  const [sectionOptions, setSectionOptions] = useState([]);
  const [departmentOptions, setDepartmentOptions] = useState([]);
  const [academicYearOptions, setAcademicYearOptions] = useState([]);
  const [deletedFacultyIds, setDeletedFacultyIds] = useState(new Set());
  const [showAllSubjectsInModal, setShowAllSubjectsInModal] = useState(false);

  const [formData, setFormData] = useState({
    facultyId: "", facultyName: "", subjectCode: "", subjectName: "",
    department: "", yearLevel: "", section: "", selectedSections: [], semester: "", academicYear: ""
  });

  const reloadAssignments = async () => {
    const [{ data: refreshed }, { data: ays }] = await Promise.all([
      supabase.from('class_assignments').select('*'),
      supabase.from('academic_years').select('year, semester'),
    ]);
    if (refreshed) {
      const validPeriodKeys = new Set((ays || []).map(y => `${y.year}___${y.semester}`));
      const list = refreshed.map(a => ({
        ...a,
        facultyId: a.faculty_id,
        facultyName: a.faculty_name,
        subjectCode: a.subject_code,
        subjectName: a.subject_name,
        yearLevel: a.year_level,
        academicYear: a.academic_year,
      }))
        .filter(inScope)
        .filter(a => validPeriodKeys.has(`${a.academicYear}___${a.semester}`))
        .sort((a, b) => {
          const ayCmp = String(b.academicYear || "").localeCompare(String(a.academicYear || ""));
          if (ayCmp !== 0) return ayCmp;
          return (b.id || 0) - (a.id || 0);
        });
      setAssignmentList(list);
    }
  };

  useEffect(() => {
    const loadAllData = async () => {
      if (scopeLoading) return;
      try {
        const [assignRes, facRes, subRes, deptRes, ayRes, secRes] = await Promise.all([
          supabase.from('class_assignments').select('*'),
          supabase.from('users').select('*'),
          supabase.from('subjects').select('*'),
          supabase.from('departments').select('*'),
          supabase.from('academic_years').select('*, departments(name)'),
          supabase.from('sections').select('*').order('name'),
        ]);

        const assignments = (assignRes.data || []).map(a => ({
          ...a,
          facultyId: a.faculty_id,
          facultyName: a.faculty_name,
          subjectCode: a.subject_code,
          subjectName: a.subject_name,
          yearLevel: a.year_level,
          academicYear: a.academic_year,
        })).sort((a, b) => {
          const ayCmp = String(b.academicYear || "").localeCompare(String(a.academicYear || ""));
          if (ayCmp !== 0) return ayCmp;
          return (b.id || 0) - (a.id || 0);
        });
        const users = facRes.data || [];
        const subjects = subRes.data || [];
        const depts = deptRes.data || [];
        const ays = ayRes.data || [];
        const secs = secRes.data || [];

        const inScopePeriod = (r) => (isSuper && !scopeDeptId)
          || !r.department_id
          || myDeptIds.includes(r.department_id)
          || r.department_id === scopeDeptId;
        const scopedAys = ays.filter(inScopePeriod);
        const aysToUse = scopedAys.length > 0 ? scopedAys : ays;

        // Sort academic periods newest first by end_date/start_date or year
        const sortedAys = [...aysToUse].sort((a, b) => {
          const dateA = a.end_date || a.start_date || "";
          const dateB = b.end_date || b.start_date || "";
          if (dateA && dateB && dateA !== dateB) return dateB.localeCompare(dateA);
          return String(b.year || "").localeCompare(String(a.year || ""));
        });

        const validPeriodKeys = new Set(ays.map(y => `${y.year}___${y.semester}`));
        const scopedAssignments = assignments.filter(inScope).filter(a => validPeriodKeys.has(`${a.academicYear}___${a.semester}`));
        setAssignmentList(scopedAssignments);
        setFacultyOptions(users.filter(u => u.role === "faculty" && u.status !== "deleted" && inScope(u)).map(u => ({ ...u, fullName: u.full_name })));
        setSubjectOptions(subjects.filter(inScope));
        setDepartmentOptions(depts);
        setAcademicYearOptions(sortedAys);
        setSectionOptions(secs.filter(inScope));

        const deletedUids = new Set(
          users.filter(u => u.status === "deleted").map(u => u.id || u.uid)
        );
        setDeletedFacultyIds(deletedUids);

        // Auto-select defaults for AY and Semester:
        // Prioritizes:
        // 1. Active period (within date window)
        // 2. Ongoing status period
        // 3. Latest period from sortedAys (newest configured period, even if closed/ended)
        // 4. Latest academic year with existing assignments
        const activeAy = pickActivePeriod(sortedAys, myDeptNames[0] || filterDept)
          || sortedAys.find(y => isPeriodActive(y))
          || sortedAys.find(y => isStatusOngoing(y.status));

        const latestPeriod = sortedAys[0];
        const fallbackAY = activeAy?.year || latestPeriod?.year || "";
        const fallbackSem = activeAy?.semester || latestPeriod?.semester || "1st Semester";

        if (!filterAY || !sortedAys.some(y => sameAY(y.year, filterAY))) {
          setFilterAY(fallbackAY);
        }
        if (!filterSemester && fallbackSem) {
          setFilterSemester(fallbackSem);
        }
      } catch (err) { console.error("Fetch Error:", err); }
    };
    loadAllData();
  }, [scopeLoading, isSuper, myDeptIds.join("|"), scopeDeptId, scopeDeptName]);

  // Scoped admin: pin program filter to own assignment (same as Report/Student pages).
  // Super with a picked program: pin to the pick.
  useEffect(() => {
    if (!scopeLoading && !isSuper && myDeptNames.length > 0 && !myDeptNames.includes(filterDept)) {
      setFilterDept(myDeptNames[0]);
    } else if (!scopeLoading && isSuper && scopeDeptName && !sameDept(filterDept, scopeDeptName)) {
      setFilterDept(scopeDeptName);
    } else if (!filterDept && departmentOptions.length > 0) {
      setFilterDept(departmentOptions[0].name);
    }
  }, [scopeLoading, isSuper, myDeptNames.join("|"), scopeDeptId, scopeDeptName, departmentOptions]);

  // When selected department changes, auto-sync Academic Year & Semester to that department's active period
  const prevDeptRef = useRef(null);
  useEffect(() => {
    if (!filterDept || academicYearOptions.length === 0) return;
    if (prevDeptRef.current !== null && prevDeptRef.current !== filterDept) {
      const activeForDept = pickActivePeriod(academicYearOptions, filterDept)
        || academicYearOptions.find(y => sameDept(y.departments?.name, filterDept) && isPeriodActive(y))
        || academicYearOptions.find(y => sameDept(y.departments?.name, filterDept) && isStatusOngoing(y.status))
        || academicYearOptions.find(y => sameDept(y.departments?.name, filterDept))
        || academicYearOptions[0];

      if (activeForDept?.year) {
        setFilterAY(activeForDept.year);
        if (activeForDept.semester) {
          setFilterSemester(activeForDept.semester);
        }
      }
    }
    prevDeptRef.current = filterDept;
  }, [filterDept, academicYearOptions]);

  const getSectionsForYear = useCallback((dept, year) => {
    const secMap = new Map();
    const addSec = (raw) => {
      if (!raw) return;
      const trimmed = String(raw).trim();
      if (!trimmed) return;
      // Normalize: "Section A" -> "A", "A" -> "A"
      const clean = trimmed.replace(/^section\s+/i, "").trim().toUpperCase() || trimmed;
      if (!secMap.has(clean)) {
        secMap.set(clean, clean);
      }
    };

    // 1. Configured sections from sections table
    sectionOptions
      .filter((sec) => (!dept || sameDept(sec.department, dept)) && normYear(sec.year_level) === normYear(year))
      .forEach((sec) => addSec(sec.name));

    // 2. Sections from active assignments in the selected academic year and semester (excludes obsolete historical years)
    assignmentList
      .filter((a) =>
        (!dept || sameDept(a.department, dept)) &&
        normYear(a.yearLevel) === normYear(year) &&
        (!filterAY || sameAY(a.academicYear, filterAY)) &&
        (!filterSemester || matchSemester(a.semester, filterSemester)) &&
        a.section
      )
      .forEach((a) => addSec(a.section));

    if (secMap.size > 0) {
      return Array.from(secMap.values()).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    }
    return ["A", "B"];
  }, [sectionOptions, assignmentList, filterAY, filterSemester]);

  const getInitials = (name) => {
    if (!name) return "??";
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  const AVATAR_COLORS = ["#2563eb", "#7c3aed", "#0891b2", "#059669", "#d97706", "#dc2626", "#4f46e5", "#0d9488"];
  const getAvatarColor = (name) => {
    if (!name) return "#64748b";
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
  };

  // ----------------------------------------------------
  // Slot Direct Actions (Assign, Change, Remove, Batch)
  // ----------------------------------------------------
  const handleSlotAssign = async (targetSubject, targetSection, faculty) => {
    try {
      const selectedDept = departmentOptions.find((d) => sameDept(d.name, filterDept));
      const deptActiveAy = pickActivePeriod(academicYearOptions, filterDept);
      const targetAY = filterAY || deptActiveAy?.year || (availableAcademicYears[0] || "2025-2026");
      const targetSem = (filterSemester && filterSemester.trim()) || targetSubject.semester || deptActiveAy?.semester || "1st Semester";

      const existing = assignmentList.find(a =>
        sameAY(a.academicYear, targetAY) &&
        matchSemester(a.semester, targetSem) &&
        sameDept(a.department, filterDept) &&
        a.subjectCode === targetSubject.code &&
        (a.section === targetSection || a.section?.replace(/^section\s+/i, "").toUpperCase() === targetSection?.replace(/^section\s+/i, "").toUpperCase())
      );

      if (existing) {
        const { error } = await supabase.from('class_assignments').update({
          faculty_id: faculty.id,
          faculty_name: faculty.fullName,
          department: filterDept,
          department_id: selectedDept?.id || null,
          year_level: selectedYearTab,
          semester: targetSem,
          academic_year: targetAY,
        }).eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('class_assignments').insert([{
          faculty_id: faculty.id,
          faculty_name: faculty.fullName,
          subject_code: targetSubject.code,
          subject_name: targetSubject.description || targetSubject.name || "",
          department: filterDept,
          department_id: selectedDept?.id || null,
          year_level: selectedYearTab,
          section: targetSection,
          semester: targetSem,
          academic_year: targetAY,
        }]);
        if (error) throw error;
      }

      await reloadAssignments();
      setSlotModal(null);
    } catch (err) {
      console.error("Slot Assign error:", err);
      alert(`Failed to assign: ${err.message || 'Unknown error'}`);
    }
  };

  const handleBatchAssignToAllSections = async (targetSubject, sectionsList, faculty) => {
    try {
      const selectedDept = departmentOptions.find((d) => sameDept(d.name, filterDept));
      const deptActiveAy = pickActivePeriod(academicYearOptions, filterDept);
      const targetAY = filterAY || deptActiveAy?.year || (availableAcademicYears[0] || "2025-2026");
      const targetSem = (filterSemester && filterSemester.trim()) || targetSubject.semester || deptActiveAy?.semester || "1st Semester";

      for (const sec of sectionsList) {
        const existing = assignmentList.find(a =>
          sameAY(a.academicYear, targetAY) &&
          matchSemester(a.semester, targetSem) &&
          sameDept(a.department, filterDept) &&
          a.subjectCode === targetSubject.code &&
          (a.section === sec || a.section?.replace(/^section\s+/i, "").toUpperCase() === sec?.replace(/^section\s+/i, "").toUpperCase())
        );

        if (existing) {
          await supabase.from('class_assignments').update({
            faculty_id: faculty.id,
            faculty_name: faculty.fullName,
            department: filterDept,
            department_id: selectedDept?.id || null,
            year_level: selectedYearTab,
            semester: targetSem,
            academic_year: targetAY,
          }).eq('id', existing.id);
        } else {
          await supabase.from('class_assignments').insert([{
            faculty_id: faculty.id,
            faculty_name: faculty.fullName,
            subject_code: targetSubject.code,
            subject_name: targetSubject.description || targetSubject.name || "",
            department: filterDept,
            department_id: selectedDept?.id || null,
            year_level: selectedYearTab,
            section: sec,
            semester: targetSem,
            academic_year: targetAY,
          }]);
        }
      }

      await reloadAssignments();
      setSlotModal(null);
    } catch (err) {
      console.error("Batch assign error:", err);
      alert(`Failed to assign all sections: ${err.message || 'Unknown error'}`);
    }
  };

  const handleSlotRemove = async (assignmentId) => {
    if (!assignmentId) return;
    if (!confirm("Remove this teacher from this section?")) return;
    try {
      const { error } = await supabase.from('class_assignments').delete().eq('id', assignmentId);
      if (error) throw error;
      setAssignmentList(prev => prev.filter(a => a.id !== assignmentId));
      setSlotModal(null);
    } catch (err) {
      console.error("Remove error:", err);
      alert(`Failed to remove: ${err.message || 'Unknown error'}`);
    }
  };

  // ----------------------------------------------------
  // Full Modal Save (Existing flow preserved)
  // ----------------------------------------------------
  const handleSave = async () => {
    try {
      if (!formData.facultyId) {
        alert("Please select a faculty member.");
        return;
      }
      if (!formData.department) {
        alert("Please select a program/department.");
        return;
      }
      if (!formData.yearLevel) {
        alert("Please select a year level.");
        return;
      }
      if (!formData.subjectCode) {
        alert("Please select a subject.");
        return;
      }
      if (!formData.semester) {
        alert("Please select a semester.");
        return;
      }
      if (!formData.academicYear) {
        alert("Please select an academic year.");
        return;
      }

      const selectedDept = departmentOptions.find((d) => sameDept(d.name, formData.department));

      if (editingAssignment) {
        if (!formData.section) {
          alert("Please select a section.");
          return;
        }
        const { error } = await supabase.from('class_assignments').update({
          faculty_id: formData.facultyId,
          faculty_name: formData.facultyName,
          subject_code: formData.subjectCode,
          subject_name: formData.subjectName,
          department: formData.department,
          department_id: selectedDept?.id || null,
          year_level: formData.yearLevel,
          section: formData.section,
          semester: formData.semester,
          academic_year: formData.academicYear,
        }).eq('id', editingAssignment.id);
        if (error) throw error;
      } else {
        const sectionsToCreate = formData.selectedSections && formData.selectedSections.length > 0
          ? formData.selectedSections
          : (formData.section ? [formData.section] : []);

        if (sectionsToCreate.length === 0) {
          alert("Please select at least one section.");
          return;
        }

        const existingSections = new Set(
          assignmentList
            .filter(a => 
              a.facultyId === formData.facultyId &&
              a.subjectCode === formData.subjectCode &&
              matchSemester(a.semester, formData.semester) &&
              sameAY(a.academicYear, formData.academicYear)
            )
            .map(a => a.section)
        );

        const newSections = sectionsToCreate.filter(sec => !existingSections.has(sec));
        const skippedSections = sectionsToCreate.filter(sec => existingSections.has(sec));

        if (newSections.length === 0) {
          alert(`This faculty is already assigned to ${skippedSections.map(s => `Section ${s}`).join(", ")} for this subject, semester, and academic year.`);
          return;
        }

        const rowsToInsert = newSections.map(sec => ({
          faculty_id: formData.facultyId,
          faculty_name: formData.facultyName,
          subject_code: formData.subjectCode,
          subject_name: formData.subjectName,
          department: formData.department,
          department_id: selectedDept?.id || null,
          year_level: formData.yearLevel,
          section: sec,
          semester: formData.semester,
          academic_year: formData.academicYear,
        }));

        const { error } = await supabase.from('class_assignments').insert(rowsToInsert);
        if (error) throw error;

        if (skippedSections.length > 0) {
          alert(`Successfully assigned ${newSections.map(s => `Section ${s}`).join(", ")}.\n(Skipped ${skippedSections.map(s => `Section ${s}`).join(", ")} because already assigned.)`);
        }
      }

      await reloadAssignments();
      setShowModal(false);
    } catch (err) {
      console.error("Save error:", err);
      alert(`Failed to save: ${err.message || 'Unknown error'}`);
    }
  };

  const handleDelete = async (id) => {
    if (confirm("Delete this assignment?")) {
      const { error } = await supabase.from('class_assignments').delete().eq('id', id);
      if (!error) {
        setAssignmentList(assignmentList.filter(a => a.id !== id));
      }
    }
  };

  // ----------------------------------------------------
  // Deduplicated academic years from registered periods only, sorted descending
  const availableAcademicYears = useMemo(() => {
    const map = new Map();
    const addYear = (yStr) => {
      if (!yStr || !yStr.trim()) return;
      const trimmed = yStr.trim();
      const cleanKey = trimmed.toLowerCase().replace(/^a\.?y\.?\s*/i, "").replace(/\s+/g, "");
      if (!map.has(cleanKey)) {
        map.set(cleanKey, trimmed);
      }
    };
    academicYearOptions
      .filter((y) => !filterDept || !y.departments?.name || sameDept(y.departments?.name, filterDept))
      .forEach(y => addYear(y.year));
    return Array.from(map.values()).sort((a, b) => b.localeCompare(a));
  }, [academicYearOptions, filterDept]);

  const displayedAYOptions = useMemo(() => {
    return availableAcademicYears;
  }, [availableAcademicYears]);

  // Keep filterAY in sync: if currently selected filterAY was deleted or is invalid, reset to valid period
  useEffect(() => {
    if (availableAcademicYears.length > 0) {
      if (filterAY && !availableAcademicYears.some(y => sameAY(y, filterAY))) {
        setFilterAY(availableAcademicYears[0] || "");
      }
    } else if (filterAY) {
      setFilterAY("");
    }
  }, [availableAcademicYears, filterAY]);

  // ----------------------------------------------------
  // Filtered Assignments for Classic Table View
  // ----------------------------------------------------
  const filteredAssignments = useMemo(() => {
    return assignmentList
      .filter(a => !deletedFacultyIds.has(a.facultyId))
      .filter(a => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        return (
          a.facultyName?.toLowerCase().includes(q) ||
          a.subjectCode?.toLowerCase().includes(q) ||
          a.subjectName?.toLowerCase().includes(q) ||
          a.section?.toLowerCase().includes(q)
        );
      })
      .filter(a => !filterDept || sameDept(a.department, filterDept))
      .filter(a => !filterYear || normYear(a.yearLevel) === normYear(filterYear))
      .filter(a => !filterSemester || matchSemester(a.semester, filterSemester))
      .filter(a => !filterAY || sameAY(a.academicYear, filterAY));
  }, [assignmentList, deletedFacultyIds, searchQuery, filterDept, filterYear, filterSemester, filterAY]);

  // ----------------------------------------------------
  // Subject Board: Year Tab Progress Statistics
  // ----------------------------------------------------
  const yearTabStats = useMemo(() => {
    const years = ["1st", "2nd", "3rd", "4th"];
    return years.map((y) => {
      const curriculumSubs = subjectOptions.filter(
        (s) =>
          sameDept(s.department, filterDept) &&
          normYear(s.year_level) === normYear(y)
      );

      const relevantAssignments = assignmentList.filter(
        (a) =>
          !deletedFacultyIds.has(a.facultyId) &&
          sameDept(a.department, filterDept) &&
          normYear(a.yearLevel) === normYear(y) &&
          (!filterAY || sameAY(a.academicYear, filterAY)) &&
          (!filterSemester || matchSemester(a.semester, filterSemester))
      );

      const assignedSubCodes = new Set(relevantAssignments.map((a) => a.subjectCode));
      const matchedCurriculumSubs = curriculumSubs.filter(
        (s) => (!filterSemester || matchSemester(s.semester, filterSemester)) || assignedSubCodes.has(s.code)
      );
      const existingCodes = new Set(matchedCurriculumSubs.map((s) => s.code));
      const extraSubs = [];
      relevantAssignments.forEach((a) => {
        if (a.subjectCode && !existingCodes.has(a.subjectCode)) {
          existingCodes.add(a.subjectCode);
          extraSubs.push({
            id: `custom-${a.subjectCode}`,
            code: a.subjectCode,
            name: a.subjectName || a.subjectCode,
            description: a.subjectName || a.subjectCode,
            department: a.department,
            year_level: a.yearLevel,
            semester: a.semester,
            units: 3,
          });
        }
      });
      const subs = [...matchedCurriculumSubs, ...extraSubs];
      const secs = getSectionsForYear(filterDept, y);
      const totalSlots = subs.length * secs.length;

      let filledSlots = 0;
      subs.forEach((s) => {
        secs.forEach((sec) => {
          const hasTeacher = assignmentList.some(
            (a) =>
              !deletedFacultyIds.has(a.facultyId) &&
              sameDept(a.department, filterDept) &&
              (!filterAY || sameAY(a.academicYear, filterAY)) &&
              (!filterSemester || matchSemester(a.semester, filterSemester)) &&
              normYear(a.yearLevel) === normYear(y) &&
              a.subjectCode === s.code &&
              (a.section === sec || a.section?.replace(/^section\s+/i, "").toUpperCase() === sec)
          );
          if (hasTeacher) filledSlots++;
        });
      });

      const pct = totalSlots > 0 ? Math.round((filledSlots / totalSlots) * 100) : 0;
      return {
        year: y,
        totalSlots,
        filledSlots,
        pct,
      };
    });
  }, [subjectOptions, assignmentList, filterDept, filterAY, filterSemester, deletedFacultyIds, getSectionsForYear]);

  // ----------------------------------------------------
  // Subject Board: Cards for Selected Year
  // ----------------------------------------------------
  const activeYearCards = useMemo(() => {
    const curriculumSubs = subjectOptions.filter(
      (s) =>
        sameDept(s.department, filterDept) &&
        normYear(s.year_level) === normYear(selectedYearTab)
    );

    const relevantAssignments = assignmentList.filter(
      (a) =>
        !deletedFacultyIds.has(a.facultyId) &&
        sameDept(a.department, filterDept) &&
        normYear(a.yearLevel) === normYear(selectedYearTab) &&
        (!filterAY || sameAY(a.academicYear, filterAY)) &&
        (!filterSemester || matchSemester(a.semester, filterSemester))
    );

    const assignedSubCodes = new Set(relevantAssignments.map((a) => a.subjectCode));
    const matchedCurriculumSubs = curriculumSubs.filter(
      (s) => (!filterSemester || matchSemester(s.semester, filterSemester)) || assignedSubCodes.has(s.code)
    );
    const existingCodes = new Set(matchedCurriculumSubs.map((s) => s.code));
    const extraSubs = [];
    relevantAssignments.forEach((a) => {
      if (a.subjectCode && !existingCodes.has(a.subjectCode)) {
        existingCodes.add(a.subjectCode);
        extraSubs.push({
          id: `custom-${a.subjectCode}`,
          code: a.subjectCode,
          name: a.subjectName || a.subjectCode,
          description: a.subjectName || a.subjectCode,
          department: a.department,
          year_level: a.yearLevel,
          semester: a.semester,
          units: 3,
        });
      }
    });
    const subs = [...matchedCurriculumSubs, ...extraSubs];
    const secs = getSectionsForYear(filterDept, selectedYearTab);

    return subs
      .map((s) => {
        const sectionSlots = secs.map((sec) => {
          const assignment = assignmentList.find(
            (a) =>
              !deletedFacultyIds.has(a.facultyId) &&
              sameDept(a.department, filterDept) &&
              (!filterAY || sameAY(a.academicYear, filterAY)) &&
              (!filterSemester || matchSemester(a.semester, filterSemester)) &&
              normYear(a.yearLevel) === normYear(selectedYearTab) &&
              a.subjectCode === s.code &&
              (a.section === sec || a.section?.replace(/^section\s+/i, "").toUpperCase() === sec)
          );
          return {
            section: sec,
            assignment: assignment || null,
          };
        });

        const assignedCount = sectionSlots.filter((sa) => sa.assignment !== null).length;
        const totalCount = secs.length;
        const isComplete = assignedCount === totalCount && totalCount > 0;
        const isUnassigned = assignedCount === 0;

        return {
          subject: s,
          sections: sectionSlots,
          assignedCount,
          totalCount,
          isComplete,
          isUnassigned,
        };
      })
      .filter((item) => {
        if (showUnassignedOnly && item.isComplete) return false;
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const codeMatch = item.subject.code?.toLowerCase().includes(q);
          const nameMatch = (item.subject.description || item.subject.name)?.toLowerCase().includes(q);
          const teacherMatch = item.sections.some((sa) =>
            sa.assignment?.facultyName?.toLowerCase().includes(q)
          );
          return codeMatch || nameMatch || teacherMatch;
        }
        return true;
      });
  }, [subjectOptions, assignmentList, filterDept, filterAY, filterSemester, selectedYearTab, showUnassignedOnly, searchQuery, deletedFacultyIds, getSectionsForYear]);

  // ----------------------------------------------------
  // Faculty Load Sidebar List (No limits, simple workload count)
  // ----------------------------------------------------
  const facultyLoadList = useMemo(() => {
    const facs = facultyOptions.filter(
      (f) => !filterDept || sameDept(f.department, filterDept) || isSuper
    );

    return facs
      .map((f) => {
        const myAssignments = assignmentList.filter(
          (a) =>
            a.facultyId === f.id &&
            (!filterAY || sameAY(a.academicYear, filterAY)) &&
            (!filterSemester || matchSemester(a.semester, filterSemester))
        );
        return {
          faculty: f,
          loadCount: myAssignments.length,
        };
      })
      .sort((a, b) => b.loadCount - a.loadCount);
  }, [facultyOptions, assignmentList, filterDept, filterAY, filterSemester, isSuper]);

  // Modal helpers for Add/Edit
  const availableSections = useMemo(() => {
    if (!formData.department || !formData.yearLevel) {
      return ["A", "B", "C", "D"];
    }
    const matches = sectionOptions.filter(
      (sec) =>
        sameDept(sec.department, formData.department) &&
        normYear(sec.year_level) === normYear(formData.yearLevel)
    );
    if (matches.length > 0) {
      return matches.map((m) => m.name);
    }
    return ["A", "B", "C", "D"];
  }, [formData.department, formData.yearLevel, sectionOptions]);

  const modalSubjectOptions = useMemo(() => {
    if (showAllSubjectsInModal || !formData.department || !formData.yearLevel) {
      return subjectOptions;
    }
    const filtered = subjectOptions.filter(
      (s) =>
        sameDept(s.department, formData.department) &&
        normYear(s.year_level) === normYear(formData.yearLevel) &&
        (!formData.semester || matchSemester(s.semester, formData.semester))
    );
    return filtered.length > 0 ? filtered : subjectOptions;
  }, [formData.department, formData.yearLevel, formData.semester, subjectOptions, showAllSubjectsInModal]);

  return (
    <AdminLayout title="Class Assignment">
      <section className="ad-content">
        {/* Welcome Header */}
        <div className="ad-welcomeHeader">
          <div>
            <h2 className="ad-title">Class Assignment</h2>
            <p className="ad-subtitle">Manage faculty assignments across subjects, year levels, and sections</p>
          </div>
          <button className="ad-btnPrimary" onClick={() => {
            setEditingAssignment(null);
            setFormData({
              facultyId: "", facultyName: "", subjectCode: "", subjectName: "",
              department: filterDept || (!isSuper && myDeptNames[0]) || "",
              yearLevel: selectedYearTab, section: "", selectedSections: [],
              semester: filterSemester || "1st Semester", academicYear: filterAY || (availableAcademicYears[0] || "")
            });
            setShowModal(true);
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add New Assignment
          </button>
        </div>

        {/* Top Context Bar */}
        <div className="ca-contextBar">
          {/* Program Select */}
          <div className="ca-contextField">
            <label className="ca-contextLabel">Program</label>
            <select
              className="ca-contextSelect"
              value={filterDept}
              disabled={!isSuper && myDeptNames.length <= 1}
              onChange={(e) => setFilterDept(e.target.value)}
            >
              {(isSuper && !scopeDeptId ? departmentOptions : departmentOptions.filter(d => scopeNameMatch(d.name) || d.id === scopeDeptId)).map(d => (
                <option key={d.id} value={d.name}>{d.name}</option>
              ))}
            </select>
          </div>

          {/* Academic Year Select */}
          <div className="ca-contextField">
            <label className="ca-contextLabel">Academic Year</label>
            <select
              className="ca-contextSelect"
              value={filterAY}
              onChange={(e) => setFilterAY(e.target.value)}
            >
              <option value="">All Academic Years</option>
              {displayedAYOptions.map(year => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </div>

          {/* Semester Select */}
          <div className="ca-contextField">
            <label className="ca-contextLabel">Semester</label>
            <select
              className="ca-contextSelect"
              value={filterSemester}
              onChange={(e) => setFilterSemester(e.target.value)}
            >
              <option value="1st Semester">1st Semester</option>
              <option value="2nd Semester">2nd Semester</option>
              <option value="Summer">Summer</option>
              <option value="">All Semesters</option>
            </select>
          </div>

          {/* View Mode Toggle */}
          <div className="ca-viewToggle">
            <button
              type="button"
              className={`ca-viewToggleBtn ${viewMode === "card" ? "ca-viewToggleBtn--active" : ""}`}
              onClick={() => setViewMode("card")}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" />
              </svg>
              Card View
            </button>
            <button
              type="button"
              className={`ca-viewToggleBtn ${viewMode === "table" ? "ca-viewToggleBtn--active" : ""}`}
              onClick={() => setViewMode("table")}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
                <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
              </svg>
              Table View
            </button>
          </div>
        </div>

        {/* ---------------------------------------------------- */}
        {/* VIEW 1: SUBJECT BOARD (CARD VIEW)                    */}
        {/* ---------------------------------------------------- */}
        {viewMode === "card" && (
          <>
            {/* Year Level Tabs with Fill Progress */}
            <div className="ca-yearTabs">
              {yearTabStats.map((stat) => {
                const isActive = selectedYearTab === stat.year;
                const barColor = stat.pct === 100 ? "#16a34a" : stat.pct >= 50 ? "#2563eb" : "#f59e0b";
                return (
                  <button
                    key={stat.year}
                    type="button"
                    className={`ca-yearTab ${isActive ? "ca-yearTab--active" : ""}`}
                    onClick={() => setSelectedYearTab(stat.year)}
                  >
                    <div className="ca-yearTabHeader">
                      <span className="ca-yearTabTitle">{stat.year} Year</span>
                      <span className="ca-yearTabRatio">{stat.filledSlots} / {stat.totalSlots}</span>
                    </div>
                    <div className="ca-yearProgressBar">
                      <div
                        className="ca-yearProgressFill"
                        style={{ width: `${stat.pct}%`, background: barColor }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Board Toolbar (Search & Unassigned Only toggle) */}
            <div className="ca-boardToolbar">
              <div className="ca-toolbarSearchWrap">
                <svg className="ca-toolbarSearchIcon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  type="text"
                  className="ca-toolbarSearchInput"
                  placeholder="Search subject code, name, teacher..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                <label className="ca-unassignedCheckbox">
                  <input
                    type="checkbox"
                    checked={showUnassignedOnly}
                    onChange={(e) => setShowUnassignedOnly(e.target.checked)}
                  />
                  <span>Show unassigned only</span>
                </label>
                {highlightedFacultyId && (
                  <button
                    type="button"
                    onClick={() => setHighlightedFacultyId(null)}
                    style={{ background: "#fef9c3", border: "1px solid #facc15", color: "#854d0e", fontSize: "12px", fontWeight: 700, padding: "4px 10px", borderRadius: "6px", cursor: "pointer" }}
                  >
                    Clear Teacher Highlight ✕
                  </button>
                )}
              </div>
            </div>

            {/* Main 2-Column Board: Cards Grid + Faculty Load Sidebar */}
            <div className="ca-boardLayout">
              {/* Cards Grid */}
              <div className="ca-cardsGrid">
                {activeYearCards.length > 0 ? (
                  activeYearCards.map((item) => {
                    const badgeClass = item.isComplete
                      ? "ca-badge--complete"
                      : item.isUnassigned
                        ? "ca-badge--unassigned"
                        : "ca-badge--partial";

                    const badgeText = item.isComplete
                      ? "Complete"
                      : item.isUnassigned
                        ? "Unassigned"
                        : `${item.assignedCount} of ${item.totalCount} assigned`;

                    const allSectionsList = item.sections.map(s => s.section);

                    return (
                      <div key={item.subject.id || item.subject.code} className="ca-card">
                        {/* Card Header */}
                        <div className="ca-cardHead">
                          <div>
                            <div className="ca-subjectCode">{item.subject.code}</div>
                            <div className="ca-subjectName">{item.subject.description || item.subject.name}</div>
                            <div className="ca-subjectMeta">
                              <span>{item.subject.units || 3} units</span>
                              {item.subject.semester && (
                                <>
                                  <span style={{ opacity: 0.4 }}>•</span>
                                  <span style={{ color: "#2563eb", fontWeight: 600 }}>{item.subject.semester}</span>
                                </>
                              )}
                            </div>
                          </div>
                          <span className={`ca-badge ${badgeClass}`}>{badgeText}</span>
                        </div>

                        {/* Section Rows */}
                        <div className="ca-sectionRows">
                          {item.sections.map((slot) => {
                            const isAssigned = slot.assignment !== null;
                            const isHighlighted = isAssigned && slot.assignment.facultyId === highlightedFacultyId;

                            if (isAssigned) {
                              const facName = slot.assignment.facultyName || "Unknown Faculty";
                              return (
                                <div key={slot.section} className="ca-sectionRow">
                                  <span className="ca-sectionLabel">Section {slot.section}</span>
                                  <div
                                    className={`ca-slot ${isHighlighted ? "ca-slot--highlighted" : ""}`}
                                    onClick={() => {
                                      setSlotModal({
                                        open: true,
                                        subject: item.subject,
                                        section: slot.section,
                                        allSections: false,
                                        existingAssignment: slot.assignment,
                                      });
                                      setSlotSearch("");
                                    }}
                                    title="Click to change or remove teacher"
                                  >
                                    <div className="ca-slotTeacher">
                                      <div
                                        className="ca-avatarMini"
                                        style={{ background: getAvatarColor(facName) }}
                                      >
                                        {getInitials(facName)}
                                      </div>
                                      <span className="ca-teacherName">{facName}</span>
                                    </div>
                                    <div className="ca-slotActions">
                                      <button
                                        type="button"
                                        className="ca-slotActionBtn ca-slotActionBtn--remove"
                                        title="Remove teacher"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleSlotRemove(slot.assignment.id);
                                        }}
                                      >
                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                                        </svg>
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              );
                            }

                            // Unassigned Slot
                            return (
                              <div key={slot.section} className="ca-sectionRow">
                                <span className="ca-sectionLabel">Section {slot.section}</span>
                                <div
                                  className="ca-slot ca-slot--empty"
                                  onClick={() => {
                                    setSlotModal({
                                      open: true,
                                      subject: item.subject,
                                      section: slot.section,
                                      allSections: false,
                                      existingAssignment: null,
                                    });
                                    setSlotSearch("");
                                  }}
                                  title="Click to assign a teacher"
                                >
                                  + Assign teacher
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {/* Card Footer: Assign to all sections */}
                        <div className="ca-cardFoot">
                          <button
                            type="button"
                            className="ca-batchAssignBtn"
                            onClick={() => {
                              setSlotModal({
                                open: true,
                                subject: item.subject,
                                section: null,
                                allSections: true,
                                existingAssignment: null,
                                sectionsList: allSectionsList,
                              });
                              setSlotSearch("");
                            }}
                          >
                            Assign one teacher to all sections
                          </button>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: "48px 20px", background: "#ffffff", borderRadius: "12px", border: "1px solid #e2e8f0" }}>
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" style={{ margin: "0 auto 12px" }}>
                      <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" />
                    </svg>
                    <h3 style={{ fontSize: "15px", fontWeight: "700", color: "#334155", margin: "0 0 4px" }}>No subjects found</h3>
                    <p style={{ fontSize: "13px", color: "#64748b", margin: 0 }}>
                      {showUnassignedOnly
                        ? "All subjects in this semester and year level already have assigned teachers."
                        : `No subjects configured for ${filterDept} (${selectedYearTab} Year${filterSemester ? ` · ${filterSemester}` : ""}).`}
                    </p>
                  </div>
                )}
              </div>

              {/* Faculty Load Sidebar (No limit warnings, displays current assignments) */}
              <aside className="ca-facultySidebar">
                <h3 className="ca-sidebarTitle">Faculty Load</h3>
                <p className="ca-sidebarSubtitle">Click a teacher to highlight their classes</p>

                <div className="ca-facList">
                  {facultyLoadList.map(({ faculty, loadCount }) => {
                    const isSelected = highlightedFacultyId === faculty.id;
                    const name = faculty.fullName || faculty.name;
                    return (
                      <div
                        key={faculty.id}
                        className={`ca-facItem ${isSelected ? "ca-facItem--active" : ""}`}
                        onClick={() => setHighlightedFacultyId(isSelected ? null : faculty.id)}
                        title={`Click to highlight ${name}'s classes`}
                      >
                        <div
                          className="ca-avatarMini"
                          style={{ background: getAvatarColor(name) }}
                        >
                          {getInitials(name)}
                        </div>
                        <div className="ca-facItemInfo">
                          <div className="ca-facItemName">{name}</div>
                          <div className="ca-facItemCount">
                            {loadCount === 0 ? "No classes assigned" : `${loadCount} class${loadCount === 1 ? "" : "es"}`}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {facultyLoadList.length === 0 && (
                    <div style={{ textAlign: "center", padding: "20px 8px", color: "#94a3b8", fontSize: "13px" }}>
                      No faculty found for this program.
                    </div>
                  )}
                </div>
              </aside>
            </div>
          </>
        )}

        {/* ---------------------------------------------------- */}
        {/* VIEW 2: CLASSIC TABLE VIEW                           */}
        {/* ---------------------------------------------------- */}
        {viewMode === "table" && (
          <div className="ad-tableCard ad-tableCard--padded">
            {/* Table Filters */}
            <div className="ad-filterBar" style={{ padding: "12px 16px", marginBottom: "16px" }}>
              <div className="ad-searchWrap" style={{ flex: '1 1 220px' }}>
                <svg className="ad-searchIcon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
                <input
                  type="text"
                  className="ad-searchInput"
                  placeholder="Search by faculty, subject..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              <select
                className="ad-filterSelect"
                value={filterYear}
                onChange={(e) => setFilterYear(e.target.value)}
              >
                <option value="">All Years</option>
                {["1st", "2nd", "3rd", "4th"].map(y => <option key={y} value={y}>{y} Year</option>)}
              </select>

              {(filterYear || searchQuery || filterSemester || filterAY) && (
                <button
                  className="ad-filterClear"
                  onClick={() => {
                    setFilterYear("");
                    setSearchQuery("");
                    setFilterSemester("");
                    setFilterAY("");
                  }}
                >
                  Clear Filters
                </button>
              )}
            </div>

            <div className="ad-tableWrap ad-tableWrap--bordered" style={{ overflowX: 'auto' }}>
              <table className="ad-table ad-table--plain ad-table--compact">
                <thead>
                  <tr>
                    <th>Faculty Name</th>
                    <th>Subject Code</th>
                    <th>Program</th>
                    <th>Year & Section</th>
                    <th>Semester</th>
                    <th>Academic Year</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAssignments.length > 0 ? (
                    filteredAssignments.map((assignment) => (
                      <tr key={assignment.id}>
                        <td>
                          <div className="ad-avatarCell">
                            <div className="ad-avatar ad-avatar--blue">
                              {getInitials(assignment.facultyName)}
                            </div>
                            <div className="ad-cellLines">
                              <span className="ad-cellPrimary">{assignment.facultyName}</span>
                              <span className="ad-cellSecondary">Faculty</span>
                            </div>
                          </div>
                        </td>
                        <td className="ad-code">{assignment.subjectCode}</td>
                        <td>
                          <span className="ad-pill">
                            {assignment.department || "—"}
                          </span>
                        </td>
                        <td>
                          <span className="ad-badge ad-badge--info">{assignment.yearLevel} - {assignment.section}</span>
                        </td>
                        <td style={{ color: '#4b5563', fontSize: '14px' }}>{assignment.semester}</td>
                        <td style={{ color: '#4b5563', fontSize: '14px' }}>{assignment.academicYear}</td>
                        <td className="ad-tableActions" style={{ justifyContent: 'flex-end' }}>
                          <button
                            className="ad-actionBtn ad-actionBtn--edit"
                            title="Edit"
                            onClick={() => {
                              setEditingAssignment(assignment);
                              setFormData({
                                facultyId: assignment.facultyId || "",
                                facultyName: assignment.facultyName || "",
                                subjectCode: assignment.subjectCode || "",
                                subjectName: assignment.subjectName || "",
                                department: assignment.department || "",
                                yearLevel: assignment.yearLevel || "",
                                section: assignment.section || "",
                                selectedSections: assignment.section ? [assignment.section] : [],
                                semester: assignment.semester || "",
                                academicYear: assignment.academicYear || "",
                              });
                              setShowModal(true);
                            }}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                          </button>
                          <button
                            className="ad-actionBtn ad-actionBtn--delete"
                            title="Delete"
                            onClick={() => handleDelete(assignment.id)}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2-2v2" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="7" style={{ textAlign: "center", padding: "48px 20px", color: "#6b7280" }}>
                        <span style={{ fontSize: '15px', fontWeight: '500', color: '#4b5563' }}>No class assignments found</span>
                        <p style={{ margin: '4px 0 0 0', fontSize: '13px' }}>Try adjusting your search or filters.</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="ad-filterFooter">
              Showing <strong>{filteredAssignments.length}</strong> of <strong>{assignmentList.filter(a => !deletedFacultyIds.has(a.facultyId)).length}</strong> assignments
            </div>
          </div>
        )}
      </section>

      {/* ---------------------------------------------------- */}
      {/* QUICK SLOT ASSIGN MODAL (Card board direct click)    */}
      {/* ---------------------------------------------------- */}
      {slotModal && slotModal.open && (
        <div className="ad-modal">
          <div className="ad-modalOverlay" onClick={() => setSlotModal(null)} />
          <div className="ad-modalContent ca-quickModal">
            <div className="ad-modalHeader">
              <div>
                <h3 className="ad-modalTitle" style={{ fontSize: "16px" }}>
                  {slotModal.allSections
                    ? `Assign All Sections: ${slotModal.subject.code}`
                    : `Assign Teacher: ${slotModal.subject.code} — Section ${slotModal.section}`}
                </h3>
                <p style={{ margin: "2px 0 0", fontSize: "12px", color: "#64748b" }}>
                  {slotModal.subject.description || slotModal.subject.name} • {selectedYearTab} Year • {filterSemester}
                </p>
              </div>
              <button className="ad-modalClose" onClick={() => setSlotModal(null)}>×</button>
            </div>

            <div className="ad-modalBody" style={{ padding: "16px 20px" }}>
              {/* Search teacher */}
              <input
                type="text"
                className="ad-searchInput"
                placeholder="Search teacher by name..."
                value={slotSearch}
                onChange={(e) => setSlotSearch(e.target.value)}
                style={{ width: "100%", height: "38px" }}
                autoFocus
              />

              {/* Teacher options */}
              <div className="ca-teacherPickerList">
                {facultyOptions
                  .filter((f) => !filterDept || sameDept(f.department, filterDept) || isSuper)
                  .filter((f) => f.fullName?.toLowerCase().includes(slotSearch.toLowerCase()))
                  .map((fac) => {
                    const myCount = assignmentList.filter(
                      (a) =>
                        a.facultyId === fac.id &&
                        (!filterAY || sameAY(a.academicYear, filterAY)) &&
                        (!filterSemester || matchSemester(a.semester, filterSemester))
                    ).length;
                    const isCurrent = slotModal.existingAssignment?.facultyId === fac.id;

                    return (
                      <div
                        key={fac.id}
                        className={`ca-teacherOption ${isCurrent ? "ca-teacherOption--current" : ""}`}
                        onClick={() => {
                          if (slotModal.allSections) {
                            handleBatchAssignToAllSections(slotModal.subject, slotModal.sectionsList, fac);
                          } else {
                            handleSlotAssign(slotModal.subject, slotModal.section, fac);
                          }
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                          <div
                            className="ca-avatarMini"
                            style={{ background: getAvatarColor(fac.fullName) }}
                          >
                            {getInitials(fac.fullName)}
                          </div>
                          <div>
                            <div style={{ fontSize: "13.5px", fontWeight: "600", color: "#0f172a" }}>
                              {fac.fullName}
                            </div>
                            <div style={{ fontSize: "11.5px", color: "#64748b" }}>
                              {fac.department || filterDept}
                            </div>
                          </div>
                        </div>

                        <div style={{ textAlign: "right" }}>
                          <span style={{ fontSize: "12px", fontWeight: 700, color: "#2563eb" }}>
                            {myCount} class{myCount === 1 ? "" : "es"}
                          </span>
                          {isCurrent && (
                            <div style={{ fontSize: "10.5px", color: "#16a34a", fontWeight: 800 }}>
                              ✓ Current
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>

              {/* Remove button if currently assigned */}
              {slotModal.existingAssignment && !slotModal.allSections && (
                <div style={{ marginTop: "14px", paddingTop: "14px", borderTop: "1px solid #f1f5f9" }}>
                  <button
                    type="button"
                    onClick={() => handleSlotRemove(slotModal.existingAssignment.id)}
                    style={{
                      width: "100%",
                      padding: "9px 14px",
                      background: "#fef2f2",
                      border: "1px solid #fecaca",
                      color: "#dc2626",
                      borderRadius: "8px",
                      fontSize: "13px",
                      fontWeight: 700,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "6px"
                    }}
                  >
                    Remove Teacher from Section {slotModal.section}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* FULL CUSTOM ASSIGNMENT MODAL (Manual multi-section)  */}
      {/* ---------------------------------------------------- */}
      {showModal && (
        <div className="ad-modal">
          <div className="ad-modalOverlay" onClick={() => setShowModal(false)} />
          <div className="ad-modalContent ad-modalContent--large">
            <div className="ad-modalHeader">
              <h3 className="ad-modalTitle">{editingAssignment ? "Edit Class Assignment" : "Add New Class Assignment"}</h3>
              <button className="ad-modalClose" onClick={() => setShowModal(false)}>×</button>
            </div>
            <div className="ad-modalBody">
              <div className="ad-formRow">
                <div className="ad-formGroup">
                  <label className="ad-label">Program *</label>
                  <select
                    className="ad-input"
                    value={formData.department || ""}
                    onChange={(e) => {
                      const nextDept = e.target.value;
                      const currentSub = subjectOptions.find(s => s.code === formData.subjectCode);
                      const stillValid = currentSub && (!nextDept || sameDept(currentSub.department, nextDept));
                      setFormData({
                        ...formData,
                        department: nextDept,
                        subjectCode: stillValid ? formData.subjectCode : "",
                        subjectName: stillValid ? formData.subjectName : "",
                      });
                    }}
                  >
                    <option value="">Select program</option>
                    {(isSuper && !scopeDeptId ? departmentOptions : departmentOptions.filter(d => scopeNameMatch(d.name) || d.id === scopeDeptId)).map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
                  </select>
                </div>
                <div className="ad-formGroup">
                  <label className="ad-label">Academic Year *</label>
                  <select
                    className="ad-input"
                    value={formData.academicYear || ""}
                    onChange={(e) => setFormData({ ...formData, academicYear: e.target.value })}
                  >
                    <option value="">Select academic year</option>
                    {availableAcademicYears.map(year => (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="ad-formRow">
                <div className="ad-formGroup">
                  <label className="ad-label">Year Level *</label>
                  <select
                    className="ad-input"
                    value={formData.yearLevel || ""}
                    onChange={(e) => {
                      const nextYear = e.target.value;
                      const currentSub = subjectOptions.find(s => s.code === formData.subjectCode);
                      const stillValid = currentSub && (!nextYear || normYear(currentSub.year_level) === normYear(nextYear));
                      setFormData({
                        ...formData,
                        yearLevel: nextYear,
                        subjectCode: stillValid ? formData.subjectCode : "",
                        subjectName: stillValid ? formData.subjectName : "",
                      });
                    }}
                  >
                    <option value="">Select year</option>
                    {["1st", "2nd", "3rd", "4th"].map(y => <option key={y} value={y}>{y} Year</option>)}
                  </select>
                </div>
                <div className="ad-formGroup">
                  <label className="ad-label">Semester *</label>
                  <select
                    className="ad-input"
                    value={formData.semester || ""}
                    onChange={(e) => {
                      const nextSem = e.target.value;
                      const currentSub = subjectOptions.find(s => s.code === formData.subjectCode);
                      const stillValid = currentSub && (!nextSem || matchSemester(currentSub.semester, nextSem));
                      setFormData({
                        ...formData,
                        semester: nextSem,
                        subjectCode: stillValid ? formData.subjectCode : "",
                        subjectName: stillValid ? formData.subjectName : "",
                      });
                    }}
                  >
                    <option value="">Select semester</option>
                    {["1st Semester", "2nd Semester", "Summer"].map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              <div className="ad-formGroup">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                  <label className="ad-label" style={{ margin: 0 }}>
                    Subject *
                    {formData.department && formData.yearLevel && !showAllSubjectsInModal && modalSubjectOptions.length < subjectOptions.length && (
                      <span style={{ fontSize: "11px", color: "#059669", fontWeight: "700", marginLeft: "6px" }}>
                        (Filtered for {formData.yearLevel} Year{formData.semester ? ` · ${formData.semester}` : ""})
                      </span>
                    )}
                  </label>
                  {formData.department && formData.yearLevel && (
                    <button
                      type="button"
                      onClick={() => setShowAllSubjectsInModal(!showAllSubjectsInModal)}
                      style={{ background: "none", border: "none", color: "#2563eb", fontSize: "12px", cursor: "pointer", textDecoration: "underline" }}
                    >
                      {showAllSubjectsInModal ? "Filter by Curriculum" : "Show All Subjects"}
                    </button>
                  )}
                </div>
                <select
                  className="ad-input"
                  value={formData.subjectCode || ""}
                  onChange={(e) => {
                    const sub = subjectOptions.find(s => s.code === e.target.value);
                    setFormData({ ...formData, subjectCode: e.target.value, subjectName: sub?.description || "" });
                  }}
                >
                  <option value="">Select subject</option>
                  {modalSubjectOptions.map(s => (
                    <option key={s.id || s.code} value={s.code}>
                      {s.code} - {s.description}{s.semester ? ` (${s.semester})` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="ad-formGroup">
                <label className="ad-label">Faculty Member *</label>
                <select
                  className="ad-input"
                  value={formData.facultyId || ""}
                  onChange={(e) => {
                    const fac = facultyOptions.find(f => f.id === e.target.value);
                    setFormData({ ...formData, facultyId: e.target.value, facultyName: fac?.fullName || "" });
                  }}
                >
                  <option value="">Select faculty member</option>
                  {facultyOptions.map(f => <option key={f.id} value={f.id}>{f.fullName}</option>)}
                </select>
              </div>

              {/* Section selection */}
              {editingAssignment ? (
                <div className="ad-formGroup">
                  <label className="ad-label">
                    Section *
                    {availableSections.length > 0 && formData.department && (
                      <span style={{ fontSize: "11px", color: "#64748b", fontWeight: "500", marginLeft: "4px" }}>
                        ({availableSections.length} available)
                      </span>
                    )}
                  </label>
                  <select
                    className="ad-input"
                    value={formData.section || ""}
                    onChange={(e) => setFormData({ ...formData, section: e.target.value })}
                  >
                    <option value="">Select section</option>
                    {availableSections.map(s => <option key={s} value={s}>Section {s}</option>)}
                  </select>
                </div>
              ) : (
                <div className="ad-formGroup" style={{ marginTop: '4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
                    <label className="ad-label" style={{ margin: 0 }}>
                      Assign Sections *
                      {formData.selectedSections?.length > 0 && (
                        <span style={{ fontSize: "12px", color: "#2563eb", fontWeight: "700", marginLeft: "8px" }}>
                          ({formData.selectedSections.length} selected)
                        </span>
                      )}
                    </label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, selectedSections: [...availableSections] })}
                        style={{
                          background: "#eff6ff",
                          border: "1px solid #bfdbfe",
                          color: "#1d4ed8",
                          padding: "4px 10px",
                          borderRadius: "6px",
                          fontSize: "12px",
                          fontWeight: "600",
                          cursor: "pointer"
                        }}
                      >
                        Select All ({availableSections.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, selectedSections: [] })}
                        style={{
                          background: "#f3f4f6",
                          border: "1px solid #e5e7eb",
                          color: "#4b5563",
                          padding: "4px 10px",
                          borderRadius: "6px",
                          fontSize: "12px",
                          fontWeight: "600",
                          cursor: "pointer"
                        }}
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  <div style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '8px',
                    padding: '12px',
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    minHeight: '48px',
                    alignItems: 'center'
                  }}>
                    {availableSections.map((sec) => {
                      const isChecked = (formData.selectedSections || []).includes(sec);
                      return (
                        <button
                          key={sec}
                          type="button"
                          onClick={() => {
                            const current = formData.selectedSections || [];
                            const updated = isChecked
                              ? current.filter((s) => s !== sec)
                              : [...current, sec];
                            setFormData({ ...formData, selectedSections: updated });
                          }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '8px 14px',
                            borderRadius: '8px',
                            fontSize: '13px',
                            fontWeight: isChecked ? '600' : '500',
                            cursor: 'pointer',
                            border: isChecked ? '1.5px solid #2563eb' : '1px solid #cbd5e1',
                            background: isChecked ? '#eff6ff' : '#ffffff',
                            color: isChecked ? '#1d4ed8' : '#334155',
                          }}
                        >
                          <span style={{
                            width: '16px',
                            height: '16px',
                            borderRadius: '4px',
                            border: isChecked ? 'none' : '1.5px solid #94a3b8',
                            background: isChecked ? '#2563eb' : 'transparent',
                            color: '#ffffff',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '11px',
                            fontWeight: 'bold',
                            lineHeight: 1
                          }}>
                            {isChecked ? '✓' : ''}
                          </span>
                          Section {sec}
                        </button>
                      );
                    })}
                  </div>
                  {(!formData.selectedSections || formData.selectedSections.length === 0) ? (
                    <p style={{ margin: '6px 0 0 0', fontSize: '12px', color: '#dc2626' }}>
                      Please select at least one section for this assignment.
                    </p>
                  ) : (
                    <p style={{ margin: '6px 0 0 0', fontSize: '12px', color: '#059669', fontWeight: '500' }}>
                      ✓ {formData.selectedSections.length} assignment{formData.selectedSections.length > 1 ? 's' : ''} will be created ({formData.selectedSections.map(s => `Section ${s}`).join(', ')}).
                    </p>
                  )}
                </div>
              )}
            </div>
            <div className="ad-modalFooter">
              <button className="ad-btnSecondary" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="ad-btnPrimary" onClick={handleSave}>
                {editingAssignment
                  ? "Update Assignment"
                  : (formData.selectedSections?.length > 1
                      ? `Save ${formData.selectedSections.length} Assignments`
                      : "Save Assignment")}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
