// Academic-period status helpers.
// A period counts as active only while its status is on-going AND
// its end date (when set) has not passed. The stored status flips
// only on manual close, so every display/selector derives from here
// instead of reading the raw status field.
export function isPeriodActive(row, today = new Date()) {
  if (!row) return false;
  if ((row.status || "").toLowerCase().trim() !== "on-going") return false;
  if (!row.end_date && !row.endDate) return true;
  const end = String(row.end_date || row.endDate).slice(0, 10);
  return end >= today.toISOString().slice(0, 10);
}

export function periodStatusLabel(row, today = new Date()) {
  return isPeriodActive(row, today) ? "On-going" : "Closed";
}
