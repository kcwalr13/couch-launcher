/**
 * Artwork proxy with a disk cache. The browser only ever loads art from /api/art/:key/:kind.
 *  - Steam games: local librarycache / grid files; else the public CDN (cached to disk).
 *  - Shortcuts: grid files only.
 *  - Jellyfin: fetched with the API key (server side) and cached to disk, so art still shows
 *    when the NAS is unreachable.
 * A 404 tells the UI to show its text fallback.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseKey } from "@couch/core";
import type { FetchFn } from "../adapters/jellyfin/client.ts";
import type { JellyfinSource } from "../adapters/jellyfin/jellyfin.ts";
import { type ArtKind, resolveShortcutArt, resolveSteamArt } from "../adapters/steam/art.ts";
import type { Logger } from "../log.ts";
import type { Platform, ReadFs } from "../platform/types.ts";
import type { Library } from "./library.ts";

export function sniffImageType(b: Uint8Array): string | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45)
    return "image/webp";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  return null;
}

export const STEAM_CDN = "https://shared.steamstatic.com/store_item_assets/steam/apps";

export interface ArtDeps {
  platform: Platform;
  steamFs: ReadFs;
  library: Library;
  jellyfin: JellyfinSource | null;
  /** Fetch for the Steam CDN. null = never go online for art (mock mode). */
  cdnFetch: FetchFn | null;
  cacheDir: string;
  log: Logger;
}

export class ArtService {
  private readonly missing = new Map<string, number>();

  constructor(private readonly d: ArtDeps) {
    mkdirSync(d.cacheDir, { recursive: true });
  }

  private cachePath(key: string, kind: ArtKind): string {
    return path.join(this.d.cacheDir, `${key.replace(/[^A-Za-z0-9_-]/g, "_")}.${kind}`);
  }

  private readCache(key: string, kind: ArtKind): Uint8Array | null {
    const p = this.cachePath(key, kind);
    return existsSync(p) ? readFileSync(p) : null;
  }

  private writeCache(key: string, kind: ArtKind, body: Uint8Array): void {
    const p = this.cachePath(key, kind);
    const tmp = `${p}.tmp`;
    writeFileSync(tmp, body);
    renameSync(tmp, p);
  }

  async get(key: string, kind: ArtKind): Promise<{ body: Uint8Array; type: string } | null> {
    const parsed = parseKey(key);
    if (!parsed) return null;
    const ok = (body: Uint8Array | null) => {
      if (!body || body.length === 0) return null;
      const type = sniffImageType(body);
      return type ? { body, type } : null;
    };

    if (parsed.source === "steam" || parsed.source === "shortcut") {
      const scan = await this.d.library.steam();
      if (scan.root) {
        const local =
          parsed.source === "steam"
            ? resolveSteamArt(this.d.steamFs, this.d.platform, scan.root, scan.userId, parsed.id, kind)
            : resolveShortcutArt(
                this.d.steamFs,
                this.d.platform,
                scan.root,
                scan.userId,
                Number(parsed.id),
                kind,
              );
        if (local) return ok(this.d.steamFs.readFile(local));
      }
      if (parsed.source === "shortcut") return null;
      const cached = this.readCache(key, kind);
      if (cached) return ok(cached);
      return this.fromCdn(key, parsed.id, kind);
    }

    // Jellyfin: disk cache first for speed and offline use; refresh on miss.
    const cached = this.readCache(key, kind);
    if (cached) return ok(cached);
    if (!this.d.jellyfin || this.recentlyMissing(key, kind)) return null;
    try {
      const img = await this.d.jellyfin.image(parsed.id, kind);
      if (!img) {
        this.markMissing(key, kind);
        return null;
      }
      const res = ok(img.body);
      if (res) this.writeCache(key, kind, img.body);
      return res;
    } catch (e) {
      this.d.log.warn(`art: ${key} ${kind}: ${(e as Error).message}`);
      return null;
    }
  }

  private recentlyMissing(key: string, kind: ArtKind): boolean {
    const t = this.missing.get(`${key}/${kind}`);
    return t !== undefined && Date.now() - t < 10 * 60_000;
  }

  private markMissing(key: string, kind: ArtKind): void {
    this.missing.set(`${key}/${kind}`, Date.now());
  }

  private async fromCdn(key: string, appId: string, kind: ArtKind) {
    if (!this.d.cdnFetch || this.recentlyMissing(key, kind)) return null;
    const file = kind === "poster" ? "library_600x900_2x.jpg" : "library_hero.jpg";
    try {
      const res = await this.d.cdnFetch(`${STEAM_CDN}/${appId}/${file}`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        this.markMissing(key, kind);
        return null;
      }
      const body = new Uint8Array(await res.arrayBuffer());
      const type = sniffImageType(body);
      if (!type) return null;
      this.writeCache(key, kind, body);
      return { body, type };
    } catch {
      this.markMissing(key, kind);
      return null;
    }
  }
}
