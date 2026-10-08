"use client"

import * as React from "react"
import { CheckIcon } from "@phosphor-icons/react"

import { cn } from "@/lib/utils"

type CheckedState = boolean | "indeterminate"

function Checkbox({
  className,
  checked,
  defaultChecked,
  disabled,
  onCheckedChange,
  onClick,
  ...props
}: Omit<
  React.ComponentProps<"button">,
  "checked" | "defaultChecked" | "onChange"
> & {
  checked?: CheckedState
  defaultChecked?: CheckedState
  onCheckedChange?: (checked: CheckedState) => void
}) {
  const [internalChecked, setInternalChecked] = React.useState<CheckedState>(
    defaultChecked ?? false
  )
  const isChecked = checked ?? internalChecked
  const state =
    isChecked === "indeterminate"
      ? "indeterminate"
      : isChecked
        ? "checked"
        : "unchecked"

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={isChecked === "indeterminate" ? "mixed" : isChecked}
      data-slot="checkbox"
      data-state={state}
      disabled={disabled}
      className={cn(
        "peer relative flex size-4.5 shrink-0 items-center justify-center rounded-none border border-base-content/40 bg-transparent transition-shadow hover:border-base-content/60 outline-none group-has-disabled/field:opacity-50 after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-error aria-invalid:ring-2 aria-invalid:ring-error/20 aria-invalid:aria-checked:border-primary dark:aria-invalid:border-error/50 dark:aria-invalid:ring-error/40 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-content dark:data-checked:bg-primary",
        className
      )}
      onClick={(event) => {
        onClick?.(event)
        if (event.defaultPrevented) return
        const next: CheckedState = isChecked === "indeterminate" ? true : !isChecked
        if (checked === undefined) setInternalChecked(next)
        onCheckedChange?.(next)
      }}
      {...props}
    >
      {isChecked !== false && (
        <span
          data-slot="checkbox-indicator"
          className="grid place-content-center text-current transition-none [&>svg]:size-3.5"
        >
          <CheckIcon />
        </span>
      )}
    </button>
  )
}

export { Checkbox }
