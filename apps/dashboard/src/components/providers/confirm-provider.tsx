"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

type ConfirmTone = "default" | "danger";

type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
};

type PendingConfirm = ConfirmOptions & {
  resolve: (value: boolean) => void;
};

type ConfirmContextValue = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...options, resolve });
    });
  }, []);

  const settle = useCallback(
    (value: boolean) => {
      pending?.resolve(value);
      setPending(null);
    },
    [pending],
  );

  useEffect(() => {
    if (!pending) return;
    confirmButtonRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") settle(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pending, settle]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <div
          id="confirm-modal-backdrop"
          className="c-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => settle(false)}
        >
          <div
            id="confirm-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-modal-title"
            className="c-modal c-modal--confirm w-full max-w-sm rounded-lg bg-surface p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="confirm-modal-title" className="c-modal__title text-[20px] leading-7 font-semibold text-foreground">
              {pending.title}
            </h2>
            {pending.message && (
              <p id="confirm-modal-message" className="c-modal__message mt-2 text-sm text-foreground-muted">
                {pending.message}
              </p>
            )}
            <div className="c-modal__actions mt-6 flex justify-end gap-3">
              <Button id="confirm-modal-cancel" variant="secondary" onClick={() => settle(false)}>
                {pending.cancelLabel ?? "Cancel"}
              </Button>
              <Button
                id="confirm-modal-confirm"
                ref={confirmButtonRef}
                variant={pending.tone === "danger" ? "danger" : "primary"}
                onClick={() => settle(true)}
              >
                {pending.confirmLabel ?? "Confirm"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within ConfirmProvider");
  return ctx;
}
