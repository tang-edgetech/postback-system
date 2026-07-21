"use client";

import { useState } from "react";
import { copyToClipboard } from "@/lib/clipboard";
import { ClipboardIcon, CheckIcon } from "@/components/icons";

export function CopyButton({ value, id }: { value: string; id: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const success = await copyToClipboard(value);
    if (success) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  }

  const label = copied ? "Copied" : "Copy";

  return (
    <span className="c-copy-btn-wrap group relative inline-flex">
      <button
        id={id}
        type="button"
        aria-label={label}
        onClick={handleCopy}
        className={`c-copy-btn inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
          copied ? "text-emerald-600" : "text-foreground-muted hover:bg-surface-alt hover:text-foreground"
        }`}
      >
        {copied ? <CheckIcon /> : <ClipboardIcon />}
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute -top-8 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-md text-slate-50 shadow-md group-hover:block"
      >
        {label}
      </span>
    </span>
  );
}
