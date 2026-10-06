/**
 * A read-only filesystem that mounts real directories at virtual paths. Mock mode and tests use
 * it to present fixtures/steam as a Linux (/home/deck/...) or Windows (C:\...) Steam install,
 * so the real Steam adapter runs unchanged against fixtures under either platform implementation.
 */
import path from "node:path";
import type { PathLib, ReadFs } from "../platform/types.ts";

export interface Mount {
  /** Virtual path in the target platform's syntax. */
  virtual: string;
  /** Real path on this host. */
  real: string;
}

export function mappedFs(
  real: ReadFs,
  virtualPath: PathLib,
  mounts: Mount[],
  files: Mount[] = [],
  caseInsensitive = false,
): ReadFs & { touched: string[] } {
  const norm = (p: string) => {
    const n = virtualPath.normalize(p).replace(/[\\/]+$/, "");
    return caseInsensitive ? n.toLowerCase() : n;
  };
  const sortedMounts = [...mounts].sort((a, b) => b.virtual.length - a.virtual.length);
  const touched: string[] = [];

  const toReal = (p: string): string | null => {
    const n = norm(p);
    for (const f of files) if (norm(f.virtual) === n) return f.real;
    for (const m of sortedMounts) {
      const v = norm(m.virtual);
      if (n === v) return m.real;
      if (n.startsWith(v + virtualPath.sep)) {
        const rest = virtualPath.normalize(p).slice(m.virtual.replace(/[\\/]+$/, "").length + 1);
        return path.join(m.real, ...rest.split(/[\\/]+/));
      }
    }
    return null;
  };
  /** Virtual parents of mount points (e.g. "/home/deck") must list their mounted child. */
  const virtualChildren = (p: string): string[] => {
    const n = norm(p);
    const out = new Set<string>();
    for (const m of mounts) {
      const v = norm(m.virtual);
      if (v.startsWith(n + virtualPath.sep))
        out.add(
          virtualPath
            .normalize(m.virtual)
            .slice(n.length + 1)
            .split(/[\\/]/)[0] as string,
        );
    }
    return [...out];
  };

  return {
    touched,
    exists(p) {
      touched.push(p);
      const r = toReal(p);
      return r ? real.exists(r) : virtualChildren(p).length > 0;
    },
    stat(p) {
      touched.push(p);
      const r = toReal(p);
      if (r) return real.stat(r);
      return virtualChildren(p).length > 0 ? { isDir: true, isFile: false, size: 0, mtimeMs: 0 } : null;
    },
    readFile(p) {
      touched.push(p);
      const r = toReal(p);
      if (!r) throw new Error(`ENOENT ${p}`);
      return real.readFile(r);
    },
    readText(p) {
      touched.push(p);
      const r = toReal(p);
      if (!r) throw new Error(`ENOENT ${p}`);
      return real.readText(r);
    },
    readdir(p) {
      touched.push(p);
      const r = toReal(p);
      if (r) return real.readdir(r);
      const kids = virtualChildren(p);
      if (kids.length === 0) throw new Error(`ENOENT ${p}`);
      return kids;
    },
    realpath(p) {
      return virtualPath.normalize(p);
    },
  };
}
