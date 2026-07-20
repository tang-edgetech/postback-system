"use client";

import { forwardRef, useId } from "react";
import { toTitleCase } from "@/lib/titlecase";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  id?: string;
};

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-foreground hover:bg-accent-hover",
  secondary: "bg-surface-alt text-foreground border border-border hover:bg-border",
  danger: "bg-red-600 text-white hover:bg-red-700",
  ghost: "bg-transparent text-foreground hover:bg-surface-alt",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", id, className = "", children, ...rest },
  ref,
) {
  const autoId = useId();
  const displayChildren = typeof children === "string" ? toTitleCase(children) : children;

  return (
    <button
      ref={ref}
      id={id ?? `btn-${autoId}`}
      className={`c-btn c-btn--${variant} inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_CLASSES[variant]} ${className}`}
      {...rest}
    >
      {displayChildren}
    </button>
  );
});
