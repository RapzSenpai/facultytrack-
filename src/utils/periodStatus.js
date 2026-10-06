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

// Department name normalizer for flexible matching (e.g. BSIT <-> Bachelor of Science in Information Technology)
function normDeptStr(val) {
  return String(val || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function matchDepartment(deptA, deptB) {
  if (!deptA || !deptB) return false;
  const a = normDeptStr(deptA);
  const b = normDeptStr(deptB);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  return false;
}

// Pick the active period for a viewer's program:
// 1. Prioritize active periods (on-going status + unexpired end date)
//    - Program match
//    - Shared period (NULL department_id)
//    - First active period
// 2. If all ongoing periods have expired end dates, still pick the matching ongoing period
//    so the UI can display the period details and explain that the deadline has passed.
export function pickActivePeriod(rows, userDept, today = new Date()) {
  const list = Array.isArray(rows) ? rows : [];
  const actives = list.filter((r) => isPeriodActive(r, today));

  const findBest = (candidateList) => {
    return candidateList.find((r) => r.departments?.name && matchDepartment(r.departments.name, userDept))
      || candidateList.find((r) => !r.department_id)
      || candidateList[0]
      || null;
  };

  const bestActive = findBest(actives);
  if (bestActive) return bestActive;

  // Fallback: ongoing status even if end date has passed
  const ongoing = list.filter((r) => isStatusOngoing(r.status));
  return findBest(ongoing);
}
