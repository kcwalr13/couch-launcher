/**
 * Generates fixtures/ deterministically. Run `bun run fixtures` and commit the result.
 *
 * fixtures/steam/root        a synthetic Steam root (library 0)
 * fixtures/steam/library2    a second library folder
 * fixtures/steam/mounts.json where each tree appears on Linux and Windows (tests mount them virtually)
 * fixtures/steam/store       Steam store appdetails responses
 * fixtures/jellyfin          recorded-shape Jellyfin JSON and a few images
 *
 * Every date is relative to FIXTURE_NOW (Saturday 3 Oct 2026, 19:00 UTC).
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { encodeBinaryVdf, type VdfObject } from "../apps/server/src/adapters/steam/vdf.ts";

const NOW = Date.parse("2026-10-03T19:00:00.000Z");
const DAY = 86_400_000;
const unix = (msAgo: number) => Math.floor((NOW - msAgo) / 1000);
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString().replace(".000Z", ".0000000Z");

const repo = path.resolve(import.meta.dir, "..");
const out = path.join(repo, "fixtures");

function write(rel: string, data: string | Uint8Array) {
  const p = path.join(out, rel);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, data);
}

// ---------- tiny deterministic PNG painter ----------

function crcTable() {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
}
const CRC = crcTable();
function crc(buf: Uint8Array) {
  let c = 0xffffffff;
  for (const b of buf) c = (CRC[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array) {
  const b = new Uint8Array(12 + data.length);
  const v = new DataView(b.buffer);
  v.setUint32(0, data.length);
  b.set(new TextEncoder().encode(type), 4);
  b.set(data, 8);
  v.setUint32(8 + data.length, crc(b.subarray(4, 8 + data.length)));
  return b;
}
function hash(s: string) {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}
function hsl(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

/** An abstract, calm poster: diagonal gradient, a large disc and horizon bands. */
function png(seed: string, w: number, h: number): Uint8Array {
  const hv = hash(seed);
  const hue = hv % 360;
  const c1 = hsl(hue, 0.55, 0.32);
  const c2 = hsl((hue + 40) % 360, 0.6, 0.12);
  const disc = hsl((hue + 180) % 360, 0.5, 0.55);
  const cx = w * (0.3 + ((hv >> 8) % 40) / 100);
  const cy = h * (0.25 + ((hv >> 16) % 30) / 100);
  const r = Math.min(w, h) * 0.28;
  const raw = new Uint8Array((w * 3 + 1) * h);
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0;
    for (let x = 0; x < w; x++) {
      const t = (x / w + y / h) / 2;
      let px = [0, 1, 2].map((i) => (c1[i] as number) * (1 - t) + (c2[i] as number) * t);
      const d = Math.hypot(x - cx, y - cy);
      if (d < r) {
        const k = Math.min(1, (r - d) / 3);
        px = px.map((v, i) => v * (1 - k * 0.85) + (disc[i] as number) * k * 0.85);
      }
      if (y > h * 0.68 && Math.floor((y - h * 0.68) / (h * 0.04)) % 2 === 0) px = px.map((v) => v * 0.7);
      raw[o++] = Math.round(px[0] as number);
      raw[o++] = Math.round(px[1] as number);
      raw[o++] = Math.round(px[2] as number);
    }
  }
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, w);
  v.setUint32(4, h);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const sig = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", new Uint8Array()),
  ];
  const total = parts.reduce((a, p) => a + p.length, 0);
  const res = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    res.set(p, off);
    off += p.length;
  }
  return res;
}
const POSTER = [300, 450] as const;
const HERO = [960, 310] as const;
const WIDE = [460, 215] as const;

// ---------- text VDF writer ----------

function vdfText(obj: VdfObject, indent = 0): string {
  const pad = "\t".repeat(indent);
  let s = "";
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "object") s += `${pad}"${k}"\n${pad}{\n${vdfText(v, indent + 1)}${pad}}\n`;
    else s += `${pad}"${k}"\t\t"${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"\n`;
  }
  return s;
}

// ---------- Steam ----------

type Art = "new" | "flat" | "hashed" | "header-only" | "none";
interface Game {
  appId: number;
  name: string;
  installdir: string;
  lib: 0 | 1;
  lastPlayedDaysAgo: number | null;
  playtimeMin: number;
  art: Art;
  genres: string[];
  categories: number[];
  short: string;
  type?: string;
}

const CATEGORY_NAMES: Record<number, string> = {
  1: "Multi-player",
  2: "Single-player",
  9: "Co-op",
  18: "Partial Controller Support",
  24: "Shared/Split Screen",
  28: "Full controller support",
  36: "Online PvP",
  37: "Shared/Split Screen PvP",
  38: "Online Co-op",
  39: "Shared/Split Screen Co-op",
  44: "Remote Play Together",
};
const GENRE_IDS: Record<string, string> = {
  Action: "1",
  Strategy: "2",
  RPG: "3",
  Casual: "4",
  Racing: "9",
  Simulation: "28",
  Adventure: "25",
  Indie: "23",
  Sports: "18",
  Puzzle: "72",
};

export const GAMES: Game[] = [
  {
    appId: 1145360,
    name: "Hades",
    installdir: "Hades",
    lib: 0,
    lastPlayedDaysAgo: 2,
    playtimeMin: 2140,
    art: "new",
    genres: ["Action", "Indie", "RPG"],
    categories: [2, 28],
    short: "Defy the god of the dead as you hack and slash out of the Underworld.",
  },
  {
    appId: 413150,
    name: "Stardew Valley",
    installdir: "Stardew Valley",
    lib: 0,
    lastPlayedDaysAgo: 20,
    playtimeMin: 6010,
    art: "new",
    genres: ["Indie", "RPG", "Simulation"],
    categories: [2, 1, 38, 39, 24, 28, 44],
    short: "You've inherited your grandfather's old farm plot in Stardew Valley.",
  },
  {
    appId: 1426210,
    name: "It Takes Two",
    installdir: "ItTakesTwo",
    lib: 0,
    lastPlayedDaysAgo: 9,
    playtimeMin: 540,
    art: "flat",
    genres: ["Action", "Adventure"],
    categories: [1, 9, 38, 39, 24, 28],
    short:
      "Embark on the craziest journey of your life in It Takes Two, a genre-bending platform adventure created purely for co-op.",
  },
  {
    appId: 367520,
    name: "Hollow Knight",
    installdir: "Hollow Knight",
    lib: 0,
    lastPlayedDaysAgo: 120,
    playtimeMin: 300,
    art: "hashed",
    genres: ["Action", "Adventure", "Indie"],
    categories: [2, 28],
    short:
      "Forge your own path in Hollow Knight! An epic action adventure through a vast ruined kingdom of insects and heroes.",
  },
  {
    appId: 1794680,
    name: "Vampire Survivors",
    installdir: "Vampire Survivors",
    lib: 0,
    lastPlayedDaysAgo: 3,
    playtimeMin: 860,
    art: "new",
    genres: ["Action", "Casual", "Indie"],
    categories: [2, 1, 39, 24, 28, 44],
    short: "Mow down thousands of night creatures and survive until dawn!",
  },
  {
    appId: 1091500,
    name: "Cyberpunk 2077",
    installdir: "Cyberpunk 2077",
    lib: 0,
    lastPlayedDaysAgo: 5,
    playtimeMin: 3300,
    art: "new",
    genres: ["RPG"],
    categories: [2, 28],
    short: "Cyberpunk 2077 is an open-world, action-adventure RPG set in the dark future of Night City.",
  },
  {
    appId: 2379780,
    name: "Balatro",
    installdir: "Balatro",
    lib: 0,
    lastPlayedDaysAgo: 1,
    playtimeMin: 410,
    art: "new",
    genres: ["Casual", "Strategy"],
    categories: [2, 28],
    short: "The poker roguelike.",
  },
  {
    appId: 504230,
    name: "Celeste",
    installdir: "Celeste",
    lib: 1,
    lastPlayedDaysAgo: 70,
    playtimeMin: 820,
    art: "new",
    genres: ["Action", "Indie"],
    categories: [2, 28],
    short: "Help Madeline survive her inner demons on her journey to the top of Celeste Mountain.",
  },
  {
    appId: 105600,
    name: "Terraria",
    installdir: "Terraria",
    lib: 1,
    lastPlayedDaysAgo: 45,
    playtimeMin: 1500,
    art: "flat",
    genres: ["Action", "Adventure", "Indie", "RPG"],
    categories: [2, 1, 36, 38, 39, 24, 18],
    short: "Dig, fight, explore, build! Nothing is impossible in this action-packed adventure game.",
  },
  {
    appId: 620,
    name: "Portal 2",
    installdir: "Portal 2",
    lib: 1,
    lastPlayedDaysAgo: null,
    playtimeMin: 0,
    art: "new",
    genres: ["Action", "Adventure"],
    categories: [2, 1, 9, 38, 39, 24, 28],
    short:
      "The Perpetual Testing Initiative has been expanded to allow you to design co-op puzzles for you and your friends!",
  },
  {
    appId: 294100,
    name: "RimWorld",
    installdir: "RimWorld",
    lib: 1,
    lastPlayedDaysAgo: 40,
    playtimeMin: 2900,
    art: "header-only",
    genres: ["Indie", "Simulation", "Strategy"],
    categories: [2],
    short: "A sci-fi colony sim driven by an intelligent AI storyteller.",
  },
  {
    appId: 1966720,
    name: "Lethal Company",
    installdir: "Lethal Company",
    lib: 1,
    lastPlayedDaysAgo: 200,
    playtimeMin: 95,
    art: "none",
    genres: ["Action", "Adventure", "Indie"],
    categories: [1, 9, 38],
    short: "A co-op horror about scavenging at abandoned moons to sell scrap to the Company.",
  },
  // Not games: filtered out of the library.
  {
    appId: 228980,
    name: "Steamworks Common Redistributables",
    installdir: "Steamworks Shared",
    lib: 0,
    lastPlayedDaysAgo: null,
    playtimeMin: 0,
    art: "none",
    genres: [],
    categories: [],
    short: "",
    type: "tool",
  },
  {
    appId: 1628350,
    name: "Steam Linux Runtime 3.0 (sniper)",
    installdir: "SteamLinuxRuntime_sniper",
    lib: 0,
    lastPlayedDaysAgo: null,
    playtimeMin: 0,
    art: "none",
    genres: [],
    categories: [],
    short: "",
    type: "tool",
  },
  {
    appId: 2805730,
    name: "Proton 9.0",
    installdir: "Proton 9.0",
    lib: 0,
    lastPlayedDaysAgo: null,
    playtimeMin: 0,
    art: "none",
    genres: [],
    categories: [],
    short: "",
    type: "tool",
  },
];

const ACCOUNT = 12345678;
const OTHER_ACCOUNT = 87654321;
const STEAMID64 = (76561197960265728n + BigInt(ACCOUNT)).toString();
const OTHER_STEAMID64 = (76561197960265728n + BigInt(OTHER_ACCOUNT)).toString();

export const MOUNTS = {
  linux: { "/home/deck/.local/share/Steam": "root", "/run/media/deck/SD/SteamLibrary": "library2" },
  windows: { "C:\\Program Files (x86)\\Steam": "root", "D:\\SteamLibrary": "library2" },
  /** On Windows the root's libraryfolders.vdf is replaced by this file (it holds Windows paths). */
  windowsFiles: {
    "C:\\Program Files (x86)\\Steam\\steamapps\\libraryfolders.vdf": "libraryfolders.windows.vdf",
  },
};

export const SHORTCUTS: {
  appid: number;
  AppName: string;
  Exe: string;
  LaunchOptions: string;
  lastPlayedDaysAgo: number | null;
  art: boolean;
  tags: Record<string, string>;
}[] = [
  {
    appid: -1734567890,
    AppName: "Diablo IV",
    Exe: '"C:\\Program Files (x86)\\Battle.net\\Battle.net Launcher.exe"',
    LaunchOptions: '--exec="launch Fen"',
    lastPlayedDaysAgo: 4,
    art: true,
    tags: { "0": "Battle.net" },
  },
  {
    appid: -1288490189,
    AppName: "StarCraft II",
    Exe: '"C:\\Program Files (x86)\\Battle.net\\Battle.net Launcher.exe"',
    LaunchOptions: '--exec="launch S2"',
    lastPlayedDaysAgo: null,
    art: false,
    tags: {},
  },
  {
    appid: -1000000001,
    AppName: "Jellyfin Desktop",
    Exe: "flatpak",
    LaunchOptions: "run org.jellyfin.JellyfinDesktop",
    lastPlayedDaysAgo: 1,
    art: false,
    tags: {},
  },
  {
    appid: -1000000002,
    AppName: "Couch Launcher",
    Exe: "flatpak",
    LaunchOptions: "run org.chromium.Chromium --kiosk http://127.0.0.1:7744/",
    lastPlayedDaysAgo: 0,
    art: false,
    tags: {},
  },
];

function makeSteam() {
  const lib0 = "steam/root";
  const lib1 = "steam/library2";
  const linuxPaths = Object.keys(MOUNTS.linux);
  const winPaths = Object.keys(MOUNTS.windows);
  const libFolders = (paths: string[]) =>
    vdfText({
      libraryfolders: Object.fromEntries(
        paths.map((p, i) => [
          String(i),
          {
            path: p,
            label: i === 0 ? "" : "SD Card",
            contentid: String(1000 + i),
            totalsize: "0",
            apps: Object.fromEntries(
              GAMES.filter((g) => g.lib === i).map((g) => [String(g.appId), "1000000"]),
            ),
          },
        ]),
      ),
    });
  write(`${lib0}/steamapps/libraryfolders.vdf`, libFolders(linuxPaths));
  write("steam/libraryfolders.windows.vdf", libFolders(winPaths));
  write("steam/mounts.json", `${JSON.stringify(MOUNTS, null, 2)}\n`);

  for (const g of GAMES) {
    const lib = g.lib === 0 ? lib0 : lib1;
    write(
      `${lib}/steamapps/appmanifest_${g.appId}.acf`,
      vdfText({
        AppState: {
          appid: String(g.appId),
          universe: "1",
          name: g.name,
          StateFlags: "4",
          installdir: g.installdir,
          LastUpdated: String(unix(30 * DAY)),
          SizeOnDisk: String(1_000_000_000 + g.appId),
          buildid: "1",
          LastOwner: STEAMID64,
        },
      }),
    );
    // Art.
    const cache = `${lib0}/appcache/librarycache`;
    if (g.art === "new") {
      write(`${cache}/${g.appId}/library_600x900.jpg`, png(`${g.name}-p`, ...POSTER));
      write(`${cache}/${g.appId}/library_hero.jpg`, png(`${g.name}-h`, ...HERO));
      write(`${cache}/${g.appId}/header.jpg`, png(`${g.name}-w`, ...WIDE));
    } else if (g.art === "flat") {
      write(`${cache}/${g.appId}_library_600x900.jpg`, png(`${g.name}-p`, ...POSTER));
      write(`${cache}/${g.appId}_library_hero.jpg`, png(`${g.name}-h`, ...HERO));
    } else if (g.art === "hashed") {
      write(
        `${cache}/${g.appId}/0123456789abcdef0123456789abcdef01234567/library_600x900.jpg`,
        png(`${g.name}-p`, ...POSTER),
      );
      write(`${cache}/${g.appId}/library_hero.jpg`, png(`${g.name}-h`, ...HERO));
    } else if (g.art === "header-only") {
      write(`${cache}/${g.appId}/header.jpg`, png(`${g.name}-w`, ...WIDE));
    }
    // Store metadata.
    if (!g.type) {
      write(
        `steam/store/${g.appId}.json`,
        `${JSON.stringify(
          {
            [String(g.appId)]: {
              success: true,
              data: {
                type: "game",
                name: g.name,
                steam_appid: g.appId,
                short_description: g.short,
                genres: g.genres.map((d) => ({ id: GENRE_IDS[d] ?? "0", description: d })),
                categories: g.categories.map((id) => ({ id, description: CATEGORY_NAMES[id] ?? String(id) })),
              },
            },
          },
          null,
          2,
        )}\n`,
      );
    }
  }

  write(
    `${lib0}/config/loginusers.vdf`,
    vdfText({
      users: {
        [OTHER_STEAMID64]: {
          AccountName: "guest",
          PersonaName: "Guest",
          MostRecent: "0",
          Timestamp: String(unix(90 * DAY)),
        },
        [STEAMID64]: {
          AccountName: "couchplayer",
          PersonaName: "Couch Player",
          MostRecent: "1",
          Timestamp: String(unix(DAY)),
        },
      },
    }),
  );

  const apps: VdfObject = {};
  for (const g of GAMES) {
    if (g.type) continue;
    const e: VdfObject = { Playtime: String(g.playtimeMin), Playtime2wks: "0" };
    if (g.lastPlayedDaysAgo !== null) e.LastPlayed = String(unix(g.lastPlayedDaysAgo * DAY + 3 * 3600_000));
    apps[String(g.appId)] = e;
  }
  write(
    `${lib0}/userdata/${ACCOUNT}/config/localconfig.vdf`,
    vdfText({
      UserLocalConfigStore: {
        Software: { Valve: { Steam: { apps } } },
        friends: { PersonaName: "Couch Player" },
      },
    }),
  );
  // The other user has played Portal 2 a lot; proves the right user is read.
  write(
    `${lib0}/userdata/${OTHER_ACCOUNT}/config/localconfig.vdf`,
    vdfText({
      UserLocalConfigStore: {
        Software: {
          Valve: { Steam: { Apps: { "620": { Playtime: "9999", LastPlayed: String(unix(DAY)) } } } },
        },
      },
    }),
  );

  const sc: VdfObject = {};
  SHORTCUTS.forEach((s, i) => {
    sc[String(i)] = {
      appid: s.appid,
      AppName: s.AppName,
      Exe: s.Exe,
      StartDir: '"C:\\Program Files (x86)\\Battle.net\\"',
      icon: "",
      ShortcutPath: "",
      LaunchOptions: s.LaunchOptions,
      IsHidden: 0,
      AllowDesktopConfig: 1,
      AllowOverlay: 1,
      OpenVR: 0,
      Devkit: 0,
      DevkitGameID: "",
      DevkitOverrideAppID: 0,
      LastPlayTime: s.lastPlayedDaysAgo === null ? 0 : unix(s.lastPlayedDaysAgo * DAY + 2 * 3600_000),
      FlatpakAppID: "",
      tags: s.tags,
    };
    if (s.art) {
      const id = s.appid >>> 0;
      write(`${lib0}/userdata/${ACCOUNT}/config/grid/${id}p.png`, png(`${s.AppName}-p`, ...POSTER));
      write(`${lib0}/userdata/${ACCOUNT}/config/grid/${id}_hero.png`, png(`${s.AppName}-h`, ...HERO));
    }
  });
  write(`${lib0}/userdata/${ACCOUNT}/config/shortcuts.vdf`, encodeBinaryVdf({ shortcuts: sc }));
}

// ---------- Jellyfin ----------

const TICKS = 10_000_000;
const jid = (s: string) => {
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  return hex(hash(s)) + hex(hash(`${s}#`)) + hex(hash(`#${s}`)) + hex(hash(`${s}${s}`));
};

interface MovieSpec {
  name: string;
  year: number;
  minutes: number;
  addedDaysAgo: number;
  positionMin?: number;
  lastPlayedDaysAgo?: number;
  played?: boolean;
  genres: string[];
  rating: string;
  overview: string;
  art?: boolean;
}

const MOVIES: MovieSpec[] = [
  {
    name: "Arrival",
    year: 2016,
    minutes: 116,
    addedDaysAgo: 200,
    positionMin: 74,
    lastPlayedDaysAgo: 4,
    genres: ["Drama", "Science Fiction"],
    rating: "PG-13",
    overview: "A linguist works with the military to communicate with alien lifeforms.",
    art: true,
  },
  {
    name: "Paddington 2",
    year: 2017,
    minutes: 103,
    addedDaysAgo: 30,
    positionMin: 85,
    lastPlayedDaysAgo: 2,
    genres: ["Comedy", "Family"],
    rating: "PG",
    overview: "Paddington picks up a series of odd jobs to buy the perfect present.",
    art: true,
  },
  {
    name: "Spirited Away",
    year: 2001,
    minutes: 125,
    addedDaysAgo: 90,
    genres: ["Animation", "Fantasy"],
    rating: "PG",
    overview: "A girl wanders into a world ruled by gods, witches and spirits.",
    art: true,
  },
  {
    name: "Mad Max: Fury Road",
    year: 2015,
    minutes: 120,
    addedDaysAgo: 3,
    genres: ["Action"],
    rating: "R",
    overview: "In a post-apocalyptic wasteland, a woman rebels against a tyrannical ruler.",
    art: true,
  },
  {
    name: "The Grand Budapest Hotel",
    year: 2014,
    minutes: 99,
    addedDaysAgo: 10,
    genres: ["Comedy"],
    rating: "R",
    overview: "A concierge and his lobby boy are framed for murder.",
    art: true,
  },
  {
    name: "Dune: Part Two",
    year: 2024,
    minutes: 166,
    addedDaysAgo: 1,
    genres: ["Science Fiction", "Adventure"],
    rating: "PG-13",
    overview: "Paul Atreides unites with the Fremen on a path of revenge.",
    art: true,
  },
  {
    name: "Knives Out",
    year: 2019,
    minutes: 130,
    addedDaysAgo: 150,
    played: true,
    lastPlayedDaysAgo: 100,
    genres: ["Mystery", "Comedy"],
    rating: "PG-13",
    overview: "A detective investigates the death of a crime novelist.",
    art: false,
  },
  {
    name: "Wallace & Gromit: Vengeance Most Fowl",
    year: 2024,
    minutes: 79,
    addedDaysAgo: 75,
    genres: ["Animation", "Comedy", "Family"],
    rating: "PG",
    overview: "Gromit's concern grows when Wallace becomes over-reliant on his inventions.",
    art: false,
  },
];

interface ShowSpec {
  name: string;
  year: number;
  episodeMinutes: number;
  episodes: {
    s: number;
    e: number;
    title: string;
    addedDaysAgo: number;
    positionMin?: number;
    lastPlayedDaysAgo?: number;
    played?: boolean;
  }[];
  overview: string;
}

const SHOWS: ShowSpec[] = [
  {
    name: "Severance",
    year: 2022,
    episodeMinutes: 52,
    overview:
      "Mark leads a team of office workers whose memories have been surgically divided between work and home.",
    episodes: [
      { s: 2, e: 3, title: "Who Is Alive?", addedDaysAgo: 40, played: true, lastPlayedDaysAgo: 6 },
      { s: 2, e: 4, title: "Woe's Hollow", addedDaysAgo: 40, positionMin: 10, lastPlayedDaysAgo: 1 },
      { s: 2, e: 5, title: "Trojan's Horse", addedDaysAgo: 40 },
    ],
  },
  {
    name: "Bluey",
    year: 2018,
    episodeMinutes: 7,
    overview: "Bluey is an inexhaustible six-year-old Blue Heeler dog who loves to play.",
    episodes: [
      { s: 3, e: 10, title: "Stickbird", addedDaysAgo: 120, played: true, lastPlayedDaysAgo: 3 },
      { s: 3, e: 11, title: "Housework", addedDaysAgo: 120 },
    ],
  },
  {
    name: "The Bear",
    year: 2022,
    episodeMinutes: 34,
    overview: "A young chef returns to Chicago to run his family's sandwich shop.",
    episodes: [
      { s: 4, e: 1, title: "Groundhog Day", addedDaysAgo: 2 },
      { s: 4, e: 2, title: "Ice Chips", addedDaysAgo: 2 },
    ],
  },
  {
    name: "Shōgun",
    year: 2024,
    episodeMinutes: 60,
    overview:
      "Lord Yoshii Toranaga fights for his life as his enemies on the Council of Regents unite against him.",
    episodes: [{ s: 1, e: 1, title: "Anjin", addedDaysAgo: 8 }],
  },
];

const SERVER_ID = "f00dfeedcafe4c0ffee0123456789abc";
const USER_ID = "8a1b2c3d4e5f60718293a4b5c6d7e8f9";

function movieDto(m: MovieSpec) {
  const id = jid(`movie:${m.name}`);
  const tag = jid(`tag:${m.name}`).slice(0, 32);
  return {
    Name: m.name,
    ServerId: SERVER_ID,
    Id: id,
    DateCreated: iso(m.addedDaysAgo * DAY),
    PremiereDate: `${m.year}-01-01T00:00:00.0000000Z`,
    OfficialRating: m.rating,
    CommunityRating: 7.5,
    RunTimeTicks: m.minutes * 60 * TICKS,
    ProductionYear: m.year,
    IsFolder: false,
    Type: "Movie",
    Overview: m.overview,
    Genres: m.genres,
    UserData: {
      PlaybackPositionTicks: (m.positionMin ?? 0) * 60 * TICKS,
      PlayCount: m.played ? 1 : 0,
      IsFavorite: false,
      Played: m.played ?? false,
      Key: id,
      ...(m.positionMin ? { PlayedPercentage: (100 * m.positionMin) / m.minutes } : {}),
      ...(m.lastPlayedDaysAgo !== undefined
        ? { LastPlayedDate: iso(m.lastPlayedDaysAgo * DAY + 2 * 3600_000) }
        : {}),
    },
    PrimaryImageAspectRatio: 0.6666666666666666,
    VideoType: "VideoFile",
    ImageTags: m.art ? { Primary: tag } : {},
    BackdropImageTags: m.art ? [tag] : [],
    LocationType: "FileSystem",
    MediaType: "Video",
  };
}

function episodeDto(show: ShowSpec, ep: ShowSpec["episodes"][number]) {
  const seriesId = jid(`series:${show.name}`);
  const id = jid(`ep:${show.name}:${ep.s}:${ep.e}`);
  const stag = jid(`tag:${show.name}`).slice(0, 32);
  return {
    Name: ep.title,
    ServerId: SERVER_ID,
    Id: id,
    DateCreated: iso(ep.addedDaysAgo * DAY),
    RunTimeTicks: show.episodeMinutes * 60 * TICKS,
    ProductionYear: show.year,
    IndexNumber: ep.e,
    ParentIndexNumber: ep.s,
    IsFolder: false,
    Type: "Episode",
    Overview: `${show.name} S${ep.s}E${ep.e}.`,
    SeriesName: show.name,
    SeriesId: seriesId,
    SeasonId: jid(`season:${show.name}:${ep.s}`),
    SeasonName: `Season ${ep.s}`,
    SeriesPrimaryImageTag: stag,
    ParentBackdropItemId: seriesId,
    ParentBackdropImageTags: [stag],
    UserData: {
      PlaybackPositionTicks: (ep.positionMin ?? 0) * 60 * TICKS,
      PlayCount: ep.played ? 1 : 0,
      IsFavorite: false,
      Played: ep.played ?? false,
      Key: id,
      ...(ep.positionMin ? { PlayedPercentage: (100 * ep.positionMin) / show.episodeMinutes } : {}),
      ...(ep.lastPlayedDaysAgo !== undefined
        ? { LastPlayedDate: iso(ep.lastPlayedDaysAgo * DAY + 3600_000) }
        : {}),
    },
    ImageTags: {},
    BackdropImageTags: [],
    LocationType: "FileSystem",
    MediaType: "Video",
  };
}

function makeJellyfin() {
  const j = (name: string, v: unknown) => write(`jellyfin/${name}`, `${JSON.stringify(v, null, 2)}\n`);
  j("system-info-public.json", {
    LocalAddress: "http://192.168.1.20:8096",
    ServerName: "dxp2800",
    Version: "10.11.2",
    ProductName: "Jellyfin Server",
    OperatingSystem: "",
    Id: SERVER_ID,
    StartupWizardCompleted: true,
  });
  j("users.json", [
    {
      Name: "living-room",
      ServerId: SERVER_ID,
      Id: USER_ID,
      HasPassword: true,
      Policy: { IsAdministrator: false, IsDisabled: false },
    },
    {
      Name: "admin",
      ServerId: SERVER_ID,
      Id: "00000000000000000000000000000001",
      HasPassword: true,
      Policy: { IsAdministrator: true, IsDisabled: false },
    },
  ]);

  const movies = MOVIES.map(movieDto);
  const resumeMovies = MOVIES.filter((m) => m.positionMin).map(movieDto);
  const episodes = SHOWS.flatMap((s) => s.episodes.map((e) => ({ show: s, ep: e, dto: episodeDto(s, e) })));
  const resumeEps = episodes.filter((x) => x.ep.positionMin).map((x) => x.dto);
  const resume = [...resumeMovies, ...resumeEps].sort((a, b) =>
    (b.UserData.LastPlayedDate ?? "").localeCompare(a.UserData.LastPlayedDate ?? ""),
  );
  j("resume.json", { Items: resume, TotalRecordCount: resume.length, StartIndex: 0 });

  // Next Up: for each series, the first unplayed episode after the last played one (not in progress).
  const nextUp = SHOWS.flatMap((s) => {
    const lastPlayed = [...s.episodes].reverse().find((e) => e.played);
    if (!lastPlayed) return [];
    const idx = s.episodes.indexOf(lastPlayed);
    const next = s.episodes[idx + 1];
    if (!next || next.positionMin) return [];
    return [episodeDto(s, next)];
  });
  j("nextup.json", { Items: nextUp, TotalRecordCount: nextUp.length, StartIndex: 0 });

  const latestMovies = [...movies].sort((a, b) => b.DateCreated.localeCompare(a.DateCreated));
  j("latest-movies.json", latestMovies);
  const latestEpisodes = episodes
    .map((x) => x.dto)
    .filter((d) => !d.UserData.Played)
    .sort((a, b) => b.DateCreated.localeCompare(a.DateCreated) || a.SeriesName.localeCompare(b.SeriesName));
  j("latest-episodes.json", latestEpisodes);
  const unwatched = movies.filter((m) => !m.UserData.Played);
  j("unwatched-movies.json", { Items: unwatched, TotalRecordCount: unwatched.length, StartIndex: 0 });

  j("sessions.json", [
    {
      Id: "session-jellyfin-desktop",
      UserId: USER_ID,
      UserName: "living-room",
      Client: "Jellyfin Desktop",
      DeviceName: "living-room-pc",
      DeviceId: "jd-device",
      ApplicationVersion: "2.0.0",
      LastActivityDate: iso(0),
      SupportsRemoteControl: true,
      SupportsMediaControl: true,
      PlayableMediaTypes: ["Audio", "Video"],
    },
  ]);

  for (const m of MOVIES) {
    if (!m.art) continue;
    const id = jid(`movie:${m.name}`);
    write(`jellyfin/images/${id}-Primary.png`, png(`${m.name}-jp`, ...POSTER));
    write(`jellyfin/images/${id}-Backdrop.png`, png(`${m.name}-jb`, ...HERO));
  }
  for (const s of SHOWS) {
    const id = jid(`series:${s.name}`);
    if (s.name === "Shōgun") continue; // no art: text fallback
    write(`jellyfin/images/${id}-Primary.png`, png(`${s.name}-jp`, ...POSTER));
    write(`jellyfin/images/${id}-Backdrop.png`, png(`${s.name}-jb`, ...HERO));
  }
}

rmSync(path.join(out, "steam"), { recursive: true, force: true });
rmSync(path.join(out, "jellyfin"), { recursive: true, force: true });
makeSteam();
makeJellyfin();
console.log("fixtures written to", out);
