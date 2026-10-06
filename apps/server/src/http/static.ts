/**
 * Serves the web UI. Compiled executables embed the bundle (see scripts/build.ts, which fills
 * embedded-web.ts); running from source serves apps/web/dist from disk.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { EMBEDDED_WEB } from "./embedded-web.ts";

export interface WebAssets {
  get(pathname: string): { body: Uint8Array; type: string } | null;
  source: string;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

export function contentType(p: string): string {
  return TYPES[path.extname(p).toLowerCase()] ?? "application/octet-stream";
}

export function embeddedAssets(): WebAssets | null {
  const keys = Object.keys(EMBEDDED_WEB);
  if (keys.length === 0) return null;
  const cache = new Map<string, Uint8Array>();
  return {
    source: "embedded",
    get(p) {
      const b64 = EMBEDDED_WEB[p];
      if (b64 === undefined) return null;
      let body = cache.get(p);
      if (!body) {
        body = Uint8Array.from(Buffer.from(b64, "base64"));
        cache.set(p, body);
      }
      return { body, type: contentType(p) };
    },
  };
}

export function diskAssets(dir: string): WebAssets {
  const root = path.resolve(dir);
  return {
    source: root,
    get(p) {
      const full = path.resolve(root, `.${p}`);
      if (full !== root && !full.startsWith(root + path.sep)) return null;
      try {
        if (!existsSync(full) || !statSync(full).isFile()) return null;
        return { body: readFileSync(full), type: contentType(full) };
      } catch {
        return null;
      }
    },
  };
}

export function defaultWebAssets(): WebAssets {
  return embeddedAssets() ?? diskAssets(path.resolve(import.meta.dir, "..", "..", "..", "web", "dist"));
}

/** GET handler for non-API paths: the file if it exists, otherwise index.html (client-side screens). */
export function serveStatic(assets: WebAssets, pathname: string): Response {
  const f = assets.get(pathname === "/" ? "/index.html" : pathname);
  if (f) {
    const immutable = pathname.startsWith("/assets/");
    return new Response(f.body, {
      headers: {
        "content-type": f.type,
        "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
      },
    });
  }
  const index = assets.get("/index.html");
  if (index && !path.extname(pathname))
    return new Response(index.body, { headers: { "content-type": index.type, "cache-control": "no-cache" } });
  return new Response("UI not built. Run `bun run build:web`.", { status: 404 });
}
