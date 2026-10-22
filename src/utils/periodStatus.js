// Academic-period status helpers.
// A period counts as active while its status is on-going/active/open AND
// its end date (when set) has not passed (evaluated up to 23:59:59).

export function normalizeStatus(status) {
  return String(status || "").toLowerCase().trim().replace(/[^a-z]/g, "");
}

export function isStatusOngoing(status) {
  const s = normalizeStatus(status);
  return s === "ongoing" || s === "active" || s === "open";
}

export function periodEndPassed(row, today = new Date()) {
  const raw = String(row?.end_date ?? row?.endDate ?? "").trim();
  if (!raw) return false;
  // Compare against end of day (23:59:59) so the period remains active throughout the entire end date.
  const end = new Date(`${raw.slice(0, 10)}T23:59:59`);
  if (Number.isNaN(end.getTime())) return false;
  return end.getTime() < today.getTime();
}

export function periodNotStarted(row, today = new Date()) {
  const raw = String(row?.start_date ?? row?.startDate ?? "").trim();
  if (!raw) return false;
  // Compare against start of day (00:00:00) so period becomes active on its start date
  const start = new Date(`${raw.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(start.getTime())) return false;
  return today.getTime() < start.getTime();
}

export function isPeriodActive(row, today = new Date()) {
  if (!row) return false;
  const status = normalizeStatus(row.status);
  if (status === "closed" || status === "inactive" || status === "completed") return false;
  // Not active if start date is in the future
  if (periodNotStarted(row, today)) return false;
  // Automatically closed when the deadline has passed (evaluated to end of day 23:59:59).
  return !periodEndPassed(row, today);
}

export function periodStatusLabel(row, today = new Date()) {
  if (!row) return "Closed";
  if (periodNotStarted(row, today)) return "Scheduled";
  return isPeriodActive(row, today) ? "On-going" : "Closed";
}

export function normDeptStr(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function getCanonicalDept(val) {
  if (!val) return "";
  const s = String(val).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (s.includes("hospitality") || s === "bshm" || s === "hm") return "BSHM";
  if (s.includes("informationtechnology") || s.includes("infotech") || s === "bsit" || s === "it") return "BSIT";
  if (s.includes("entrepreneur") || s === "bsentrepreneur" || s === "bsentrep" || s === "entrep") return "BSEntrep";
  if (s.includes("secondary") || s === "bsed" || s === "sed") return "BSED";
  if (s.includes("elementary") || s === "beed" || s === "eed") return "BEED";
  if (s.includes("physical") || s === "bped" || s === "ped") return "BPED";
  return s.toUpperCase();
}

export function matchDepartment(deptA, deptB) {
  if (!deptA || !deptB) return false;
  const cA = getCanonicalDept(deptA);
  const cB = getCanonicalDept(deptB);
  if (cA && cB && cA === cB) return true;
  const a = normDeptStr(deptA);
  const b = normDeptStr(deptB);
  if (!a || !b) return false;
  return a === b;
}

// Pick the active period for a viewer's program:
// Strict isolation rules:
// 1. Program-specific periods always govern for that department.
//    - If an active period exists for userDept, return it.
//    - If an ongoing period exists (even if deadline passed), return it so UI shows deadline passed.
//    - If only closed periods exist for userDept, return the most recent closed period so UI displays CLOSED.
// 2. Global/Shared period (department_id IS NULL) applies ONLY if no program-specific period exists for userDept.
// 3. NEVER steal or leak another department's active period (no fallback to candidateList[0]).
export function pickActivePeriod(rows, userDept, today = new Date()) {
  const list = Array.isArray(rows) ? rows : [];
  if (!userDept && list.length === 0) return null;

  const sortNewest = (arr) => {
    const key = (r) => String(r.endDate ?? r.end_date ?? r.startDate ?? r.start_date ?? "");
    return [...arr].sort((a, b) => {
      const y = String(b.year || "").localeCompare(String(a.year || ""));
      if (y !== 0) return y;
      const s = key(b).localeCompare(key(a));
      if (s !== 0) return s;
      return String(b.semester || "").localeCompare(String(a.semester || ""));
    });
  };

  // 1. For Super Admin / Global oversight (when no userDept is specified):
  // Pick active period across any program, or the newest period in the system
  if (!userDept) {
    const sorted = sortNewest(list);
    const anyActive = sorted.find((r) => isPeriodActive(r, today));
    if (anyActive) return anyActive;
    return sorted[0] || null;
  }

  // 2. Look for periods specifically belonging to this student's department
  const deptPeriods = sortNewest(
    list.filter((r) => (r.departments?.name || r.department) && matchDepartment(r.departments?.name || r.department, userDept))
  );

  if (deptPeriods.length > 0) {
    const active = deptPeriods.find((r) => isPeriodActive(r, today));
    if (active) return active;
    // Return most recent closed/expired period for their own department so UI knows it's closed
    return deptPeriods[0];
  }

  // 3. Global shared periods (department_id IS NULL)
  const sharedPeriods = sortNewest(list.filter((r) => !r.department_id));
  if (sharedPeriods.length > 0) {
    const activeShared = sharedPeriods.find((r) => isPeriodActive(r, today));
    if (activeShared) return activeShared;
    return sharedPeriods[0];
  }

  // 4. Neither department period nor shared period exists: NULL (no period / closed)
  return null;
}

// List every period an admin created that belongs to the viewer's program,
// newest first. Mirrors the isolation rules of pickActivePeriod:
// program-specific periods only; shared periods (department_id IS NULL)
// are listed only when the program has none of its own.
// Never exposes another department's periods.
export function listStudentPeriods(rows, userDept) {
  const list = Array.isArray(rows) ? rows : [];
  const deptPeriods = list.filter(
    (r) => r.departments?.name && matchDepartment(r.departments.name, userDept)
  );
  const scoped = deptPeriods.length > 0 ? deptPeriods : list.filter((r) => !r.department_id);
  const key = (r) => String(r.startDate ?? r.start_date ?? "");
  return [...scoped].sort((a, b) => {
    const y = String(b.year || "").localeCompare(String(a.year || ""));
    if (y !== 0) return y;
    const s = key(b).localeCompare(key(a));
    if (s !== 0) return s;
    return String(b.semester || "").localeCompare(String(a.semester || ""));
  });
}
