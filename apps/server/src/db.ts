/**
 * The store: one SQLite file under the user data directory.
 * Holds profiles, preferences, suggestion history, the metadata cache and UI state.
 * Never holds secrets.
 */
import { Database } from "bun:sqlite";
import type { Profile, SessionLength, UiState } from "@couch/core";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS profile (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  size INTEGER NOT NULL CHECK (size >= 1),
  is_default INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS item_pref (
  profile_id INTEGER NOT NULL REFERENCES profile(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  favourite INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  session_length_override TEXT CHECK (session_length_override IN ('short','medium','long')),
  PRIMARY KEY (profile_id, item_key)
);
CREATE TABLE IF NOT EXISTS suggestion_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  profile_id INTEGER NOT NULL,
  item_key TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('shown','accepted','skipped'))
);
CREATE INDEX IF NOT EXISTS suggestion_event_profile_ts ON suggestion_event(profile_id, ts);
CREATE TABLE IF NOT EXISTS metadata_cache (
  item_key TEXT NOT NULL,
  source TEXT NOT NULL,
  json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (item_key, source)
);
CREATE TABLE IF NOT EXISTS ui_state (
  profile_id INTEGER PRIMARY KEY,
  screen TEXT NOT NULL,
  focused_key TEXT,
  params TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS app_setting (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export const PRESET_PROFILES: { name: string; size: number }[] = [
  { name: "Solo", size: 1 },
  { name: "Two of us", size: 2 },
  { name: "Group", size: 4 },
];

export interface ItemPref {
  itemKey: string;
  favourite: boolean;
  hidden: boolean;
  sessionLengthOverride: SessionLength | null;
}

export interface SuggestionEvent {
  ts: string;
  profileId: number;
  itemKey: string;
  action: "shown" | "accepted" | "skipped";
}

export class Store {
  readonly db: Database;

  constructor(file: string) {
    this.db = new Database(file, { create: true, strict: true });
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec(SCHEMA);
    this.seedProfiles();
  }

  close(): void {
    this.db.close();
  }

  private seedProfiles(): void {
    const n = this.db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM profile").get();
    if (n && n.n > 0) return;
    const ins = this.db.query("INSERT INTO profile (name, size, is_default) VALUES ($name, $size, $d)");
    this.db.transaction(() => {
      PRESET_PROFILES.forEach((p, i) => {
        ins.run({ name: p.name, size: p.size, d: i === 0 ? 1 : 0 });
      });
    })();
  }

  // Profiles. `is_default` marks the active profile (see docs/DECISIONS.md).

  profiles(): Profile[] {
    return this.db
      .query<{ id: number; name: string; size: number; is_default: number }, []>(
        "SELECT id, name, size, is_default FROM profile ORDER BY id",
      )
      .all()
      .map((r) => ({ id: r.id, name: r.name, size: r.size, isDefault: r.is_default === 1 }));
  }

  profile(id: number): Profile | null {
    return this.profiles().find((p) => p.id === id) ?? null;
  }

  activeProfile(): Profile {
    const all = this.profiles();
    const active = all.find((p) => p.isDefault) ?? all[0];
    if (!active) throw new Error("no profiles");
    return active;
  }

  setActiveProfile(id: number): boolean {
    if (!this.profile(id)) return false;
    this.db.transaction(() => {
      this.db.query("UPDATE profile SET is_default = 0").run();
      this.db.query("UPDATE profile SET is_default = 1 WHERE id = $id").run({ id });
    })();
    return true;
  }

  // Preferences.

  prefs(profileId: number): Map<string, ItemPref> {
    const rows = this.db
      .query<
        {
          item_key: string;
          favourite: number;
          hidden: number;
          session_length_override: SessionLength | null;
        },
        { p: number }
      >("SELECT item_key, favourite, hidden, session_length_override FROM item_pref WHERE profile_id = $p")
      .all({ p: profileId });
    return new Map(
      rows.map((r) => [
        r.item_key,
        {
          itemKey: r.item_key,
          favourite: r.favourite === 1,
          hidden: r.hidden === 1,
          sessionLengthOverride: r.session_length_override,
        },
      ]),
    );
  }

  setPref(
    profileId: number,
    itemKey: string,
    change: { favourite?: boolean; hidden?: boolean; sessionLength?: SessionLength | null },
  ): ItemPref {
    const cur = this.prefs(profileId).get(itemKey) ?? {
      itemKey,
      favourite: false,
      hidden: false,
      sessionLengthOverride: null,
    };
    const next: ItemPref = {
      itemKey,
      favourite: change.favourite ?? cur.favourite,
      hidden: change.hidden ?? cur.hidden,
      sessionLengthOverride:
        change.sessionLength !== undefined ? change.sessionLength : cur.sessionLengthOverride,
    };
    this.db
      .query(
        `INSERT INTO item_pref (profile_id, item_key, favourite, hidden, session_length_override)
         VALUES ($p, $k, $f, $h, $s)
         ON CONFLICT (profile_id, item_key) DO UPDATE SET
           favourite = excluded.favourite, hidden = excluded.hidden,
           session_length_override = excluded.session_length_override`,
      )
      .run({
        p: profileId,
        k: itemKey,
        f: next.favourite ? 1 : 0,
        h: next.hidden ? 1 : 0,
        s: next.sessionLengthOverride,
      });
    return next;
  }

  // Suggestion history.

  addSuggestionEvents(events: SuggestionEvent[]): void {
    const ins = this.db.query(
      "INSERT INTO suggestion_event (ts, profile_id, item_key, action) VALUES ($ts, $p, $k, $a)",
    );
    this.db.transaction(() => {
      for (const e of events) ins.run({ ts: e.ts, p: e.profileId, k: e.itemKey, a: e.action });
    })();
  }

  suggestionEvents(profileId: number, sinceIso: string): SuggestionEvent[] {
    return this.db
      .query<
        { ts: string; profile_id: number; item_key: string; action: SuggestionEvent["action"] },
        {
          p: number;
          s: string;
        }
      >(
        "SELECT ts, profile_id, item_key, action FROM suggestion_event WHERE profile_id = $p AND ts >= $s ORDER BY id",
      )
      .all({ p: profileId, s: sinceIso })
      .map((r) => ({ ts: r.ts, profileId: r.profile_id, itemKey: r.item_key, action: r.action }));
  }

  // Metadata cache.

  getCache<T>(itemKey: string, source: string): { value: T; fetchedAt: string } | null {
    const r = this.db
      .query<{ json: string; fetched_at: string }, { k: string; s: string }>(
        "SELECT json, fetched_at FROM metadata_cache WHERE item_key = $k AND source = $s",
      )
      .get({ k: itemKey, s: source });
    if (!r) return null;
    try {
      return { value: JSON.parse(r.json) as T, fetchedAt: r.fetched_at };
    } catch {
      return null;
    }
  }

  getCacheBySource<T>(source: string): Map<string, { value: T; fetchedAt: string }> {
    const rows = this.db
      .query<{ item_key: string; json: string; fetched_at: string }, { s: string }>(
        "SELECT item_key, json, fetched_at FROM metadata_cache WHERE source = $s",
      )
      .all({ s: source });
    const out = new Map<string, { value: T; fetchedAt: string }>();
    for (const r of rows) {
      try {
        out.set(r.item_key, { value: JSON.parse(r.json) as T, fetchedAt: r.fetched_at });
      } catch {
        // Skip corrupt rows; they are refetched.
      }
    }
    return out;
  }

  putCache(itemKey: string, source: string, value: unknown, fetchedAt: string): void {
    this.db
      .query(
        `INSERT INTO metadata_cache (item_key, source, json, fetched_at) VALUES ($k, $s, $j, $t)
         ON CONFLICT (item_key, source) DO UPDATE SET json = excluded.json, fetched_at = excluded.fetched_at`,
      )
      .run({ k: itemKey, s: source, j: JSON.stringify(value), t: fetchedAt });
  }

  // UI state, per profile.

  getUiState(profileId: number): UiState | null {
    const r = this.db
      .query<
        { screen: string; focused_key: string | null; params: string | null; updated_at: string },
        {
          p: number;
        }
      >("SELECT screen, focused_key, params, updated_at FROM ui_state WHERE profile_id = $p")
      .get({ p: profileId });
    if (!r) return null;
    let params: Record<string, string> | undefined;
    try {
      params = r.params ? (JSON.parse(r.params) as Record<string, string>) : undefined;
    } catch {
      params = undefined;
    }
    return { screen: r.screen, focusedKey: r.focused_key, params, updatedAt: r.updated_at };
  }

  putUiState(profileId: number, s: UiState, now: string): void {
    this.db
      .query(
        `INSERT INTO ui_state (profile_id, screen, focused_key, params, updated_at) VALUES ($p, $s, $f, $x, $t)
         ON CONFLICT (profile_id) DO UPDATE SET screen = excluded.screen, focused_key = excluded.focused_key,
           params = excluded.params, updated_at = excluded.updated_at`,
      )
      .run({
        p: profileId,
        s: s.screen,
        f: s.focusedKey,
        x: s.params ? JSON.stringify(s.params) : null,
        t: now,
      });
  }

  // Small app settings (UI scale override, last picker answers).

  getSetting(key: string): string | null {
    return (
      this.db
        .query<{ value: string }, { k: string }>("SELECT value FROM app_setting WHERE key = $k")
        .get({ k: key })?.value ?? null
    );
  }

  setSetting(key: string, value: string): void {
    this.db
      .query(
        "INSERT INTO app_setting (key, value) VALUES ($k, $v) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      )
      .run({ k: key, v: value });
  }
}
