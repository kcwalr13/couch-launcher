/**
 * `couch-launcher doctor`: prints what the service can find. Read-only: it creates no config
 * file, uses an in-memory database and only reads under the Steam root. On Windows the report is
 * also written to %LOCALAPPDATA%\couch-launcher\doctor.txt, because the GUI-subsystem executable
 * has no console when started from Explorer (DECISIONS D-009).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { isUtilityShortcut } from "./adapters/steam/items.ts";
import { bootstrap } from "./bootstrap.ts";
import { VERSION } from "./version.ts";

export async function doctorReport(
  env: Record<string, string | undefined>,
): Promise<{ lines: string[]; problems: number }> {
  const b = await bootstrap(env, { readOnly: true });
  const { app, config, platform } = b;
  const lines: string[] = [];
  let problems = 0;
  const say = (s = "") => lines.push(s);
  const bad = (s: string) => {
    problems++;
    say(s);
  };

  say(`Couch Launcher doctor ${VERSION} (${platform.id}${b.mock ? ", mock mode" : ""})`);
  say();
  if (b.configFile)
    say(
      `Config     ${b.configFile} ${b.configFound ? "(found)" : "(missing: defaults used; `serve` creates it)"}`,
    );
  else say("Config     mock mode defaults");
  for (const w of b.configWarnings) bad(`  warning: ${w}`);
  say(`Data       ${b.dataDir}`);

  const url = `http://127.0.0.1:${config.server.port}`;
  const running = await fetch(`${url}/api/status`, { signal: AbortSignal.timeout(1000) }).then(
    (r) => r.ok,
    () => false,
  );
  say(`Service    ${running ? `running at ${url}` : `not running on port ${config.server.port}`}`);
  say();

  const scan = await app.library.steam(true);
  if (!scan.root) {
    bad("Steam      NOT FOUND");
    for (const t of scan.rootSearch) say(`  tried ${t.path}: ${t.why}`);
  } else {
    say(`Steam      OK  ${scan.root}${scan.flatpak ? " (Flatpak)" : ""}`);
    const user = scan.users.find((u) => u.accountId === scan.userId);
    say(`  user: ${scan.userId ?? "none"}${user ? ` (${user.name})` : ""}`);
    for (const l of scan.libraries)
      (l.ok ? say : bad)(`  library: ${l.path} ${l.ok ? `(${l.appCount} apps)` : "(NOT MOUNTED)"}`);
    const utility = scan.shortcuts.filter((s) =>
      isUtilityShortcut(s, config.playback.client_shortcut, config.server.port),
    );
    say(
      `  games: ${scan.games.length}; shortcuts: ${scan.shortcuts.length} (${utility.length} launcher/player shortcuts)`,
    );
    const sample = scan.games.slice(0, 5).map((g) => g.name);
    if (sample.length) say(`  e.g. ${sample.join(", ")}`);
    for (const w of scan.warnings) bad(`  warning: ${w}`);
    if (!scan.userId) bad("  no Steam user found: playtime, shortcuts and grid art are unavailable");
  }
  say();

  if (!app.jellyfin)
    bad(
      `Jellyfin   NOT CONFIGURED: set jellyfin.url and jellyfin.api_key in ${b.configFile ?? "config.toml"}`,
    );
  else {
    const s = await app.jellyfin.status();
    const line = `${s.serverName ?? "Jellyfin"} ${s.version ?? ""} at ${s.server}`.replace(/\s+/g, " ");
    if (s.state === "ok" || s.state === "mock")
      say(`Jellyfin   OK  ${line}; ${s.itemCount} items in Watch rows`);
    else bad(`Jellyfin   ${s.state.toUpperCase()}: ${s.detail}`);
  }
  const shortcutName = config.playback.client_shortcut;
  const clientShortcut = shortcutName
    ? scan.shortcuts.find((s) => s.name.toLowerCase().includes(shortcutName.toLowerCase()))
    : undefined;
  say(`Playback   handoff = ${config.playback.handoff}`);
  if (config.playback.handoff === "client") {
    if (clientShortcut)
      say(`  client: Steam shortcut "${clientShortcut.name}" (steam://rungameid/${clientShortcut.gameId})`);
    else {
      const cmd = config.playback.client_command
        ? platform.parseCommandLine(config.playback.client_command)
        : platform.jellyfinClientCommand();
      say(
        `  client: no shortcut named like "${shortcutName}"; will run: ${cmd ? [cmd.cmd, ...cmd.args].join(" ") : "(unreadable command)"}`,
      );
    }
  }
  const k = platform.kioskCommand(`${url}/`);
  say(`Kiosk      ${[k.cmd, ...k.args].join(" ")}`);
  const own = scan.shortcuts.find((s) => s.name.toLowerCase().includes("couch launcher"));
  if (own) {
    say(`  Steam shortcut "${own.name}": steam://rungameid/${own.gameId}`);
    if (platform.id === "linux") {
      const c = platform.steamLaunchCommand(
        { root: scan.root, tried: [], flatpak: scan.flatpak },
        own.gameId,
      );
      say(`  for kiosk.restart_command: ${[c.cmd, ...c.args].join(" ")}`);
    }
  } else say('  no Steam shortcut named "Couch Launcher" yet (see the install steps)');
  say();
  say(problems ? `${problems} problem(s) found.` : "No problems found.");
  b.store.close();
  return { lines, problems };
}

export async function doctor(env: Record<string, string | undefined>): Promise<number> {
  const { lines, problems } = await doctorReport(env);
  const text = `${lines.join("\n")}\n`;
  process.stdout.write(text);
  const b = await bootstrap({ ...env }, { readOnly: true });
  if (b.platform.id === "windows" && !b.mock) {
    try {
      mkdirSync(b.dataDir, { recursive: true });
      writeFileSync(b.platform.path.join(b.dataDir, "doctor.txt"), text.replace(/\n/g, "\r\n"));
    } catch {
      // The report was printed; the file copy is best effort.
    }
  }
  b.store.close();
  return problems ? 1 : 0;
}
