import type { SessionLength } from "./types.ts";

/** Picker weights. Positive values boost, negative values penalise. Overridable in config.toml. */
export interface PickerWeights {
  /** Game played in the last 14 days, or a Jellyfin resume / next-up item. */
  inProgress: number;
  /** Item fits the time available (small boost, mainly so it can be named as a reason). */
  fitsTime: number;
  /** Game: penalty per session-length step beyond the time available (soft). */
  tooLong: number;
  /** Game has local co-op and more than one person is on the couch. */
  fitsGroup: number;
  /** Game's multiplayer support is unknown (no store data) and more than one person is here. */
  groupUnknown: number;
  /** Game has full controller support. */
  controllerFriendly: number;
  /** Game lacks full controller support (partial, none or unknown). */
  noController: number;
  /** Favourite for the active profile. */
  favourite: number;
  /** Installed but unplayed for 60 days, or added 60+ days ago and never watched. */
  neglected: number;
  /** Skipped in the last 7 days. */
  recentlySkipped: number;
}

export const DEFAULT_WEIGHTS: PickerWeights = {
  inProgress: 40,
  fitsTime: 6,
  tooLong: -12,
  fitsGroup: 8,
  groupUnknown: -10,
  controllerFriendly: 4,
  noController: -15,
  favourite: 20,
  neglected: 6,
  recentlySkipped: -30,
};

/** Steam store genre (English description) to typical session length. */
export const DEFAULT_GENRE_SESSION_MAP: Record<string, SessionLength> = {
  Casual: "short",
  Puzzle: "short",
  Racing: "short",
  Sports: "short",
  Indie: "medium",
  Action: "medium",
  Adventure: "medium",
  Simulation: "long",
  Strategy: "long",
  RPG: "long",
  "Massively Multiplayer": "long",
};

export const SESSION_MINUTES: Record<SessionLength, number> = { short: 30, medium: 60, long: 120 };
