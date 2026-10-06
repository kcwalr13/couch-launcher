import { afterEach, describe, expect, test } from "bun:test";
import type { HomeResponse, ItemResponse, LaunchResponse, UiState } from "@couch/core";
import { Launcher, pickClientSession } from "../src/services/launcher.ts";
import { makeTestApp, type TestApp } from "./helpers.ts";

let t: TestApp;
afterEach(() => t.cleanup());

const launch = async (key: string, q = "") => {
  const r = await t.send("POST", `/api/launch/${key}${q}`);
  return { status: r.status, body: (await r.json()) as LaunchResponse };
};

describe("game launch commands (asserted through the injected spawner, never run)", () => {
  test("Linux: Steam game", async () => {
    t = makeTestApp({ platformId: "linux" });
    const r = await launch("steam:620");
    expect(r.body).toEqual({ ok: true, message: "Steam is starting Portal 2." });
    expect(t.proc.spawned).toEqual([{ cmd: "steam", args: ["steam://rungameid/620"] }]);
  });

  test("Linux: non-Steam shortcut uses the 64-bit game id", async () => {
    t = makeTestApp({ platformId: "linux" });
    await launch("shortcut:2560399406");
    expect(t.proc.spawned).toEqual([{ cmd: "steam", args: ["steam://rungameid/10996831713501380608"] }]);
  });

  test("Windows: Steam game through steam.exe", async () => {
    t = makeTestApp({ platformId: "windows" });
    await launch("steam:1145360");
    expect(t.proc.spawned).toEqual([
      { cmd: "C:\\Program Files (x86)\\Steam\\steam.exe", args: ["steam://rungameid/1145360"] },
    ]);
  });

  test("Windows: non-Steam shortcut", async () => {
    t = makeTestApp({ platformId: "windows" });
    await launch("shortcut:2560399406");
    expect(t.proc.spawned).toEqual([
      { cmd: "C:\\Program Files (x86)\\Steam\\steam.exe", args: ["steam://rungameid/10996831713501380608"] },
    ]);
  });

  test("a spawn failure becomes an error message", async () => {
    t = makeTestApp();
    t.proc.spawnDetached = () => {
      throw new Error("ENOENT: steam");
    };
    const r = await launch("steam:620");
    expect(r.status).toBe(502);
    expect(r.body).toEqual({ ok: false, message: "Couldn't ask Steam to start Portal 2: ENOENT: steam" });
  });

  test("unknown and malformed keys", async () => {
    t = makeTestApp();
    expect((await launch("steam:999")).status).toBe(404);
    expect((await launch("bad")).status).toBe(400);
    expect(t.proc.spawned).toEqual([]);
  });
});

async function mediaKey(title: string) {
  const h = (await (await t.get("/api/home")).json()) as HomeResponse;
  const item = h.continueRow.find((i) => i.title === title);
  if (!item) throw new Error(`no ${title}`);
  return item;
}

describe("playback handoff", () => {
  test("client: starts Jellyfin Desktop via its shortcut, waits for its session, sends PlayNow at the resume point", async () => {
    t = makeTestApp({ platformId: "linux" });
    const arrival = await mediaKey("Arrival");
    t.jf.sessionsDelay = 3; // the pre-check plus two polls see no session yet
    const r = await launch(arrival.key);
    expect(r.body).toEqual({ ok: true, message: "Playing Arrival in Jellyfin Desktop." });
    expect(t.proc.spawned).toEqual([{ cmd: "steam", args: ["steam://rungameid/14151776773448138752"] }]);
    expect(t.jf.plays).toEqual([
      {
        sessionId: "session-jellyfin-desktop",
        query: {
          playCommand: "PlayNow",
          itemIds: arrival.key.slice(9),
          startPositionTicks: String(4440 * 10_000_000),
        },
      },
    ]);
  });

  test("client: Play from start sends position 0", async () => {
    t = makeTestApp();
    const arrival = await mediaKey("Arrival");
    await launch(arrival.key, "?from=start");
    expect(t.jf.plays[0]?.query.startPositionTicks).toBe("0");
  });

  test("client: no matching shortcut falls back to the platform command (Windows)", async () => {
    t = makeTestApp({
      platformId: "windows",
      configure: (c) => (c.playback.client_shortcut = "nothing-matches"),
    });
    const arrival = await mediaKey("Arrival");
    await launch(arrival.key);
    expect(t.proc.spawned).toEqual([
      { cmd: "C:\\Users\\deck\\AppData\\Local\\Programs\\Jellyfin Desktop\\Jellyfin Desktop.exe", args: [] },
    ]);
  });

  test("client: a configured client_command wins over the platform default", async () => {
    t = makeTestApp({
      configure: (c) => {
        c.playback.client_shortcut = "";
        c.playback.client_command = 'flatpak run "com.github.iwalton3.jellyfin-media-player"';
      },
    });
    await launch((await mediaKey("Arrival")).key);
    expect(t.proc.spawned).toEqual([
      { cmd: "flatpak", args: ["run", "com.github.iwalton3.jellyfin-media-player"] },
    ]);
  });

  test("client: no session within the wait is reported on screen", async () => {
    t = makeTestApp({ configure: (c) => (c.playback.session_wait_sec = 3) });
    const arrival = await mediaKey("Arrival");
    t.jf.sessionsDelay = 100;
    const r = await launch(arrival.key);
    expect(r.status).toBe(502);
    expect(r.body.message).toContain("did not accept the play command");
    expect(t.jf.plays).toEqual([]);
  });

  test("client: server unreachable", async () => {
    t = makeTestApp();
    const arrival = await mediaKey("Arrival");
    t.jf.down = true;
    const r = await launch(arrival.key);
    expect(r.body.ok).toBe(false);
    expect(r.body.message).toStartWith("Can't reach Jellyfin");
    expect(t.proc.spawned).toEqual([]);
  });

  test("web: returns the item page for the kiosk browser and starts nothing", async () => {
    t = makeTestApp({ configure: (c) => (c.playback.handoff = "web") });
    const arrival = await mediaKey("Arrival");
    const r = await launch(arrival.key);
    expect(r.body).toEqual({
      ok: true,
      message: "Opening in Jellyfin.",
      openUrl: `http://jellyfin.mock:8096/web/#/details?id=${arrival.key.slice(9)}`,
    });
    expect(t.proc.spawned).toEqual([]);
  });

  test("session picking prefers the newest controllable Jellyfin Desktop", () => {
    expect(
      pickClientSession([
        {
          Id: "web",
          Client: "Jellyfin Web",
          SupportsRemoteControl: true,
          LastActivityDate: "2026-10-03T19:00:00Z",
        },
        {
          Id: "old",
          Client: "Jellyfin Desktop",
          SupportsRemoteControl: true,
          LastActivityDate: "2026-10-01T00:00:00Z",
        },
        {
          Id: "new",
          Client: "Jellyfin Media Player",
          SupportsRemoteControl: true,
          LastActivityDate: "2026-10-03T18:00:00Z",
        },
        {
          Id: "nope",
          Client: "Jellyfin Desktop",
          SupportsRemoteControl: false,
          LastActivityDate: "2026-10-03T19:00:00Z",
        },
      ])?.Id,
    ).toBe("new");
  });
});

describe("UI state", () => {
  test("save and restore screen, focus and params", async () => {
    t = makeTestApp();
    expect(((await (await t.get("/api/ui-state")).json()) as { state: UiState | null }).state).toBeNull();
    const put = await t.send("PUT", "/api/ui-state", {
      screen: "play",
      focusedKey: "tile:steam:620",
      params: { sort: "az" },
    });
    expect(put.status).toBe(200);
    const s = ((await (await t.get("/api/ui-state")).json()) as { state: UiState }).state;
    expect(s).toMatchObject({ screen: "play", focusedKey: "tile:steam:620", params: { sort: "az" } });
  });
  test("rejects unknown screens", async () => {
    t = makeTestApp();
    expect((await t.send("PUT", "/api/ui-state", { screen: "evil" })).status).toBe(400);
    expect((await t.send("PUT", "/api/ui-state", "nope")).status).toBe(400);
  });
});

describe("Linux kiosk restart mitigation", () => {
  test("restarts the kiosk after the launched game has run and exited", async () => {
    t = makeTestApp({ configure: (c) => (c.kiosk.restart_after_game = true) });
    // /proc scanning itself is covered in platform-commands.test.ts; here the game's state is scripted.
    let running = true;
    const platform = { ...t.deps.platform, isGameRunning: () => running };
    const intervals: (() => void)[] = [];
    const realSetInterval = globalThis.setInterval;
    globalThis.setInterval = ((fn: () => void) => {
      intervals.push(fn);
      return 1 as unknown as ReturnType<typeof setInterval>;
    }) as typeof setInterval;
    try {
      const l = new Launcher({ ...t.deps, platform, jellyfin: null, library: t.app.library });
      await l.launch(((await (await t.get("/api/items/steam:620")).json()) as ItemResponse).item);
      expect(t.proc.spawned.length).toBe(1);
      intervals[0]?.(); // running
      running = false;
      intervals[0]?.(); // exited
      expect(t.proc.spawned[1]?.cmd).toBe("flatpak");
      expect(t.proc.spawned[1]?.args).toContain("--kiosk");
    } finally {
      globalThis.setInterval = realSetInterval;
    }
  });
});
