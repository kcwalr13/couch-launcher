import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { DEFAULT_GENRE_SESSION_MAP } from "@couch/core";
import { resolveShortcutArt, resolveSteamArt } from "../src/adapters/steam/art.ts";
import {
  isUtilityShortcut,
  sessionFromGenres,
  shortcutItem,
  steamGameItem,
  tagsFromStore,
} from "../src/adapters/steam/items.ts";
import { scanSteam } from "../src/adapters/steam/steam.ts";
import { parseAppDetails } from "../src/adapters/steam/store-metadata.ts";
import { steamFixtureFs } from "../src/mock/fixtures.ts";
import { createPlatform } from "../src/platform/index.ts";
import type { PlatformId } from "../src/platform/types.ts";
import { FIXTURES, recordingProc } from "./helpers.ts";

function setup(id: PlatformId) {
  const fs = steamFixtureFs(id);
  const platform = createPlatform(id, {
    env: {},
    home: id === "windows" ? "C:\\Users\\deck" : "/home/deck",
    fs,
    proc: recordingProc(),
  });
  return { fs, platform };
}

const EXPECTED_GAMES = [
  ["620", "Portal 2", 0, null],
  ["105600", "Terraria", 1500, "2026-08-19T16:00:00.000Z"],
  ["294100", "RimWorld", 2900, "2026-08-24T16:00:00.000Z"],
  ["367520", "Hollow Knight", 300, "2026-06-05T16:00:00.000Z"],
  ["413150", "Stardew Valley", 6010, "2026-09-13T16:00:00.000Z"],
  ["504230", "Celeste", 820, "2026-07-25T16:00:00.000Z"],
  ["1091500", "Cyberpunk 2077", 3300, "2026-09-28T16:00:00.000Z"],
  ["1145360", "Hades", 2140, "2026-10-01T16:00:00.000Z"],
  ["1426210", "It Takes Two", 540, "2026-09-24T16:00:00.000Z"],
  ["1794680", "Vampire Survivors", 860, "2026-09-30T16:00:00.000Z"],
  ["1966720", "Lethal Company", 95, "2026-03-17T16:00:00.000Z"],
  ["2379780", "Balatro", 410, "2026-10-02T16:00:00.000Z"],
] as const;

const EXPECTED_SHORTCUTS = [
  // Game ids computed independently: ((appid & 0xffffffff) << 32) | 0x02000000 (python).
  ["2560399406", "Diablo IV", "10996831713501380608", "2026-09-29T17:00:00.000Z"],
  ["3006477107", "StarCraft II", "12912720850771247104", null],
  ["3294967295", "Jellyfin Desktop", "14151776773448138752", "2026-10-02T17:00:00.000Z"],
  ["3294967294", "Couch Launcher", "14151776769153171456", "2026-10-03T17:00:00.000Z"],
] as const;

for (const id of ["linux", "windows"] as const) {
  describe(`Steam fixtures under the ${id} platform`, () => {
    test("produce the exact expected item list", async () => {
      const { fs, platform } = setup(id);
      const scan = await scanSteam({ platform, fs, configuredRoot: "", configuredUser: "" });
      expect(scan.root).toBe(
        id === "windows" ? "C:\\Program Files (x86)\\Steam" : "/home/deck/.local/share/Steam",
      );
      expect(scan.userId).toBe("12345678");
      expect(scan.libraries.map((l) => l.ok)).toEqual([true, true]);
      expect(scan.libraries.map((l) => l.appCount)).toEqual([10, 5]);
      const items = scan.games.map((g) => steamGameItem(g, null, DEFAULT_GENRE_SESSION_MAP, "medium"));
      expect(
        items.map((i) => [
          i.launch.type === "steam" ? i.launch.appId : "",
          i.title,
          i.playtimeMin,
          i.lastActivityAt,
        ]),
      ).toEqual(EXPECTED_GAMES.map((g) => [...g]));
      expect(items.every((i) => i.key === `steam:${(i.launch as { appId: string }).appId}`)).toBe(true);
      const sc = scan.shortcuts.map((s) => shortcutItem(s, "medium"));
      expect(
        sc.map((i) => [
          i.key.slice("shortcut:".length),
          i.title,
          (i.launch as { gameId: string }).gameId,
          i.lastActivityAt,
        ]),
      ).toEqual(EXPECTED_SHORTCUTS.map((s) => [...s]));
      expect(scan.warnings).toEqual([]);
    });

    test("utility shortcuts are recognised", async () => {
      const { fs, platform } = setup(id);
      const scan = await scanSteam({ platform, fs, configuredRoot: "", configuredUser: "" });
      expect(
        scan.shortcuts.filter((s) => !isUtilityShortcut(s, "Jellyfin", 7744)).map((s) => s.name),
      ).toEqual(["Diablo IV", "StarCraft II"]);
    });

    test("artwork resolves through every layout and missing art falls back to null", async () => {
      const { fs, platform } = setup(id);
      const scan = await scanSteam({ platform, fs, configuredRoot: "", configuredUser: "" });
      const root = scan.root as string;
      const art = (app: string, k: "poster" | "hero") => {
        const p = resolveSteamArt(fs, platform, root, scan.userId, app, k);
        return p ? platform.path.relative(root, p) : null;
      };
      const sep = platform.path.sep;
      const j = (...p: string[]) => p.join(sep);
      expect(art("1145360", "poster")).toBe(j("appcache", "librarycache", "1145360", "library_600x900.jpg"));
      expect(art("1426210", "poster")).toBe(j("appcache", "librarycache", "1426210_library_600x900.jpg"));
      expect(art("367520", "poster")).toBe(
        j(
          "appcache",
          "librarycache",
          "367520",
          "0123456789abcdef0123456789abcdef01234567",
          "library_600x900.jpg",
        ),
      );
      expect(art("294100", "poster")).toBe(j("appcache", "librarycache", "294100", "header.jpg"));
      expect(art("294100", "hero")).toBe(j("appcache", "librarycache", "294100", "header.jpg"));
      expect(art("1966720", "poster")).toBeNull();
      expect(art("1966720", "hero")).toBeNull();
      expect(resolveShortcutArt(fs, platform, root, scan.userId, 2560399406, "poster")).toEndWith(
        "2560399406p.png",
      );
      expect(resolveShortcutArt(fs, platform, root, scan.userId, 3006477107, "poster")).toBeNull();
    });
  });
}

describe("user selection", () => {
  test("a configured user wins and reads that user's playtime", async () => {
    const { fs, platform } = setup("linux");
    const scan = await scanSteam({ platform, fs, configuredRoot: "", configuredUser: "87654321" });
    expect(scan.userId).toBe("87654321");
    expect(scan.games.find((g) => g.appId === "620")?.playtimeMin).toBe(9999);
    expect(scan.shortcuts).toEqual([]);
  });
  test("an unknown configured user warns and falls back", async () => {
    const { fs, platform } = setup("linux");
    const scan = await scanSteam({ platform, fs, configuredRoot: "", configuredUser: "1" });
    expect(scan.userId).toBe("12345678");
    expect(scan.warnings[0]).toContain("steam.user_id");
  });
});

test("no Steam install is reported, not thrown", async () => {
  const platform = createPlatform("linux", {
    env: {},
    home: "/nowhere",
    fs: steamFixtureFs("linux"),
    proc: recordingProc(),
  });
  const scan = await scanSteam({
    platform,
    fs: steamFixtureFs("linux"),
    configuredRoot: "",
    configuredUser: "",
  });
  expect(scan.root).toBeNull();
  expect(scan.warnings).toContain("Steam not found");
});

describe("store metadata mapping", () => {
  const info = (id: string) =>
    parseAppDetails(
      id,
      JSON.parse(readFileSync(path.join(FIXTURES, "steam", "store", `${id}.json`), "utf8")),
    );
  test("parses genres and categories", () => {
    const s = info("413150");
    expect(s.genres).toEqual(["Indie", "RPG", "Simulation"]);
    expect(s.categories).toContain(39);
    const tags = tagsFromStore(s, DEFAULT_GENRE_SESSION_MAP, "medium");
    expect(tags).toEqual({
      genres: ["Indie", "RPG", "Simulation"],
      couchCoop: true,
      controller: "full",
      sessionLength: "long",
    });
  });
  test("partial controller and no couch co-op", () => {
    expect(tagsFromStore(info("105600"), {}, "medium").controller).toBe("partial");
    expect(tagsFromStore(info("294100"), {}, "medium")).toMatchObject({
      controller: "none",
      couchCoop: false,
    });
  });
  test("unknown metadata stays unknown", () => {
    expect(tagsFromStore(null, {}, "short")).toEqual({
      genres: [],
      couchCoop: null,
      controller: null,
      sessionLength: "short",
    });
    expect(parseAppDetails("1", { "1": { success: false } }).available).toBe(false);
    expect(parseAppDetails("1", "garbage").available).toBe(false);
  });
  test("genre session mapping takes the longest mapped genre, case-insensitively", () => {
    expect(sessionFromGenres(["casual", "Strategy"], DEFAULT_GENRE_SESSION_MAP, "medium")).toBe("long");
    expect(sessionFromGenres(["Puzzle"], DEFAULT_GENRE_SESSION_MAP, "medium")).toBe("short");
    expect(sessionFromGenres(["Unknown"], DEFAULT_GENRE_SESSION_MAP, "medium")).toBe("medium");
  });
  test("HTML entities and tags are stripped from descriptions", () => {
    const s = parseAppDetails("1", {
      "1": { success: true, data: { short_description: "Tom &amp; Jerry&#39;s <b>game</b>" } },
    });
    expect(s.description).toBe("Tom & Jerry's game");
  });
});

describe("Steam access is read-only", () => {
  function snapshot(dir: string): Map<string, string> {
    const out = new Map<string, string>();
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = path.join(d, n);
        const s = statSync(p);
        if (s.isDirectory()) walk(p);
        else out.set(p, `${s.mtimeMs}:${s.size}:${createHash("sha1").update(readFileSync(p)).digest("hex")}`);
      }
    };
    walk(dir);
    return out;
  }

  test("the adapter only calls read methods, and the Steam tree is unchanged after a full scan", async () => {
    const before = snapshot(path.join(FIXTURES, "steam"));
    const { fs, platform } = setup("linux");
    const calls: string[] = [];
    const spy = new Proxy(fs, {
      get(t, prop, r) {
        const v = Reflect.get(t, prop, r);
        if (typeof v === "function") calls.push(String(prop));
        return v;
      },
    });
    const scan = await scanSteam({ platform, fs: spy, configuredRoot: "", configuredUser: "" });
    for (const g of scan.games)
      for (const k of ["poster", "hero"] as const)
        resolveSteamArt(spy, platform, scan.root as string, scan.userId, g.appId, k);
    expect(new Set(calls)).toEqual(new Set(["exists", "stat", "readFile", "readText", "readdir"]));
    expect(snapshot(path.join(FIXTURES, "steam"))).toEqual(before);
  });

  test("syscall trace: no file under the Steam root is opened for writing", () => {
    if (!Bun.which("strace")) {
      console.warn("strace not installed; syscall-level write test skipped");
      return;
    }
    const log = path.join(require("node:os").tmpdir(), `couch-strace-${process.pid}.log`);
    const r = Bun.spawnSync(
      [
        "strace",
        "-f",
        "-qq",
        "-e",
        "trace=open,openat,openat2,creat,truncate,unlink,unlinkat,rename,renameat,renameat2,mkdir,mkdirat",
        "-o",
        log,
        "bun",
        path.join(import.meta.dir, "support", "scan-fixture.ts"),
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(r.stdout.toString())).toMatchObject({ games: 12, shortcuts: 4 });
    const steamDir = path.join(FIXTURES, "steam");
    const lines = readFileSync(log, "utf8")
      .split("\n")
      .filter((l) => l.includes(steamDir));
    expect(lines.length).toBeGreaterThan(20);
    const writes = lines.filter((l) =>
      /O_WRONLY|O_RDWR|O_CREAT|O_TRUNC|creat\(|unlink|rename|mkdir|truncate\(/.test(l),
    );
    expect(writes).toEqual([]);
  });
});
