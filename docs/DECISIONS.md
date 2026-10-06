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
