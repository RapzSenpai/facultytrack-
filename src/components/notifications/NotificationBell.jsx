import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, CheckCircle2, AlertCircle, Info, CheckCheck, Clock, Trash2 } from "lucide-react";
import { useNotifications } from "../../context/NotificationContext";
import "../../styles/notifications.css";

function formatRelativeTime(dateString) {
  if (!dateString) return "";
  const now = new Date();
  const date = new Date(dateString);
  const diffSec = Math.floor((now - date) / 1000);

  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay}d ago`;

  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function getNotificationIcon(type) {
  switch (type) {
    case "success":
      return <CheckCircle2 size={16} />;
    case "warning":
    case "alert":
      return <AlertCircle size={16} />;
    case "info":
    default:
      return <Info size={16} />;
  }
}

export default function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false);
  const {
    notifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
    removeNotification,
    clearAllNotifications,
    refreshNotifications,
  } = useNotifications();
  const dropdownRef = useRef(null);
  const navigate = useNavigate();

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const handleNotificationClick = async (notif) => {
    if (!notif.is_read) {
      await markAsRead(notif.id);
    }
    setIsOpen(false);
    if (notif.link) {
      navigate(notif.link);
    }
  };

  return (
    <div className="notif-bell-wrap" ref={dropdownRef}>
      <button
        type="button"
        className={`notif-bell-btn ${isOpen ? "notif-bell-btn--active" : ""}`}
        onClick={() => {
          if (!isOpen && typeof refreshNotifications === "function") {
            refreshNotifications();
          }
          setIsOpen((prev) => !prev);
        }}
        aria-label="View notifications"
        title="Notifications"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="notif-badge">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="notif-dropdown" role="dialog" aria-label="Notifications Dropdown">
          <div className="notif-header">
            <div className="notif-header-title">
              <span>Notifications</span>
              {unreadCount > 0 && (
                <span className="notif-header-count">{unreadCount} new</span>
              )}
            </div>
            <div className="notif-header-actions">
              {unreadCount > 0 && (
                <button
                  type="button"
                  className="notif-mark-all-btn"
                  onClick={markAllAsRead}
                  title="Mark all as read"
                >
                  <CheckCheck size={14} style={{ marginRight: "4px", verticalAlign: "middle" }} />
                  Mark read
                </button>
              )}
              {notifications.length > 0 && (
                <button
                  type="button"
                  className="notif-clear-all-btn"
                  onClick={clearAllNotifications}
                  title="Clear all notifications"
                >
                  Clear all
                </button>
              )}
            </div>
          </div>

          <ul className="notif-list">
            {notifications.length === 0 ? (
              <div className="notif-empty">
                <div className="notif-empty-icon">
                  <Bell size={28} />
                </div>
                <h4 className="notif-empty-title">No notifications yet</h4>
                <p className="notif-empty-desc">
                  You will receive updates on evaluation periods, results, and issues here.
                </p>
              </div>
            ) : (
              notifications.map((notif) => {
                const iconTypeClass = `notif-icon-wrap--${notif.type || "info"}`;
                return (
                  <li
                    key={notif.id}
                    className={`notif-item ${!notif.is_read ? "notif-item--unread" : ""}`}
                    onClick={() => handleNotificationClick(notif)}
                  >
                    <div className={`notif-icon-wrap ${iconTypeClass}`}>
                      {getNotificationIcon(notif.type)}
                    </div>
                    <div className="notif-content">
                      <div className="notif-title-row">
                        <h5 className="notif-item-title">{notif.title}</h5>
                        <span className="notif-item-time">
                          {formatRelativeTime(notif.created_at)}
                        </span>
                      </div>
                      <p className="notif-item-message">{notif.message}</p>
                    </div>
                    <div className="notif-item-end">
                      {!notif.is_read && <span className="notif-unread-dot" />}
                      <button
                        type="button"
                        className="notif-delete-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeNotification(notif.id);
                        }}
                        title="Delete notification"
                        aria-label="Delete notification"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
