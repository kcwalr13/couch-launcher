/**
 * Data loading with a tiny stale-while-revalidate cache: a screen that remounts (Back) shows
 * its last data at once, so focus restores onto real tiles, while fresh data loads.
 */
import { useCallback, useEffect, useRef, useState } from "react";

const cache = new Map<string, unknown>();

export function clearApiCache(): void {
  cache.clear();
}

export function useApi<T>(cacheKey: string, load: () => Promise<T>, refreshToken = 0) {
  const [data, setData] = useState<T | null>(() => (cache.get(cacheKey) as T | undefined) ?? null);
  const [error, setError] = useState<string | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;

  const reload = useCallback(() => {
    let alive = true;
    loadRef
      .current()
      .then((d) => {
        if (!alive) return;
        cache.set(cacheKey, d);
        setData(d);
        setError(null);
      })
      .catch((e: Error) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [cacheKey]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshToken triggers a reload on purpose
  useEffect(() => {
    const cached = cache.get(cacheKey) as T | undefined;
    if (cached !== undefined) setData(cached);
    return reload();
  }, [cacheKey, reload, refreshToken]);

  return { data, error, reload };
}
