import path from "node:path";
import { splitCommandLine } from "./cmdline.ts";
import type { Command, Platform, PlatformDeps, SteamRootResult } from "./types.ts";

const P = path.posix;

export const STEAM_FLATPAK_ID = "com.valvesoftware.Steam";
export const CHROMIUM_FLATPAK_ID = "org.chromium.Chromium";
export const JELLYFIN_DESKTOP_FLATPAK_ID = "org.jellyfin.JellyfinDesktop";

/** Chromium kiosk flags for the launcher window. See docs/DECISIONS.md (kiosk spike). */
export const CHROMIUM_KIOSK_FLAGS = [
  "--kiosk",
  "--noerrdialogs",
  "--disable-session-crashed-bubble",
  "--disable-infobars",
  "--no-first-run",
  "--check-for-update-interval=31536000",
  "--autoplay-policy=no-user-gesture-required",
];

export function createLinuxPlatform(deps: PlatformDeps): Platform {
  const { env, home, fs } = deps;
  const xdgConfig =
    env.XDG_CONFIG_HOME && P.isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : P.join(home, ".config");
  const xdgData =
    env.XDG_DATA_HOME && P.isAbsolute(env.XDG_DATA_HOME)
      ? env.XDG_DATA_HOME
      : P.join(home, ".local", "share");

  const flatpakRoots = [
    P.join(home, ".var", "app", STEAM_FLATPAK_ID, ".local", "share", "Steam"),
    P.join(home, ".var", "app", STEAM_FLATPAK_ID, "data", "Steam"),
  ];

  /** A Steam root must contain steamapps/libraryfolders.vdf. */
  const check = (p: string): { ok: boolean; why: string } => {
    if (!fs.exists(p)) return { ok: false, why: "does not exist" };
    if (!fs.exists(P.join(p, "steamapps", "libraryfolders.vdf")))
      return { ok: false, why: "no steamapps/libraryfolders.vdf" };
    return { ok: true, why: "found steamapps/libraryfolders.vdf" };
  };

  return {
    id: "linux",
    path: P,
    configDir: () => P.join(xdgConfig, "couch-launcher"),
    dataDir: () => P.join(xdgData, "couch-launcher"),
    configFile: () => P.join(xdgConfig, "couch-launcher", "config.toml"),

    async findSteamRoot(configured: string): Promise<SteamRootResult> {
      const candidates = [
        ...(configured ? [configured] : []),
        P.join(home, ".steam", "steam"),
        P.join(home, ".steam", "root"),
        P.join(home, ".local", "share", "Steam"),
        ...flatpakRoots,
      ];
      const tried: SteamRootResult["tried"] = [];
      const seen = new Set<string>();
      for (const c of candidates) {
        let real = c;
        try {
          if (fs.exists(c)) real = fs.realpath(c);
        } catch {
          real = c;
        }
        if (seen.has(real)) {
          tried.push({ path: c, ok: false, why: `same as ${real}` });
          continue;
        }
        seen.add(real);
        const r = check(real);
        tried.push({ path: c, ...r });
        if (r.ok) {
          const flatpak = flatpakRoots.some((f) => real === f || real.startsWith(`${f}/`));
          return { root: real, tried, flatpak };
        }
      }
      return { root: null, tried, flatpak: false };
    },

    steamLaunchCommand(steam: SteamRootResult, gameId: string): Command {
      const url = `steam://rungameid/${gameId}`;
      if (steam.flatpak) return { cmd: "flatpak", args: ["run", STEAM_FLATPAK_ID, url] };
      return { cmd: "steam", args: [url] };
    },

    jellyfinClientCommand(): Command {
      return { cmd: "flatpak", args: ["run", JELLYFIN_DESKTOP_FLATPAK_ID] };
    },

    kioskCommand(url: string): Command {
      return { cmd: "flatpak", args: ["run", CHROMIUM_FLATPAK_ID, ...CHROMIUM_KIOSK_FLAGS, url] };
    },

    parseCommandLine: splitCommandLine,

    isGameRunning(gameId: string): boolean | null {
      // Steam starts every game under `reaper SteamLaunch AppId=<id> -- ...`.
      // Shortcuts use the 32-bit app id in that argument, Steam games the app id.
      const id = BigInt(gameId);
      const appId = id > 0xffffffffn ? (id >> 32n).toString() : id.toString();
      const needle = `AppId=${appId}`;
      let pids: string[];
      try {
        pids = fs.readdir("/proc").filter((d) => /^\d+$/.test(d));
      } catch {
        return null;
      }
      for (const pid of pids) {
        try {
          const args = fs.readText(P.join("/proc", pid, "cmdline")).split("\0");
          if (args.includes(needle)) return true;
        } catch {
          // Process exited between readdir and read.
        }
      }
      return false;
    },
  };
}
