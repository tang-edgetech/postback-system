"use client";

import { useState } from "react";
import { copyToClipboard } from "@/lib/clipboard";
import { ClipboardIcon, CheckIcon } from "@/components/icons";
import { useTooltip, TooltipPortal } from "./tooltip";

export function CopyButton({ value, id }: { value: string; id: string }) {
  const [copied, setCopied] = useState(false);
  const { anchorRef, tooltipRef, triggerProps, visible, coords } = useTooltip<HTMLButtonElement>();

  async function handleCopy() {
    const success = await copyToClipboard(value);
    if (success) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  }

  const label = copied ? "Copied" : "Copy";

  return (
    <>
      <button
        ref={anchorRef}
        id={id}
        type="button"
        aria-label={label}
        onClick={handleCopy}
        className={`c-copy-btn inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
          copied ? "text-emerald-600" : "text-foreground-muted hover:bg-surface-alt hover:text-foreground"
        }`}
        {...triggerProps}
      >
        {copied ? <CheckIcon /> : <ClipboardIcon />}
      </button>
      <TooltipPortal tooltipRef={tooltipRef} visible={visible} coords={coords}>
        {label}
      </TooltipPortal>
    </>
  );
}
