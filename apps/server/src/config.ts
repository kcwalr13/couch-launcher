/**
 * Config file: config.toml under the platform config directory.
 * Created with defaults on first run. Secrets (jellyfin.api_key) live only here:
 * use `redactConfig` before logging and never send the config to the UI.
 */
import type { SessionLength } from "@couch/core";
import { DEFAULT_GENRE_SESSION_MAP, DEFAULT_WEIGHTS, type PickerWeights } from "@couch/core";

export type HandoffMode = "client" | "web";

export interface Config {
  server: { port: number; host: string };
  steam: { root: string; user_id: string };
  jellyfin: { url: string; api_key: string; user_id: string };
  playback: {
    handoff: HandoffMode;
    /** Name (case-insensitive substring) of the Jellyfin Desktop non-Steam shortcut to start it through. */
    client_shortcut: string;
    /** Direct command to start the client when no shortcut matches. Blank = platform default. */
    client_command: string;
    /** Seconds to wait for the client's session to appear before falling back. */
    session_wait_sec: number;
  };
  ui: { scale: number };
  kiosk: {
    /** Linux input-loss mitigation: restart the kiosk browser when a launched game exits. */
    restart_after_game: boolean;
    /** Command used for that restart. Blank = platform default. */
    restart_command: string;
  };
  picker: {
    weights: PickerWeights;
    genre_session_map: Record<string, SessionLength>;
    default_session_length: SessionLength;
  };
}

export const DEFAULT_PORT = 7744;

export function defaultConfig(): Config {
  return {
    server: { port: DEFAULT_PORT, host: "127.0.0.1" },
    steam: { root: "", user_id: "" },
    jellyfin: { url: "", api_key: "", user_id: "" },
    playback: { handoff: "client", client_shortcut: "Jellyfin", client_command: "", session_wait_sec: 30 },
    ui: { scale: 1 },
    kiosk: { restart_after_game: false, restart_command: "" },
    picker: {
      weights: { ...DEFAULT_WEIGHTS },
      genre_session_map: { ...DEFAULT_GENRE_SESSION_MAP },
      default_session_length: "medium",
    },
  };
}

function tomlString(s: string): string {
  return JSON.stringify(s);
}

/** The commented config file written on first run. */
export function defaultConfigToml(): string {
  const c = defaultConfig();
  const weights = Object.entries(c.picker.weights)
    .map(([k, v]) => `${k} = ${v}`)
    .join("\n");
  const genres = Object.entries(c.picker.genre_session_map)
    .map(([k, v]) => `${tomlString(k)} = ${tomlString(v)}`)
    .join("\n");
  return `# Couch Launcher configuration.
# Secrets live only in this file. They are never copied to the database, logs or the UI.

[server]
# The service only listens on the loopback interface.
port = ${c.server.port}
host = "127.0.0.1"

[steam]
# Leave blank to auto-detect.
root = ""
# 32-bit Steam account id (the folder name under userdata). Blank = most recent login.
user_id = ""

[jellyfin]
# For example "http://192.168.1.20:8096". Blank disables Jellyfin.
url = ""
# Create one in Jellyfin: Dashboard > API Keys.
api_key = ""
# Jellyfin user whose library and progress to show. Blank = first user on the server.
user_id = ""

[playback]
# "client": start Jellyfin Desktop and send it a play command.
# "web": open the item in Jellyfin's web client inside the kiosk browser.
handoff = "client"
# Name (or part of it) of the Jellyfin Desktop non-Steam shortcut used to start it.
client_shortcut = "Jellyfin"
# Command to start the client if no such shortcut exists. Blank = platform default.
client_command = ""
session_wait_sec = 30

[ui]
# Multiplies the whole interface. 1.0 fills a 1080p or 4K TV at the designed size.
scale = 1.0

[kiosk]
# Linux only: restart the kiosk browser after a launched game exits, in case the
# controller stopped working in it (see docs/ON_DEVICE.md).
restart_after_game = false
restart_command = ""

[picker]
default_session_length = "medium"

[picker.weights]
${weights}

# Steam store genre -> typical session length ("short", "medium" or "long").
# When a game has several mapped genres the longest wins.
[picker.genre_session_map]
${genres}
`;
}

export interface ConfigResult {
  config: Config;
  warnings: string[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Merge a parsed TOML object over the defaults, validating types. Unknown keys are warned about. */
export function parseConfig(raw: unknown): ConfigResult {
  const config = defaultConfig();
  const warnings: string[] = [];
  if (!isObj(raw)) return { config, warnings: ["config is not a table; using defaults"] };

  const section = (name: string): Obj => {
    const s = raw[name];
    if (s === undefined) return {};
    if (!isObj(s)) {
      warnings.push(`[${name}] is not a table; ignored`);
      return {};
    }
    return s;
  };
  const str = (obj: Obj, sect: string, key: string, set: (v: string) => void) => {
    const v = obj[key];
    if (v === undefined) return;
    if (typeof v === "string") set(v.trim());
    else warnings.push(`${sect}.${key} must be a string`);
  };
  const num = (obj: Obj, sect: string, key: string, min: number, max: number, set: (v: number) => void) => {
    const v = obj[key];
    if (v === undefined) return;
    if (typeof v === "number" && Number.isFinite(v) && v >= min && v <= max) set(v);
    else warnings.push(`${sect}.${key} must be a number between ${min} and ${max}`);
  };
  const bool = (obj: Obj, sect: string, key: string, set: (v: boolean) => void) => {
    const v = obj[key];
    if (v === undefined) return;
    if (typeof v === "boolean") set(v);
    else warnings.push(`${sect}.${key} must be true or false`);
  };

  const server = section("server");
  num(server, "server", "port", 1, 65535, (v) => {
    config.server.port = Math.trunc(v);
  });
  str(server, "server", "host", (v) => {
    if (v === "127.0.0.1" || v === "localhost" || v === "::1") config.server.host = v;
    else warnings.push("server.host must be a loopback address; using 127.0.0.1");
  });

  const steam = section("steam");
  str(steam, "steam", "root", (v) => {
    config.steam.root = v;
  });
  str(steam, "steam", "user_id", (v) => {
    config.steam.user_id = v;
  });

  const jf = section("jellyfin");
  str(jf, "jellyfin", "url", (v) => {
    config.jellyfin.url = v.replace(/\/+$/, "");
  });
  str(jf, "jellyfin", "api_key", (v) => {
    config.jellyfin.api_key = v;
  });
  str(jf, "jellyfin", "user_id", (v) => {
    config.jellyfin.user_id = v;
  });

  const pb = section("playback");
  str(pb, "playback", "handoff", (v) => {
    if (v === "client" || v === "web") config.playback.handoff = v;
    else warnings.push('playback.handoff must be "client" or "web"');
  });
  str(pb, "playback", "client_shortcut", (v) => {
    config.playback.client_shortcut = v;
  });
  str(pb, "playback", "client_command", (v) => {
    config.playback.client_command = v;
  });
  num(pb, "playback", "session_wait_sec", 1, 300, (v) => {
    config.playback.session_wait_sec = v;
  });

  const ui = section("ui");
  num(ui, "ui", "scale", 0.5, 2, (v) => {
    config.ui.scale = v;
  });

  const kiosk = section("kiosk");
  bool(kiosk, "kiosk", "restart_after_game", (v) => {
    config.kiosk.restart_after_game = v;
  });
  str(kiosk, "kiosk", "restart_command", (v) => {
    config.kiosk.restart_command = v;
  });

  const picker = section("picker");
  str(picker, "picker", "default_session_length", (v) => {
    if (isSessionLength(v)) config.picker.default_session_length = v;
    else warnings.push('picker.default_session_length must be "short", "medium" or "long"');
  });
  const w = picker.weights;
  if (w !== undefined) {
    if (!isObj(w)) warnings.push("[picker.weights] is not a table");
    else
      for (const [k, v] of Object.entries(w)) {
        if (!(k in config.picker.weights)) warnings.push(`picker.weights.${k} is not a known weight`);
        else if (typeof v !== "number" || !Number.isFinite(v))
          warnings.push(`picker.weights.${k} must be a number`);
        else config.picker.weights[k as keyof PickerWeights] = v;
      }
  }
  const g = picker.genre_session_map;
  if (g !== undefined) {
    if (!isObj(g)) warnings.push("[picker.genre_session_map] is not a table");
    else {
      const map: Record<string, SessionLength> = {};
      for (const [k, v] of Object.entries(g)) {
        if (typeof v === "string" && isSessionLength(v)) map[k] = v;
        else warnings.push(`picker.genre_session_map."${k}" must be "short", "medium" or "long"`);
      }
      config.picker.genre_session_map = map;
    }
  }

  const known = new Set(["server", "steam", "jellyfin", "playback", "ui", "kiosk", "picker"]);
  for (const k of Object.keys(raw)) if (!known.has(k)) warnings.push(`unknown section [${k}]`);
  return { config, warnings };
}

function isSessionLength(v: string): v is SessionLength {
  return v === "short" || v === "medium" || v === "long";
}

/** A copy that is safe to log or show: secrets replaced. */
export function redactConfig(c: Config): Config {
  return {
    ...c,
    jellyfin: { ...c.jellyfin, api_key: c.jellyfin.api_key ? "<redacted>" : "" },
  };
}

export interface ConfigFs {
  exists(p: string): boolean;
  readText(p: string): string;
  writeText(p: string, data: string): void;
  mkdirp(p: string): void;
}

/** Load the config file, creating it with defaults when missing. */
export function loadConfigFile(
  path: string,
  dir: string,
  fs: ConfigFs,
): ConfigResult & { created: boolean; path: string } {
  let created = false;
  if (!fs.exists(path)) {
    fs.mkdirp(dir);
    fs.writeText(path, defaultConfigToml());
    created = true;
  }
  let raw: unknown;
  try {
    raw = Bun.TOML.parse(fs.readText(path));
  } catch (e) {
    const { config } = parseConfig({});
    return {
      config,
      warnings: [`could not parse ${path}: ${(e as Error).message}; using defaults`],
      created,
      path,
    };
  }
  return { ...parseConfig(raw), created, path };
}
