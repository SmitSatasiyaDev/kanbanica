# Solution: cap composer height, scroll internally

**Change:** in `components/task/task-activity-feed.tsx`, the editor's `attributes.class` now adds `max-h-[min(40vh,320px)] overflow-y-auto overscroll-contain break-words`.

**Why it works:** the editor still grows with content (min-height unchanged) up to 320px / 40% of the viewport, then becomes its own scroll container. The toolbar + Send button are siblings below it, so they stay in place. Height is CSS-driven, so it shrinks automatically when text is deleted. Content is never truncated; no JS autosize, send logic, keyboard handling or activity rendering was touched. `break-words` stops long unbroken strings causing horizontal overflow.
