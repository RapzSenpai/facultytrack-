import { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../config/supabase";
import { useAuth } from "./AuthContext";
import { getCanonicalDept } from "../utils/periodStatus";
import {
  markNotificationAsRead as apiMarkAsRead,
  markAllNotificationsAsRead as apiMarkAllAsRead,
  deleteNotification as apiDeleteNotification,
} from "../utils/notifications";

const NotificationContext = createContext(null);

/**
 * Detect department code from notification title or message.
 * Matches canonical codes (BSIT, BSHM, BSEntrep, BPED, BSED, BEED)
 * or department names.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function detectNotificationDepartment(text) {
  if (!text) return null;
  const str = String(text);

  // Check explicit bracket or parenthesis department tag: e.g. [BSIT], (BSIT), (BSIT 3rd Year - Section A)
  const tagMatch = str.match(/(?:^|[([{\s])(BSIT|BSHM|BSEntrep|BPED|BSED|BEED|IT|HM|Entrep)\b/i);
  if (tagMatch) {
    return getCanonicalDept(tagMatch[1]);
  }

  // Check full names or abbreviations anywhere in the text
  const lower = str.toLowerCase();
  if (lower.includes("hospitality") || /\bbshm\b/.test(lower) || /\bhm\b/.test(lower)) return "BSHM";
  if (lower.includes("information technology") || lower.includes("infotech") || /\bbsit\b/.test(lower)) return "BSIT";
  if (lower.includes("entrepreneur") || /\bbsentrep\b/.test(lower) || /\bentrep\b/.test(lower)) return "BSEntrep";
  if (lower.includes("secondary education") || /\bbsed\b/.test(lower)) return "BSED";
  if (lower.includes("elementary education") || /\bbeed\b/.test(lower)) return "BEED";
  if (lower.includes("physical education") || /\bbped\b/.test(lower)) return "BPED";

  return null;
}

export function NotificationProvider({ children }) {
  const { currentUser, userProfile } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [toastNotification, setToastNotification] = useState(null);
  const toastTimeoutRef = useRef(null);
  const seenNotificationIdsRef = useRef(new Set());

  useEffect(() => {
    seenNotificationIdsRef.current.clear();
    setNotifications([]);
    setUnreadCount(0);
    setToastNotification(null);
  }, [currentUser?.id]);

  // Department scope tracking for scoped program admins
  const [, setAssignedDepts] = useState(new Set());
  const assignedDeptsRef = useRef(new Set());
  const [scopeLoaded, setScopeLoaded] = useState(false);
  const scopeLoadedRef = useRef(false);

  // Load assigned programs for scoped admins
  useEffect(() => {
    let isMounted = true;
    if (!currentUser?.id) {
      assignedDeptsRef.current = new Set();
      setAssignedDepts(new Set());
      scopeLoadedRef.current = true;
      setScopeLoaded(true);
      return;
    }

    if (userProfile === undefined) {
      scopeLoadedRef.current = false;
      setScopeLoaded(false);
      return;
    }

    // Non-admins don't need department program filtering
    if (userProfile && userProfile.role !== "admin") {
      assignedDeptsRef.current = new Set();
      setAssignedDepts(new Set());
      scopeLoadedRef.current = true;
      setScopeLoaded(true);
      return;
    }

    scopeLoadedRef.current = false;
    setScopeLoaded(false);

    const loadAssignments = async () => {
      try {
        const s = new Set();
        if (userProfile?.department) {
          const c = getCanonicalDept(userProfile.department);
          if (c) s.add(c);
          s.add(userProfile.department.toLowerCase().trim());
        }
        if (userProfile?.department_id) {
          s.add(userProfile.department_id);
        }

        const { data: assigns, error: assignErr } = await supabase
          .from("admin_program_assignments")
          .select("department_id")
          .eq("admin_id", currentUser.id);

        const deptIdsToFetch = new Set();
        if (userProfile?.department_id) {
          deptIdsToFetch.add(userProfile.department_id);
        }
        if (!assignErr && assigns && assigns.length > 0) {
          assigns.forEach((a) => {
            if (a.department_id) {
              s.add(a.department_id);
              deptIdsToFetch.add(a.department_id);
            }
          });
        }

        if (deptIdsToFetch.size > 0) {
          // Schema fix: departments table has id, name, description (no code column)
          const { data: depts, error: deptErr } = await supabase
            .from("departments")
            .select("id, name, description")
            .in("id", Array.from(deptIdsToFetch));

          if (!deptErr && depts) {
            depts.forEach((d) => {
              if (d.name) {
                const c = getCanonicalDept(d.name);
                if (c) s.add(c);
                s.add(d.name.toLowerCase().trim());
              }
              if (d.description) {
                const c = getCanonicalDept(d.description);
                if (c) s.add(c);
                s.add(d.description.toLowerCase().trim());
              }
            });
          }
        }

        if (isMounted) {
          assignedDeptsRef.current = s;
          setAssignedDepts(s);
          scopeLoadedRef.current = true;
          setScopeLoaded(true);
        }
      } catch (err) {
        console.warn("[notifications] Failed to load admin program assignments:", err);
        if (isMounted) {
          scopeLoadedRef.current = true;
          setScopeLoaded(true);
        }
      }
    };

    loadAssignments();

    return () => {
      isMounted = false;
    };
  }, [currentUser?.id, userProfile]);

  /**
   * Determine whether a notification belongs to the current user's department scope.
   */
  const isNotifPermitted = useCallback(
    (notif) => {
      if (!notif) return false;
      // Super admins see all notifications across all departments
      if (userProfile?.role === "super_admin") return true;

      const role = userProfile?.role;
      const link = String(notif.link || "");
      if (role && link.startsWith("/admin/") && role !== "admin") return false;
      if (role && link.startsWith("/faculty/") && role !== "faculty") return false;
      if (role && link.startsWith("/student/") && role !== "student") return false;

      // Students and faculty only receive what's explicitly addressed to their user_id
      if (userProfile?.role !== "admin") return true;

      // If scope has not loaded yet, don't drop anything prematurely
      if (!scopeLoadedRef.current) return true;

      const text = `${notif.title || ""} ${notif.message || ""}`;
      const detectedDept = detectNotificationDepartment(text);

      // If notification belongs to a specific department:
      if (detectedDept) {
        // Must match one of this admin's assigned programs
        return assignedDeptsRef.current.has(detectedDept);
      }

      // If message is the legacy un-scoped 028 generic notification:
      if (notif.message === "A student has submitted an issue regarding their assigned subject list.") {
        // Leaked un-scoped trigger notification without department
        return false;
      }

      // Generic / system notifications (e.g. account / password) are permitted
      return true;
    },
    [userProfile?.role]
  );

  const fetchNotifications = useCallback(async () => {
    if (!currentUser?.id) {
      setNotifications([]);
      setUnreadCount(0);
      return;
    }
    if (userProfile?.role === "admin" && !scopeLoadedRef.current) return;

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", currentUser.id)
        .order("created_at", { ascending: false })
        .limit(40);

      if (!error && data) {
        data.forEach((notification) => seenNotificationIdsRef.current.add(notification.id));
        const allowed = data.filter((notification) => isNotifPermitted(notification));
        setNotifications(allowed);
        setUnreadCount(allowed.filter((notification) => !notification.is_read).length);
      }
    } catch (err) {
      console.warn("fetchNotifications failed:", err);
    } finally {
      setLoading(false);
    }
  }, [currentUser?.id, userProfile?.role, isNotifPermitted]);

  // Initial and reactive fetch
  useEffect(() => {
    if (scopeLoaded) {
      fetchNotifications();
    }
  }, [scopeLoaded, fetchNotifications]);

  // Realtime subscription
  useEffect(() => {
    if (!currentUser?.id || !scopeLoaded || (userProfile?.role === "admin" && !scopeLoadedRef.current)) return;

    const channelName = `realtime-notifications-${currentUser.id}-${Date.now()}`;
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${currentUser.id}`,
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const newNotif = payload.new;

            // Strict department isolation: ignore foreign department notifications in state
            if (!isNotifPermitted(newNotif)) {
              return;
            }

            if (seenNotificationIdsRef.current.has(newNotif.id)) return;
            seenNotificationIdsRef.current.add(newNotif.id);

            setNotifications((prev) => {
              if (prev.some((n) => n.id === newNotif.id)) return prev;
              const next = [newNotif, ...prev];
              setUnreadCount(next.filter((n) => !n.is_read).length);
              return next;
            });

            // Trigger floating toast
            setToastNotification(newNotif);
            if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
            toastTimeoutRef.current = setTimeout(() => {
              setToastNotification(null);
            }, 6000);
          } else if (payload.eventType === "UPDATE") {
            const updated = payload.new;
            if (!isNotifPermitted(updated)) {
              setNotifications((prev) => {
                const next = prev.filter((n) => n.id !== updated.id);
                setUnreadCount(next.filter((n) => !n.is_read).length);
                return next;
              });
              return;
            }
            setNotifications((prev) => {
              const next = prev.map((n) => (n.id === updated.id ? updated : n));
              setUnreadCount(next.filter((n) => !n.is_read).length);
              return next;
            });
          } else if (payload.eventType === "DELETE") {
            const deleted = payload.old;
            setNotifications((prev) => {
              const next = prev.filter((n) => n.id !== deleted.id);
              setUnreadCount(next.filter((n) => !n.is_read).length);
              return next;
            });
          }
        }
      )
      .subscribe();

    return () => {
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
      supabase.removeChannel(channel);
    };
  }, [currentUser?.id, scopeLoaded, userProfile?.role, isNotifPermitted]);

  const markAsRead = async (id) => {
    setNotifications((prev) => {
      const next = prev.map((n) => (n.id === id ? { ...n, is_read: true } : n));
      setUnreadCount(next.filter((n) => !n.is_read).length);
      return next;
    });
    await apiMarkAsRead(id);
  };

  const markAllAsRead = async () => {
    if (!currentUser?.id) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    setUnreadCount(0);
    await apiMarkAllAsRead(currentUser.id);
  };

  const removeNotification = async (id) => {
    let previousNotifications;
    setNotifications((prev) => {
      previousNotifications = prev;
      const next = prev.filter((n) => n.id !== id);
      setUnreadCount(next.filter((n) => !n.is_read).length);
      return next;
    });

    const success = await apiDeleteNotification(id);
    if (!success) {
      console.warn("[notifications] Server delete failed; reverting local state.");
      if (previousNotifications) {
        setNotifications(previousNotifications);
        setUnreadCount(previousNotifications.filter((n) => !n.is_read).length);
      }
    }
  };

  const clearAllNotifications = async () => {
    if (!currentUser?.id) return;
    let previousNotifications;
    setNotifications((prev) => {
      previousNotifications = prev;
      return [];
    });
    setUnreadCount(0);
    try {
      const { error } = await supabase.from("notifications").delete().eq("user_id", currentUser.id);
      if (error) {
        console.error("[notifications] clearAllNotifications database error:", error.message, error);
        if (previousNotifications) {
          setNotifications(previousNotifications);
          setUnreadCount(previousNotifications.filter((n) => !n.is_read).length);
        }
      }
    } catch (err) {
      console.error("[notifications] clearAllNotifications error:", err);
      if (previousNotifications) {
        setNotifications(previousNotifications);
        setUnreadCount(previousNotifications.filter((n) => !n.is_read).length);
      }
    }
  };

  const dismissToast = () => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToastNotification(null);
  };

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        loading,
        toastNotification,
        dismissToast,
        markAsRead,
        markAllAsRead,
        removeNotification,
        clearAllNotifications,
        refreshNotifications: fetchNotifications,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error("useNotifications must be used within a NotificationProvider");
  }
  return context;
}
