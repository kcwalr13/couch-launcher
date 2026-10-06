/** Shared item and API types. Pure data: no I/O, no platform code. */

export type ItemKind = "game" | "movie" | "episode";
export type ItemSource = "steam" | "shortcut" | "jellyfin";
export type SessionLength = "short" | "medium" | "long";

export interface ItemArt {
  /** Portrait poster (2:3). Always a local URL served by the art proxy. */
  poster: string;
  /** Wide hero / backdrop image. Always a local URL served by the art proxy. */
  hero: string;
}

export interface ItemProgress {
  positionSec: number;
  durationSec: number;
}

export interface ItemTags {
  genres: string[];
  /** Local (same-screen) multiplayer: shared or split-screen co-op / PvP. null = unknown. */
  couchCoop: boolean | null;
  /** Full controller support per store categories. null = unknown. */
  controller: "full" | "partial" | "none" | null;
  /** Session length for games (derived from genres, or a per-profile override). */
  sessionLength: SessionLength | null;
  /** True when sessionLength comes from a user override. */
  sessionLengthOverridden?: boolean;
}

export type LaunchSpec =
  | { type: "steam"; appId: string }
  | { type: "shortcut"; gameId: string }
  | { type: "jellyfin"; itemId: string; positionSec: number };

export interface UnifiedItem {
  key: string;
  kind: ItemKind;
  source: ItemSource;
  title: string;
  subtitle: string | null;
  summary: string | null;
  art: ItemArt;
  /** ISO timestamp of last played / last watched, or null when never. */
  lastActivityAt: string | null;
  /** ISO timestamp of when the item was added (media) or installed (games), when known. */
  addedAt: string | null;
  progress: ItemProgress | null;
  playtimeMin: number | null;
  tags: ItemTags;
  launch: LaunchSpec;
  /** Media only: which Jellyfin list(s) the item came from. */
  mediaLists?: MediaList[];
  /** Per-profile flags, filled in by the service for the active profile. */
  favourite?: boolean;
  hidden?: boolean;
}

export type MediaList = "resume" | "nextup" | "latestMovies" | "latestShows" | "unwatchedMovies";

export interface Profile {
  id: number;
  name: string;
  size: number;
  isDefault: boolean;
}

export type SourceState = "ok" | "degraded" | "unreachable" | "not_configured" | "mock";

export interface SourceStatus {
  state: SourceState;
  detail: string;
  itemCount: number;
  checkedAt: string | null;
}

export interface StatusResponse {
  version: string;
  mock: boolean;
  platform: "linux" | "windows";
  now: string;
  steam: SourceStatus & { root: string | null; userId: string | null; libraries: string[] };
  jellyfin: SourceStatus & { server: string | null; serverName: string | null; version: string | null };
  metadata: SourceStatus;
  uiScale: number;
}

export interface HomeResponse {
  now: string;
  profile: Profile;
  continueRow: UnifiedItem[];
}

export type GameSort = "recent" | "az" | "playtime";

export interface GamesResponse {
  now: string;
  sort: GameSort;
  filters: { coop: boolean; controller: boolean };
  items: UnifiedItem[];
}

export interface WatchRow {
  id: "continue" | "nextup" | "movies" | "shows";
  title: string;
  items: UnifiedItem[];
}

export interface WatchResponse {
  now: string;
  status: SourceState;
  /** True when the rows come from the offline cache. */
  cached: boolean;
  rows: WatchRow[];
}

export interface ItemResponse {
  now: string;
  item: UnifiedItem;
}

export interface LaunchResponse {
  ok: boolean;
  message: string;
  /** For the web handoff: the URL the kiosk browser should open. */
  openUrl?: string;
}

export type TonightTime = 30 | 60 | 120 | "evening";
export type TonightMode = "play" | "watch" | "either";

export interface TonightAnswers {
  time: TonightTime;
  profileId: number;
  mode: TonightMode;
}

export interface TonightRequest extends TonightAnswers {
  /** 0 for the first set; each reroll increments it. */
  page?: number;
  /** Keys shown on earlier pages of this session: never shown again in this session. */
  exclude?: string[];
  /** Keys on the page being rerolled away from: recorded as skipped. */
  skipped?: string[];
}

/** "runnerUp" fills the second card when nothing is in progress. */
export type PickSlot = "best" | "finish" | "runnerUp" | "wildcard";

export interface Pick {
  slot: PickSlot;
  item: UnifiedItem;
  score: number;
  reason: string;
  signals: SignalHit[];
}

export interface TonightResponse {
  now: string;
  answers: TonightAnswers;
  page: number;
  picks: Pick[];
  /** Total candidates after hard filters, for the UI's "nothing left" state. */
  remaining: number;
}

export type SignalId =
  | "inProgress"
  | "fitsTime"
  | "tooLong"
  | "fitsGroup"
  | "groupUnknown"
  | "controllerFriendly"
  | "noController"
  | "favourite"
  | "neglected"
  | "recentlySkipped";

export interface SignalHit {
  id: SignalId;
  /** Score contribution, already multiplied by the weight. */
  score: number;
  /** Short human text, e.g. "42 minutes left". */
  text: string;
}

export interface UiState {
  screen: string;
  focusedKey: string | null;
  params?: Record<string, string>;
  updatedAt?: string;
}

export interface PrefsRequest {
  key: string;
  favourite?: boolean;
  hidden?: boolean;
  /** null clears the override. */
  sessionLength?: SessionLength | null;
}

export interface ApiError {
  error: string;
}
