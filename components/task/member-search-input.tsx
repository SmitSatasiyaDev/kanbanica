"use client";

import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import type { KeyboardEventHandler, Ref } from "react";
import { Input } from "@/components/ui/input";

/** Compact search field for member-picker popovers. */
export function MemberSearchInput({
  value,
  onChange,
  autoFocus = true,
  inputRef,
  onKeyDown,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Disable when the field is mounted while hidden (e.g. a closed Select). */
  autoFocus?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
}) {
  return (
    <div className="relative mb-2">
      <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-base-content/60" />
      <Input
        aria-label="Search members"
        autoFocus={autoFocus}
        className="h-7 pl-7 text-xs"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Search members…"
        ref={inputRef}
        value={value}
      />
    </div>
  );
}
