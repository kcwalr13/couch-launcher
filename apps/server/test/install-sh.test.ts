import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { parseConfig } from "../src/config.ts";
import { REPO_ROOT, tempDir } from "./helpers.ts";

const SCRIPT = path.join(REPO_ROOT, "scripts", "install.sh");
const MAIN = path.join(REPO_ROOT, "apps", "server", "src", "main.ts");

/** A stand-in "couch-launcher" binary that runs the real CLI from source. */
function fakeBinary(dir: string): string {
  const p = path.join(dir, "couch-launcher-linux-x64");
  writeFileSync(p, `#!/bin/sh\nexec "${process.execPath}" "${MAIN}" "$@"\n`);
  chmodSync(p, 0o755);
  return p;
}

/** Logging stand-ins for systemctl and flatpak (the VM has neither). */
function stubs(dir: string): string {
  const bin = path.join(dir, "stub-bin");
  mkdirSync(bin);
  for (const name of ["systemctl", "flatpak"]) {
    const p = path.join(bin, name);
    writeFileSync(
      p,
      `#!/bin/sh\necho "${name} $*" >> "${dir}/calls.log"\n[ "$1" = "--version" ] && echo "Flatpak 1.16.1"\nexit 0\n`,
    );
    chmodSync(p, 0o755);
  }
  return bin;
}

describe("install.sh", () => {
  test("--dry-run prints every step and changes nothing", () => {
    const d = tempDir();
    const home = path.join(d.dir, "home");
    mkdirSync(home);
    const r = Bun.spawnSync(
      ["bash", SCRIPT, "--dry-run", "--binary", fakeBinary(d.dir), "--jellyfin-url", "http://nas:8096"],
      {
        env: { PATH: process.env.PATH ?? "", HOME: home },
      },
    );
    const out = r.stdout.toString();
    expect(r.exitCode).toBe(0);
    for (let i = 1; i <= 6; i++) expect(out).toContain(`[${i}/6]`);
    expect(out).toContain(
      `$ install -m 755 ${d.dir}/couch-launcher-linux-x64 ${home}/.local/bin/couch-launcher`,
    );
    expect(out).toContain(`$ ${home}/.local/bin/couch-launcher configure --jellyfin-url http://nas:8096`);
    expect(out).toContain("$ systemctl --user enable --now couch-launcher.service");
    expect(out).toContain("$ flatpak install --user -y --noninteractive flathub org.chromium.Chromium");
    expect(out).toContain("org.chromium.Chromium");
    expect(out).toContain(
      "$ flatpak install --user -y --noninteractive flathub org.jellyfin.JellyfinDesktop",
    );
    expect(out).toContain("Add a Non-Steam Game");
    expect(readdirSync(home)).toEqual([]);
    d.cleanup();
  });

  test("a real run into a scratch home: binary, config with URL and key, unit, kiosk wrapper, service enabled", () => {
    const d = tempDir();
    const home = path.join(d.dir, "home");
    mkdirSync(home);
    const bin = stubs(d.dir);
    const r = Bun.spawnSync(
      ["bash", SCRIPT, "--yes", "--binary", fakeBinary(d.dir), "--jellyfin-url", "http://nas:8096"],
      {
        env: {
          PATH: `${bin}:${process.env.PATH}`,
          HOME: home,
          COUCH_JELLYFIN_API_KEY: "secret-key-42",
          COUCH_PORT: "7997",
        },
      },
    );
    const out = r.stdout.toString() + r.stderr.toString();
    expect(r.exitCode).toBe(0);
    expect(out).not.toContain("secret-key-42");
    const exe = path.join(home, ".local", "bin", "couch-launcher");
    expect(statSync(exe).mode & 0o111).toBeGreaterThan(0);
    const cfgFile = path.join(home, ".config", "couch-launcher", "config.toml");
    const cfg = parseConfig(Bun.TOML.parse(readFileSync(cfgFile, "utf8"))).config;
    expect(cfg.jellyfin).toMatchObject({ url: "http://nas:8096", api_key: "secret-key-42" });
    expect(statSync(cfgFile).mode & 0o077).toBe(0); // readable by the user only
    expect(
      readFileSync(path.join(home, ".config", "systemd", "user", "couch-launcher.service"), "utf8"),
    ).toBe(readFileSync(path.join(REPO_ROOT, "scripts", "couch-launcher.service"), "utf8"));
    const kiosk = readFileSync(path.join(home, ".local", "bin", "couch-launcher-kiosk"), "utf8");
    expect(kiosk).toContain("exec 'flatpak' 'run' 'org.chromium.Chromium' '--kiosk'");
    expect(kiosk).toContain("'http://127.0.0.1:7744/'");
    const calls = readFileSync(path.join(d.dir, "calls.log"), "utf8");
    expect(calls).toContain("systemctl --user daemon-reload");
    expect(calls).toContain("systemctl --user enable --now couch-launcher.service");
    expect(calls).toContain("flatpak override --user --device=input org.chromium.Chromium");
    expect(calls).toContain(
      "flatpak install --user -y --noninteractive flathub org.jellyfin.JellyfinDesktop",
    );
    expect(out).toContain("Couch Launcher doctor"); // ran doctor at the end
    expect(existsSync(path.join(home, ".local", "share", "Steam"))).toBe(false);
    d.cleanup();
  });

  test("old Flatpak falls back to --device=all", () => {
    const d = tempDir();
    const home = path.join(d.dir, "home");
    mkdirSync(home);
    const bin = stubs(d.dir);
    writeFileSync(
      path.join(bin, "flatpak"),
      `#!/bin/sh\necho "flatpak $*" >> "${d.dir}/calls.log"\n[ "$1" = "--version" ] && echo "Flatpak 1.14.4"\nexit 0\n`,
    );
    const r = Bun.spawnSync(["bash", SCRIPT, "--yes", "--binary", fakeBinary(d.dir)], {
      env: { PATH: `${bin}:${process.env.PATH}`, HOME: home },
    });
    expect(r.exitCode).toBe(0);
    expect(readFileSync(path.join(d.dir, "calls.log"), "utf8")).toContain(
      "flatpak override --user --device=all org.chromium.Chromium",
    );
    d.cleanup();
  });
});
