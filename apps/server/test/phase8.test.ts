import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { StatusResponse } from "@couch/core";
import { defaultConfigToml, parseConfig, setConfigValues } from "../src/config.ts";
import { doctorReport } from "../src/doctor.ts";
import { makeTestApp, REPO_ROOT, type TestApp, tempDir } from "./helpers.ts";

let t: TestApp | null = null;
afterEach(() => {
  t?.cleanup();
  t = null;
});

describe("doctor", () => {
  test("mock mode: finds the fixture Steam library and Jellyfin, read-only", async () => {
    const d = tempDir();
    const r = await doctorReport({
      COUCH_MOCK: "1",
      COUCH_DATA_DIR: path.join(d.dir, "data"),
      COUCH_PORT: "7999",
    });
    const text = r.lines.join("\n");
    expect(r.problems).toBe(0);
    expect(text).toContain("Steam      OK  /home/deck/.local/share/Steam");
    expect(text).toContain("games: 12; shortcuts: 4");
    expect(text).toContain("Jellyfin   OK  dxp2800 10.11.2");
    expect(text).toContain('client: Steam shortcut "Jellyfin Desktop"');
    expect(text).toContain("Service    not running on port 7999");
    expect(existsSync(path.join(d.dir, "data"))).toBe(false); // created nothing
    d.cleanup();
  });

  test("a machine without Steam or Jellyfin reports both problems and creates no config", async () => {
    const d = tempDir();
    const r = await doctorReport({
      HOME: d.dir,
      COUCH_CONFIG_DIR: path.join(d.dir, "cfg"),
      COUCH_DATA_DIR: path.join(d.dir, "data"),
      COUCH_PORT: "7998",
    });
    const text = r.lines.join("\n");
    expect(text).toContain("missing: defaults used");
    expect(text).toContain("Jellyfin   NOT CONFIGURED");
    expect(r.problems).toBeGreaterThanOrEqual(1);
    expect(existsSync(path.join(d.dir, "cfg", "config.toml"))).toBe(false);
    d.cleanup();
  });
});

describe("configure (installer helper)", () => {
  test("sets Jellyfin values and keeps comments", () => {
    const out = setConfigValues(defaultConfigToml(), "jellyfin", { url: "http://nas:8096", api_key: 'k"ey' });
    expect(out).toContain("# Create one in Jellyfin: Dashboard > API Keys.");
    const c = parseConfig(Bun.TOML.parse(out)).config;
    expect(c.jellyfin).toMatchObject({ url: "http://nas:8096", api_key: 'k"ey', user_id: "" });
    expect(c.server.port).toBe(7744);
  });
  test("adds a missing section or key", () => {
    const out = setConfigValues("[server]\nport = 1\n", "jellyfin", { url: "u" });
    expect(parseConfig(Bun.TOML.parse(out)).config.jellyfin.url).toBe("u");
    const out2 = setConfigValues('[jellyfin]\nurl = "a"\n\n[ui]\nscale = 1.0\n', "jellyfin", {
      api_key: "k",
    });
    const c = parseConfig(Bun.TOML.parse(out2)).config;
    expect(c.jellyfin).toMatchObject({ url: "a", api_key: "k" });
    expect(c.ui.scale).toBe(1);
  });
  test("CLI: configure writes the file, config-path and kiosk-command print", () => {
    const d = tempDir();
    const env = { ...process.env, COUCH_CONFIG_DIR: d.dir };
    const main = path.join(REPO_ROOT, "apps", "server", "src", "main.ts");
    const r = Bun.spawnSync(
      ["bun", main, "configure", "--jellyfin-url", "http://nas:8096/", "--api-key", "abc123"],
      { env },
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout.toString()).not.toContain("abc123");
    const c = parseConfig(Bun.TOML.parse(readFileSync(path.join(d.dir, "config.toml"), "utf8"))).config;
    expect(c.jellyfin).toMatchObject({ url: "http://nas:8096", api_key: "abc123" });
    expect(Bun.spawnSync(["bun", main, "config-path"], { env }).stdout.toString().trim()).toBe(
      path.join(d.dir, "config.toml"),
    );
    const k = JSON.parse(Bun.spawnSync(["bun", main, "kiosk-command"], { env }).stdout.toString()) as {
      cmd: string;
      args: string[];
    };
    expect(k.args.at(-1)).toBe("http://127.0.0.1:7744/");
    d.cleanup();
  });
});

describe("settings", () => {
  test("UI scale is clamped, stored and reported", async () => {
    t = makeTestApp();
    const r = await t.send("POST", "/api/settings", { uiScale: 3 });
    expect(await r.json()).toEqual({ uiScale: 1.5 });
    const s = (await (await t.get("/api/status")).json()) as StatusResponse;
    expect(s.uiScale).toBe(1.5);
    expect((await t.send("POST", "/api/settings", { uiScale: "big" })).status).toBe(400);
  });
  test("rescan forces a Steam rescan", async () => {
    t = makeTestApp();
    const r = await t.send("POST", "/api/rescan");
    expect(r.status).toBe(200);
    expect(((await r.json()) as { steam: { itemCount: number } }).steam.itemCount).toBe(16);
  });
});

test("warm GET /api/home answers in under 200 ms over HTTP on fixtures", async () => {
  t = makeTestApp();
  const app = t.app;
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: app.fetch });
  try {
    const url = `http://127.0.0.1:${server.port}/api/home`;
    await (await fetch(url)).json(); // cold
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      const res = await fetch(url);
      await res.json();
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const median = times[10] as number;
    const worst = times[19] as number;
    console.log(`warm /api/home: median ${median.toFixed(1)} ms, worst ${worst.toFixed(1)} ms`);
    expect(worst).toBeLessThan(200);
  } finally {
    server.stop(true);
  }
});
