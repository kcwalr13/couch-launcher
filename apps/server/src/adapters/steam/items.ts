/** Maps Steam scan results and store metadata to unified items. Pure. */
import type { ItemTags, SessionLength, UnifiedItem } from "@couch/core";
import { makeKey } from "@couch/core";
import type { SteamGame, SteamShortcut } from "./steam.ts";
import {
  CAT_FULL_CONTROLLER,
  CAT_PARTIAL_CONTROLLER,
  COUCH_CATEGORIES,
  type StoreInfo,
} from "./store-metadata.ts";

const ORDER: SessionLength[] = ["short", "medium", "long"];

/** Longest session length among mapped genres; the default when none map or genres are unknown. */
export function sessionFromGenres(
  genres: string[],
  map: Record<string, SessionLength>,
  fallback: SessionLength,
): SessionLength {
  const lower = new Map(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]));
  let best: SessionLength | null = null;
  for (const g of genres) {
    const s = lower.get(g.toLowerCase());
    if (s && (best === null || ORDER.indexOf(s) > ORDER.indexOf(best))) best = s;
  }
  return best ?? fallback;
}

export function tagsFromStore(
  info: StoreInfo | null,
  map: Record<string, SessionLength>,
  fallback: SessionLength,
): ItemTags {
  if (!info?.available) return { genres: [], couchCoop: null, controller: null, sessionLength: fallback };
  const cats = new Set(info.categories);
  return {
    genres: info.genres,
    couchCoop: COUCH_CATEGORIES.some((c) => cats.has(c)),
    controller: cats.has(CAT_FULL_CONTROLLER)
      ? "full"
      : cats.has(CAT_PARTIAL_CONTROLLER)
        ? "partial"
        : "none",
    sessionLength: sessionFromGenres(info.genres, map, fallback),
  };
}

const isoFromUnix = (s: number | null) => (s ? new Date(s * 1000).toISOString() : null);

export function artUrls(key: string) {
  return { poster: `/api/art/${key}/poster`, hero: `/api/art/${key}/hero` };
}

export function steamGameItem(
  g: SteamGame,
  info: StoreInfo | null,
  map: Record<string, SessionLength>,
  fallback: SessionLength,
): UnifiedItem {
  const key = makeKey("steam", g.appId);
  return {
    key,
    kind: "game",
    source: "steam",
    title: g.name,
    subtitle: null,
    summary: info?.description ?? null,
    art: artUrls(key),
    lastActivityAt: isoFromUnix(g.lastPlayed),
    addedAt: null,
    progress: null,
    playtimeMin: g.playtimeMin,
    tags: tagsFromStore(info, map, fallback),
    launch: { type: "steam", appId: g.appId },
  };
}

export function shortcutItem(s: SteamShortcut, fallback: SessionLength): UnifiedItem {
  const key = makeKey("shortcut", String(s.appId32));
  return {
    key,
    kind: "game",
    source: "shortcut",
    title: s.name,
    subtitle: s.tags[0] ?? null,
    summary: null,
    art: artUrls(key),
    lastActivityAt: isoFromUnix(s.lastPlayed),
    addedAt: null,
    progress: null,
    playtimeMin: null,
    tags: { genres: [], couchCoop: null, controller: null, sessionLength: fallback },
    launch: { type: "shortcut", gameId: s.gameId },
  };
}

/**
 * Shortcuts that are not games: hidden ones, the Jellyfin client used for playback and the
 * launcher's own kiosk shortcut.
 */
export function isUtilityShortcut(s: SteamShortcut, clientShortcut: string, port: number): boolean {
  if (s.hidden) return true;
  const name = s.name.toLowerCase();
  if (clientShortcut && name.includes(clientShortcut.toLowerCase())) return true;
  if (name.includes("couch launcher")) return true;
  const cmd = `${s.exe} ${s.launchOptions}`;
  return cmd.includes(`127.0.0.1:${port}`) || cmd.includes(`localhost:${port}`);
}
