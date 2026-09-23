import { supabase } from "../config/supabase";

// Best-effort client audit for privileged admin writes (H8).
// audit_log is service-role-only; log_admin_action is the single
// client-reachable path. Never throws — a failed audit must not
// fail the admin action itself.
export async function logAdminAction(action, entity, entityId = null, details = {}) {
  try {
    const { error } = await supabase.rpc("log_admin_action", {
      p_action: action,
      p_entity: entity,
      p_entity_id: entityId,
      p_details: details,
    });
    if (error) console.warn("Admin audit failed:", error.message);
  } catch (err) {
    console.warn("Admin audit failed:", err?.message || err);
  }
}

// Edge Function errors carry the server JSON body on
// error.context (functions-js), not error.message. Parse it so
// the UI shows the real reason (duplicate, blocked, 429…).
export async function parseFunctionError(error, fallback = "Request failed.") {
  if (!error) return fallback;
  try {
    const parsed = await error.context?.json?.();
    if (parsed?.error) return parsed.error;
  } catch {
    // fall through to message below
  }
  return error.message || fallback;
}
