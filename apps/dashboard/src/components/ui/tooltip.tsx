"use client";

import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";

type Coords = { top: number; left: number; placement: "top" | "bottom" };

// Portals the tooltip bubble to document.body and positions it with `fixed` +
// getBoundingClientRect, so it can never be clipped by a scrollable/overflow-hidden
// ancestor (e.g. a table wrapper) or hidden behind a higher-stacked sibling (e.g. the
// sidebar sitting above a sticky topbar) the way an absolutely-positioned child of the
// trigger would be. Flips below the trigger when there isn't room above (a button
// pinned to the very top of the viewport, like the sidebar toggle) and clamps
// horizontally so it never runs off either edge.
export function useTooltip<T extends HTMLElement>() {
  const anchorRef = useRef<T>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState<Coords>({ top: -9999, left: -9999, placement: "top" });

  function reposition() {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const tooltip = tooltipRef.current;
    const gap = 8;
    const tooltipHeight = tooltip?.offsetHeight ?? 32;
    const tooltipWidth = tooltip?.offsetWidth ?? 80;

    const placement: Coords["placement"] = rect.top - tooltipHeight - gap < 0 ? "bottom" : "top";
    const top = placement === "top" ? rect.top - gap : rect.bottom + gap;

    const halfWidth = tooltipWidth / 2;
    const left = Math.min(Math.max(rect.left + rect.width / 2, halfWidth + gap), window.innerWidth - halfWidth - gap);

    setCoords({ top, left, placement });
  }

  useLayoutEffect(() => {
    if (!visible) return;
    reposition();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const triggerProps = {
    onMouseEnter: () => setVisible(true),
    onMouseLeave: () => setVisible(false),
    onFocus: () => setVisible(true),
    onBlur: () => setVisible(false),
  };

  return { anchorRef, tooltipRef, triggerProps, visible, coords };
}

export function TooltipPortal({
  tooltipRef,
  visible,
  coords,
  children,
}: {
  tooltipRef: RefObject<HTMLSpanElement | null>;
  visible: boolean;
  coords: Coords;
  children: React.ReactNode;
}) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <span
      ref={tooltipRef}
      role="tooltip"
      className={`pointer-events-none fixed z-[999] -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-md text-slate-50 shadow-md transition-opacity ${
        coords.placement === "top" ? "-translate-y-full" : ""
      } ${visible ? "opacity-100" : "opacity-0"}`}
      style={{ top: coords.top, left: coords.left }}
    >
      {children}
    </span>,
    document.body,
  );
}
