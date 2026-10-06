/**
 * The Platform interface: the only place Linux and Windows differ.
 * Implementations receive every side effect through PlatformDeps so both can be
 * tested on any host with a fake filesystem and a fake process runner.
 */

export interface Command {
  cmd: string;
  args: string[];
  cwd?: string;
}

export interface FileStat {
  isDir: boolean;
  isFile: boolean;
  size: number;
  mtimeMs: number;
}

/**
 * Read-only filesystem. There are deliberately no write methods here:
 * everything under the Steam root is accessed through this interface.
 */
export interface ReadFs {
  exists(p: string): boolean;
  stat(p: string): FileStat | null;
  readFile(p: string): Uint8Array;
  readText(p: string): string;
  readdir(p: string): string[];
  realpath(p: string): string;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ProcessRunner {
  /** Run to completion and capture output (used for short queries such as `reg query`). */
  run(cmd: Command): Promise<RunResult>;
  /** Start detached and return immediately. Throws when the executable cannot be started. */
  spawnDetached(cmd: Command): void;
}

export interface PlatformDeps {
  env: Record<string, string | undefined>;
  home: string;
  fs: ReadFs;
  proc: ProcessRunner;
}

export interface PathLib {
  join(...parts: string[]): string;
  resolve(...parts: string[]): string;
  normalize(p: string): string;
  dirname(p: string): string;
  basename(p: string): string;
  isAbsolute(p: string): boolean;
  relative(from: string, to: string): string;
  sep: string;
}

export interface SteamRootResult {
  root: string | null;
  /** Every candidate considered, with the reason it was rejected, for `doctor`. */
  tried: { path: string; ok: boolean; why: string }[];
  /** Linux only: Steam runs as a Flatpak. Changes the launch command. */
  flatpak: boolean;
}

export type PlatformId = "linux" | "windows";

export interface Platform {
  id: PlatformId;
  path: PathLib;
  configDir(): string;
  dataDir(): string;
  configFile(): string;
  /** Find the Steam root. A configured path wins when it looks valid. */
  findSteamRoot(configured: string): Promise<SteamRootResult>;
  /** The command that makes the running Steam client start a game id (app id or 64-bit shortcut id). */
  steamLaunchCommand(steam: SteamRootResult, gameId: string): Command;
  /** Default command to start Jellyfin Desktop directly (used when no Steam shortcut matches). */
  jellyfinClientCommand(): Command | null;
  /** Kiosk browser command for the launcher UI (used by the installer and the restart mitigation). */
  kioskCommand(url: string): Command;
  /** Parse a command line from the config file into a Command. */
  parseCommandLine(line: string): Command | null;
  /**
   * Linux input mitigation support: is a process for this Steam game id still running?
   * Returns null when the platform cannot tell.
   */
  isGameRunning(gameId: string): boolean | null;
}
