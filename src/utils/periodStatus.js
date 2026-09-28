// Academic-period status helpers.
// A period counts as active only while its status is on-going AND
// its end date (when set) has not passed. The stored status flips
// only on manual close, so every display/selector derives from here
// instead of reading the raw status field. Dates compare as real
// calendar days (not strings), so any stored format works.
export function periodEndPassed(row, today = new Date()) {
  const raw = String(row?.end_date ?? row?.endDate ?? "").trim();
  if (!raw) return false;
  const end = new Date(`${raw.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(end.getTime())) return false;
  const day = new Date(today);
  day.setHours(0, 0, 0, 0);
  return end < day;
}

export function isPeriodActive(row, today = new Date()) {
  if (!row) return false;
  if ((row.status || "").toLowerCase().trim() !== "on-going") return false;
  return !periodEndPassed(row, today);
}

export function periodStatusLabel(row, today = new Date()) {
  return isPeriodActive(row, today) ? "On-going" : "Closed";
}

// Pick the active period for a viewer's program: own-program row
// first, then shared (NULL department), then first active. RLS
// already restricts rows to own + shared; this only orders them.
export function pickActivePeriod(rows, userDept, today = new Date()) {
  const actives = (rows || []).filter((r) => isPeriodActive(r, today));
  const same = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
  return actives.find((r) => r.departments?.name && same(r.departments.name, userDept))
    || actives.find((r) => !r.department_id)
    || actives[0]
    || null;
}
