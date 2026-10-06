import type { Command } from "./types.ts";

/**
 * Split a command line into a command and arguments. Supports double and single
 * quotes; backslashes are literal (so Windows paths survive). No shell expansion.
 */
export function splitCommandLine(line: string): Command | null {
  const out: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  let has = false;
  for (const ch of line.trim()) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (ch === " " || ch === "\t") {
      if (has || cur) out.push(cur);
      cur = "";
      has = false;
    } else {
      cur += ch;
    }
  }
  if (has || cur) out.push(cur);
  if (quote || out.length === 0) return null;
  const [cmd, ...args] = out as [string, ...string[]];
  return { cmd, args };
}
