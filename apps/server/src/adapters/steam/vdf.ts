/**
 * Valve KeyValues ("VDF") parsers.
 *  - Text: libraryfolders.vdf, appmanifest_*.acf, localconfig.vdf, loginusers.vdf.
 *  - Binary: userdata/<id>/config/shortcuts.vdf.
 * Both return the same tree. Keys keep their case; use `ci()` for case-insensitive lookup
 * because Steam writes some keys in different cases (apps/Apps, Exe/exe, AppName/appname).
 */

export type VdfValue = string | number | VdfObject;
export interface VdfObject {
  [key: string]: VdfValue;
}

export class VdfError extends Error {}

export function isVdfObject(v: VdfValue | undefined): v is VdfObject {
  return typeof v === "object" && v !== null;
}

/** Case-insensitive key lookup. */
export function ci(obj: VdfObject | undefined, key: string): VdfValue | undefined {
  if (!obj) return undefined;
  if (key in obj) return obj[key];
  const lower = key.toLowerCase();
  for (const k of Object.keys(obj)) if (k.toLowerCase() === lower) return obj[k];
  return undefined;
}

export function ciObj(obj: VdfObject | undefined, key: string): VdfObject | undefined {
  const v = ci(obj, key);
  return isVdfObject(v) ? v : undefined;
}

export function ciStr(obj: VdfObject | undefined, key: string): string | undefined {
  const v = ci(obj, key);
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return undefined;
}

export function ciNum(obj: VdfObject | undefined, key: string): number | undefined {
  const v = ci(obj, key);
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

/** Walk a path of keys case-insensitively. */
export function ciPath(obj: VdfObject | undefined, ...keys: string[]): VdfObject | undefined {
  let cur = obj;
  for (const k of keys) {
    cur = ciObj(cur, k);
    if (!cur) return undefined;
  }
  return cur;
}

// ---------- Text format ----------

const ESCAPES: Record<string, string> = { n: "\n", t: "\t", "\\": "\\", '"': '"' };

export function parseTextVdf(src: string): VdfObject {
  let i = 0;
  const n = src.length;
  // Skip a UTF-8 BOM.
  if (src.charCodeAt(0) === 0xfeff) i = 1;

  type Tok = { t: "str"; v: string } | { t: "open" } | { t: "close" } | { t: "eof" };
  const next = (): Tok => {
    for (;;) {
      while (i < n && /\s/.test(src[i] as string)) i++;
      if (i >= n) return { t: "eof" };
      if (src[i] === "/" && src[i + 1] === "/") {
        while (i < n && src[i] !== "\n") i++;
        continue;
      }
      break;
    }
    const c = src[i] as string;
    if (c === "{") {
      i++;
      return { t: "open" };
    }
    if (c === "}") {
      i++;
      return { t: "close" };
    }
    if (c === '"') {
      i++;
      let out = "";
      while (i < n && src[i] !== '"') {
        if (src[i] === "\\" && i + 1 < n) {
          const e = src[i + 1] as string;
          out += ESCAPES[e] ?? `\\${e}`;
          i += 2;
        } else {
          out += src[i];
          i++;
        }
      }
      if (i >= n) throw new VdfError("unterminated string");
      i++;
      return { t: "str", v: out };
    }
    let out = "";
    while (i < n && !/[\s{}"]/.test(src[i] as string)) out += src[i++];
    return { t: "str", v: out };
  };

  const skipConditional = () => {
    // Optional platform conditional after a value, e.g. "key" "value" [$WIN32]
    const save = i;
    while (i < n && (src[i] === " " || src[i] === "\t")) i++;
    if (src[i] === "[") {
      while (i < n && src[i] !== "]") i++;
      i++;
    } else i = save;
  };

  const parseObject = (top: boolean): VdfObject => {
    const obj: VdfObject = {};
    for (;;) {
      const k = next();
      if (k.t === "eof") {
        if (top) return obj;
        throw new VdfError("unexpected end of file");
      }
      if (k.t === "close") {
        if (top) throw new VdfError("unexpected }");
        return obj;
      }
      if (k.t !== "str") throw new VdfError("expected key");
      const v = next();
      if (v.t === "str") {
        obj[k.v] = v.v;
        skipConditional();
      } else if (v.t === "open") {
        const child = parseObject(false);
        const existing = obj[k.v];
        // Duplicate sections merge (Steam occasionally writes them).
        obj[k.v] = isVdfObject(existing) ? { ...existing, ...child } : child;
      } else throw new VdfError(`expected value for "${k.v}"`);
    }
  };
  return parseObject(true);
}

// ---------- Binary format ----------

const T_MAP = 0x00;
const T_STRING = 0x01;
const T_INT32 = 0x02;
const T_FLOAT32 = 0x03;
const T_POINTER = 0x04;
const T_WSTRING = 0x05;
const T_COLOR = 0x06;
const T_UINT64 = 0x07;
const T_END = 0x08;
const T_INT64 = 0x0a;
const T_END_ALT = 0x0b;

export function parseBinaryVdf(buf: Uint8Array): VdfObject {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const dec = new TextDecoder("utf-8");
  let i = 0;

  const cstr = (): string => {
    const start = i;
    while (i < buf.length && buf[i] !== 0) i++;
    if (i >= buf.length) throw new VdfError("unterminated string");
    const s = dec.decode(buf.subarray(start, i));
    i++;
    return s;
  };
  const need = (bytes: number) => {
    if (i + bytes > buf.length) throw new VdfError("truncated value");
  };

  const parseMap = (depth: number): VdfObject => {
    if (depth > 32) throw new VdfError("nesting too deep");
    const obj: VdfObject = {};
    for (;;) {
      if (i >= buf.length) {
        if (depth === 0) return obj;
        throw new VdfError("unexpected end of data");
      }
      const type = buf[i++] as number;
      if (type === T_END || type === T_END_ALT) {
        return obj;
      }
      const key = cstr();
      switch (type) {
        case T_MAP:
          obj[key] = parseMap(depth + 1);
          break;
        case T_STRING:
          obj[key] = cstr();
          break;
        case T_WSTRING: {
          // UTF-16LE, terminated by two zero bytes.
          const start = i;
          while (i + 1 < buf.length && !(buf[i] === 0 && buf[i + 1] === 0)) i += 2;
          obj[key] = new TextDecoder("utf-16le").decode(buf.subarray(start, i));
          i += 2;
          break;
        }
        case T_INT32:
        case T_POINTER:
        case T_COLOR:
          need(4);
          obj[key] = view.getInt32(i, true);
          i += 4;
          break;
        case T_FLOAT32:
          need(4);
          obj[key] = view.getFloat32(i, true);
          i += 4;
          break;
        case T_UINT64:
          need(8);
          obj[key] = view.getBigUint64(i, true).toString();
          i += 8;
          break;
        case T_INT64:
          need(8);
          obj[key] = view.getBigInt64(i, true).toString();
          i += 8;
          break;
        default:
          throw new VdfError(`unknown type byte 0x${type.toString(16)} at ${i - key.length - 2}`);
      }
    }
  };
  const root = parseMap(0);
  return root;
}

/** Encode a tree as binary VDF. Used only to generate fixtures and in tests; never against Steam's files. */
export function encodeBinaryVdf(obj: VdfObject): Uint8Array {
  const enc = new TextEncoder();
  const parts: number[] = [];
  const pushStr = (s: string) => {
    parts.push(...enc.encode(s), 0);
  };
  const writeMap = (o: VdfObject) => {
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === "string") {
        parts.push(T_STRING);
        pushStr(k);
        pushStr(v);
      } else if (typeof v === "number") {
        parts.push(T_INT32);
        pushStr(k);
        const b = new Uint8Array(4);
        new DataView(b.buffer).setInt32(0, v, true);
        parts.push(...b);
      } else {
        parts.push(T_MAP);
        pushStr(k);
        writeMap(v);
        parts.push(T_END);
      }
    }
  };
  writeMap(obj);
  parts.push(T_END);
  return Uint8Array.from(parts);
}
