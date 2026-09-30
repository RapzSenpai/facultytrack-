import { useNavigate } from "react-router-dom";
import { X, CheckCircle2, AlertCircle, Info } from "lucide-react";
import { useNotifications } from "../../context/NotificationContext";
import "../../styles/notifications.css";

function getNotificationIcon(type) {
  switch (type) {
    case "success":
      return <CheckCircle2 size={18} />;
    case "warning":
    case "alert":
      return <AlertCircle size={18} />;
    case "info":
    default:
      return <Info size={18} />;
  }
}

export default function NotificationToast() {
  const { toastNotification, dismissToast, markAsRead } = useNotifications();
  const navigate = useNavigate();

  if (!toastNotification) return null;

  const handleClick = async () => {
    if (!toastNotification.is_read) {
      await markAsRead(toastNotification.id);
    }
    const targetLink = toastNotification.link;
    dismissToast();
    if (targetLink) {
      navigate(targetLink);
    }
  };

  const iconTypeClass = `notif-icon-wrap--${toastNotification.type || "info"}`;

  return (
    <div className="notif-toast-container" aria-live="polite">
      <div className="notif-toast" onClick={handleClick}>
        <div className={`notif-icon-wrap ${iconTypeClass}`}>
          {getNotificationIcon(toastNotification.type)}
        </div>
        <div className="notif-toast-content">
          <h5 className="notif-toast-title">{toastNotification.title}</h5>
          <p className="notif-toast-msg">{toastNotification.message}</p>
        </div>
        <button
          type="button"
          className="notif-toast-close"
          onClick={(e) => {
            e.stopPropagation();
            dismissToast();
          }}
          aria-label="Dismiss notification"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
