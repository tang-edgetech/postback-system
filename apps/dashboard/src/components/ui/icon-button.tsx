"use client";

import { useId } from "react";
import { toTitleCase } from "@/lib/titlecase";
import { useTooltip, TooltipPortal } from "./tooltip";

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
  const { anchorRef, tooltipRef, triggerProps, visible, coords } = useTooltip<HTMLButtonElement>();

  return (
    <>
      <button
        ref={anchorRef}
        id={id ?? `icon-btn-${autoId}`}
        type="button"
        aria-label={title}
        className={`c-icon-btn inline-flex h-9 w-9 items-center justify-center rounded-md transition-colors ${VARIANT_CLASSES[variant]} ${className}`}
        {...rest}
        {...triggerProps}
      >
        {icon}
      </button>
      <TooltipPortal tooltipRef={tooltipRef} visible={visible} coords={coords}>
        {title}
      </TooltipPortal>
    </>
  );
}
