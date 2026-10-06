// Scans the fixture Steam root through the real adapter (used by the strace write test).
import { resolveShortcutArt, resolveSteamArt } from "../../src/adapters/steam/art.ts";
import { scanSteam } from "../../src/adapters/steam/steam.ts";
import { steamFixtureFs } from "../../src/mock/fixtures.ts";
import { createPlatform, realProcessRunner } from "../../src/platform/index.ts";

const fs = steamFixtureFs("linux");
const platform = createPlatform("linux", { env: {}, home: "/home/deck", fs, proc: realProcessRunner });
const scan = await scanSteam({ platform, fs, configuredRoot: "", configuredUser: "" });
let art = 0;
for (const g of scan.games)
  for (const k of ["poster", "hero"] as const) {
    const p = resolveSteamArt(fs, platform, scan.root as string, scan.userId, g.appId, k);
    if (p) {
      fs.readFile(p);
      art++;
    }
  }
for (const s of scan.shortcuts)
  for (const k of ["poster", "hero"] as const)
    if (resolveShortcutArt(fs, platform, scan.root as string, scan.userId, s.appId32, k)) art++;
console.log(JSON.stringify({ games: scan.games.length, shortcuts: scan.shortcuts.length, art }));
