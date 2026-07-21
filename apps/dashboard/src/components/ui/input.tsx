"use client";

import { useId } from "react";
import { toTitleCase } from "@/lib/titlecase";

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  id?: string;
  error?: string;
};

export function Input({ label, id, error, className = "", ...rest }: InputProps) {
  const autoId = useId();
  const inputId = id ?? `input-${autoId}`;

  return (
    <div className="c-field flex flex-col gap-1">
      <label htmlFor={inputId} className="c-field__label text-md font-medium text-foreground">
        {toTitleCase(label)}
      </label>
      <input
        id={inputId}
        className={`c-field__input rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent ${error ? "border-red-500" : ""} ${className}`}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${inputId}-error` : undefined}
        {...rest}
      />
      {error && (
        <p id={`${inputId}-error`} className="c-field__error text-md text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
