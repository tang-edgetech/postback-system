"use client";

import { useId, useState } from "react";
import { toTitleCase } from "@/lib/titlecase";

type PasswordInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label: string;
  id?: string;
  error?: string;
};

const EyeIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const EyeOffIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a18.5 18.5 0 0 1 4.22-5.06M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 7 11 7a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);

export function PasswordInput({ label, id, error, className = "", ...rest }: PasswordInputProps) {
  const autoId = useId();
  const inputId = id ?? `input-${autoId}`;
  const [visible, setVisible] = useState(false);
  const toggleLabel = visible ? "Hide Password" : "Show Password";

  return (
    <div className="c-field flex flex-col gap-1">
      <label htmlFor={inputId} className="c-field__label text-sm font-medium text-foreground">
        {toTitleCase(label)}
      </label>
      <div className="c-field__input-wrap relative">
        <input
          id={inputId}
          type={visible ? "text" : "password"}
          className={`c-field__input w-full rounded-md border border-border bg-background px-3 py-2 pr-10 text-sm text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent ${error ? "border-red-500" : ""} ${className}`}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${inputId}-error` : undefined}
          {...rest}
        />
        <button
          type="button"
          id={`${inputId}-toggle-visibility`}
          aria-label={toggleLabel}
          title={toggleLabel}
          className="c-field__toggle absolute inset-y-0 right-0 flex items-center px-3 text-foreground-muted hover:text-foreground"
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
      {error && (
        <p id={`${inputId}-error`} className="c-field__error text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
