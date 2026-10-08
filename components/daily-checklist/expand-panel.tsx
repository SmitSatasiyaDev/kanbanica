"use client";

import { useEffect, useState } from "react";
import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

const MS = 220;

/**
 * Mount / unmount around a height transition: `present` keeps the content in the DOM until the
 * collapse finishes, `shown` flips a frame after mount so the expand actually animates.
 */
function useExpand(open: boolean) {
  const [present, setPresent] = useState(open);
  const [shown, setShown] = useState(open);
  useEffect(() => {
    if (open) {
      setPresent(true);
      const id = requestAnimationFrame(() =>
        requestAnimationFrame(() => setShown(true))
      );
      return () => cancelAnimationFrame(id);
    }
    setShown(false);
    const t = setTimeout(() => setPresent(false), MS);
    return () => clearTimeout(t);
  }, [open]);
  return { present, shown };
}

/** Animates 0 ↔ natural height (grid-rows trick — no measuring, content can change height). */
function Panel({
  shown,
  children,
}: {
  children: React.ReactNode;
  shown: boolean;
}) {
  return (
    <div
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
        shown ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
      )}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

/** Table row that slides open/closed under its parent row. */
export function ExpandRow({
  open,
  colSpan,
  id,
  children,
}: {
  children: React.ReactNode;
  colSpan: number;
  id?: string;
  open: boolean;
}) {
  const { present, shown } = useExpand(open);
  if (!present) {
    return null;
  }
  return (
    <TableRow className="bg-base-200/40 hover:bg-base-200/40">
      <TableCell className="p-0" colSpan={colSpan} id={id}>
        <Panel shown={shown}>{children}</Panel>
      </TableCell>
    </TableRow>
  );
}

/** Same, for the mobile cards (a block inside the card). */
export function ExpandBlock({
  open,
  id,
  children,
}: {
  children: React.ReactNode;
  id?: string;
  open: boolean;
}) {
  const { present, shown } = useExpand(open);
  if (!present) {
    return null;
  }
  return (
    <div className="-mx-3 -mb-3 rounded-b-xl bg-base-200/40" id={id}>
      <Panel shown={shown}>{children}</Panel>
    </div>
  );
}
