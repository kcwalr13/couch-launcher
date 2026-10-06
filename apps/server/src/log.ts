/** Minimal logger that scrubs registered secrets from every line. */
export interface Logger {
  info(msg: string, extra?: unknown): void;
  warn(msg: string, extra?: unknown): void;
  error(msg: string, extra?: unknown): void;
  addSecret(s: string): void;
  lines?: string[];
}

export function createLogger(opts: { quiet?: boolean; capture?: boolean } = {}): Logger {
  const secrets: string[] = [];
  const lines: string[] = [];
  const scrub = (s: string) => secrets.reduce((acc, sec) => acc.split(sec).join("<redacted>"), s);
  const emit = (level: string, msg: string, extra?: unknown) => {
    let line = `${new Date().toISOString()} ${level} ${msg}`;
    if (extra !== undefined) {
      const e =
        extra instanceof Error ? extra.message : typeof extra === "string" ? extra : JSON.stringify(extra);
      line += ` ${e}`;
    }
    line = scrub(line);
    if (opts.capture) lines.push(line);
    if (!opts.quiet) (level === "ERROR" ? console.error : console.log)(line);
  };
  return {
    info: (m, x) => emit("INFO", m, x),
    warn: (m, x) => emit("WARN", m, x),
    error: (m, x) => emit("ERROR", m, x),
    addSecret: (s) => {
      if (s && s.length >= 4) secrets.push(s);
    },
    lines: opts.capture ? lines : undefined,
  };
}
