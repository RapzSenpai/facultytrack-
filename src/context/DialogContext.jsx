import { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";
 import DialogModal from "../components/common/DialogModal";

const DialogContext = createContext(null);

export function DialogProvider({ children }) {
  const [dialogState, setDialogState] = useState(null);
  const resolveRef = useRef(null);

  const showDialog = useCallback(
    ({
      title,
      message,
      type = "info",
      confirmText = "OK",
      cancelText = null,
      isConfirm = false,
    }) => {
      return new Promise((resolve) => {
        resolveRef.current = resolve;
        setDialogState({
          title,
          message,
          type,
          confirmText,
          cancelText: isConfirm ? (cancelText || "Cancel") : cancelText,
          isConfirm,
        });
      });
    },
    [],
  );

  const handleConfirm = useCallback(() => {
    if (resolveRef.current) {
      resolveRef.current(true);
      resolveRef.current = null;
    }
    setDialogState(null);
  }, []);

  const handleCancel = useCallback(() => {
    if (resolveRef.current) {
      resolveRef.current(false);
      resolveRef.current = null;
    }
    setDialogState(null);
  }, []);

  const showNotice = useCallback(
    (message, options = {}) => {
      const opts = typeof options === "string" ? { title: options } : options;
      const type = opts.type || "warning";
      const defaultTitle =
        type === "error"
          ? "Action Error"
          : type === "warning"
          ? "Notice"
          : type === "success"
          ? "Success"
          : "Information";

      return showDialog({
        title: opts.title || defaultTitle,
        message,
        type,
        confirmText: opts.confirmText || "OK",
        isConfirm: false,
      });
    },
    [showDialog],
  );

  const showConfirm = useCallback(
    (message, options = {}) => {
      const opts = typeof options === "string" ? { title: options } : options;
      return showDialog({
        title: opts.title || "Confirmation Required",
        message,
        type: opts.type || "warning",
        confirmText: opts.confirmText || "Confirm",
        cancelText: opts.cancelText || "Cancel",
        isConfirm: true,
      });
    },
    [showDialog],
  );

  // Globally bridge native window.alert to the custom modal UI so NO unstyled browser popups appear anywhere
  useEffect(() => {
    const originalAlert = window.alert;
    window.alert = (message) => {
      const msgStr = typeof message === "string" ? message : String(message ?? "");
      const lower = msgStr.toLowerCase();
      const isError =
        lower.startsWith("error") ||
        lower.includes("failed") ||
        lower.includes("could not") ||
        lower.includes("closed") ||
        lower.includes("denied");
      const isSuccess = lower.includes("success") || lower.includes("submitted");
      const type = isError ? "error" : isSuccess ? "success" : "warning";
      const defaultTitle = isError ? "Error" : isSuccess ? "Success" : "Notice";

      // Strip leading "Error: " prefix for cleaner display in the modal card
      const cleanMsg = msgStr.replace(/^error:\s*/i, "");

      showDialog({
        title: defaultTitle,
        message: cleanMsg,
        type,
        confirmText: "OK",
        isConfirm: false,
      });
    };

    return () => {
      window.alert = originalAlert;
    };
  }, [showDialog]);

  return (
    <DialogContext.Provider value={{ showDialog, showNotice, showConfirm }}>
      {children}
      {dialogState && (
        <DialogModal
          {...dialogState}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}
    </DialogContext.Provider>
  );
}

export function useDialog() {
  const ctx = useContext(DialogContext);
  if (!ctx) {
    return {
      showDialog: async ({ message }) => {
        window.alert(message);
        return true;
      },
      showNotice: async (message) => {
        window.alert(message);
        return true;
      },
      showConfirm: async (message) => Boolean(window.confirm(message)),
    };
  }
  return ctx;
}
