# Design

How Couch Launcher is built. Updated at the end of every phase, with acceptance evidence.

## Overview

One Bun process (`apps/server`) listens on 127.0.0.1, serves the React UI (`apps/web`) and the JSON API, reads Steam and Jellyfin, and performs launches. Pure domain logic (item types, keys, picker scoring) lives in `packages/core`.

```
kiosk browser ──HTTP──> local service ──read-only──> Steam files
                          │  ├────────REST─────────> Jellyfin (NAS)
                          │  └──spawn──────────────> steam / Jellyfin Desktop
                          └── SQLite (profiles, prefs, history, caches, UI state)
```

### Service wiring

- `main.ts` parses the sub-command (`serve`, `doctor`, `version`).
- `bootstrap.ts` reads the environment, loads config, picks the host platform, opens the store and calls `createApp`.
- `createApp(deps)` builds the router. All dependencies are injected (`Config`, `Platform`, `Store`, `Clock`, `Logger`), so API tests call `app.fetch(new Request(...))` with no network.
- Non-API GETs serve the UI: embedded base64 bundle in compiled executables, `apps/web/dist` from disk when running from source.

### Config

`config.ts` merges the TOML file over defaults with per-key validation; bad values produce warnings and keep the default. First run writes a commented default file (mode 0600). `redactConfig` and the scrubbing logger keep the API key out of logs.

### Platform

`platform/types.ts` defines `Platform` and its injected deps (`ReadFs` with no write methods, `ProcessRunner`, env, home). `linux.ts` uses `path.posix`, `windows.ts` uses `path.win32`; both are tested on any host. `platform/index.ts` holds the only `process.platform` check.

### Store

`db.ts` creates the brief's tables plus `app_setting` (D-004) and seeds the three preset profiles.

### Steam adapter

`adapters/steam/`:
- `vdf.ts`: text and binary KeyValues parsers, with case-insensitive accessors.
- `steam.ts`: finds the root (via `platform.findSteamRoot`), the user, library folders, manifests, `localconfig.vdf` playtime and last played, and `shortcuts.vdf`.
- `art.ts`: local art resolution.
- `store-metadata.ts`: appdetails fetch and cache, rate-limited, offline-tolerant.
- `items.ts`: maps a scan plus store metadata to `UnifiedItem`.

`services/library.ts` caches the scan (15 s TTL), filters runtimes and utility shortcuts, overlays per-profile prefs, and sorts.

### Jellyfin adapter

`adapters/jellyfin/client.ts` is the REST client: it builds the auth header, applies timeouts and classifies errors. `adapters/jellyfin/jellyfin.ts` (`JellyfinSource`) does the rest:
- picks the user
- fetches the rows in parallel and maps each item to a `UnifiedItem` with key `jellyfin:<Id>`, kind movie or episode, subtitle `S2:E4 · Title` or `2016 · PG-13 · 1 h 56 min`, progress and launch position
- caches the rows (D-033)
- reports status (D-034)
- fetches images
- provides the remote-control calls the handoff uses (`sessions`, `play`, `webUrl`)

`GET /api/watch` applies the active profile's hidden items.

### Web UI

`apps/web/src`:
- `App.tsx`: the navigation stack (tabs Home, Play and Watch are roots that remember their focus; Detail, Tonight, Profiles and Settings are pushed on top), global actions, the backdrop, the Y options overlay, the Launching overlay, and on-screen messages.
- `focus/`: the pure engine, the React scopes, and deterministic scrolling.
- `input/`: action bindings, the repeater, and `InputController` (keyboard plus Gamepad API polling).
- `screens/`: one component per screen; each declares its focus rows.
- `useApi.ts`: stale-while-revalidate fetches. A `refreshToken` refetches everything when the page becomes visible again after a launch.

The visual identity ("Lamplight") is described in DECISIONS D-041. Screenshots are in `docs/screenshots/`.

Screen layouts:

| Screen | Focus rows |
| --- | --- |
| Home | [Tonight, Play, Watch, profile chip] / Continue tiles |
| Play | [sort ×3, co-op filter, controller filter] / grid rows of 6 |
| Watch | ([Try again, Settings] when Jellyfin has a problem) / Continue Watching / Next Up / Movies / Shows |
| Detail | [Play or Resume, Play from start, Favourite, Hide, Session length] |
| Options (Y) | Favourite / Hide / session length chips / Close |

### Launching and playback

`services/launcher.ts` (`Launcher`):
- **Games and shortcuts:** `platform.steamLaunchCommand(steamRoot, appId | 64-bit gameId)`, spawned detached through the injected `ProcessRunner`.
- **Media, `handoff = "client"`:**
  1. Check Jellyfin is reachable.
  2. Start Jellyfin Desktop, choosing in this order: its non-Steam shortcut (via `steam://rungameid/`), `playback.client_command`, or the platform default.
  3. Poll `/Sessions` for a remote-controllable Jellyfin Desktop or Media Player session.
  4. `POST /Sessions/{id}/Playing?playCommand=PlayNow&itemIds=…&startPositionTicks=…`.
- **Media, `handoff = "web"`:** return the item's `…/web/#/details?id=…` URL for the kiosk browser to open.
- **Linux, optional:** watch for the game to exit and restart the kiosk browser (D-049).

### Input-loss mitigations (brief, "Input: a known platform risk")

1. **Key-mapped Steam Input layout.** Keyboard is the primary input path. The layout ships in `steam-input/` (Phase 8).
2. **Gamepad API.** Polled every animation frame; built.
3. **Restorable UI state.** Built (D-048). The opt-in kiosk restart after a game exits is also built (D-049).
4. **Input bridge.** Not built. The design, if it is ever needed:
   - The unsandboxed service reads the controller from `/dev/input/event*` via evdev, or SDL through a small helper.
   - It maps the controller to the same actions as the keyboard.
   - It pushes the actions to the UI over a WebSocket on `/api/input`.
   - The UI feeds them into `InputController` exactly like key events.

   No UI changes would be needed beyond subscribing to the socket.

### Tonight picker

`packages/core/src/picker.ts` is pure. `pickTonight(candidates, context)` takes the profile-applied items and a context (time, mode, profile, weights, skips map, exclusions, page, now, UTC offset). It applies the hard filters (`excludedBecause`), scores the signals (`signalsFor`), ranks with a key tie-break, and builds the cards with reasons (`reasonFor`) and the seeded wildcard. The service (`POST /api/tonight`) adds history and answer persistence; the UI (`screens/Tonight.tsx`) is three one-press questions and then three cards plus "Show three more" and "Start over". See D-054 to D-057.

### Fixtures and mock mode

`scripts/make-fixtures.ts` generates everything under `fixtures/` relative to `FIXTURE_NOW = 2026-10-03T19:00Z`:
- 12 games plus 3 runtimes, across two libraries
- two Steam users
- a binary shortcuts file with 4 entries
- art in every librarycache layout: new, flat, hashed, header-only, none
- store appdetails JSON
- Jellyfin JSON and images

`mock/mapped-fs.ts` mounts the Steam tree at virtual Linux or Windows paths (D-029).

## Phase acceptance evidence

### Phase 0 — Foundations

- `bun run check` green: biome, tsc (4 projects), `bun test` (12 tests), vite build, Playwright smoke test.
- Server starts in mock mode and answers `GET /api/status` (`apps/server/test/status.test.ts`, and the Playwright web server waits on `/api/status`).
- Config loader: defaults, first-run creation, overrides, warnings, unparseable file, redaction (`config.test.ts`).

### Phase 1 — Spikes

Each spike's conclusion is in `docs/DECISIONS.md` D-008 to D-022. Code and tests:

| Spike | Code | Evidence |
| --- | --- | --- |
| Single executable (Linux + Windows) | `scripts/build.ts` | Both targets compile. The Linux binary served the UI and API and created its database. The Windows `.exe` ran under Wine (`scripts/wine-smoke.ts`: version, `/api/status` reporting `platform: "windows"`, embedded UI). |
| Binary shortcuts parsing | `adapters/steam/vdf.ts` | `vdf.test.ts`: hand-assembled bytes, round trip, malformed input |
| Shortcut game id | `adapters/steam/gameid.ts` | `gameid.test.ts`: CRC check value, signed→unsigned, 64-bit id, legacy id |
| Jellyfin endpoints and auth | `adapters/jellyfin/client.ts` | `jellyfin-client.test.ts`: header, key never in the URL, error classes |
| Playback handoff | design in D-013 | Implemented in Phase 5 |
| Kiosk flags, controller permission | `platform/linux.ts`, `platform/windows.ts` | `platform-commands.test.ts` |
| Windows Steam path | `platform/windows.ts` `findSteamRoot` | `platform-commands.test.ts`. Parser checked against real `reg.exe` output under Wine. |
| Windows launch command | `platform/windows.ts` | `platform-commands.test.ts` |
| Windows start at sign-in | D-017 | Implemented in `install.ps1` (Phase 8) |

### Phase 2 — Steam adapter

- **Exact item list under both platforms**: `steam-adapter.test.ts` runs the real adapter against the fixtures mounted at Linux paths and at Windows paths. It asserts the same 12 games (app id, title, playtime, last played) and 4 shortcuts (32-bit id, title, 64-bit game id computed independently in Python, last played). Libraries, user selection and the configured-user override are covered too.
- **Missing artwork falls back cleanly**: every layout resolves (new, flat, hashed subfolder, header-only), and Lethal Company and StarCraft II resolve to `null`, which the art proxy turns into the UI's text fallback in Phase 4.
- **No file under the Steam root is opened for writing**, shown three ways:
  1. `ReadFs` has no write methods.
  2. A Proxy spy shows only `exists/stat/readFile/readText/readdir` are called, and a SHA-1 + mtime snapshot of `fixtures/steam` is identical after a full scan.
  3. An `strace -f` trace of a full scan plus art reads (`test/support/scan-fixture.ts`) shows no `O_WRONLY`, `O_RDWR`, `O_CREAT`, `O_TRUNC`, unlink, rename, mkdir or truncate under the Steam tree.
- **Store metadata cache**: `store-metadata.test.ts` covers the request gap, the 30-day refresh, offline use of the cache, 429 backoff, and unavailable apps not being refetched.
- **API**: `games-api.test.ts` covers sort (recent, A–Z, playtime), co-op and controller filters, and status.
- **Windows runtime (Wine)**: `scripts/wine-smoke.ts`, run with the cross-compiled `.exe`:
  - Mock mode: fixtures at `C:\Program Files (x86)\Steam`, 16 items.
  - Real mode: fixtures copied onto the Wine C: and D: drives. The Steam root comes from `HKCU\Software\Valve\Steam\SteamPath` through the real `reg.exe`, both libraries are found, and `/api/games` lists 14 games.

### Phase 3 — Jellyfin adapter

- **Fixture responses map to unified items**: `jellyfin-adapter.test.ts` checks all four rows, including order, titles, subtitles, progress, launch position, dates, genres, list membership and art URLs. It also checks that unsupported types are dropped, that the user is auto-detected and sent on every call, and that a configured user skips the lookup.
- **Server unreachable**:
  - With a previous fetch, status reports `unreachable` ("showing cached items") and `/api/watch` returns the SQLite-cached rows with `cached: true`.
  - With no cache, status is `unreachable` and every row is empty. The UI's empty state is covered in Phase 4.
- **Bad API key**: status is `degraded`, "Jellyfin rejected the API key". The key does not appear in responses or logs.
- **Images**: movie poster, series backdrop for episodes, and `null` when no image exists (Shōgun).

### Phase 4 — UI shell and focus

- **Every screen and tile reachable by keys alone** (`navigation.e2e.ts`):
  - A walk of every row and column reaches every focusable on Home, Play (14 games and 5 chips) and Watch (15 tiles).
  - Each screen is reached by keys: Home, Play, Watch, Detail, Tonight, Settings and Profiles. Tonight, Settings and Profiles are placeholders until their phases.
- **A focused element exists after every input**: the `press()` helper asserts that `document.activeElement` is the `data-focused` element after every key press in every test.
- **Focus behaviour**:
  - Back restores the previous focus.
  - LB and RB remember each section's focus.
  - Up and down keep the column; rows do not wrap.
  - Holding a direction repeats after 400 ms at about 8 per second.
  - Input to visible focus change measures under 100 ms (MutationObserver from keydown).
  - Missing art shows the text fallback.
  - Watch shows its empty state, with Try again focused, when Jellyfin is down with no cache, and saved items when a cache exists.
- **Gamepad path** (`gamepad.e2e.ts`): a `navigator.getGamepads` shim drives the polling path. The D-pad, A, B, LB, RB, X, Start and the left stick work, held D-pad repeats, and the guide button is ignored.
- **Ten-foot rules** (`tenfoot.e2e.ts` + `tenfoot.ts`): 8 screen states × {1920×1080, 3840×2160}. Each audit asserts:
  - every visible text is at least 28 px at 1080p (56 px at 4K)
  - text contrast is at least 7:1, measured against the composited background
  - text and focusables stay inside the 5% safe area
  - the focused element is scaled and ringed
  - there is no scrollable overflow and no `:hover` rule
  - the pointer is hidden and the theme is dark

  Screenshots are written to `apps/web/test-results/screens/` on every run. A reviewed set is in `docs/screenshots/`. The audit caught tiles peeking past the right safe line, fixed by D-042.
- **Unit tests**: focus engine (wrap, column memory, empty rows, focus-never-lost property over every key, direction and column), repeat timing with fake timers, and core formatting.
- **API tests** (`home-items-art.test.ts`): Continue order, hidden items, item detail with 400/404, and the art proxy (local, grid, 404 fallback, Jellyfin proxied and disk-cached, served from cache while the NAS is down, API key never exposed).

### Phase 5 — Launching

- **Exact commands for Linux and Windows, through an injected spawner** (`launch.test.ts`):
  - Linux: `steam steam://rungameid/620`, and `steam steam://rungameid/10996831713501380608` for a shortcut.
  - Windows: `C:\Program Files (x86)\Steam\steam.exe steam://rungameid/…` for both.
  - Jellyfin Desktop is started through its shortcut (`steam://rungameid/14151776773448138752`), or through `%LOCALAPPDATA%\Programs\Jellyfin Desktop\Jellyfin Desktop.exe` when no shortcut matches, or through a configured command.
  - PlayNow carries `startPositionTicks = 4440 × 10^7` (resume) or 0 (from start).
  - The web handoff returns the details URL and starts nothing.
  - The kiosk restart runs after the game exits.
- **Errors appear as on-screen messages**:
  - API: a spawn failure (502 with the message), Jellyfin unreachable, a client that never answers, unknown or malformed keys.
  - UI: `launch.e2e.ts` takes the mock NAS down, presses Resume, and sees an error message with `data-kind="error"` while focus stays on the Resume button.
- **Launching state**: `launch.e2e.ts` covers the full sequence. The overlay shows "Steam is starting Portal 2." and the recorded command is `steam://rungameid/620`. A `visibilitychange` to visible clears the overlay and refetches data, and B dismisses it. Resuming Arrival hands off with the right ticks.
- **Reloading restores screen and focus**: covered for Play (with column memory) and for Detail, after which Back goes to Home.

### Phase 6 — Profiles and preferences

- **Isolated per profile** (`profiles-prefs.test.ts`): a favourite, a hidden item and a session-length override set on Solo are absent on "Two of us" and present again on Solo. Hidden media leaves Watch, and the hidden list can unhide it. Clearing an override restores the genre default. Bad input is rejected with 400.
- **Persist across a restart**: a second `createApp` over the same SQLite file sees the active profile, each profile's favourites and the saved UI state. Profiles are seeded exactly once.
- **UI** (`profiles.e2e.ts`, keys only):
  - A favourite set with Y appears as a ★, disappears after switching to "Two of us", and is back for Solo after a page reload.
  - Hide from Detail shows a message and removes the game from Play (13 games). Group still sees it.
  - A session-length override from the Y menu shows on Detail as "Short sessions (set by you)".
- The Profiles screen is included in the ten-foot audit at 1080p and 4K.

### Phase 7 — Tonight picker

- **One unit test per signal** (`packages/core/src/picker.test.ts`): inProgress (games, resume, next-up), fitsTime as a hard media filter with the "42 minutes left" text, tooLong as a soft per-step penalty, fitsGroup (boost and filter), groupUnknown, controllerFriendly and noController, favourite, neglected (games and media), and recentlySkipped (6.9 days counts, 7.1 days does not). There are also tests for weights from the context, filters, key tie-break, the reason format, card slots, wildcard reproducibility, rerolls never repeating, and empty input.
- **Golden tests for a fixed fixture evening** (`apps/server/test/tonight.test.ts`, Saturday 3 Oct 2026 19:00):
  - Two of us, 1 hour, either: It Takes Two ("Played on 24 Sep, couch co-op for two"), Vampire Survivors (finish), Bluey (wildcard, "7 minutes long, the next episode").
  - Solo, 30 min, watch: Bluey, then Paddington 2 ("18 minutes left, started on Thursday"). Severance (42 minutes left) is filtered out.
  - Solo, all evening, play: Cyberpunk 2077, Hades, then Portal 2 ("Installed but never played").
- **Skipped items drop for 7 days**:
  - A reroll records three skips and shows three new items.
  - A new session that evening scores each skipped item exactly 30 lower, and none of them is the best pick.
  - Eight days later no skip signal remains, and Vampire Survivors leads again.
  - Skips are per profile.
- **Other API checks**: answers persist and switch the active profile, accept is recorded, input is validated, and weights come from the config.
- **UI** (`tonight.e2e.ts`): from Home, Tonight to a running pick takes 5 presses (A, A, A, A, A), within the brief's "at most five". Reroll gives new cards. B steps back through the questions. Last answers are preselected. The ten-foot audit covers the question and results screens at 1080p and 4K.
