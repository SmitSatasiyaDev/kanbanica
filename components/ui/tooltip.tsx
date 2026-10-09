"use client"

import * as React from "react"
import type { Placement } from "@floating-ui/dom"

import { cn } from "@/lib/utils"
import { Slot } from "@/components/ui/slot"
import { Portal, useFloatingPosition, usePresence } from "@/components/ui/floating"

type Side = "top" | "right" | "bottom" | "left"
type Align = "start" | "center" | "end"

function toPlacement(side: Side, align: Align): Placement {
  return align === "center" ? side : (`${side}-${align}` as Placement)
}

type TooltipProviderContextValue = { delayDuration: number }

const TooltipProviderContext =
  React.createContext<TooltipProviderContextValue>({ delayDuration: 0 })

function TooltipProvider({
  delayDuration = 0,
  children,
}: {
  delayDuration?: number
  children?: React.ReactNode
}) {
  return (
    <TooltipProviderContext.Provider value={{ delayDuration }}>
      {children}
    </TooltipProviderContext.Provider>
  )
}

type TooltipContextValue = {
  open: boolean
  setOpen: (open: boolean) => void
  triggerRef: React.RefObject<HTMLElement | null>
  contentRef: React.RefObject<HTMLElement | null>
  contentId: string
  delayDuration: number
}

const TooltipContext = React.createContext<TooltipContextValue | null>(null)

function useTooltipContext(component: string) {
  const context = React.useContext(TooltipContext)
  if (!context) {
    throw new Error(`${component} must be used within <Tooltip>`)
  }
  return context
}

function Tooltip({
  open: openProp,
  defaultOpen,
  onOpenChange,
  delayDuration,
  children,
}: {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  delayDuration?: number
  children?: React.ReactNode
}) {
  const providerContext = React.useContext(TooltipProviderContext)
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen ?? false)
  const open = openProp ?? internalOpen
  const triggerRef = React.useRef<HTMLElement | null>(null)
  const contentRef = React.useRef<HTMLElement | null>(null)
  const contentId = React.useId()

  const setOpen = React.useCallback(
    (next: boolean) => {
      if (openProp === undefined) setInternalOpen(next)
      onOpenChange?.(next)
    },
    [openProp, onOpenChange]
  )

  return (
    <TooltipContext.Provider
      value={{
        open,
        setOpen,
        triggerRef,
        contentRef,
        contentId,
        delayDuration: delayDuration ?? providerContext.delayDuration,
      }}
    >
      {children}
    </TooltipContext.Provider>
  )
}

function TooltipTrigger({
  asChild,
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onBlur,
  ...props
}: React.ComponentProps<"button"> & { asChild?: boolean }) {
  const { open, setOpen, triggerRef, contentId, delayDuration } =
    useTooltipContext("TooltipTrigger")
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const Comp = asChild ? Slot : "button"

  const clearPendingOpen = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }

  React.useEffect(() => clearPendingOpen, [])

  return (
    <Comp
      ref={triggerRef as React.Ref<HTMLButtonElement>}
      data-slot="tooltip-trigger"
      aria-describedby={open ? contentId : undefined}
      onMouseEnter={(event: React.MouseEvent<HTMLButtonElement>) => {
        onMouseEnter?.(event)
        if (event.defaultPrevented) return
        clearPendingOpen()
        timeoutRef.current = setTimeout(() => setOpen(true), delayDuration)
      }}
      onMouseLeave={(event: React.MouseEvent<HTMLButtonElement>) => {
        onMouseLeave?.(event)
        if (event.defaultPrevented) return
        clearPendingOpen()
        setOpen(false)
      }}
      onFocus={(event: React.FocusEvent<HTMLButtonElement>) => {
        onFocus?.(event)
        if (event.defaultPrevented) return
        clearPendingOpen()
        setOpen(true)
      }}
      onBlur={(event: React.FocusEvent<HTMLButtonElement>) => {
        onBlur?.(event)
        if (event.defaultPrevented) return
        clearPendingOpen()
        setOpen(false)
      }}
      {...props}
    />
  )
}

function TooltipContent({
  className,
  side = "top",
  align = "center",
  sideOffset = 0,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  side?: Side
  align?: Align
  sideOffset?: number
}) {
  const { open, triggerRef, contentRef, contentId, setOpen } =
    useTooltipContext("TooltipContent")
  const mounted = usePresence(open, 100)
  const { referenceRef, floatingRef, styles, placement } = useFloatingPosition({
    open: mounted,
    placement: toPlacement(side, align),
    gap: sideOffset + 6,
    boundaryPadding: 8,
  })
  referenceRef.current = triggerRef.current

  React.useEffect(() => {
    if (!open) return
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("keydown", handleKeyDown, true)
    return () => document.removeEventListener("keydown", handleKeyDown, true)
  }, [open, setOpen])

  // The tooltip body can be shifted along the edge to stay inside the viewport
  // (e.g. a trigger in the top-right corner), so a centered arrow would point
  // at empty space. Aim it at the trigger's center instead, clamped to the
  // body so it never leaves the rounded corners.
  const [arrowOffset, setArrowOffset] = React.useState<number | null>(null)
  React.useLayoutEffect(() => {
    const trigger = triggerRef.current
    const content = contentRef.current
    if (!mounted || !trigger || !content) return
    const t = trigger.getBoundingClientRect()
    const c = content.getBoundingClientRect()
    const vertical = placement.startsWith("top") || placement.startsWith("bottom")
    const raw = vertical
      ? t.left + t.width / 2 - c.left
      : t.top + t.height / 2 - c.top
    const max = (vertical ? c.width : c.height) - 12
    setArrowOffset(Math.min(Math.max(raw, 12), Math.max(max, 12)))
  }, [mounted, placement, styles, triggerRef, contentRef])

  if (!mounted) return null

  const resolvedSide = placement.split("-")[0] as Side

  return (
    <Portal>
      <div
        ref={(node) => {
          contentRef.current = node
          floatingRef.current = node
        }}
        id={contentId}
        role="tooltip"
        data-slot="tooltip-content"
        data-state={open ? "open" : "closed"}
        data-side={resolvedSide}
        style={styles}
        className={cn(
          "z-50 inline-flex w-fit max-w-xs items-center gap-1.5 rounded-md bg-base-content px-3 py-1.5 text-xs text-base-100 has-data-[slot=kbd]:pr-1.5 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      >
        {children}
        <span
          data-slot="tooltip-arrow"
          style={
            arrowOffset === null
              ? undefined
              : resolvedSide === "top" || resolvedSide === "bottom"
                ? { left: arrowOffset }
                : { top: arrowOffset }
          }
          className={cn(
            "absolute z-50 size-2.5 rotate-45 rounded-none bg-base-content",
            resolvedSide === "top" && "top-full left-1/2 -translate-x-1/2 -translate-y-1/2",
            resolvedSide === "bottom" && "bottom-full left-1/2 -translate-x-1/2 translate-y-1/2",
            resolvedSide === "left" && "left-full top-1/2 -translate-y-1/2 -translate-x-1/2",
            resolvedSide === "right" && "right-full top-1/2 -translate-y-1/2 translate-x-1/2"
          )}
        />
      </div>
    </Portal>
  )
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
