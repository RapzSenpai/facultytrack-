import { useEffect, useRef } from "react";
import { AlertTriangle, AlertCircle, CheckCircle2, Info, X } from "lucide-react";

export default function DialogModal({
  title,
  message,
  type = "info",
  confirmText = "OK",
  cancelText,
  isConfirm = false,
  onConfirm,
  onCancel,
}) {
  const confirmBtnRef = useRef(null);

  useEffect(() => {
    confirmBtnRef.current?.focus();

    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        if (onCancel) onCancel();
        else if (onConfirm) onConfirm();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onConfirm, onCancel]);

  const renderIcon = () => {
    switch (type) {
      case "error":
        return <AlertCircle size={26} strokeWidth={2.2} />;
      case "success":
        return <CheckCircle2 size={26} strokeWidth={2.2} />;
      case "info":
        return <Info size={26} strokeWidth={2.2} />;
      case "warning":
      default:
        return <AlertTriangle size={26} strokeWidth={2.2} />;
    }
  };

  return (
    <div
      className="ft-dialog-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ft-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          if (onCancel) onCancel();
          else if (onConfirm) onConfirm();
        }
      }}
    >
      <div className="ft-dialog-card" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="ft-dialog-close-btn"
          onClick={onCancel || onConfirm}
          aria-label="Close dialog"
        >
          <X size={18} />
        </button>

        <div className="ft-dialog-body">
          <div className={`ft-dialog-icon-wrapper ${type}`}>
            {renderIcon()}
          </div>

          <div className="ft-dialog-content">
            {title && (
              <h3 id="ft-dialog-title" className="ft-dialog-title">
                {title}
              </h3>
            )}
            <div className="ft-dialog-message">
              {typeof message === "string" ? (
                message.split("\n").map((line, idx) => (
                  <p key={idx} style={{ margin: idx === 0 ? 0 : "6px 0 0 0" }}>
                    {line}
                  </p>
                ))
              ) : (
                message
              )}
            </div>
          </div>
        </div>

        <div className="ft-dialog-footer">
          {isConfirm && cancelText && (
            <button
              type="button"
              className="ft-dialog-btn ft-dialog-btn-secondary"
              onClick={onCancel}
            >
              {cancelText}
            </button>
          )}
          <button
            ref={confirmBtnRef}
            type="button"
            className={`ft-dialog-btn ft-dialog-btn-primary ${type}`}
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
