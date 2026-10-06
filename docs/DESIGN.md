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
