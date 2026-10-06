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
