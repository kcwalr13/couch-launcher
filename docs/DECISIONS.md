# Decisions

A dated log of every choice made where the brief was silent, said "verify", or turned out wrong.
Format: **D-number — title** (date, phase). Decision. Why. Source when verified.

## Phase 0: Foundations

**D-001 — Toolchain** (2026-10-06, P0). Bun 1.4.2 workspaces; TypeScript 5.9.3 (strict, `noUncheckedIndexedAccess`) used only as a type checker; Biome 2.5 for lint and format; React 19.3, Vite 8.3, Tailwind 4.3; Playwright 1.56.1 pinned because it matches the Chromium build preinstalled in the dev VM. TypeScript 7 (native) exists but 5.9 is the conservative choice for `tsc -p` checks.

**D-002 — Default port 7744** (2026-10-06, P0). The brief names `server.port` without a value. 7744 avoids common home-server ports (8096 Jellyfin, 7878 Radarr, 8080, 5173 Vite). Service binds to 127.0.0.1 only; config rejects non-loopback hosts.

**D-003 — Mock mode wiring** (2026-10-06, P0). `COUCH_MOCK=1` enables mock mode. Mock mode without `COUCH_CONFIG_DIR` uses in-memory default config and writes nothing to the real config dir; its database goes to `<dataDir>/mock` unless `COUCH_DATA_DIR` is set. `COUCH_NOW` pins the clock so fixture-relative dates are stable.

**D-004 — Extra `app_setting` table** (2026-10-06, P0). The brief's five tables have no home for the Settings-screen UI scale (which must not rewrite the user's commented config file) or the picker's last answers. Added a key/value `app_setting` table. It never holds secrets.

**D-005 — `profile.is_default` marks the active profile** (2026-10-06, P0). The schema has `is_default` but no "active" column; switching profile moves the flag so the choice survives restarts.

**D-006 — Typecheck per project with `tsc -p`** (2026-10-06, P0). `tsc -b` needs composite projects that emit; the repo never emits with tsc, so `scripts/typecheck.ts` runs `tsc -p --noEmit` per project.

**D-007 — Playwright test naming** (2026-10-06, P0). UI tests are `*.e2e.ts` and run under Node via the Playwright CLI; `bun test` would otherwise collect `*.spec.ts` files.

## Phase 1: Spikes

Research was done against primary sources where the VM's egress proxy allowed it (GitHub source and raw files, Microsoft Learn). bun.com, developer.valvesoftware.com, api.jellyfin.org and store.steampowered.com were blocked from this VM, so those facts come from source code mirrors on GitHub. "Verified" below means checked against a source or by running code here. "Unverified" items are on `docs/ON_DEVICE.md`.

**D-008 — Single executable: Bun works for both targets** (2026-10-06, P1). `bun build --compile --target=bun-linux-x64` and `--target=bun-windows-x64` both succeed from Linux (Bun downloads the target runtime). Sizes: about 82 MB (Linux) and 86 MB (Windows). The web bundle is embedded as base64 in a generated module (`scripts/build.ts` fills `http/embedded-web.ts` during the compile, then restores the empty stub), which avoids Bun's special handling of HTML imports. `bun:sqlite` is part of the runtime and works in the compiled binary.
*Verified by running*: the Linux binary serves the UI and `/api/status` and creates its SQLite file. The Windows `.exe` is a PE32+ x86-64 image; it was **run under Wine 9.0** in this VM: it reported `platform: "windows"`, created its database under `%LOCALAPPDATA%\couch-launcher\mock`, and served the UI and API. Wine is not Windows, so a run on the real PC stays on the on-device list. No fallback to Node was needed. Source: oven-sh/bun `docs/bundler/executables.mdx`.

**D-009 — Hidden console on Windows** (2026-10-06, P1). The service starts at sign-in and must not leave a console window open. The docs say `--windows-hide-console` is the one Windows flag that works when cross-compiling, and the built PE's subsystem field reads 2 (GUI), which confirms it. `--windows-icon` and version metadata need a Windows build host, so v1 ships without a custom icon. A GUI-subsystem program has no console when started by double-click, so `doctor` also writes its report to `%LOCALAPPDATA%\couch-launcher\doctor.txt`, and `install.ps1` prints that file.

**D-010 — shortcuts.vdf binary format** (2026-10-06, P1). Type bytes are 00 map, 01 string, 02 int32 LE, 03 float32, 07 uint64, 08 end, plus 05/06/0A/0B, which shortcuts.vdf does not use but the parser accepts. The root is `shortcuts` → `"0"`, `"1"`… entries. Key casing varies by writer (`AppName`/`appname`, `Exe`/`exe`), so every lookup is case-insensitive. Fields used: `appid` (signed int32), `AppName`, `Exe`, `StartDir`, `LaunchOptions`, `IsHidden`, `LastPlayTime` (unix seconds), `tags`. Sources: ValvePython/vdf, Corecii/steam-binary-vdf-ts. Covered by a hand-assembled byte fixture test.

**D-011 — Shortcut game id** (2026-10-06, P1). `rungameid = (appid >>> 0) << 32 | 0x02000000`, where `appid` is the signed int32 from shortcuts.vdf. For old files with no `appid`, the 32-bit id is `crc32(Exe + AppName) | 0x80000000`, with Exe taken exactly as stored, quotes included. Grid art uses the unsigned 32-bit id: `<id>p.png` (portrait), `<id>_hero.png`, `<id>_logo.png`, `<id>.png` (wide), or the same names as `.jpg`. Source: SteamGridDB/steam-rom-manager `generate-app-id.ts`. Tests: `gameid.test.ts`. That a real shortcut actually starts this way is on the on-device list.

**D-012 — Jellyfin endpoints and auth** (2026-10-06, P1). Auth header: `Authorization: MediaBrowser Client="Couch Launcher", Device=…, DeviceId=…, Version=…, Token="<key>"`. `X-Emby-Token` and `api_key` are gated by `EnableLegacyAuthorization`, which defaults to true in 10.11 and false on master, so they are not used. Endpoints, all with `userId` as a query parameter:
- `/UserItems/Resume`
- `/Shows/NextUp`
- `/Items/Latest` (returns a bare array)
- `/Items` (unwatched movies)
- `/Items/{id}`
- `/Items/{id}/Images/{Primary|Backdrop}`
- `/System/Info/Public` (no auth, used as the reachability check)
- `/Users` (to auto-pick a user)

The `/Users/{id}/Items/...` forms are obsolete in 10.11 and are not used. Source: jellyfin/jellyfin `release-10.11.z` controllers (`ItemsController`, `UserLibraryController`, `SessionController`) and `AuthorizationContext.cs` on master.

**D-013 — Playback handoff** (2026-10-06, P1). The default (`playback.handoff = "client"`) has five steps:
1. Start Jellyfin Desktop through its own non-Steam shortcut, found in shortcuts.vdf by name containing `playback.client_shortcut` (default "Jellyfin"), using `steam://rungameid/`. This keeps it inside Gaming Mode's focus handling.
2. If no shortcut matches, run `playback.client_command` or the platform default (Linux: `flatpak run org.jellyfin.JellyfinDesktop`; Windows: `Jellyfin Desktop.exe` under `%LOCALAPPDATA%\Programs` or `%ProgramFiles%`).
3. Poll `GET /Sessions?controllableByUserId=<user>&activeWithinSeconds=60` every second, up to `playback.session_wait_sec`, for a session whose `Client` contains "Jellyfin Desktop" or "Jellyfin Media Player", supports remote control, and has the newest `LastActivityDate`.
4. Send `POST /Sessions/{id}/Playing?playCommand=PlayNow&itemIds=<id>&startPositionTicks=<pos*10^7>`.
5. If no session appears in time, the client stays open and the UI says "Jellyfin Desktop is open, but did not accept the play command; pick the item there". The service does not swap the kiosk to the web client behind the user's back.

`"web"` mode returns `<url>/web/#/details?id=<itemId>` for the kiosk browser to open. That page needs the browser to be signed in to Jellyfin once. The play endpoint returns 204 even when a client ignores the command, so the server's answer cannot confirm acceptance. Jellyfin Desktop is jellyfin-web inside a Qt shell, so it should honour PlayNow over its websocket, but this is **unverified** and on the on-device list. Jellyfin Desktop is the v2.0 rename of Jellyfin Media Player; its Flatpak id is `org.jellyfin.JellyfinDesktop` and its Windows installer uses `PrivilegesRequired=lowest`. Source: jellyfin/jellyfin-desktop releases and `bundle/win/JellyfinDesktop.iss.in`.

**D-014 — Kiosk browser and controller permission on Linux** (2026-10-06, P1).
- Browser: `flatpak run org.chromium.Chromium --kiosk --noerrdialogs --disable-session-crashed-bubble --disable-infobars --no-first-run --check-for-update-interval=31536000 --autoplay-policy=no-user-gesture-required http://127.0.0.1:7744/`.
- Gamepad API access inside the Flatpak: `flatpak override --user --device=input org.chromium.Chromium`. `--device=input` exists from Flatpak 1.15.6; the installer falls back to `--device=all` on older Flatpak. Source: Flathub discourse "Support for --device=input".
- Primary input stays the key-mapped Steam Input layout (brief), because of steam-for-linux#13665. That issue is open: Steam Input recreates its virtual pad on every app launch, and sandboxed apps that are already running keep the dead device (ENODEV) without hotplug.

**D-015 — Steam launch command** (2026-10-06, P1). Linux: `steam steam://rungameid/<id>`, which hands the URL to the running client over IPC. When Steam itself is the Flatpak, use `flatpak run com.valvesoftware.Steam <url>`. Windows: `<SteamRoot>\steam.exe steam://rungameid/<id>`, a direct exec with no shell or `start` quoting; `explorer.exe <url>` is the fallback when no root is known. The service always spawns these itself; the browser never sees a `steam://` link. That the game comes to the front in Gaming Mode / Big Picture is on the on-device list.

**D-016 — Windows kiosk browser** (2026-10-06, P1). Edge's `--kiosk` mode always runs InPrivate (Microsoft Learn, "Configure Microsoft Edge kiosk mode"), which would forget the Jellyfin web login. The launcher therefore uses `msedge.exe --app=<url> --user-data-dir=%LOCALAPPDATA%\couch-launcher\browser --start-fullscreen --no-first-run`: a chromeless full-screen window with its own persistent profile, and no admin rights needed. The Gamepad API works in Edge without extra permission.

**D-017 — Windows start at sign-in** (2026-10-06, P1). `install.ps1` writes a per-user `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` value `CouchLauncher = "<exe>" serve`, which needs no admin. A scheduled task at logon usually needs elevation; a Startup-folder `.lnk` would also work but needs COM to create. Wine's `reg.exe` output was used to confirm the `reg query` parser (`SteamPath    REG_SZ    c:/program files (x86)/steam`, CRLF line ends).

**D-018 — Windows Steam root** (2026-10-06, P1). Lookup order:
1. `steam.root` from config
2. `HKCU\Software\Valve\Steam\SteamPath` (stored lower case with forward slashes, normalised with `path.win32.normalize`)
3. `HKLM\SOFTWARE\WOW6432Node\Valve\Steam\InstallPath`
4. `HKLM\SOFTWARE\Valve\Steam\InstallPath`
5. `%ProgramFiles(x86)%\Steam`

A root is valid only if `steamapps\libraryfolders.vdf` exists.

**D-019 — Linux Steam root** (2026-10-06, P1). Candidates, in order:
1. config
2. `~/.steam/steam`
3. `~/.steam/root`
4. `~/.local/share/Steam`
5. `~/.var/app/com.valvesoftware.Steam/.local/share/Steam`
6. `~/.var/app/com.valvesoftware.Steam/data/Steam`

Symlinks are resolved and de-duplicated. SteamOS and Bazzite both use the native `~/.local/share/Steam`, reached through the `~/.steam/steam` symlink. Valid only with `steamapps/libraryfolders.vdf`.

**D-020 — Steam local data sources** (2026-10-06, P1).
- Library folders: `steamapps/libraryfolders.vdf`.
- Installed games: `appmanifest_<id>.acf` in each library's `steamapps`.
- Playtime and last played: `userdata/<accountid>/config/localconfig.vdf` → `UserLocalConfigStore/Software/Valve/Steam/apps/<appid>` → `Playtime` (minutes) and `LastPlayed` (unix seconds). The key is `apps` or `Apps` depending on client version. The manifest's `LastPlayed` is only a fallback.
- User: `config/loginusers.vdf`, taking the `MostRecent` user. Account id = SteamID64 − 76561197960265728.
- Artwork (`appcache/librarycache`), current layout: `<appid>/library_600x900.jpg`, `<appid>/library_hero.jpg`, `<appid>/header.jpg`, and sometimes `<appid>/<hash>/library_600x900.jpg` or `library_capsule.jpg`.
- Artwork, old flat layout: `<appid>_library_600x900.jpg`, `<appid>_library_hero.jpg`, `<appid>_header.jpg`.
- Resolution order: grid override, then per-app folder, then hashed subfolder, then flat file, then `header.jpg` as a last resort for the poster.

Sources: Playnite#1016, Deguffer#63, Vibepollo#555.

**D-021 — Store metadata** (2026-10-06, P1). `https://store.steampowered.com/api/appdetails?appids=<id>&l=english` returns `{ "<id>": { success, data: { type, name, short_description, genres: [{id: "1", description: "Action"}], categories: [{id: 28, description: "Full controller support"}] } } }`. Category ids used:
- 24 Shared/Split Screen
- 37 Shared/Split Screen PvP
- 39 Shared/Split Screen Co-op
- 28 Full controller support
- 18 Partial Controller Support

The unofficial limit is about 200 requests per 5 minutes, so requests go out one at a time, 1.5 s apart, back off for 5 minutes on HTTP 429, and the cache refreshes after 30 days. The store host is blocked from this VM, so fixtures follow the documented shape and live fetching is on the on-device list. Source: woctezuma/steam-api `categories.json`.

**D-022 — Wine as a Windows test bed** (2026-10-06, P1). Wine 9.0 was installed in the dev VM (`apt-get install wine64`). It runs the cross-compiled `.exe`, so Windows code paths (`process.platform === "win32"`, `%APPDATA%`/`%LOCALAPPDATA%`, `reg.exe`) are exercised for real by `scripts/wine-smoke.ts`. It is optional, not part of `check`, because a fresh clone has no Wine. A Wine pass is evidence, not proof.

## Phase 2: Steam adapter

**D-023 — Fixture shortcuts file has four entries, not two** (2026-10-06, P2). Two are game shortcuts: Diablo IV, which has grid art, and StarCraft II, which has none. The other two are the shortcuts a real setup will contain: "Jellyfin Desktop", used by the playback handoff, and "Couch Launcher", the kiosk itself. Including them proves those two are kept out of the games list.

**D-024 — Shortcuts that are not games** (2026-10-06, P2). A shortcut is left out of games, Continue and the picker if any of these holds:
- it is hidden (`IsHidden`)
- its name contains `playback.client_shortcut` (default "Jellyfin")
- its name contains "Couch Launcher"
- its command line points at `127.0.0.1:<port>` or `localhost:<port>`

**D-025 — Runtimes and tools are not games** (2026-10-06, P2). These are dropped:
- a fixed list of app ids: Steamworks Common Redistributables, the Steam Linux Runtimes, Proton Experimental/Hotfix, the EAC/BattlEye runtimes, SteamVR
- names starting with "Proton", "Steam Linux Runtime" or "Steamworks Common"
- any app whose cached store metadata says `type` is not "game"

Manifests without the fully-installed StateFlags bit (4) are skipped.

**D-026 — Derived tags** (2026-10-06, P2).
- Couch co-op means store category 24, 37 or 39 (any shared/split-screen mode). Online-only co-op does not count for "Fits the group".
- Controller support is `full` for category 28, `partial` for 18, `none` otherwise, and `null` (unknown) when there is no store data. Shortcuts always have no store data.
- Session length: when a game has several mapped genres, the longest wins. With no mapped genre, or no data, it falls back to `picker.default_session_length` (default `medium`).

**D-027 — User selection** (2026-10-06, P2). Order:
1. `steam.user_id`, if that userdata folder exists
2. the `MostRecent` login in `loginusers.vdf`
3. the only folder under `userdata`
4. the lowest-numbered folder, with a warning

Playtime, last played, shortcuts and grid art all come from the chosen user.

**D-028 — Steam scan freshness** (2026-10-06, P2). The scan is cached for 15 s and re-read on demand, which costs a few small file reads. A launched game's new "last played" therefore shows on the next request once the UI regains visibility. Store metadata refreshes in the background after each scan. Mock mode skips the 1.5 s rate limit because its fetches are fixture reads.

**D-029 — Mock mode mounts fixtures at virtual paths** (2026-10-06, P2). `mock/mapped-fs.ts` presents `fixtures/steam/root` and `library2` at `/home/deck/.local/share/Steam` and `/run/media/deck/SD/SteamLibrary` on Linux, or at `C:\Program Files (x86)\Steam` and `D:\SteamLibrary` on Windows. On Windows, `libraryfolders.vdf` is swapped for a copy with Windows paths. The real adapter and the real platform implementation then run unchanged, and launches go to a recording runner.

**D-030 — Fixture images** (2026-10-06, P2). Fixture art is small abstract PNGs drawn by the generator: deterministic, with no fonts and no copyrighted art. Some are saved under Steam's `.jpg` names, so the art proxy detects the image type from magic bytes rather than the file extension.

## Phase 3: Jellyfin adapter

**D-031 — Jellyfin user when `user_id` is blank** (2026-10-06, P3). An API key carries no user, so the first enabled user from `GET /Users` is used and logged. Households with several users should set `jellyfin.user_id`; the README says so.

**D-032 — What each Watch row contains** (2026-10-06, P3).
- **Continue Watching:** `/UserItems/Resume`, video only.
- **Next Up:** `/Shows/NextUp` with `enableResumable=false`.
- **Recently Added Movies:** `/Items/Latest?includeItemTypes=Movie`, minus played ones.
- **Recently Added Shows:** `/Items/Latest?includeItemTypes=Episode&groupItems=false`, reduced to the newest unplayed episode per series. Each tile is then directly playable, which a grouped Series or Season tile would not be.

The picker additionally uses `/Items?includeItemTypes=Movie&isPlayed=false&recursive=true`, the 200 newest unwatched movies.

**D-033 — Jellyfin caching** (2026-10-06, P3). The mapped rows, with image references but no image bytes, are stored in `metadata_cache` (`jellyfin:rows`) after every successful fetch, and kept in memory for 30 s. When the server is unreachable, Watch serves the SQLite copy and flags it `cached`; with no copy it shows empty rows. A random device id is generated once and stored in `app_setting`; Jellyfin uses it to tell clients apart.

**D-034 — Jellyfin status** (2026-10-06, P3).
- **Reachability:** `GET /System/Info/Public`, which needs no auth and gives the server name and version.
- **Auth:** checked by the authenticated row fetch.
- **States:** `unreachable` (network), `degraded` (key rejected or HTTP error), `ok`, `not_configured`, or `mock`.

**D-035 — Episode art** (2026-10-06, P3). Episodes use the series poster (`SeriesId` + `SeriesPrimaryImageTag`) and the series backdrop (`ParentBackdropItemId`), because episode stills are 16:9 thumbnails that look wrong in poster tiles. A 404 from the image endpoint counts as "no art", and the UI shows the text fallback.

**D-036 — The mock Jellyfin server checks auth** (2026-10-06, P3). `mock/jellyfin.ts` rejects requests that lack the `MediaBrowser … Token="…"` header, records remote-control calls, and can simulate an outage (`down`) or a client that is slow to start (`sessionsDelay`).

## Phase 4: UI shell and focus

**D-037 — Own focus engine** (2026-10-06, P4). Focus behaviour is the product, so the launcher uses a ~80-line pure engine (`apps/web/src/focus/engine.ts`) instead of a TV navigation library. A screen declares rows of keys. Left and right stay within the row and never wrap. Up and down skip empty rows and land on the remembered column, clamped to the row's length. `resolve` turns a stale key into the screen default, then into the first key. React scopes (`scope.tsx`) stack: a modal sits on top of its screen and gets every action first.

**D-038 — Our own key repeat** (2026-10-06, P4). Browser key-repeat events (`event.repeat`) are ignored. One `Repeater` drives held directions from both keyboard and gamepad: the first step fires on press, repeats start after 400 ms, then come every 125 ms (8 per second). Hold timing is therefore the same whatever the OS key-repeat settings or Steam Input emulation.

**D-039 — Key map** (2026-10-06, P4).

| Action | Keys |
| --- | --- |
| Move | Arrows |
| A | Enter or Space |
| B | Escape or Backspace |
| X | `x` |
| Y | `y` |
| LB | `q` or PageUp |
| RB | `e` or PageDown |
| Start | `s` |

The Gamepad API uses the W3C standard mapping (0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 9 Start, 12–15 D-pad, left stick with a 0.5 threshold). Button 16 (guide) is never bound. When the same action arrives from both the keyboard and the gamepad within 80 ms, the gamepad copy is dropped, because a pad can be seen both ways.

**D-040 — Scaling** (2026-10-06, P4). `html { font-size: min(100vw/120, 100vh/67.5) × ui-scale }`, and everything is sized in rem. 1 rem is 16 px at 1920×1080 and 32 px at 3840×2160, so both layouts are identical. Body text is 1.75 rem (28 px at 1080p), and every text on screen is at least that size.

**D-041 — Visual identity "Lamplight"** (2026-10-06, P4).
- Slate-black surfaces (`#0b0d12`, `#151a23`, `#1e2531`) and warm off-white text (`#f3f0e8`).
- Muted text `#b9bfcb`, 8.3:1 even on the lightest surface.
- One amber accent, `#f5b544`, for the focus ring and primary actions.
- Inter Variable is bundled, so the look is the same on SteamOS and Windows with no internet.
- The focused item's hero art sits blurred behind the screen at 30% opacity under an ink gradient. Worst case, a white backdrop pixel, still leaves muted text at about 7.9:1.
- Focus is shown three ways: scale 1.08, a 0.6 rem amber ring with an ink gap, and a bold caption. Colour is never the only cue.

**D-042 — Rows clip at the safe area** (2026-10-06, P4). Horizontal rows and the Play grid clip exactly at the 5% safe line, and their content is inset 1.5 rem so the focused tile's scale and ring fit inside the clip. Scrolling is programmatic (`focus/scroll.ts`), with no scroll bars. Watch rows snap the focused row to the top.

**D-043 — Mock-only test endpoints** (2026-10-06, P4). `POST /api/mock/reset` and `POST /api/mock/jellyfin` (`{down, sessionsDelay}`) are registered only when `COUCH_MOCK=1`. They let UI tests start each run from a clean slate and simulate a NAS outage.

**D-044 — Something is always focusable** (2026-10-06, P4). Every screen state has a focusable element:
- Watch with Jellyfin down shows "Try again" and "Settings".
- Placeholder screens show "Back".
- Play's sort and filter chips stay present when filters match nothing.

While a screen's data loads (milliseconds with local fixtures), focus is not stored. The screen default is applied once data arrives, and a returning screen shows cached data at once, so focus restores onto real tiles.

## Phase 5: Launching

**D-045 — Jellyfin Desktop is always started through Steam** (2026-10-06, P5). Before every client handoff the service starts Jellyfin Desktop through its shortcut, even if a session already exists, because in Gaming Mode only an app started through Steam comes to the front. It then polls `/Sessions` once a second for up to `playback.session_wait_sec` (default 30). Whether a second start of a running Jellyfin Desktop focuses the existing window, rather than opening another, is on the on-device list. A reachability check (`GET /Sessions`) runs first, so "Can't reach Jellyfin" is reported before anything is started.

**D-046 — Launch request lifetime and errors** (2026-10-06, P5). `POST /api/launch/:key` waits for the whole handoff, which takes up to the session wait, and returns `{ok, message}`. Failures use HTTP 502 and a plain-language message that the UI shows as an on-screen message. Spawn failures, missing Steam, an unreachable Jellyfin and a client that never answers are all reported this way. `?from=start` sends position 0.

**D-047 — Launching state** (2026-10-06, P5). After a successful launch the UI shows a full-screen "Starting… / Started" card with the message. The card clears on `visibilitychange` to visible, which is what happens when the game or player quits and the launcher returns; the same event refetches every screen's data. B also dismisses it. While it is shown, no other input acts.

**D-048 — UI state save and restore** (2026-10-06, P5). The top of the navigation stack (screen, params such as sort, filters or the item key, and the focused key) is `PUT` to `/api/ui-state` 250 ms after it settles, per active profile. On load, the UI fetches it, waiting at most 1.5 s, and rebuilds the stack:
- A tab is restored as the root.
- Detail, Tonight, Profiles and Settings are restored on top of Home.
- The column is re-derived from the restored key, so up and down still remember it.

This is the restorable state the brief asks for in input mitigation 3.

**D-049 — Kiosk restart mitigation (Linux, opt-in)** (2026-10-06, P5). With `kiosk.restart_after_game = true`:
- After a game launch, the service checks `/proc/*/cmdline` every 5 s for Steam's `reaper … AppId=<id>`.
- Once the game has been seen and then disappears, the service runs `kiosk.restart_command`, or the default `flatpak run org.chromium.Chromium --kiosk … <url>`.
- It gives up after 5 minutes if the game never appears.

It is off by default; the on-device checklist says when to turn it on. The input bridge (mitigation 4) is documented in DESIGN.md and not built.

**D-050 — Mock-mode launch log** (2026-10-06, P5). In mock mode the recording runner keeps every command it would have run. `GET /api/mock/launches` returns those commands and the mock Jellyfin server's play commands, so UI tests can assert them. Like the other mock endpoints, it does not exist outside mock mode.

## Phase 6: Profiles and preferences

**D-051 — Preferences belong to the active profile** (2026-10-06, P6). `POST /api/prefs` takes `{key, favourite?, hidden?, sessionLength?}` and writes to the active profile; partial updates keep the other fields. A session-length override applies to game keys only, and `null` clears it so the genre default comes back. Hidden items leave Home, Play, Watch and the picker. `GET /api/hidden` lists them so Settings can offer Unhide (Phase 8). Favourites show a ★ badge on tiles; the badge is a shape, not a colour.

**D-052 — Profile switching UI** (2026-10-06, P6). The Home profile chip opens "Who's on the couch?", with one large card per profile showing its size. A switches the profile, refreshes all data, says "<name> is on the couch", and returns. UI state is saved per profile, so each profile resumes where it left off. Profiles stay the three presets (brief default); creating and renaming profiles needs text entry, which the controller-only rule rules out, so they are not editable in v1.

**D-053 — Focus returns when a modal closes** (2026-10-06, P6). Closing the Y menu removes its focused element. The scope stack now hands DOM focus back to the focused element of the scope underneath on the next frame. An end-to-end test caught this.

## Phase 7: Tonight picker

**D-054 — Signal definitions** (2026-10-06, P7). Default weights are in `packages/core/src/picker-config.ts` and can be overridden under `[picker.weights]`.

| Signal | Applies when | Default weight |
| --- | --- | --- |
| inProgress | Game played ≤ 14 days ago; Jellyfin resume item with a position; next-up episode ("the next episode") | +40 |
| fitsTime | Game session fits the time; media fits (resume: "42 minutes left", else "1 hour 56 minutes long") | +6 |
| tooLong (games, soft) | Per length step beyond the time (short 30, medium 60, long 120 min) | −12 per step |
| fitsGroup | Profile size > 1 and the game has couch co-op | +8 |
| groupUnknown | Profile size > 1 and couch support is unknown (no store data, e.g. shortcuts) | −10 |
| controllerFriendly | Full controller support | +4 |
| noController | Partial or no controller support. Unknown is not penalised, so shortcuts are not punished for missing store data. | −15 |
| favourite | Favourite for the active profile | +20 |
| neglected | Game unplayed ≥ 60 days or never; unwatched movie added ≥ 60 days ago | +6 |
| recentlySkipped | A skip in the last 7 days | −30 |

"All evening" gives games no fitsTime boost, because every game fits and the reason would otherwise always read "plenty of time".

Hard filters:
- hidden items
- items already shown in this picker session
- the wrong type for "play" or "watch"
- media that is not a resume, next-up or unwatched movie
- media whose remaining runtime exceeds the time
- with more than one person on the couch, games known to lack couch co-op

**D-055 — Cards** (2026-10-06, P7).
1. **Best**: the top-ranked item.
2. **Finish what you started**: the best remaining item with an inProgress signal. If there is none, the next best item, labelled "Also good" (slot `runnerUp`, an addition to the brief's slots).
3. **Wildcard**: chosen from the top 8 remaining items, restricted to the other type (game or media) from card 1 when the answer was "either". The seed is local date + profile id + reroll page, so it is reproducible per evening and changes on reroll.

Ties break on the item key. A reason is the top two positive signals by score, written in reading order: time, then progress, then the rest ("42 minutes left, started on Tuesday"). With no positive signal the reason is "Ready to play", "Ready to watch" or "Something different tonight".

**D-056 — History** (2026-10-06, P7). Every returned card is recorded as `shown`. Rerolling sends the previous page's keys as `skipped`, which are recorded, and all keys shown so far as `exclude`. Choosing a card records `accepted`, then launches it. Skips older than 7 days are ignored, and skips are per profile.

**D-057 — Answers** (2026-10-06, P7). The last answers are stored in `app_setting` (`tonight.last`) and preselected and focused on each question; the defaults are 1 hour, the active profile, and either. Answering "Who is here?" also makes that profile active, since the people on the couch are the same. B steps back through the questions.

## Phase 8: Settings, polish, packaging

**D-058 — Settings** (2026-10-06, P8). Settings shows a health card each for Steam and Jellyfin (state, detail, paths, and where the config file lives), and an action row: Rescan library, text size A− / A+ (0.75–1.5 in steps of 0.05), and Profiles. Below them is the profile's hidden items, each of which can be unhidden. Text size is stored in `app_setting`, applied at once through the `--ui-scale` CSS variable, and overrides `ui.scale` without rewriting the config file. Secrets are never shown or editable in the UI. The state markers (●, ▲, ✕, ○) are shapes, so state is never conveyed by colour alone.

**D-059 — `doctor`** (2026-10-06, P8). The read-only boot creates no config file, uses an in-memory database, and its logger is quiet. `doctor` reports config warnings, the data directory, whether the service is running, each Steam root candidate tried, the user, libraries (flagging any not mounted), counts, Jellyfin status, the playback client, the kiosk command, and the kiosk's own shortcut id (used for `kiosk.restart_command`). It exits 1 when it finds a problem.

**D-060 — Installer helpers live in the executable** (2026-10-06, P8). `couch-launcher configure`, `kiosk-command [--shell]` and `config-path` keep paths and commands in one place, the platform module, so the shell and PowerShell scripts never duplicate them. `configure` edits only the `[jellyfin]` keys in place and keeps the file's comments. It reads the API key from `COUCH_JELLYFIN_API_KEY`, so the key never appears in a process list, and writes the file with mode 0600.

**D-061 — Windows installer details** (2026-10-06, P8).
- The executable has the GUI subsystem, so `install.ps1` calls it with `Start-Process -Wait -RedirectStandardOutput` to capture output.
- Sign-in start uses the `HKCU\Software\Microsoft\Windows\CurrentVersion\Run\CouchLauncher` value `"<exe>" serve`.
- `.lnk` shortcuts on the Desktop and in the Start menu are created through `WScript.Shell`.
- The script is written for Windows PowerShell 5.1: no `??`, no ternaries.
- It was parsed and dry-run with PowerShell 7.4 on Linux. PSScriptAnalyzer could not be installed because PowerShell Gallery is blocked from the VM.

**D-062 — Release layout** (2026-10-06, P8). `bun run build` produces two release folders:
- `out/linux/`: executable, `install.sh`, `couch-launcher.service`, `steam-input/`, `README.md`, `ON_DEVICE.md`
- `out/windows/`: executable, `install.ps1`, `README.md`, `ON_DEVICE.md`

Each installer finds the executable next to itself.

**D-063 — Steam Input layout delivery** (2026-10-06, P8). Steam only loads layouts from its own folders, and the brief forbids writing Steam's files, so the layout ships as a binding table with step-by-step instructions (`steam-input/README.md`). The equivalent `controller_mappings` VDF is included for reference and is parsed in a test. Whether Steam accepts that exact file is on the on-device list.

**D-064 — UI state flush on hide** (2026-10-06, P8). Besides the 250 ms debounced save, the UI flushes its screen and focus with a `keepalive` PUT on `pagehide` and on `visibilitychange` to hidden. The state is therefore current at the moment a game takes over, or if the browser is killed by the restart mitigation.

**D-065 — Optional dev tools installed in the VM** (2026-10-06, P8). Wine 9.0 (apt) and PowerShell 7.4.6 (GitHub release tarball under `/opt/pwsh`) were installed to exercise the Windows build and installer. Tests that need them skip cleanly when they are missing (`install-ps1.test.ts`; `scripts/wine-smoke.ts` is run by hand). `bun run check` needs neither.

**D-066 — One press launches; Detail lives in the Y menu** (2026-10-06, P8). Re-reading the brief at the end showed a conflict. Play says "One press launches" and Watch says "One press hands off to playback", yet the build first opened Detail on A, which took two presses. Now:
- A on any tile (Home Continue, Play, Watch) launches the game, or resumes the media at its saved position.
- Detail (hero art, summary, Play from start, Favourite, Hide, Session length) opens from the Y menu, whose first entry is "Details…".
- The Detail screen's own Y menu omits that entry.

The Tonight flow stays within five presses: Home, then A on Tonight, A ×3 for the answers, and A on a card.

**D-067 — Play shows last played and playtime** (2026-10-06, P8). The brief's Play screen shows "last played and playtime". Tiles stay artwork-only, so a line under the sort and filter row shows the focused game's title, last played and playtime (for example "Hades · Last played on Thursday · 36 h played"). The grid fills the remaining height in a flex column, so it always ends at the safe line.

**D-068 — Tonight reads its last answers fresh on each visit** (2026-10-06, P8). The full check caught a race: the stale-while-revalidate cache could show the previous visit's defaults, and focus settled on them before fresh data arrived. The last-answers fetch is now keyed by the navigation entry, so it is never served from a cache.
