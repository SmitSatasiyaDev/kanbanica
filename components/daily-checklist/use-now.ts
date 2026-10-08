"use client";

import { useSyncExternalStore } from "react";

// One shared 30s clock for every due-time cell, so overdue state flips on screen without a
// reload and without a timer per row. Display-only; the server stays the source of truth.
const TICK_MS = 30_000;
let current = new Date();
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  if (!timer) {
    current = new Date();
    timer = setInterval(() => {
      current = new Date();
      for (const l of listeners) {
        l();
      }
    }, TICK_MS);
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function useNow(): Date {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => current
  );
}
