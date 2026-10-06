# Couch Launcher: Build Brief

Oct 3, 2026 · @Kyle Walraven

## How to use this brief

This brief is the complete input for one Claude Code session to build Couch Launcher v1 end to end. No further human input is expected until the on-device checklist.

- Read the whole brief before writing code. Save it in the repo as `docs/BRIEF.md` and treat it as the source of truth.
- Work the phases in order. A phase is finished only when every acceptance criterion passes and the full check script is green. Commit at the end of each phase.
- Keep three living files: `CLAUDE.md` (conventions and commands), `docs/DESIGN.md` (how it is built, updated each phase), and `docs/DECISIONS.md` (a dated log of every choice made where the brief was silent or wrong).
- Where the brief says "verify", check current documentation or the real file format before relying on it. If reality differs from the brief, follow reality and log it.
- Do not stop to ask questions. Take the default from the Assumptions and open decisions section, log it, and continue.
- Never write to Steam's own files. All Steam access is read-only.
- If a secret is missing (the Jellyfin API key, for example), build and test against mock mode instead of stopping.
- Finish with a working repo, passing tests, a README install guide, and a filled-in `docs/ON_DEVICE.md`.

## Product vision

Couch Launcher is a controller-first home screen for the living room TV that answers one question: what should we play or watch tonight?

It runs as a full-screen web app on the living room gaming PC, started from Steam's Gaming Mode like any other game. On Windows it runs the same way from Big Picture or a desktop shortcut. It shows installed games and the Jellyfin library side by side and starts either with one button press.

These principles settle trade-offs, in this order:

1. **Controller only.** Every daily action works with a D-pad and two buttons. No keyboard, mouse, or text entry.
2. **Fast to a decision.** From opening the launcher to something running takes under 30 seconds and at most five button presses.
3. **Readable from the couch.** Designed for a 4K TV viewed from about three metres.
4. **Local and private.** Everything runs on the home network. It keeps working with the internet down, apart from artwork not yet cached.
5. **Explainable picks.** Every suggestion says why it was chosen.
6. **Small.** One service, one config file, no accounts, no telemetry.

## Environment and constraints

The target machine has not been bought yet, so v1 must be fully buildable and testable on a development machine using fixtures.

| Area | What is known | Consequence for the build |
| --- | --- | --- |
| Target PC | A dedicated living room box running SteamOS or Bazzite in Gaming Mode, OS undecided. Hardware not yet purchased. Until then an existing Windows PC is the first real machine. | Keep platform specifics behind one adapter with Linux and Windows implementations. Windows can be checked on real hardware first. Linux checks wait for the box. |
| Operating system | Both Linux candidates have an immutable root filesystem. Windows has no such limit. | On Linux, install entirely under the home directory with no system packages. On Windows, install per user with no administrator rights. |
| Display | 4K TV. | Lay out for 3840x2160 and 1920x1080. Scale the UI with the viewport. |
| Input | A wireless controller, almost always. | Keyboard events and the Gamepad API are both first-class input paths. See the input risk under Architecture. |
| Network | The PC is wired to a router in the living room. | The NAS is reachable on the LAN. No internet dependency at runtime beyond artwork and store metadata. |
| Media | Jellyfin runs on a UGREEN DXP2800 NAS. | Use the Jellyfin REST API. Server URL and API key live in the config file. |
| Games | A Steam library, plus non-Steam shortcuts added to Steam (Battle.net titles, for example). | Read both Steam app manifests and the shortcuts file. |

## Scope

v1 is four things: a unified home screen, a games shelf, a watch shelf, and the Tonight picker.

**In v1**

- **Home:** a Continue row mixing recently played games with Jellyfin resume items, plus a Tonight button.
- **Play:** installed Steam games and non-Steam shortcuts with artwork, last played and playtime. One press launches.
- **Watch:** Jellyfin Continue Watching, Next Up and Recently Added. One press hands off to playback.
- **Tonight:** a three-question picker that returns three suggestions, each with a reason.
- **Profiles:** named couch groups with their own favourites and hidden items.
- **Settings:** connection status, rescan and UI scale, all reachable by controller. Secrets stay in the config file.
- **Mock mode:** the whole app runs from fixtures with no Steam or Jellyfin present.
- **Platforms:** Linux (SteamOS and Bazzite) and Windows, from one codebase.

**Later (leave room in the design, do not build)**

- A natural-language mood prompt backed by an LLM.
- A phone page that works as a remote.
- Owned but uninstalled games, with an install prompt.
- Other stores as extra adapters.
- A NAS health tile.

**Out**

- A media player of its own. Playback is handed to Jellyfin.
- Replacing Gaming Mode or booting straight into the launcher.
- Installing, uninstalling or editing anything in Steam.
- Cloud accounts, sync between devices, or analytics.

## Experience

The whole UI is a grid of focusable tiles moved by D-pad, with A to select and B to go back.

**Screens**

| Screen | Purpose | Contents |
| --- | --- | --- |
| Home | Landing screen | Tonight button (default focus), Continue row, entries to Play and Watch, active profile chip |
| Play | Browse games | Grid of installed games and shortcuts. Sort by recent, A to Z, or playtime. Filter by couch co-op and controller support. |
| Watch | Browse media | Rows for Continue Watching, Next Up, Recently Added Movies, Recently Added Shows |
| Tonight | Decide quickly | Three questions, then three result cards and a reroll |
| Detail | One item | Hero art, summary or pick reason, primary action (Play, Resume, or Play from start), favourite and hide |
| Profiles | Who is on the couch | Switch the active profile |
| Settings | Health and options | Steam library status, Jellyfin status, rescan, UI scale |

**Controller map**

| Input | Action |
| --- | --- |
| D-pad or left stick | Move focus |
| A | Select |
| B | Back |
| X | Open the Tonight picker from anywhere |
| Y | Item options: favourite, hide, set session length |
| LB and RB | Switch between Home, Play and Watch |
| Start | Settings |

The Steam or guide button is reserved by Steam and must not be bound.

**Ten-foot rules**

- Body text is at least 28 px at 1080p and scales with the viewport. Keep a 5% safe margin on every edge.
- The focused tile is unmistakable: scaled up and ringed, never marked by colour alone.
- Focus is never lost. Every screen has a default focus, and going back restores the previous focus.
- Spatial navigation is deterministic. Moving up or down remembers the column. Rows do not wrap.
- No hover states, scroll bars, pointer-only controls or text fields.
- Holding a direction repeats after 400 ms at eight steps per second.
- Every tile has a text fallback for missing artwork.
- Dark theme only, with text contrast of at least 7:1.
- Input to visible focus change takes under 100 ms. Use skeleton tiles, not spinners.

**Visual direction:** calm, dark and artwork-led, with the interface receding behind the cover art and one accent colour. Settle a distinct identity in the UI phase and record it in `docs/DESIGN.md`.

## Tonight picker

The picker asks three questions and returns three suggestions with reasons, using deterministic scoring that can be unit tested.

**Questions** (one press each, with the last answer preselected)

1. How long do you have? 30 minutes, 1 hour, 2 hours, or all evening.
2. Who is here? Pick a profile.
3. Play, watch, or either?

**Candidates**

- Games: installed Steam games and shortcuts not hidden for the active profile.
- Media: Jellyfin resume items, next-up episodes and unwatched movies.

**Signals**

| Signal | Source | Effect |
| --- | --- | --- |
| In progress | Game played in the last 14 days, or a Jellyfin resume item | Strong boost |
| Fits the time | Media: remaining runtime. Games: session-length tag (short, medium, long). | Hard filter for media, soft penalty for games |
| Fits the group | Steam store categories such as shared or split-screen co-op, against profile size | Filter when the profile has more than one person |
| Controller friendly | Steam store category for full controller support | Penalty when absent |
| Favourite | Per-profile preference | Boost |
| Neglected | Installed but unplayed for 60 days, or added and never watched | Small boost for variety |
| Recently skipped | Suggestion history | Penalty for 7 days |

**Session length for games:** derive a default from Steam store genres through a small mapping table in the config file. Let the user override it per game from the Detail screen. No external time-to-beat service in v1.

**Output**

- Card 1 is the best overall match.
- Card 2 is the best "finish what you started" item, when one exists.
- Card 3 is a wildcard, of the other type when the answer was "either".
- Each card shows a one-line reason built from its top two signals, such as "42 minutes left, started on Tuesday".
- Reroll shows the next three. Choosing a card records an accept. Rerolling records skips.

**Implementation rules**

- Scoring is a pure function: candidates, context, weights and the current time in; a ranked list with reasons out.
- Weights live in the config file with sensible defaults.
- Ties break on a stable item key. The wildcard uses a seed of date plus profile, so results are reproducible in tests.

## Architecture

One local service on the gaming PC serves the UI, reads Steam and Jellyfin, and performs every launch. A kiosk browser, added to Steam as a non-Steam shortcut, displays it.

&#91;embedded content: architecture · 6 components on the PC, 1 on the NAS\]

The browser only ever talks to the local service. The service is the one place that reads Steam, calls Jellyfin and starts things.

**Components**

| Component | Responsibility | Notes |
| --- | --- | --- |
| Kiosk browser | Shows the web UI full screen inside Gaming Mode | A Chromium-based browser started in kiosk mode at the localhost URL. Platform details are in the table below. |
| Web UI | Screens, focus engine, input handling | Talks only to the local API. |
| Local service | HTTP API on 127.0.0.1, aggregation, caching, launching | Runs unsandboxed on the host and starts with the user session. |
| Steam adapter | Reads library folders, app manifests, playtime and last played, the shortcuts file, and the local artwork cache | Read-only. The Steam root path is configurable. Verify each file format, including the binary shortcuts format. |
| Store metadata | Fetches genres and categories per app from Steam's public store data | Cache in SQLite, refresh every 30 days, rate-limit requests, and work offline from the cache. |
| Jellyfin adapter | Resume, Next Up, Latest and item images | REST with an API key. Verify endpoints and the auth header against current Jellyfin documentation. |
| Launcher | Starts games and playback | The service runs the launch command itself. The browser never opens a `steam://` link. |
| Store | Profiles, preferences, suggestion history, metadata cache | One SQLite file under the user data directory. |
| Mock adapters | Fixture-backed versions of every adapter | Enabled with one environment variable. |

**Platforms**

Linux and Windows share everything except one `Platform` interface with two implementations.

| Concern | Linux (SteamOS, Bazzite) | Windows |
| --- | --- | --- |
| Steam root | Under the home directory. Verify the candidate paths. | Read from the registry, with the default install path as fallback. Verify. |
| Launch command | The Steam executable with a `steam://rungameid/` URL | The same URL opened through the shell, or the Steam executable directly. Verify. |
| UI shell | Chromium-based Flatpak in kiosk mode, added to Steam as a non-Steam shortcut for Gaming Mode | Edge or Chrome in kiosk or app mode, started from a shortcut that can also be added to Steam for Big Picture |
| Service lifetime | systemd user service | Starts at sign-in through a per-user startup entry. No administrator rights. |
| Config and data | `~/.config/couch-launcher` and `~/.local/share/couch-launcher` | `%APPDATA%\couch-launcher` and `%LOCALAPPDATA%\couch-launcher` |
| Input | Key-mapped Steam Input layout first, Gamepad API second | Gamepad API works directly. Keys remain supported. |
| Jellyfin client | Jellyfin Desktop Flatpak | Jellyfin Desktop for Windows |

- No platform checks outside the platform module.
- Both implementations are tested on any host through an injected filesystem and process spawner.
- Paths are built with the runtime's path utilities, never by joining strings.

**Input: a known platform risk**

Treat keyboard events as the primary input path and the Gamepad API as the second.

A [Steam issue opened on Sep 29, 2026](https://github.com/ValveSoftware/steam-for-linux/issues/13665) reports that in Gaming Mode, launching any app recreates Steam Input's virtual gamepad. Flatpak apps already running then lose controller input until relaunched. That is exactly the launcher's situation after it starts a game. The risk is specific to Linux and does not apply on Windows.

Mitigations, in order:

1. Ship a Steam Input layout for the launcher shortcut that maps the controller to keys: D-pad to arrows, A to Enter, B to Escape, the rest to letters. The UI handles those keys natively. Whether key emulation survives the bug is unverified and goes on the on-device checklist.
2. Keep Gamepad API support for setups where it works.
3. Make UI state restorable (current screen and focused item saved to the service). If input still dies, the service restarts the kiosk browser when the launched game exits.
4. Last resort: an input bridge, where the unsandboxed service reads the controller and pushes events to the UI over a WebSocket.

Build 1, 2 and the restorable state from 3 in v1. Document 4 as an option.

**Launching games**

- Steam games: the service runs the Steam launch command with the app id. Verify the exact form.
- Non-Steam shortcuts: these need a 64-bit game id derived from the shortcut's own app id. Verify the derivation and cover it with a fixture test.
- After a launch the UI shows a Launching state, then refreshes its data when it becomes visible again.

**Playback handoff**

- Default: start Jellyfin Desktop, the native client, through its own Steam shortcut. A native player suits 4K and HDR files better than a browser.
- To land on the chosen item, try Jellyfin's remote-control session API: wait for the client's session to appear, then send a play command with the item and resume position. Verify this works with the current client.
- Fallback: open the item's page in Jellyfin's web client in the kiosk browser.
- Keep the handoff behind one interface with both implementations, selected in the config file.

## Data model and config

Everything the UI shows is one unified item type, keyed by source, with preferences stored per profile.

**Item keys:** `steam:<appid>`, `shortcut:<id>`, `jellyfin:<itemId>`.

**Unified item (API shape)**

| Field | Meaning |
| --- | --- |
| `key` | Source-prefixed id |
| `kind` | `game`, `movie` or `episode` |
| `title`, `subtitle` | Display text. Subtitle carries series and episode for TV. |
| `art` | Poster and hero image URLs, served through the local art proxy |
| `lastActivityAt` | Last played or last watched |
| `progress` | Position and duration in seconds, for media |
| `playtimeMin` | Total playtime, for games |
| `tags` | Genres, co-op, controller support, session length |
| `launch` | What the launcher should do for this item |

**SQLite tables**

| Table | Columns |
| --- | --- |
| `profile` | id, name, size, is\_default |
| `item_pref` | profile\_id, item\_key, favourite, hidden, session\_length\_override |
| `suggestion_event` | id, ts, profile\_id, item\_key, action (shown, accepted, skipped) |
| `metadata_cache` | item\_key, source, json, fetched\_at |
| `ui_state` | profile\_id, screen, focused\_key, updated\_at |

**API**

| Method and path | Purpose |
| --- | --- |
| `GET /api/home` | Continue row and active profile |
| `GET /api/games` | Installed games and shortcuts, with sort and filter |
| `GET /api/watch` | Jellyfin rows |
| `GET /api/items/:key` | Detail for one item |
| `POST /api/launch/:key` | Start a game or playback |
| `POST /api/tonight` | Run the picker with the three answers |
| `GET` and `POST /api/profiles` | List and switch profiles |
| `POST /api/prefs` | Favourite, hide, session length override |
| `GET` and `PUT /api/ui-state` | Save and restore screen and focus |
| `GET /api/status`, `POST /api/rescan` | Health of each source, forced refresh |
| `GET /api/art/:key/:kind` | Artwork proxy with a disk cache |

**Config file:** `~/.config/couch-launcher/config.toml` on Linux, and the same file under %APPDATA%\\couch-launcher on Windows. Created with defaults on first run.

- `server.port`
- `steam.root` and `steam.user_id` (auto-detected when blank)
- `jellyfin.url`, `jellyfin.api_key`, `jellyfin.user_id`
- `playback.handoff` (`client` or `web`)
- `ui.scale`
- `picker.weights` and `picker.genre_session_map`

Secrets live only in the config file. Never copy them into SQLite, logs or API responses.

## Tech stack and repo layout

TypeScript end to end, shipped as a single self-contained executable so nothing needs installing on an immutable OS.

| Layer | Choice | Reason |
| --- | --- | --- |
| UI | React, Vite, Tailwind CSS | Familiar stack. A static bundle the service can embed. |
| Focus and input | A small spatial-navigation module of our own, or an existing TV navigation library if one fits | Focus behaviour is the product, so it must be fully testable. |
| Service | Bun, using its built-in HTTP server and SQLite | Can compile to one executable with the UI embedded. Build one per platform: Linux x64 and Windows x64. Verify this in Phase 1. Fall back to Node with a bundled runtime if it fails. |
| Steam file parsing | Text and binary VDF parsers, from a maintained package or written in-repo | Small formats, fully covered by fixtures. |
| Tests | The runtime's test runner for unit and API tests, Playwright for the UI | Playwright drives the UI by keyboard and takes screenshots. |
| Quality | Strict TypeScript, a linter and a formatter, one `check` script that runs everything | One command gates every phase. |

```text
couch-launcher/
  CLAUDE.md
  README.md
  docs/            BRIEF.md  DESIGN.md  DECISIONS.md  ON_DEVICE.md
  apps/web/        UI: screens, focus engine, input
  apps/server/     API, adapters, launcher, config
    platform/      linux.ts  windows.ts  (the only platform-specific code)
  packages/core/   item types and picker scoring (pure, no I/O)
  fixtures/        steam/  jellyfin/
  scripts/         check, make-fixtures, install.sh, install.ps1, doctor
  steam-input/     controller layout for the launcher shortcut
```

## Build phases

Nine phases in order, each ending in a commit with the `check` script green and its acceptance criteria evidenced in `docs/DESIGN.md`.

| Phase | Builds | Done when |
| --- | --- | --- |
| 0. Foundations | Repo, tooling, `CLAUDE.md`, `check` script, config loader, mock-mode skeleton | `check` passes. The server starts in mock mode and answers `GET /api/status`. |
| 1. Spikes | Short investigations of every "verify" in this brief: single-executable build, binary shortcuts parsing, shortcut game id, Jellyfin endpoints and auth, playback handoff, kiosk flags and controller permission, plus the Windows equivalents: Steam path lookup, launch command, kiosk browser and start at sign-in | Each spike has a written conclusion in `docs/DECISIONS.md` and, where code is possible, a passing test. |
| 2. Steam adapter | Library folders, manifests, playtime, shortcuts, artwork resolution, store metadata cache, Steam root discovery on both platforms | Fixtures produce the exact expected item list under both platform implementations. Missing artwork falls back cleanly. A test proves no file under the Steam root is opened for writing. |
| 3. Jellyfin adapter | Resume, Next Up, Latest, images, status | Fixture responses map to unified items. With the server unreachable, status reports it and Watch shows cached items or an empty state. |
| 4. UI shell and focus | Home, Play, Watch, Detail, keyboard and gamepad input, artwork proxy | Playwright reaches every screen and tile by keys alone. A focused element exists after every input. Screenshots pass the ten-foot rules at 1080p and 4K. |
| 5. Launching | Launch endpoint, platform commands, Launching state, playback handoff, UI state save and restore | Tests assert the exact command for Linux and for Windows through an injected process spawner. Errors appear as on-screen messages. Reloading the page restores screen and focus. |
| 6. Profiles and preferences | Profiles screen, favourites, hidden items, session length override | Preferences persist across a restart and are isolated per profile. |
| 7. Tonight picker | Questions, scoring, reasons, reroll, suggestion history | One unit test per signal. A golden test for a fixed fixture evening. Skipped items drop for 7 days. |
| 8. Settings, polish, packaging | Settings screen, `doctor` command, install scripts for Linux and Windows, systemd user unit, Windows startup entry, Steam Input layout, README, `docs/ON_DEVICE.md` | A fresh clone builds one executable per platform. `install.sh --dry-run` prints every step. Warm `GET /api/home` answers in under 200 ms on fixtures. |

## Testing and verification

Everything before the hardware arrives is verified against fixtures, so the session can prove its own work.

- **Fixtures:** a synthetic Steam root with two library folders, about a dozen app manifests, a playtime file, a binary shortcuts file with two entries and a few cached images. Add recorded-shape Jellyfin JSON for each endpoint. A script generates them and they are committed.
- **Unit tests:** parsers, item mapping and picker scoring, as pure functions with a fixed clock. Platform code is tested for both Linux and Windows on any host.
- **API tests:** every endpoint against the mock adapters. Launch commands are asserted through an injected process spawner, never run.
- **UI tests:** Playwright drives the app with key events. A small shim fakes the Gamepad API so the polling path is tested too.
- **Visual review:** capture each screen at 1080p and 4K, check the captures against the ten-foot rules, and fix what fails.
- **Phase gate:** `check` is green and each acceptance criterion has its evidence noted in `docs/DESIGN.md`.
- **Optional smoke test:** if a real Steam install exists on the development machine, `doctor` prints what it finds, read-only.

## Install and on-device checklist

This is the only part that needs a person and a real machine. The Windows checks can be done first, on the existing PC. The session prepares it as `docs/ON_DEVICE.md` and a scripted install.

**Linux install steps the script performs or prints**

1. Copy the executable to `~/.local/bin/couch-launcher`.
2. Create the config file and prompt for the Jellyfin URL and API key.
3. Install and enable the systemd user service.
4. Install a Chromium-based browser Flatpak and grant it controller access.
5. Install Jellyfin Desktop and sign in once in Desktop Mode.
6. Print the manual steps to add the kiosk browser as a non-Steam shortcut and apply the Steam Input layout. The script must not edit Steam's shortcuts file.

**Checks on the living room box**

- [ ] The service starts with the session and `doctor` finds the Steam library and Jellyfin.
- [ ] The controller moves focus in Gaming Mode using the key-mapped layout.
- [ ] Starting a Steam game from the launcher brings the game to the front.
- [ ] Quitting the game returns to the launcher with focus where it was.
- [ ] The controller still works in the launcher after returning from a game. If not, enable the browser restart mitigation.
- [ ] A non-Steam shortcut launches the same way.
- [ ] A Jellyfin item starts at the right position, a 4K file plays without transcoding, and exiting returns to the launcher.
- [ ] Text is readable from the couch and nothing is cut off at the screen edges.
- [ ] The Tonight picker gives sensible suggestions on the real library. Note any weights to tune.

**Windows install steps the script performs or prints**

1. Copy the executable to a per-user folder under `%LOCALAPPDATA%\couch-launcher`.
2. Create the config file and prompt for the Jellyfin URL and API key.
3. Register the service to start at sign-in, without administrator rights.
4. Create a shortcut that opens the UI in a kiosk or app-mode browser window.
5. Print the manual steps to add that shortcut to Steam as a non-Steam game for Big Picture.

**Checks on the Windows PC**

- [ ] `doctor` finds the Steam library and Jellyfin.
- [ ] The controller reaches every screen and tile.
- [ ] A Steam game and a non-Steam shortcut both launch, and quitting returns to the launcher.
- [ ] A Jellyfin item starts at the right position.
- [ ] The Tonight picker gives sensible suggestions on the real library.

## Assumptions and open decisions

Every open decision has a default so the build never blocks. Change any of them here before handing off.

| Decision | Default | Alternative |
| --- | --- | --- |
| Name | Couch Launcher. Confirmed on Oct 6, 2026. | Closed. |
| Operating system | Undecided between SteamOS and Bazzite, so build for both. Windows is also a v1 target, decided on Oct 6, 2026. | Drop the unused Linux variant once the box's OS is chosen. |
| Where the service runs | On the living room PC | On the NAS in a container, with a thin launch agent on the PC |
| Playback | Hand off to Jellyfin Desktop | A built-in player inside the launcher |
| Session length for games | Genre mapping plus manual override | Look up time-to-beat data from an external service |
| Owned but uninstalled games | Not shown | Shown, with an install prompt through Steam |
| Steam Web API key | Not used. Local files and public store data only. | Use it for the full owned-games list and richer playtime |
| Profiles | Three presets: Solo, Two of us, Group | Named profiles for specific people |
| Picker intelligence | Deterministic scoring | An LLM mood prompt on top of the scoring |
| Visual identity | Claude Code decides within the stated direction | Supply reference screenshots or a palette |
