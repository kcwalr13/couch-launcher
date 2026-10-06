import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT, tempDir } from "./helpers.ts";

const SCRIPT = path.join(REPO_ROOT, "scripts", "install.ps1");
const pwsh = Bun.which("pwsh");

// PowerShell is optional on the dev machine (installed in the build VM). The registry and
// shortcut steps can only run on Windows; here the script is parsed and dry-run.
test.skipIf(!pwsh)("install.ps1 parses and -DryRun prints all six steps without changing anything", () => {
  const parse = Bun.spawnSync([
    pwsh as string,
    "-NoProfile",
    "-Command",
    `$e=$null; [System.Management.Automation.Language.Parser]::ParseFile('${SCRIPT}',[ref]$null,[ref]$e) | Out-Null; $e.Count`,
  ]);
  expect(parse.stdout.toString().trim()).toBe("0");

  const d = tempDir();
  const r = Bun.spawnSync(
    [pwsh as string, "-NoProfile", "-File", SCRIPT, "-DryRun", "-JellyfinUrl", "http://nas:8096"],
    {
      env: {
        ...process.env,
        LOCALAPPDATA: path.join(d.dir, "Local"),
        APPDATA: path.join(d.dir, "Roaming"),
        HOME: d.dir,
      },
    },
  );
  const out = r.stdout.toString();
  expect(r.exitCode).toBe(0);
  for (let i = 1; i <= 6; i++) expect(out).toContain(`[${i}/6]`);
  expect(out).toContain("configure --jellyfin-url http://nas:8096");
  expect(out).toContain("HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\\CouchLauncher");
  expect(out).toContain("Couch Launcher.lnk");
  expect(out).toContain("Add a Non-Steam Game");
  // Neither install target was created (pwsh may still write its own caches).
  expect(readdirSync(d.dir).filter((n) => n === "Local" || n === "Roaming")).toEqual([]);
  d.cleanup();
});
