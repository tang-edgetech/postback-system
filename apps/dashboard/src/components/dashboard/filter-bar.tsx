"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { FilterIcon, XIcon } from "@/components/icons";

// Mobile: filters collapse behind a "Filters" button (badge = active count) that opens
// a full-screen sheet; the same controls render inline on desktop. One instance of the
// filter controls in the DOM either way — only the wrapping classes change with
// breakpoint/open state, so ids never collide between a "desktop" and "mobile" copy.
export function FilterBar({ id, activeCount, onClear, children }: { id: string; activeCount: number; onClear?: () => void; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div id={id} className="c-filter-bar">
      <div className="flex items-center gap-3 md:hidden">
        <Button id={`${id}-toggle`} type="button" variant="secondary" onClick={() => setOpen(true)}>
          <FilterIcon />
          {`filters${activeCount > 0 ? ` (${activeCount})` : ""}`}
        </Button>
        {activeCount > 0 && onClear && (
          <Button id={`${id}-clear-mobile`} type="button" variant="ghost" onClick={onClear}>
            clear
          </Button>
        )}
      </div>

      <div
        className={
          open
            ? "fixed inset-0 z-50 flex flex-col gap-4 overflow-y-auto bg-background p-4 md:static md:z-auto md:flex md:flex-row md:flex-wrap md:items-end md:gap-3 md:overflow-visible md:bg-transparent md:p-0"
            : "hidden md:flex md:flex-wrap md:items-end md:gap-3"
        }
      >
        {open && (
          <div className="flex items-center justify-between md:hidden">
            <h2 className="text-lg font-semibold text-foreground">Filters</h2>
            <IconButton icon={<XIcon />} label="Close Filters" onClick={() => setOpen(false)} />
          </div>
        )}

        {children}

        {open && (
          <div className="mt-2 flex gap-2 md:hidden">
            <Button id={`${id}-apply`} type="button" variant="primary" className="flex-1" onClick={() => setOpen(false)}>
              apply
            </Button>
            {activeCount > 0 && onClear && (
              <Button id={`${id}-clear`} type="button" variant="secondary" onClick={onClear}>
                clear
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
