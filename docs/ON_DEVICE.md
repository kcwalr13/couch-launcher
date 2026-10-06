# On-device checklist

Everything in this repository was built and tested in a Linux VM with no Steam, no Jellyfin, no controller and no display, against fixtures. This file lists what can only be checked on real hardware. Do the Windows checks first on the existing PC; do the Linux checks when the living-room box arrives.

Tick the boxes as you go. If something fails, run `couch-launcher doctor` and note its output next to the item.

## What is already verified, and how

So you know what you are *not* re-testing:

| Area | Verified by | Not verified |
| --- | --- | --- |
| Steam file parsing (library folders, manifests, `localconfig.vdf`, binary `shortcuts.vdf`, art layouts) | Fixtures through both platform implementations, plus a real Windows-runtime scan under Wine | That a current Steam client writes exactly these files and keys |
| Read-only access to Steam | Type-level, a call spy, a before/after hash snapshot, and an `strace` syscall trace | — |
| Launch commands | Exact commands asserted for Linux and Windows through an injected spawner. Under Wine, a missing `steam.exe` is reported as an on-screen error | That Steam receives the URL and brings the game to the front |
| Jellyfin API | A mock server built from the documented 10.11 routes and auth header | A real 10.11 server; Jellyfin Desktop accepting `PlayNow` |
| UI, focus, input | Playwright by keys and a Gamepad API shim at 1080p and 4K, with automatic ten-foot audits | A real TV, a real controller, Steam Input |
| Windows executable | Cross-compiled; run under Wine 9.0 (serve, scan via the registry, doctor, configure, kiosk-command) | Real Windows 10/11 |
| `install.sh` | Dry run, plus a real run into a scratch home with stand-in `systemctl`/`flatpak` | A real systemd user session and Flatpak |
| `install.ps1` | Parsed and dry-run with PowerShell 7 on Linux | Windows PowerShell 5.1, the registry Run key, `.lnk` creation |

## Windows PC (first real machine)

### Install

1. Download (or build with `bun run build`) the `out/windows` folder. It contains `couch-launcher-windows-x64.exe` and `install.ps1`.
2. In that folder run:
   `powershell -ExecutionPolicy Bypass -File .\install.ps1`
   - It asks for the Jellyfin URL and API key (Jellyfin: Dashboard → API Keys). The key is typed hidden and stored only in `%APPDATA%\couch-launcher\config.toml`.
   - The script performs or prints these steps:
     1. Copy the executable to `%LOCALAPPDATA%\couch-launcher\couch-launcher.exe`.
     2. Create the config file and set the Jellyfin URL and API key.
     3. Register the service to start at sign-in (`HKCU\...\Run\CouchLauncher`), with no administrator rights, and start it now.
     4. Create the "Couch Launcher" shortcut on the Desktop and in the Start menu. It opens Edge as a full-screen app window.
     5. Print the manual steps to add that shortcut to Steam as a non-Steam game for Big Picture.
     6. Run `doctor` (the report is also saved to `%LOCALAPPDATA%\couch-launcher\doctor.txt`).
3. In Steam, add the "Couch Launcher" shortcut as a non-Steam game. Also add **Jellyfin Desktop** as a non-Steam game, and keep "Jellyfin" in its name.

### Checks

- [ ] `install.ps1` completes on Windows PowerShell 5.1 with no errors, and `doctor.txt` is written. *(Only dry-run so far.)*
- [ ] After signing out and back in, the service is running (`http://127.0.0.1:7744` opens in a browser) and **no console window** is visible. *(The PE subsystem is GUI; the window behaviour is unverified on real Windows.)*
- [ ] `doctor` finds the Steam library (from the registry) and Jellyfin.
- [ ] The shortcut opens a full-screen Edge window with no address bar. *(D-016: `--app` + `--start-fullscreen` with its own profile.)*
- [ ] The controller reaches every screen and tile (Home, Play, Watch, Detail, Tonight, Profiles, Settings, the Y menu).
- [ ] A Steam game launches from the launcher, and quitting it returns to the launcher with focus where it was.
- [ ] A non-Steam shortcut (e.g. a Battle.net game) launches the same way. *(The 64-bit game id derivation is fixture-tested only.)*
- [ ] A Jellyfin item starts at the right position in Jellyfin Desktop. *(Remote-control `PlayNow` with `startPositionTicks` to Jellyfin Desktop is unverified; if it fails, set `playback.handoff = "web"` and sign in to the Jellyfin web client once in the Edge window.)*
- [ ] Pressing Play while Jellyfin Desktop is already open brings it to the front without opening a second copy. *(D-045.)*
- [ ] The Tonight picker gives sensible suggestions on the real library. Note any weights to tune in `[picker.weights]`.
- [ ] Store genres and categories load. After a few minutes, Settings → Steam shows the games; Play's "Couch co-op" filter is not empty. *(The live Steam store API was blocked in the build VM.)*

## Linux living-room box (SteamOS or Bazzite)

### Install

1. Copy the `out/linux` folder to the box (Desktop Mode). It contains `couch-launcher-linux-x64`, `install.sh`, `couch-launcher.service` and `steam-input/`.
2. Run `./install.sh` (try `./install.sh --dry-run` first to see every step). It performs or prints:
   1. Copy the executable to `~/.local/bin/couch-launcher`.
   2. Create the config file and prompt for the Jellyfin URL and API key.
   3. Install and enable the systemd user service.
   4. Install the Chromium Flatpak and grant it controller access (`--device=input`, or `--device=all` on Flatpak older than 1.15.6). Write `~/.local/bin/couch-launcher-kiosk`.
   5. Install Jellyfin Desktop (`org.jellyfin.JellyfinDesktop`). **Open it once in Desktop Mode and sign in.**
   6. Print the manual steps to add the kiosk wrapper and Jellyfin Desktop as non-Steam shortcuts and to apply the Steam Input layout. The script never edits Steam's shortcuts file.
3. Follow the printed step 6, then switch to Gaming Mode.

### Checks on the living room box

- [ ] The service starts with the session (`systemctl --user status couch-launcher`) and `couch-launcher doctor` finds the Steam library and Jellyfin.
- [ ] The controller moves focus in Gaming Mode using the key-mapped layout (`steam-input/README.md`).
- [ ] Starting a Steam game from the launcher brings the game to the front. *(`steam steam://rungameid/<id>` forwarding into the running Gaming Mode client is unverified.)*
- [ ] Quitting the game returns to the launcher with focus where it was.
- [ ] The controller still works in the launcher after returning from a game. If not:
  - [ ] Check whether key emulation survived but the Gamepad API did not (steam-for-linux#13665). With the key-mapped layout this should be fine.
  - [ ] If input is still dead, enable the browser restart mitigation in `~/.config/couch-launcher/config.toml`:
    ```toml
    [kiosk]
    restart_after_game = true
    restart_command = "steam steam://rungameid/<id printed by doctor for the Couch Launcher shortcut>"
    ```
    Restarting through the Steam shortcut keeps the browser inside Gaming Mode. The default command (`flatpak run org.chromium.Chromium --kiosk …`) starts it outside Steam and may not get focus.
- [ ] A non-Steam shortcut launches the same way.
- [ ] A Jellyfin item starts at the right position, a 4K file plays without transcoding (check Jellyfin Dashboard → Activity), and exiting returns to the launcher.
- [ ] Text is readable from the couch and nothing is cut off at the screen edges. If needed, change the text size in Settings (A− / A+) or `ui.scale`.
- [ ] The Tonight picker gives sensible suggestions on the real library. Note any weights to tune.

### Extra Linux checks (unverified assumptions)

- [ ] The Chromium kiosk flags (D-014) give a borderless full-screen window in Gaming Mode, with no first-run or crash bubbles.
- [ ] If the Steam Input layout is not used, the Gamepad API sees the controller in the Chromium Flatpak after `flatpak override --device=input`.
- [ ] The current Steam client's art is found. Check that games show cover art; `doctor` lists the library, and missing art shows title text instead. *(Layouts per D-020.)*
- [ ] Playtime and "last played" match Steam's own library. *(`localconfig.vdf` keys `Playtime` and `LastPlayed`.)*
- [ ] With several Steam accounts, the right one is used (set `steam.user_id` otherwise).
- [ ] With several Jellyfin users, set `jellyfin.user_id`; otherwise the first enabled user is used (D-031).
- [ ] `steam-input/couch_launcher_keyboard.vdf` matches what Steam saves for the hand-made layout. This only matters if you want to share the file; nothing loads it automatically.

## Input bridge (only if all else fails)

If the controller cannot be kept working in the browser, the last-resort design is documented in `docs/DESIGN.md` under "Input-loss mitigations": the service would read the controller and push actions over a WebSocket. It is not built in v1.
