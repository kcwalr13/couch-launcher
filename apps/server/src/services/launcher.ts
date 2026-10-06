/**
 * Starts games and playback. The service runs every command itself; the browser never sees a
 * steam:// link. All process starts go through the injected ProcessRunner, so tests assert the
 * exact command for each platform without running anything.
 */
import type { LaunchResponse, UnifiedItem } from "@couch/core";
import type { JellyfinSource, Session } from "../adapters/jellyfin/jellyfin.ts";
import type { SteamScan } from "../adapters/steam/steam.ts";
import type { Config } from "../config.ts";
import type { Logger } from "../log.ts";
import type { Command, Platform, ProcessRunner } from "../platform/types.ts";
import type { Library } from "./library.ts";

export interface LauncherDeps {
  config: Config;
  platform: Platform;
  proc: ProcessRunner;
  library: Library;
  jellyfin: JellyfinSource | null;
  log: Logger;
  sleep?: (ms: number) => Promise<void>;
}

const CLIENT_NAMES = /jellyfin (desktop|media player)/i;

export class Launcher {
  private readonly sleep: (ms: number) => Promise<void>;
  private watcher: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly d: LauncherDeps) {
    this.sleep = d.sleep ?? ((ms) => Bun.sleep(ms));
  }

  private spawn(cmd: Command): string | null {
    try {
      this.d.log.info(`launch: ${cmd.cmd} ${cmd.args.join(" ")}`);
      this.d.proc.spawnDetached(cmd);
      return null;
    } catch (e) {
      this.d.log.error(`launch failed: ${cmd.cmd}`, e);
      return (e as Error).message;
    }
  }

  private steamRootResult(scan: SteamScan) {
    return { root: scan.root, tried: scan.rootSearch, flatpak: scan.flatpak };
  }

  async launch(item: UnifiedItem, fromStart = false): Promise<LaunchResponse> {
    const l = item.launch;
    if (l.type === "steam" || l.type === "shortcut") {
      const scan = await this.d.library.steam();
      if (!scan.root)
        return { ok: false, message: "Steam was not found on this PC, so the game can't start." };
      const gameId = l.type === "steam" ? l.appId : l.gameId;
      const err = this.spawn(this.d.platform.steamLaunchCommand(this.steamRootResult(scan), gameId));
      if (err) return { ok: false, message: `Couldn't ask Steam to start ${item.title}: ${err}` };
      this.watchForExit(gameId);
      return { ok: true, message: `Steam is starting ${item.title}.` };
    }
    return this.play(item, l.itemId, fromStart ? 0 : l.positionSec);
  }

  private async play(item: UnifiedItem, itemId: string, positionSec: number): Promise<LaunchResponse> {
    const jf = this.d.jellyfin;
    if (!jf) return { ok: false, message: "Jellyfin is not set up in config.toml." };
    if (this.d.config.playback.handoff === "web")
      return { ok: true, message: "Opening in Jellyfin.", openUrl: jf.webUrl(itemId) };

    // Client handoff. The client is always started through Steam (even when it is already
    // running) so Gaming Mode brings it to the front; then wait for its session and send PlayNow.
    try {
      await jf.sessions();
    } catch (e) {
      return { ok: false, message: `Can't reach Jellyfin: ${(e as Error).message}` };
    }
    const err = await this.startClient();
    if (err) return { ok: false, message: err };
    let session: Session | null = null;
    const deadline = this.d.config.playback.session_wait_sec;
    for (let waited = 0; waited < deadline && !session; waited++) {
      await this.sleep(1000);
      try {
        session = pickClientSession(await jf.sessions());
      } catch {
        // The server blipped; keep waiting until the deadline.
      }
    }
    if (!session)
      return {
        ok: false,
        message: "Jellyfin Desktop is open, but it did not accept the play command. Pick the item there.",
      };
    try {
      await jf.play(session.Id, itemId, positionSec);
    } catch (e) {
      return { ok: false, message: `Jellyfin did not accept the play command: ${(e as Error).message}` };
    }
    return { ok: true, message: `Playing ${item.title} in Jellyfin Desktop.` };
  }

  /** Start Jellyfin Desktop: through its Steam shortcut when one exists, else directly. */
  private async startClient(): Promise<string | null> {
    const { client_shortcut, client_command } = this.d.config.playback;
    const scan = await this.d.library.steam();
    const sc =
      client_shortcut && scan.root
        ? scan.shortcuts.find((s) => s.name.toLowerCase().includes(client_shortcut.toLowerCase()))
        : undefined;
    let cmd: Command | null;
    if (sc) cmd = this.d.platform.steamLaunchCommand(this.steamRootResult(scan), sc.gameId);
    else if (client_command) cmd = this.d.platform.parseCommandLine(client_command);
    else cmd = this.d.platform.jellyfinClientCommand();
    if (!cmd) return "playback.client_command in config.toml could not be read.";
    const err = this.spawn(cmd);
    return err ? `Couldn't start Jellyfin Desktop: ${err}` : null;
  }

  /**
   * Linux input-loss mitigation (opt-in, kiosk.restart_after_game): once the launched game has
   * been seen running and then exits, restart the kiosk browser so it picks up the controller again.
   */
  private watchForExit(gameId: string): void {
    const k = this.d.config.kiosk;
    if (!k.restart_after_game || this.d.platform.isGameRunning(gameId) === null) return;
    if (this.watcher) clearInterval(this.watcher);
    let seen = false;
    let checks = 0;
    this.watcher = setInterval(() => {
      checks++;
      const running = this.d.platform.isGameRunning(gameId);
      if (running) seen = true;
      if ((seen && running === false) || (!seen && checks > 60)) {
        if (this.watcher) clearInterval(this.watcher);
        this.watcher = null;
        if (seen) this.restartKiosk();
      }
    }, 5000);
  }

  restartKiosk(): void {
    const url = `http://127.0.0.1:${this.d.config.server.port}/`;
    const cmd = this.d.config.kiosk.restart_command
      ? this.d.platform.parseCommandLine(this.d.config.kiosk.restart_command)
      : this.d.platform.kioskCommand(url);
    if (cmd) this.spawn(cmd);
  }

  stop(): void {
    if (this.watcher) clearInterval(this.watcher);
  }
}

/** The most recently active remote-controllable Jellyfin Desktop (or Media Player) session. */
export function pickClientSession(sessions: Session[]): Session | null {
  return (
    sessions
      .filter((s) => s.SupportsRemoteControl && CLIENT_NAMES.test(s.Client ?? ""))
      .sort((a, b) => (b.LastActivityDate ?? "").localeCompare(a.LastActivityDate ?? ""))[0] ?? null
  );
}
