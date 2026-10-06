/** A tiny method + path router. Patterns use `:name` segments. */
export type Params = Record<string, string>;
export type Handler = (req: Request, params: Params, url: URL) => Response | Promise<Response>;

interface Route {
  method: string;
  parts: string[];
  handler: Handler;
}

export class Router {
  private routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler): this {
    this.routes.push({ method, parts: pattern.split("/").filter(Boolean), handler });
    return this;
  }

  get(p: string, h: Handler) {
    return this.add("GET", p, h);
  }
  post(p: string, h: Handler) {
    return this.add("POST", p, h);
  }
  put(p: string, h: Handler) {
    return this.add("PUT", p, h);
  }

  /** Returns null when no route matches the path; a 405 when the path matches another method. */
  match(method: string, pathname: string): { handler: Handler; params: Params } | "method" | null {
    const segs = pathname.split("/").filter(Boolean);
    let pathMatched = false;
    for (const r of this.routes) {
      if (r.parts.length !== segs.length) continue;
      const params: Params = {};
      let ok = true;
      for (let i = 0; i < r.parts.length; i++) {
        const p = r.parts[i] as string;
        const s = segs[i] as string;
        if (p.startsWith(":")) {
          try {
            params[p.slice(1)] = decodeURIComponent(s);
          } catch {
            ok = false;
            break;
          }
        } else if (p !== s) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      pathMatched = true;
      if (r.method === method || (method === "HEAD" && r.method === "GET"))
        return { handler: r.handler, params };
    }
    return pathMatched ? "method" : null;
  }
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

export function errorJson(status: number, error: string): Response {
  return json({ error }, status);
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}
