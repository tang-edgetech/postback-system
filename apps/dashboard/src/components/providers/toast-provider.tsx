"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";

type ToastType = "success" | "error" | "info";

type Toast = {
  id: number;
  message: string;
  type: ToastType;
};

type ToastContextValue = {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const TYPE_CLASSES: Record<ToastType, string> = {
  success: "border-l-4 border-emerald-500",
  error: "border-l-4 border-red-500",
  info: "border-l-4 border-accent",
};

const AUTO_DISMISS_MS = 4000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const removeToast = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    (message: string, type: ToastType) => {
      const id = nextId.current++;
      setToasts((current) => [...current, { id, message, type }]);
      window.setTimeout(() => removeToast(id), AUTO_DISMISS_MS);
    },
    [removeToast],
  );

  const value: ToastContextValue = {
    success: (message) => addToast(message, "success"),
    error: (message) => addToast(message, "error"),
    info: (message) => addToast(message, "info"),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="c-toast-container fixed top-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2"
        id="toast-container"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            id={`toast-${toast.id}`}
            className={`c-toast flex items-start justify-between gap-3 rounded-md bg-surface px-4 py-3 text-sm text-foreground shadow-lg ${TYPE_CLASSES[toast.type]}`}
          >
            <span className="c-toast__message">{toast.message}</span>
            <button
              id={`toast-close-${toast.id}`}
              type="button"
              aria-label="Close"
              className="c-toast__close text-foreground-muted hover:text-foreground"
              onClick={() => removeToast(toast.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
