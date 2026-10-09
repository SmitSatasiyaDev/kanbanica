"use client"

import { CheckIcon } from "@phosphor-icons/react"
import * as React from "react"
import { Input } from "@/components/ui/input"
import {
  type Hsv,
  hexToHsv,
  hsvToHex,
  normalizeHexColor,
} from "@/lib/status-color"
import { cn } from "@/lib/utils"

const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n))

/**
 * Drag surface shared by the saturation/brightness square and the hue slider.
 * Pointer-captured so a drag keeps tracking outside the element; arrow keys
 * nudge the value (Shift = bigger step) so it is usable without a mouse.
 */
function useDrag(
  onMove: (x: number, y: number) => void,
  onKey: (key: string, step: number) => boolean
) {
  const ref = React.useRef<HTMLDivElement>(null)
  const dragging = React.useRef(false)

  function update(e: React.PointerEvent) {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    onMove(
      clamp((e.clientX - rect.left) / rect.width, 0, 1),
      clamp((e.clientY - rect.top) / rect.height, 0, 1)
    )
  }

  return {
    ref,
    onPointerDown(e: React.PointerEvent) {
      dragging.current = true
      e.currentTarget.setPointerCapture(e.pointerId)
      update(e)
    },
    onPointerMove(e: React.PointerEvent) {
      if (dragging.current) update(e)
    },
    onPointerUp(e: React.PointerEvent) {
      dragging.current = false
      e.currentTarget.releasePointerCapture(e.pointerId)
    },
    onKeyDown(e: React.KeyboardEvent) {
      if (onKey(e.key, e.shiftKey ? 10 : 1)) e.preventDefault()
    },
  }
}

interface ColorPickerProps {
  /** Called when a preset swatch is clicked (callers may close their popover). */
  onCommit?: (hex: string) => void
  /** Called live while dragging / typing, always with a valid `#RRGGBB`. */
  onChange: (hex: string) => void
  /** Quick-pick swatches shown under the picker. */
  presets?: readonly string[]
  /** Current color, `#RRGGBB`. */
  value: string
}

function ColorPicker({
  value,
  onChange,
  onCommit,
  presets = [],
}: ColorPickerProps) {
  // HSV is the source of truth while interacting: round-tripping through hex
  // would lose the hue whenever saturation or brightness hits 0 (the thumb
  // would snap back to red). Re-sync only when `value` changes from outside.
  const [hsv, setHsv] = React.useState<Hsv>(() => hexToHsv(value))
  const [hex, setHex] = React.useState(value.toUpperCase())

  React.useEffect(() => {
    if (normalizeHexColor(value) !== hsvToHex(hsv)) {
      setHsv(hexToHsv(value))
      setHex(value.toUpperCase())
    }
    // `hsv` intentionally omitted: this only reacts to external value changes.
  }, [value])

  function apply(next: Hsv) {
    setHsv(next)
    const out = hsvToHex(next)
    setHex(out)
    onChange(out)
  }

  const area = useDrag(
    (x, y) => apply({ ...hsv, s: x * 100, v: (1 - y) * 100 }),
    (key, step) => {
      if (key === "ArrowLeft") apply({ ...hsv, s: clamp(hsv.s - step, 0, 100) })
      else if (key === "ArrowRight")
        apply({ ...hsv, s: clamp(hsv.s + step, 0, 100) })
      else if (key === "ArrowUp")
        apply({ ...hsv, v: clamp(hsv.v + step, 0, 100) })
      else if (key === "ArrowDown")
        apply({ ...hsv, v: clamp(hsv.v - step, 0, 100) })
      else return false
      return true
    }
  )
  const hue = useDrag(
    (x) => apply({ ...hsv, h: x * 360 }),
    (key, step) => {
      const d = step * 3
      if (key === "ArrowLeft" || key === "ArrowDown")
        apply({ ...hsv, h: clamp(hsv.h - d, 0, 360) })
      else if (key === "ArrowRight" || key === "ArrowUp")
        apply({ ...hsv, h: clamp(hsv.h + d, 0, 360) })
      else return false
      return true
    }
  )

  const current = hsvToHex(hsv)
  const invalid = hex.trim() !== "" && !normalizeHexColor(hex)

  return (
    <div className="w-56 space-y-3 p-1">
      <div
        aria-label="Color saturation and brightness"
        aria-valuetext={`Saturation ${Math.round(hsv.s)}%, brightness ${Math.round(hsv.v)}%`}
        className="relative h-32 w-full cursor-crosshair touch-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onKeyDown={area.onKeyDown}
        onPointerDown={area.onPointerDown}
        onPointerMove={area.onPointerMove}
        onPointerUp={area.onPointerUp}
        ref={area.ref}
        role="slider"
        style={{
          backgroundColor: `hsl(${hsv.h} 100% 50%)`,
          backgroundImage:
            "linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)",
        }}
        tabIndex={0}
      >
        <span
          className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
          style={{
            left: `${hsv.s}%`,
            top: `${100 - hsv.v}%`,
            backgroundColor: current,
          }}
        />
      </div>

      <div
        aria-label="Hue"
        aria-valuemax={360}
        aria-valuemin={0}
        aria-valuenow={Math.round(hsv.h)}
        className="relative h-3 w-full cursor-pointer touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onKeyDown={hue.onKeyDown}
        onPointerDown={hue.onPointerDown}
        onPointerMove={hue.onPointerMove}
        onPointerUp={hue.onPointerUp}
        ref={hue.ref}
        role="slider"
        style={{
          backgroundImage:
            "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)",
        }}
        tabIndex={0}
      >
        <span
          className="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
          style={{
            left: `${(hsv.h / 360) * 100}%`,
            backgroundColor: `hsl(${hsv.h} 100% 50%)`,
          }}
        />
      </div>

      <div className="flex items-center gap-2">
        <span
          className="size-7 shrink-0 rounded-md border border-base-300"
          style={{ backgroundColor: current }}
        />
        <Input
          aria-invalid={invalid}
          aria-label="Hex color"
          className="h-7 flex-1 font-mono text-xs uppercase"
          maxLength={7}
          onChange={(e) => {
            const next = e.target.value
            setHex(next)
            const valid = normalizeHexColor(next)
            if (valid) {
              setHsv(hexToHsv(valid))
              onChange(valid)
            }
          }}
          onBlur={() => setHex(current)}
          spellCheck={false}
          value={hex}
        />
      </div>
      {invalid && (
        <p className="text-xs text-error">Enter a hex color like #3B82F6</p>
      )}

      {presets.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-base-300 pt-3">
          {presets.map((c) => {
            const selected = c.toLowerCase() === current.toLowerCase()
            return (
              <button
                aria-label={`Color ${c}`}
                className={cn(
                  "flex size-5 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                )}
                key={c}
                onClick={() => {
                  apply(hexToHsv(c))
                  onCommit?.(c)
                }}
                style={{
                  backgroundColor: c,
                  boxShadow: selected
                    ? `0 0 0 2px white, 0 0 0 3.5px ${c}`
                    : undefined,
                }}
                type="button"
              >
                {selected && (
                  <CheckIcon className="size-2.5 text-white" weight="bold" />
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export { ColorPicker }
