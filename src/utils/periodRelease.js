// Phase 5: client-side mirror of the SQL rule in
// is_period_released() (migration 011) — §4.7:
// released = approved AND release_date IS NOT NULL AND
//            release_date <= today.
// A missing release_date NEVER counts as released [D4].
// The SQL function remains the authoritative gate (it filters the
// faculty view); this mirror is for UI display only.
export function is_period_released(row, today = new Date()) {
  if (!row) return false;
  const isApproved = row.approved === true || String(row.approved).toLowerCase() === "true";
  if (!isApproved) return false;
  if (!row.release_date) return false;
  const relDate = String(row.release_date).trim().slice(0, 10);
  if (!relDate) return false;
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const d = String(today.getDate()).padStart(2, "0");
  const localTodayStr = `${y}-${m}-${d}`;
  const utcTodayStr = today.toISOString().slice(0, 10);
  return relDate <= localTodayStr || relDate <= utcTodayStr;
}
