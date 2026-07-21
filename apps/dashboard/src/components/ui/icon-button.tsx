"use client";

import { useId } from "react";
import { toTitleCase } from "@/lib/titlecase";

type IconButtonVariant = "default" | "danger";

type IconButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "title"> & {
  icon: React.ReactNode;
  label: string;
  variant?: IconButtonVariant;
  id?: string;
};

const VARIANT_CLASSES: Record<IconButtonVariant, string> = {
  default: "text-foreground-muted hover:bg-surface-alt hover:text-foreground",
  danger: "text-red-600 hover:bg-red-50 dark:hover:bg-red-950",
};

export function IconButton({ icon, label, variant = "default", id, className = "", ...rest }: IconButtonProps) {
  const autoId = useId();
  const title = toTitleCase(label);

  return (
    <span className="c-icon-btn-wrap group relative inline-flex">
      <button
        id={id ?? `icon-btn-${autoId}`}
        type="button"
        aria-label={title}
        title={title}
        className={`c-icon-btn inline-flex h-9 w-9 items-center justify-center rounded-md transition-colors ${VARIANT_CLASSES[variant]} ${className}`}
        {...rest}
      >
        {icon}
      </button>
      <span
        className="c-icon-btn-tooltip pointer-events-none absolute -top-8 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-md text-slate-50 shadow-md group-hover:block group-focus-within:block"
        role="tooltip"
      >
        {title}
      </span>
    </span>
  );
}
