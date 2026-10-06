/**
 * Resolves local Steam artwork files. Returns a path under the Steam root, or null.
 * Order (DECISIONS D-020): user grid override, per-app librarycache folder, hashed subfolder,
 * old flat layout, then the wide header as a last resort.
 */
import type { Platform, ReadFs } from "../../platform/types.ts";

export type ArtKind = "poster" | "hero";

const IMG_EXT = ["png", "jpg", "jpeg", "webp"];

function first(fs: ReadFs, paths: string[]): string | null {
  for (const p of paths) {
    const s = fs.stat(p);
    if (s?.isFile && s.size > 0) return p;
  }
  return null;
}

function gridCandidates(
  platform: Platform,
  root: string,
  userId: string | null,
  id: string,
  kind: ArtKind,
): string[] {
  if (!userId) return [];
  const P = platform.path;
  const grid = P.join(root, "userdata", userId, "config", "grid");
  const suffix = kind === "poster" ? "p" : "_hero";
  return IMG_EXT.map((e) => P.join(grid, `${id}${suffix}.${e}`));
}

function hashedSubdirs(fs: ReadFs, platform: Platform, dir: string, names: string[]): string[] {
  const P = platform.path;
  let entries: string[];
  try {
    entries = fs.readdir(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries.sort()) {
    if (!/^[0-9a-f]{40}$/i.test(e)) continue;
    for (const n of names) out.push(P.join(dir, e, n));
  }
  return out;
}

export function resolveSteamArt(
  fs: ReadFs,
  platform: Platform,
  root: string,
  userId: string | null,
  appId: string,
  kind: ArtKind,
): string | null {
  const P = platform.path;
  const cache = P.join(root, "appcache", "librarycache");
  const appDir = P.join(cache, appId);
  const main = kind === "poster" ? ["library_600x900.jpg", "library_capsule.jpg"] : ["library_hero.jpg"];
  const candidates = [
    ...gridCandidates(platform, root, userId, appId, kind),
    ...main.map((n) => P.join(appDir, n)),
    ...hashedSubdirs(fs, platform, appDir, main),
    P.join(cache, kind === "poster" ? `${appId}_library_600x900.jpg` : `${appId}_library_hero.jpg`),
    P.join(appDir, "header.jpg"),
    P.join(cache, `${appId}_header.jpg`),
  ];
  return first(fs, candidates);
}

export function resolveShortcutArt(
  fs: ReadFs,
  platform: Platform,
  root: string,
  userId: string | null,
  appId32: number,
  kind: ArtKind,
): string | null {
  const id = String(appId32);
  const P = platform.path;
  const wide = userId
    ? IMG_EXT.map((e) => P.join(root, "userdata", userId, "config", "grid", `${id}.${e}`))
    : [];
  return first(fs, [...gridCandidates(platform, root, userId, id, kind), ...wide]);
}
