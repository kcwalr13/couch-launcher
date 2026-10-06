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

## Phase acceptance evidence

### Phase 0 — Foundations

- `bun run check` green: biome, tsc (4 projects), `bun test` (12 tests), vite build, Playwright smoke test.
- Server starts in mock mode and answers `GET /api/status` (`apps/server/test/status.test.ts`, and the Playwright web server waits on `/api/status`).
- Config loader: defaults, first-run creation, overrides, warnings, unparseable file, redaction (`config.test.ts`).
