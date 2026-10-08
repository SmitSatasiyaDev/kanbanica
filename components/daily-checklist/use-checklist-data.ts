"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtimeRefetch } from "@/components/realtime/realtime-provider";

type Result<T> = T | { error: string };

/**
 * Loads server-action data, re-fetching on realtime `data_changed` and on demand.
 * `deps` is the cache key: a change reloads (and shows the loading state).
 */
export function useChecklistData<T>(
  fetcher: () => Promise<Result<T>>,
  deps: readonly (string | null | undefined)[]
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const key = deps.join("|");

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is the cache key; the latest fetcher is read through a ref
  const reload = useCallback(
    async (silent = false) => {
      if (!silent) {
        setLoading(true);
      }
      try {
        const res = await fetcherRef.current();
        if (res && typeof res === "object" && "error" in res) {
          setError((res as { error: string }).error);
          setData(null);
        } else {
          setError(null);
          setData(res as T);
        }
      } catch {
        setError("Something went wrong. Please try again.");
      } finally {
        setLoading(false);
      }
    },
    [key]
  );

  useEffect(() => {
    reload();
  }, [reload]);

  useRealtimeRefetch(() => {
    reload(true);
  });

  return { data, error, loading, reload };
}
