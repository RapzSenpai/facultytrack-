import { supabase } from "../config/supabase";
import { matchDepartment } from "./periodStatus";

/**
 * Send an in-app notification to a user.
 */
export async function sendNotification({ userId, title, message, type = "info", link = null }) {
  if (!userId || !title || !message) return null;
  try {
    const { data, error } = await supabase
      .from("notifications")
      .insert({
        user_id: userId,
        title,
        message,
        type,
        link,
      })
      .select()
      .single();

    if (error) {
      console.warn("sendNotification error:", error.message);
      return null;
    }
    return data;
  } catch (err) {
    console.warn("sendNotification error:", err);
    return null;
  }
}

/**
 * Notify administrators assigned to a specific department, plus all super_admins.
 * If department cannot be resolved or is not provided, notifications are safely delivered
 * to super_admins only, preventing department cross-contamination.
 *
 * @param {Object} options
 * @param {string|null} [options.department] - Text name or code of department (e.g. "Information Technology", "BSIT")
 * @param {string|null} [options.departmentId] - UUID of department
 * @param {string} options.title - Notification title
 * @param {string} options.message - Notification message
 * @param {string} [options.type="info"] - 'info' | 'success' | 'warning' | 'alert'
 * @param {string|null} [options.link=null] - App route to navigate to on click
 * @returns {Promise<number>} Number of notifications sent
 */
export async function notifyAdminsForDepartment({
  department = null,
  departmentId = null,
  title,
  message,
  type = "info",
  link = null,
}) {
  if (!title || !message) return 0;

  try {
    // Primary path: Server-side RPC (SECURITY DEFINER bypasses student RLS,
    // safely routes to matching program admins + super_admins, and respects strict department isolation)
    const { data: rpcCount, error: rpcErr } = await supabase.rpc("notify_admins_for_department", {
      p_department: department || null,
      p_department_id: departmentId || null,
      p_title: title,
      p_message: message,
      p_type: type,
      p_link: link,
    });

    if (!rpcErr && typeof rpcCount === "number") {
      return rpcCount;
    }

    if (rpcErr) {
      console.warn("[notifications] notify_admins_for_department RPC fallback:", rpcErr.message);
    }

    // Step A: Fetch active super_admins (receive system-wide alerts)
    const { data: superAdmins, error: superErr } = await supabase
      .from("users")
      .select("id")
      .eq("role", "super_admin")
      .neq("status", "deleted");

    if (superErr) {
      console.warn("[notifications] notifyAdminsForDepartment super_admin fetch error:", superErr.message);
    }
    const superAdminIds = (superAdmins || []).map((u) => u.id);

    // Step B: Resolve target department UUID
    let resolvedDeptId = departmentId || null;
    const cleanDeptName = department ? String(department).trim() : null;

    if (!resolvedDeptId && cleanDeptName) {
      const { data: depts, error: deptErr } = await supabase
        .from("departments")
        .select("id, name");

      if (!deptErr && depts) {
        const matched = depts.find((d) => matchDepartment(d.name, cleanDeptName));
        if (matched) {
          resolvedDeptId = matched.id;
        }
      }
    }

    // Step C: If department ID resolved, find assigned admins via admin_program_assignments AND direct users table
    let scopedAdminIds = [];
    if (resolvedDeptId) {
      const [assignRes, directAdminsRes] = await Promise.all([
        supabase
          .from("admin_program_assignments")
          .select("admin_id")
          .eq("department_id", resolvedDeptId),
        supabase
          .from("users")
          .select("id, department, department_id")
          .eq("role", "admin")
          .neq("status", "deleted"),
      ]);

      const assignedIds = new Set((assignRes.data || []).map((a) => a.admin_id).filter(Boolean));

      // Also check direct department or department_id on users table
      (directAdminsRes.data || []).forEach((u) => {
        if (
          (u.department_id && u.department_id === resolvedDeptId) ||
          (cleanDeptName && u.department && matchDepartment(u.department, cleanDeptName))
        ) {
          assignedIds.add(u.id);
        }
      });

      scopedAdminIds = Array.from(assignedIds);
    }

    // Strict isolation: If department could NOT be resolved, ONLY super_admins receive the alert.
    // Regular program admins of other departments are NEVER notified!
    const recipientIds = Array.from(new Set([...superAdminIds, ...scopedAdminIds]));
    if (recipientIds.length === 0) return 0;

    // Deduplication guard: Check if an identical notification was recently created (within last 15 seconds)
    // for these recipients (e.g. by database trigger or duplicate click)
    const recentWindow = new Date(Date.now() - 15000).toISOString();
    const { data: existingRecent } = await supabase
      .from("notifications")
      .select("user_id")
      .in("user_id", recipientIds)
      .eq("title", title)
      .gte("created_at", recentWindow);

    const alreadyNotified = new Set((existingRecent || []).map((n) => n.user_id));
    const finalRecipients = recipientIds.filter((id) => !alreadyNotified.has(id));

    if (finalRecipients.length === 0) {
      return 0;
    }

    const payload = finalRecipients.map((uid) => ({
      user_id: uid,
      title,
      message,
      type,
      link,
    }));

    const { error: insErr } = await supabase.from("notifications").insert(payload);
    if (insErr) {
      console.warn("[notifications] notifyAdminsForDepartment insert error:", insErr.message);
      return 0;
    }

    return payload.length;
  } catch (err) {
    console.warn("[notifications] notifyAdminsForDepartment exception:", err);
    return 0;
  }
}

/**
 * Notify all relevant faculty when an evaluation period release is published.
 */
export async function notifyFacultyOnRelease({ academicYear, semester, department = null }) {
  if (!academicYear || !semester) return 0;
  try {
    // First try the server-side RPC (migration 028)
    const { data, error } = await supabase.rpc("notify_faculty_on_release", {
      p_academic_year: academicYear,
      p_semester: semester,
      p_department: department || null,
    });

    if (!error && typeof data === "number") {
      return data;
    }

    // Client-side fallback if RPC is not yet applied
    let query = supabase
      .from("users")
      .select("id, department")
      .eq("role", "faculty")
      .neq("status", "deleted");

    if (department && department.trim()) {
      query = query.eq("department", department.trim());
    }

    const { data: facultyList } = await query;
    if (!facultyList || facultyList.length === 0) return 0;

    const payload = facultyList.map((f) => ({
      user_id: f.id,
      title: "Evaluation Results Released",
      message: `Evaluation results for ${academicYear} ${semester} have been published. Check your ratings and student feedback.`,
      type: "success",
      link: "/faculty/evaluations",
    }));

    const { error: insErr } = await supabase.from("notifications").insert(payload);
    if (insErr) {
      console.warn("Fallback notifyFacultyOnRelease error:", insErr.message);
      return 0;
    }
    return payload.length;
  } catch (err) {
    console.warn("notifyFacultyOnRelease error:", err);
    return 0;
  }
}

/**
 * Mark a single notification as read.
 */
export async function markNotificationAsRead(notificationId) {
  if (!notificationId) return false;
  try {
    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("id", notificationId);
    if (error) {
      console.error("[notifications] markNotificationAsRead database error:", error.message, error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[notifications] markNotificationAsRead exception:", err);
    return false;
  }
}

/**
 * Mark all notifications as read for a user.
 */
export async function markAllNotificationsAsRead(userId) {
  if (!userId) return false;
  try {
    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", userId)
      .eq("is_read", false);
    if (error) {
      console.error("[notifications] markAllNotificationsAsRead database error:", error.message, error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[notifications] markAllNotificationsAsRead exception:", err);
    return false;
  }
}

/**
 * Delete a notification permanently from database.
 */
export async function deleteNotification(notificationId) {
  if (!notificationId) return false;
  try {
    const { error } = await supabase
      .from("notifications")
      .delete()
      .eq("id", notificationId);

    if (error) {
      console.error("[notifications] deleteNotification database error:", error.message, error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[notifications] deleteNotification exception:", err);
    return false;
  }
}
