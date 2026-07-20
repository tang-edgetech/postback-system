"use client";

import { useId } from "react";
import { toTitleCase } from "@/lib/titlecase";

type Option = { value: string; label: string };

type SelectProps = Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "children"> & {
  label: string;
  id?: string;
  options: Option[];
};

export function Select({ label, id, options, className = "", ...rest }: SelectProps) {
  const autoId = useId();
  const selectId = id ?? `select-${autoId}`;

  return (
    <div className="c-field flex flex-col gap-1">
      <label htmlFor={selectId} className="c-field__label text-sm font-medium text-foreground">
        {toTitleCase(label)}
      </label>
      <select
        id={selectId}
        className={`c-field__select rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent ${className}`}
        {...rest}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {toTitleCase(opt.label)}
          </option>
        ))}
      </select>
    </div>
  );
}
