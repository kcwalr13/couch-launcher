import path from "node:path";
import { splitCommandLine } from "./cmdline.ts";
import type { Command, Platform, PlatformDeps, SteamRootResult } from "./types.ts";

const W = path.win32;

/**
 * Edge app-mode flags. `--kiosk` would force an InPrivate session, which forgets the Jellyfin web
 * login the "web" handoff relies on, so the launcher uses a full-screen app window with its own
 * persistent profile instead. See docs/DECISIONS.md D-016.
 */
export const EDGE_APP_FLAGS = [
  "--start-fullscreen",
  "--no-first-run",
  "--noerrdialogs",
  "--disable-features=Translate",
];

/** Registry values that record where Steam is installed (per user first). */
export const STEAM_REGISTRY_QUERIES = [
  { key: "HKCU\\Software\\Valve\\Steam", value: "SteamPath" },
  { key: "HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam", value: "InstallPath" },
  { key: "HKLM\\SOFTWARE\\Valve\\Steam", value: "InstallPath" },
] as const;

/**
 * Parse `reg query <key> /v <value>` output, e.g.
 *     SteamPath    REG_SZ    c:/program files (x86)/steam
 */
export function parseRegQuery(stdout: string, value: string): string | null {
  for (const line of stdout.split(/\r?\n/)) {
    const m = /^\s*(\S.*?)\s{2,}(REG_[A-Z_]+)\s{2,}(.*?)\s*$/.exec(line);
    if (m && m[1]?.toLowerCase() === value.toLowerCase() && m[3]) return m[3];
  }
  return null;
}

export function createWindowsPlatform(deps: PlatformDeps): Platform {
  const { env, home, fs, proc } = deps;
  const appData = env.APPDATA || W.join(home, "AppData", "Roaming");
  const localAppData = env.LOCALAPPDATA || W.join(home, "AppData", "Local");
  const programFilesX86 = env["ProgramFiles(x86)"] || env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
  const programFiles = env.ProgramFiles || env.PROGRAMFILES || "C:\\Program Files";

  const check = (p: string): { ok: boolean; why: string } => {
    if (!fs.exists(p)) return { ok: false, why: "does not exist" };
    if (!fs.exists(W.join(p, "steamapps", "libraryfolders.vdf")))
      return { ok: false, why: "no steamapps\\libraryfolders.vdf" };
    return { ok: true, why: "found steamapps\\libraryfolders.vdf" };
  };

  return {
    id: "windows",
    path: W,
    configDir: () => W.join(appData, "couch-launcher"),
    dataDir: () => W.join(localAppData, "couch-launcher"),
    configFile: () => W.join(appData, "couch-launcher", "config.toml"),

    async findSteamRoot(configured: string): Promise<SteamRootResult> {
      const tried: SteamRootResult["tried"] = [];
      const candidates: string[] = configured ? [W.normalize(configured)] : [];
      for (const q of STEAM_REGISTRY_QUERIES) {
        try {
          const r = await proc.run({ cmd: "reg", args: ["query", q.key, "/v", q.value] });
          const v = r.code === 0 ? parseRegQuery(r.stdout, q.value) : null;
          // SteamPath is stored with forward slashes and lower case; normalise it.
          if (v) candidates.push(W.normalize(v));
          else tried.push({ path: `${q.key}\\${q.value}`, ok: false, why: "registry value not found" });
        } catch (e) {
          tried.push({
            path: `${q.key}\\${q.value}`,
            ok: false,
            why: `reg query failed: ${(e as Error).message}`,
          });
        }
      }
      candidates.push(W.join(programFilesX86, "Steam"));
      const seen = new Set<string>();
      for (const c of candidates) {
        const k = c.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        const r = check(c);
        tried.push({ path: c, ...r });
        if (r.ok) return { root: c, tried, flatpak: false };
      }
      return { root: null, tried, flatpak: false };
    },

    steamLaunchCommand(steam: SteamRootResult, gameId: string): Command {
      const url = `steam://rungameid/${gameId}`;
      // Passing the URL to the running client's executable forwards it over Steam's IPC,
      // the same thing the steam:// protocol handler does. No shell involved.
      if (steam.root) return { cmd: W.join(steam.root, "steam.exe"), args: [url] };
      return { cmd: "explorer.exe", args: [url] };
    },

    jellyfinClientCommand(): Command {
      // The Jellyfin Desktop installer runs with PrivilegesRequired=lowest: per-user installs land in
      // %LOCALAPPDATA%\Programs, machine-wide ones in %ProgramFiles%.
      const candidates = [
        W.join(localAppData, "Programs", "Jellyfin Desktop", "Jellyfin Desktop.exe"),
        W.join(programFiles, "Jellyfin Desktop", "Jellyfin Desktop.exe"),
        W.join(programFiles, "Jellyfin", "Jellyfin Media Player", "JellyfinMediaPlayer.exe"),
      ];
      const found = candidates.find((c) => fs.exists(c)) ?? candidates[0];
      return { cmd: found as string, args: [] };
    },

    kioskCommand(url: string): Command {
      const edge = [
        W.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
        W.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
      ];
      return {
        cmd: edge.find((c) => fs.exists(c)) ?? (edge[0] as string),
        args: [
          `--app=${url}`,
          `--user-data-dir=${W.join(localAppData, "couch-launcher", "browser")}`,
          ...EDGE_APP_FLAGS,
        ],
      };
    },

    parseCommandLine: splitCommandLine,

    isGameRunning(): boolean | null {
      // Not needed on Windows: the controller input bug is Linux-only.
      return null;
    },
  };
}
