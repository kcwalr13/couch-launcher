import { describe, expect, test } from "bun:test";
import { DEFAULT_WEIGHTS } from "@couch/core";
import {
  type ConfigFs,
  DEFAULT_PORT,
  defaultConfigToml,
  loadConfigFile,
  parseConfig,
  redactConfig,
} from "../src/config.ts";

function memConfigFs(initial: Record<string, string> = {}): ConfigFs & { files: Record<string, string> } {
  const files = { ...initial };
  return {
    files,
    exists: (p) => p in files,
    readText: (p) => {
      const f = files[p];
      if (f === undefined) throw new Error("ENOENT");
      return f;
    },
    writeText: (p, d) => {
      files[p] = d;
    },
    mkdirp: () => {},
  };
}

describe("config", () => {
  test("the default file round-trips to the defaults with no warnings", () => {
    const r = parseConfig(Bun.TOML.parse(defaultConfigToml()));
    expect(r.warnings).toEqual([]);
    expect(r.config.server.port).toBe(DEFAULT_PORT);
    expect(r.config.picker.weights).toEqual(DEFAULT_WEIGHTS);
    expect(r.config.playback.handoff).toBe("client");
  });

  test("creates the file on first run", () => {
    const fs = memConfigFs();
    const r = loadConfigFile("/c/config.toml", "/c", fs);
    expect(r.created).toBe(true);
    expect(fs.files["/c/config.toml"]).toContain("[jellyfin]");
    const again = loadConfigFile("/c/config.toml", "/c", fs);
    expect(again.created).toBe(false);
  });

  test("overrides merge over defaults and bad values warn", () => {
    const r = parseConfig({
      server: { port: 9000, host: "0.0.0.0" },
      jellyfin: { url: "http://nas:8096/", api_key: "secret-key" },
      playback: { handoff: "tv" },
      ui: { scale: 1.25 },
      picker: { weights: { favourite: 50, nope: 1 }, genre_session_map: { Action: "short", Bad: "forever" } },
      extra: {},
    });
    expect(r.config.server.port).toBe(9000);
    expect(r.config.server.host).toBe("127.0.0.1");
    expect(r.config.jellyfin.url).toBe("http://nas:8096");
    expect(r.config.playback.handoff).toBe("client");
    expect(r.config.ui.scale).toBe(1.25);
    expect(r.config.picker.weights.favourite).toBe(50);
    expect(r.config.picker.genre_session_map).toEqual({ Action: "short" });
    expect(r.warnings.join("\n")).toContain("loopback");
    expect(r.warnings.join("\n")).toContain("playback.handoff");
    expect(r.warnings.join("\n")).toContain("picker.weights.nope");
    expect(r.warnings.join("\n")).toContain('"Bad"');
    expect(r.warnings.join("\n")).toContain("[extra]");
  });

  test("an unparseable file falls back to defaults with a warning", () => {
    const fs = memConfigFs({ "/c/config.toml": "this is = = not toml" });
    const r = loadConfigFile("/c/config.toml", "/c", fs);
    expect(r.config.server.port).toBe(DEFAULT_PORT);
    expect(r.warnings[0]).toContain("could not parse");
  });

  test("redaction hides the API key", () => {
    const { config } = parseConfig({ jellyfin: { api_key: "abc123" } });
    expect(JSON.stringify(redactConfig(config))).not.toContain("abc123");
  });
});
