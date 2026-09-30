import { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../config/supabase";
import { useAuth } from "./AuthContext";
import {
  markNotificationAsRead as apiMarkAsRead,
  markAllNotificationsAsRead as apiMarkAllAsRead,
  deleteNotification as apiDeleteNotification,
} from "../utils/notifications";

const NotificationContext = createContext(null);

export function NotificationProvider({ children }) {
  const { currentUser } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [toastNotification, setToastNotification] = useState(null);
  const toastTimeoutRef = useRef(null);

  const fetchNotifications = useCallback(async () => {
    if (!currentUser?.id) {
      setNotifications([]);
      setUnreadCount(0);
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", currentUser.id)
        .order("created_at", { ascending: false })
        .limit(30);

      if (!error && data) {
        setNotifications(data);
        setUnreadCount(data.filter((n) => !n.is_read).length);
      }
    } catch (err) {
      console.warn("fetchNotifications failed:", err);
    } finally {
      setLoading(false);
    }
  }, [currentUser?.id]);

  // Initial load
  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // Realtime subscription
  useEffect(() => {
    if (!currentUser?.id) return;

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
  }, [currentUser?.id]);

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

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error("useNotifications must be used within a NotificationProvider");
  }
  return context;
}
