import type { ItemSource } from "./types.ts";

/** Item keys: `steam:<appid>`, `shortcut:<id>`, `jellyfin:<itemId>`. */
export function makeKey(source: ItemSource, id: string): string {
  return `${source}:${id}`;
}

export function parseKey(key: string): { source: ItemSource; id: string } | null {
  const m = /^(steam|shortcut|jellyfin):([A-Za-z0-9_-]{1,64})$/.exec(key);
  if (!m) return null;
  return { source: m[1] as ItemSource, id: m[2] as string };
}

export function isGameKey(key: string): boolean {
  return key.startsWith("steam:") || key.startsWith("shortcut:");
}

/** Milliseconds since epoch for an ISO timestamp, or -Infinity for null / invalid. */
export function timeOf(iso: string | null | undefined): number {
  if (!iso) return Number.NEGATIVE_INFINITY;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

/** Most recent activity first; ties broken by the stable item key. */
export function byRecentActivity(a: { lastActivityAt: string | null; key: string }, b: typeof a): number {
  const d = timeOf(b.lastActivityAt) - timeOf(a.lastActivityAt);
  if (d !== 0 && !Number.isNaN(d)) return d > 0 ? 1 : -1;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}
