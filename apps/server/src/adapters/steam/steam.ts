/**
 * Steam adapter: reads library folders, app manifests, playtime / last played and the
 * shortcuts file. Strictly read-only: every access goes through ReadFs, which has no write methods.
 */
import type { Platform, ReadFs } from "../../platform/types.ts";
import { legacyShortcutAppId, shortcutAppId, shortcutGameId } from "./gameid.ts";
import {
  ci,
  ciNum,
  ciObj,
  ciPath,
  ciStr,
  isVdfObject,
  parseBinaryVdf,
  parseTextVdf,
  type VdfObject,
} from "./vdf.ts";

export const STEAMID64_BASE = 76561197960265728n;

export interface SteamGame {
  appId: string;
  name: string;
  installDir: string;
  library: string;
  /** Unix seconds, null when never played. */
  lastPlayed: number | null;
  playtimeMin: number | null;
}

export interface SteamShortcut {
  /** Unsigned 32-bit app id (grid art file names use it). */
  appId32: number;
  /** 64-bit id for steam://rungameid/. */
  gameId: string;
  name: string;
  exe: string;
  launchOptions: string;
  lastPlayed: number | null;
  tags: string[];
  hidden: boolean;
}

export interface SteamUser {
  accountId: string;
  steamId64: string;
  name: string;
  mostRecent: boolean;
}

export interface SteamLibrary {
  path: string;
  ok: boolean;
  appCount: number;
}

export interface SteamScan {
  root: string | null;
  flatpak: boolean;
  userId: string | null;
  users: SteamUser[];
  libraries: SteamLibrary[];
  games: SteamGame[];
  shortcuts: SteamShortcut[];
  warnings: string[];
  rootSearch: { path: string; ok: boolean; why: string }[];
}

/** Redistributables, runtimes and compatibility tools that appear as installed apps. */
export const NON_GAME_APP_IDS = new Set([
  "228980", // Steamworks Common Redistributables
  "1070560", // Steam Linux Runtime 1.0 (scout)
  "1391110", // Steam Linux Runtime 2.0 (soldier)
  "1628350", // Steam Linux Runtime 3.0 (sniper)
  "1493710", // Proton Experimental
  "2180100", // Proton Hotfix
  "1826330", // Proton EasyAntiCheat Runtime
  "1161040", // Proton BattlEye Runtime
  "250820", // SteamVR
]);
const NON_GAME_NAME =
  /^(Proton\b|Steam Linux Runtime|Steamworks Common|SteamVR|Steam Audio|Proton EasyAntiCheat|Proton BattlEye)/i;

export function isNonGame(appId: string, name: string): boolean {
  return NON_GAME_APP_IDS.has(appId) || NON_GAME_NAME.test(name);
}

function readText(fs: ReadFs, p: string, warnings: string[]): VdfObject | null {
  try {
    if (!fs.exists(p)) return null;
    return parseTextVdf(fs.readText(p));
  } catch (e) {
    warnings.push(`could not read ${p}: ${(e as Error).message}`);
    return null;
  }
}

export function readUsers(fs: ReadFs, platform: Platform, root: string, warnings: string[]): SteamUser[] {
  const P = platform.path;
  const v = readText(fs, P.join(root, "config", "loginusers.vdf"), warnings);
  const users = ciObj(v ?? undefined, "users");
  const out: SteamUser[] = [];
  if (users) {
    for (const [sid, u] of Object.entries(users)) {
      if (!isVdfObject(u) || !/^\d+$/.test(sid)) continue;
      const id = BigInt(sid);
      if (id < STEAMID64_BASE) continue;
      out.push({
        accountId: (id - STEAMID64_BASE).toString(),
        steamId64: sid,
        name: ciStr(u, "PersonaName") ?? ciStr(u, "AccountName") ?? sid,
        mostRecent: ciStr(u, "MostRecent") === "1",
      });
    }
  }
  return out;
}

/** Pick the user: configured id, else the most recent login, else the only userdata folder. */
export function pickUser(
  fs: ReadFs,
  platform: Platform,
  root: string,
  users: SteamUser[],
  configured: string,
  warnings: string[],
): string | null {
  const P = platform.path;
  const userdata = P.join(root, "userdata");
  if (configured) {
    if (fs.exists(P.join(userdata, configured))) return configured;
    warnings.push(`steam.user_id ${configured} has no userdata folder; auto-detecting`);
  }
  const recent = users.find((u) => u.mostRecent && fs.exists(P.join(userdata, u.accountId)));
  if (recent) return recent.accountId;
  let dirs: string[] = [];
  try {
    dirs = fs.readdir(userdata).filter((d) => /^\d+$/.test(d) && d !== "0");
  } catch {
    return null;
  }
  if (dirs.length === 1) return dirs[0] as string;
  if (dirs.length > 1) {
    const sorted = dirs.sort();
    warnings.push(`several Steam users and none marked most recent; using ${sorted[0]}. Set steam.user_id.`);
    return sorted[0] as string;
  }
  return null;
}

export function readLibraries(fs: ReadFs, platform: Platform, root: string, warnings: string[]): string[] {
  const P = platform.path;
  const v = readText(fs, P.join(root, "steamapps", "libraryfolders.vdf"), warnings);
  const lf = ciObj(v ?? undefined, "libraryfolders") ?? v ?? undefined;
  const out: string[] = [];
  if (lf) {
    for (const [k, entry] of Object.entries(lf)) {
      if (!/^\d+$/.test(k)) continue;
      // Current format: { "path" "..." }. Very old format: "1" "D:\\Games".
      const p = isVdfObject(entry) ? ciStr(entry, "path") : typeof entry === "string" ? entry : undefined;
      if (p) out.push(P.normalize(p));
    }
  }
  const normRoot = P.normalize(root);
  if (!out.some((p) => samePath(platform, p, normRoot))) out.unshift(normRoot);
  return out;
}

function samePath(platform: Platform, a: string, b: string): boolean {
  return platform.id === "windows" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export function readPlaytime(
  fs: ReadFs,
  platform: Platform,
  root: string,
  userId: string | null,
  warnings: string[],
): Map<string, { lastPlayed: number | null; playtimeMin: number | null }> {
  const out = new Map<string, { lastPlayed: number | null; playtimeMin: number | null }>();
  if (!userId) return out;
  const P = platform.path;
  const v = readText(fs, P.join(root, "userdata", userId, "config", "localconfig.vdf"), warnings);
  const apps = ciPath(v ?? undefined, "UserLocalConfigStore", "Software", "Valve", "Steam", "apps");
  if (!apps) return out;
  for (const [id, e] of Object.entries(apps)) {
    if (!isVdfObject(e)) continue;
    const lp = ciNum(e, "LastPlayed");
    const pt = ciNum(e, "Playtime");
    out.set(id, { lastPlayed: lp && lp > 0 ? lp : null, playtimeMin: pt ?? null });
  }
  return out;
}

export function readManifests(
  fs: ReadFs,
  platform: Platform,
  library: string,
  warnings: string[],
): SteamGame[] {
  const P = platform.path;
  const dir = P.join(library, "steamapps");
  let files: string[];
  try {
    files = fs.readdir(dir);
  } catch {
    warnings.push(`library ${library} has no readable steamapps folder`);
    return [];
  }
  const games: SteamGame[] = [];
  for (const f of files.sort()) {
    const m = /^appmanifest_(\d+)\.acf$/i.exec(f);
    if (!m) continue;
    const v = readText(fs, P.join(dir, f), warnings);
    const st = ciObj(v ?? undefined, "AppState");
    if (!st) continue;
    const appId = ciStr(st, "appid") ?? (m[1] as string);
    const name = ciStr(st, "name") ?? `App ${appId}`;
    const flags = ciNum(st, "StateFlags") ?? 0;
    // StateFlags bit 4 (value 4) = fully installed.
    if ((flags & 4) === 0) continue;
    const lp = ciNum(st, "LastPlayed");
    games.push({
      appId,
      name,
      installDir: ciStr(st, "installdir") ?? "",
      library,
      lastPlayed: lp && lp > 0 ? lp : null,
      playtimeMin: null,
    });
  }
  return games;
}

export function readShortcuts(
  fs: ReadFs,
  platform: Platform,
  root: string,
  userId: string | null,
  warnings: string[],
): SteamShortcut[] {
  if (!userId) return [];
  const P = platform.path;
  const p = P.join(root, "userdata", userId, "config", "shortcuts.vdf");
  if (!fs.exists(p)) return [];
  let v: VdfObject;
  try {
    v = parseBinaryVdf(fs.readFile(p));
  } catch (e) {
    warnings.push(`could not read shortcuts.vdf: ${(e as Error).message}`);
    return [];
  }
  const list = ciObj(v, "shortcuts") ?? {};
  const out: SteamShortcut[] = [];
  for (const entry of Object.values(list)) {
    if (!isVdfObject(entry)) continue;
    const name = ciStr(entry, "AppName") ?? "";
    const exe = ciStr(entry, "Exe") ?? "";
    if (!name) continue;
    const raw = ci(entry, "appid");
    const appId32 =
      typeof raw === "number" && raw !== 0 ? shortcutAppId(raw) : legacyShortcutAppId(exe, name);
    const lp = ciNum(entry, "LastPlayTime");
    const tags = ciObj(entry, "tags");
    out.push({
      appId32,
      gameId: shortcutGameId(appId32),
      name,
      exe,
      launchOptions: ciStr(entry, "LaunchOptions") ?? "",
      lastPlayed: lp && lp > 0 ? lp : null,
      tags: tags ? Object.values(tags).filter((t): t is string => typeof t === "string") : [],
      hidden: ciNum(entry, "IsHidden") === 1,
    });
  }
  return out;
}

export async function scanSteam(opts: {
  platform: Platform;
  fs: ReadFs;
  configuredRoot: string;
  configuredUser: string;
}): Promise<SteamScan> {
  const { platform, fs } = opts;
  const warnings: string[] = [];
  const found = await platform.findSteamRoot(opts.configuredRoot);
  const empty: SteamScan = {
    root: null,
    flatpak: false,
    userId: null,
    users: [],
    libraries: [],
    games: [],
    shortcuts: [],
    warnings,
    rootSearch: found.tried,
  };
  if (!found.root) {
    warnings.push("Steam not found");
    return empty;
  }
  const root = found.root;
  const users = readUsers(fs, platform, root, warnings);
  const userId = pickUser(fs, platform, root, users, opts.configuredUser, warnings);
  const playtime = readPlaytime(fs, platform, root, userId, warnings);

  const libraries: SteamLibrary[] = [];
  const byId = new Map<string, SteamGame>();
  for (const lib of readLibraries(fs, platform, root, warnings)) {
    const ok = fs.exists(lib);
    const games = ok ? readManifests(fs, platform, lib, warnings) : [];
    if (!ok) warnings.push(`library ${lib} is not mounted`);
    libraries.push({ path: lib, ok, appCount: games.length });
    for (const g of games) {
      if (isNonGame(g.appId, g.name) || byId.has(g.appId)) continue;
      const pt = playtime.get(g.appId);
      byId.set(g.appId, {
        ...g,
        lastPlayed: pt?.lastPlayed ?? g.lastPlayed,
        playtimeMin: pt?.playtimeMin ?? null,
      });
    }
  }
  const games = [...byId.values()].sort((a, b) => Number(a.appId) - Number(b.appId));
  const shortcuts = readShortcuts(fs, platform, root, userId, warnings);
  return {
    root,
    flatpak: found.flatpak,
    userId,
    users,
    libraries,
    games,
    shortcuts,
    warnings,
    rootSearch: found.tried,
  };
}
