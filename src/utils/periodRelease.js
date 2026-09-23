// Phase 5: client-side mirror of the SQL rule in
// is_period_released() (migration 011) — §4.7:
// released = approved AND release_date IS NOT NULL AND
//            release_date <= today.
// A missing release_date NEVER counts as released [D4].
// The SQL function remains the authoritative gate (it filters the
// faculty view); this mirror is for UI display only.
export function is_period_released(row, today = new Date()) {
  if (!row) return false;
  if (!row.approved) return false;
  if (!row.release_date) return false;
  const todayStr = today.toISOString().slice(0, 10);
  return row.release_date <= todayStr;
}
