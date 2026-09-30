import { supabase } from "../config/supabase";

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
