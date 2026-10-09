#!/usr/bin/env bash
# Fails if any legacy shadcn-style token utility class shows up outside the
# allowlisted exceptions. Guards against regressing the daisyUI migration
# (.claude/plans/i-need-complete-migration-refactored-kite.md) now that
# app/globals.css no longer defines the old --color-* aliases for most of
# these — a reintroduced usage renders unstyled, not a build error, so this
# is the only thing that actually catches it.
set -euo pipefail
cd "$(dirname "$0")/.."

PATTERN='\b(bg-background|text-foreground|bg-muted\b|bg-border\b|border-border|border-input|bg-card\b|bg-popover\b|text-card-foreground|text-popover-foreground|text-muted-foreground|text-primary-foreground|bg-destructive|text-destructive\b|border-destructive|ring-destructive|bg-accent|text-accent-foreground)\b'

# components/ui/ is excluded from Biome entirely (see biome.jsonc) and from
# this gate too: button.tsx's --secondary color-mix() and the deferred
# secondary/accent boundary live there deliberately, not a token regression.
MATCHES=$(grep -rnE "$PATTERN" app components --include='*.tsx' \
  | grep -v '^components/ui/' \
  | grep -v '^app/dev/kitchen-sink/' \
  || true)

if [ -n "$MATCHES" ]; then
  echo "lint:tokens: found legacy shadcn-style token classes outside components/ui/:"
  echo "$MATCHES"
  echo
  echo "These utility classes no longer resolve to a real color for most tokens"
  echo "(app/globals.css's legacy aliases were removed in Phase 6 of the daisyUI"
  echo "migration) — use the daisyUI-native name instead (see the rename table in"
  echo ".claude/plans/i-need-complete-migration-refactored-kite.md)."
  exit 1
fi

echo "lint:tokens: clean"
