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

export function isPeriodActive(row, today = new Date()) {
  if (!row) return false;
  if (!isStatusOngoing(row.status)) return false;
  return !periodEndPassed(row, today);
}

export function periodStatusLabel(row, today = new Date()) {
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

  // 1. Look for periods specifically belonging to this student's department
  const deptPeriods = list.filter((r) =>
    r.departments?.name && matchDepartment(r.departments.name, userDept)
  );

  if (deptPeriods.length > 0) {
    const active = deptPeriods.find((r) => isPeriodActive(r, today));
    if (active) return active;
    const ongoing = deptPeriods.find((r) => isStatusOngoing(r.status));
    if (ongoing) return ongoing;
    // Return closed/expired period for their own department so UI knows it's closed
    return deptPeriods[0];
  }

  // 2. Global shared periods (department_id IS NULL)
  const sharedPeriods = list.filter((r) => !r.department_id);
  if (sharedPeriods.length > 0) {
    const activeShared = sharedPeriods.find((r) => isPeriodActive(r, today));
    if (activeShared) return activeShared;
    const ongoingShared = sharedPeriods.find((r) => isStatusOngoing(r.status));
    if (ongoingShared) return ongoingShared;
    return sharedPeriods[0];
  }

  // 3. Neither department period nor shared period exists: NULL (no period / closed)
  return null;
}
