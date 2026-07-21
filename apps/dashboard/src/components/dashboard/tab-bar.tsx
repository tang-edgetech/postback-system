"use client";

import { useEffect, useRef, useState } from "react";
import { toTitleCase } from "@/lib/titlecase";

// Horizontally-scrollable tab bar with native touch-swipe + scroll-snap (no swiper-style
// library needed for something this simple) and a fade on whichever edge still has more
// tabs to reveal, so a narrow/mobile viewport never just clips the tab row with no hint
// that there's more to swipe to.
export function TabBar<T extends string>({ id, tabs, active, onChange }: { id: string; tabs: readonly T[]; active: T; onChange: (t: T) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  function updateFades() {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }

  useEffect(() => {
    updateFades();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateFades, { passive: true });
    window.addEventListener("resize", updateFades);
    return () => {
      el.removeEventListener("scroll", updateFades);
      window.removeEventListener("resize", updateFades);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs.length]);

  return (
    <div id={id} className="relative">
      <div
        ref={scrollRef}
        className="flex gap-1 overflow-x-auto border-b border-border [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ scrollSnapType: "x proximity" }}
      >
        {tabs.map((t) => (
          <button
            key={t}
            id={`${id}-${t.toLowerCase()}`}
            type="button"
            onClick={() => onChange(t)}
            style={{ scrollSnapAlign: "start" }}
            className={`shrink-0 whitespace-nowrap px-4 py-2 text-sm font-medium ${
              active === t ? "border-b-2 border-accent text-accent" : "text-foreground-muted hover:text-foreground"
            }`}
          >
            {toTitleCase(t)}
          </button>
        ))}
      </div>
      {canScrollLeft && <div className="pointer-events-none absolute bottom-px left-0 top-0 w-6 bg-gradient-to-r from-background to-transparent" />}
      {canScrollRight && <div className="pointer-events-none absolute bottom-px right-0 top-0 w-6 bg-gradient-to-l from-background to-transparent" />}
    </div>
  );
}
