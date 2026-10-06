/**
 * The Tonight picker: deterministic, explainable scoring.
 *
 * `pickTonight(candidates, context)` is a pure function. Candidates carry the active profile's
 * preferences (favourite, hidden, session-length override); the context carries the three
 * answers, the profile, weights, suggestion history and the current time. The result is a
 * ranked list and up to three picks (best, finish-what-you-started, wildcard), each with a
 * one-line reason built from its top two signals.
 */
import { durationText, relativeDay, remainingMinutes } from "./format.ts";
import type { PickerWeights } from "./picker-config.ts";
import { SESSION_MINUTES } from "./picker-config.ts";
import type {
  Pick,
  PickSlot,
  SessionLength,
  SignalHit,
  SignalId,
  TonightMode,
  TonightTime,
  UnifiedItem,
} from "./types.ts";

const DAY = 86_400_000;
export const IN_PROGRESS_DAYS = 14;
export const NEGLECTED_DAYS = 60;
export const SKIP_DAYS = 7;
const WILDCARD_POOL = 8;
const LENGTHS: SessionLength[] = ["short", "medium", "long"];

export interface PickerContext {
  now: Date;
  /** Minutes east of UTC, for "on Tuesday" style text. */
  utcOffsetMin: number;
  time: TonightTime;
  mode: TonightMode;
  profile: { id: number; name: string; size: number };
  weights: PickerWeights;
  /** Item key -> ISO time of its most recent skip (any age; the picker applies the 7-day window). */
  skips: Map<string, string>;
  /** Keys already shown in this picker session (rerolls never repeat them). */
  exclude?: Set<string>;
  /** Reroll page, part of the wildcard seed. */
  page?: number;
}

export interface Scored {
  item: UnifiedItem;
  score: number;
  signals: SignalHit[];
}

export interface PickResult {
  ranked: Scored[];
  picks: Pick[];
  /** Candidates left after hard filters and exclusions. */
  remaining: number;
}

const minutesAvailable = (t: TonightTime): number => (t === "evening" ? Number.POSITIVE_INFINITY : t);

const isMediaCandidate = (i: UnifiedItem) =>
  i.kind !== "game" &&
  (i.mediaLists ?? []).some((l) => l === "resume" || l === "nextup" || l === "unwatchedMovies");

const isResume = (i: UnifiedItem) =>
  (i.mediaLists ?? []).includes("resume") && (i.progress?.positionSec ?? 0) > 0;

/** Hard filters: hidden, excluded, mode, media time, group. Returns the reason an item is out, or null. */
export function excludedBecause(i: UnifiedItem, ctx: PickerContext): string | null {
  if (i.hidden) return "hidden";
  if (ctx.exclude?.has(i.key)) return "already shown";
  const isGame = i.kind === "game";
  if (ctx.mode === "play" && !isGame) return "not a game";
  if (ctx.mode === "watch" && isGame) return "not media";
  if (!isGame) {
    if (!isMediaCandidate(i)) return "not a resume, next-up or unwatched item";
    const left = remainingMinutes(i.progress);
    if (left !== null && left > minutesAvailable(ctx.time)) return "longer than the time available";
  } else if (ctx.profile.size > 1 && i.tags.couchCoop === false) return "no couch multiplayer";
  return null;
}

/** All signals for one candidate. Pure; `score` already includes the weight. */
export function signalsFor(i: UnifiedItem, ctx: PickerContext): SignalHit[] {
  const w = ctx.weights;
  const now = ctx.now.getTime();
  const hits: SignalHit[] = [];
  const add = (id: SignalId, score: number, text: string) => {
    if (score !== 0) hits.push({ id, score, text });
  };
  const ago = (iso: string | null) => (iso ? (now - Date.parse(iso)) / DAY : Number.POSITIVE_INFINITY);
  const when = (iso: string | null) => relativeDay(iso, ctx.now, ctx.utcOffsetMin);
  const avail = minutesAvailable(ctx.time);

  if (i.kind === "game") {
    // In progress: played in the last 14 days.
    if (ago(i.lastActivityAt) <= IN_PROGRESS_DAYS)
      add("inProgress", w.inProgress, `played ${when(i.lastActivityAt)}`);
    // Fits the time: soft, by session length.
    const len = i.tags.sessionLength ?? "medium";
    const need = SESSION_MINUTES[len];
    // With all evening every game fits, so fitting is not a distinguishing signal then.
    if (need <= avail) {
      if (ctx.time !== "evening") add("fitsTime", w.fitsTime, `fits in ${durationText(avail)}`);
    } else {
      const fitting = LENGTHS.filter((l) => SESSION_MINUTES[l] <= avail);
      const maxFit = fitting.length ? LENGTHS.indexOf(fitting[fitting.length - 1] as SessionLength) : -1;
      const steps = LENGTHS.indexOf(len) - maxFit;
      add("tooLong", w.tooLong * steps, `usually needs ${durationText(need)}`);
    }
    // Fits the group.
    if (ctx.profile.size > 1) {
      if (i.tags.couchCoop === true)
        add(
          "fitsGroup",
          w.fitsGroup,
          ctx.profile.size === 2 ? "couch co-op for two" : "couch multiplayer for the group",
        );
      else if (i.tags.couchCoop === null)
        add("groupUnknown", w.groupUnknown, "may not support couch multiplayer");
    }
    // Controller.
    if (i.tags.controller === "full")
      add("controllerFriendly", w.controllerFriendly, "full controller support");
    else if (i.tags.controller === "partial" || i.tags.controller === "none")
      add(
        "noController",
        w.noController,
        i.tags.controller === "partial" ? "only partial controller support" : "needs keyboard and mouse",
      );
    // Neglected.
    const idle = ago(i.lastActivityAt);
    if (idle >= NEGLECTED_DAYS)
      add(
        "neglected",
        w.neglected,
        i.lastActivityAt
          ? `not played since ${when(i.lastActivityAt)?.replace(/^on /, "")}`
          : "installed but never played",
      );
  } else {
    const left = remainingMinutes(i.progress);
    const lists = i.mediaLists ?? [];
    if (isResume(i)) add("inProgress", w.inProgress, `started ${when(i.lastActivityAt) ?? "earlier"}`);
    else if (lists.includes("nextup")) add("inProgress", w.inProgress, "the next episode");
    if (left !== null)
      add("fitsTime", w.fitsTime, isResume(i) ? `${durationText(left)} left` : `${durationText(left)} long`);
    if (!isResume(i) && lists.includes("unwatchedMovies") && ago(i.addedAt) >= NEGLECTED_DAYS)
      add("neglected", w.neglected, `added ${when(i.addedAt)}, never watched`);
  }
  if (i.favourite) add("favourite", w.favourite, `a favourite for ${ctx.profile.name}`);
  const skippedAt = ctx.skips.get(i.key);
  if (skippedAt && ago(skippedAt) < SKIP_DAYS) add("recentlySkipped", w.recentlySkipped, "skipped recently");
  return hits;
}

/** Display order of signal text in a reason ("42 minutes left, started on Tuesday"). */
const REASON_ORDER: SignalId[] = [
  "fitsTime",
  "inProgress",
  "fitsGroup",
  "favourite",
  "neglected",
  "controllerFriendly",
  "tooLong",
  "groupUnknown",
  "noController",
  "recentlySkipped",
];

const capitalise = (s: string) => (s ? s[0]?.toUpperCase() + s.slice(1) : s);

/** One line from the top two positive signals (by score, ties by display order). */
export function reasonFor(signals: SignalHit[], slot: PickSlot, kind: UnifiedItem["kind"]): string {
  const positive = signals
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || REASON_ORDER.indexOf(a.id) - REASON_ORDER.indexOf(b.id))
    .slice(0, 2)
    .sort((a, b) => REASON_ORDER.indexOf(a.id) - REASON_ORDER.indexOf(b.id));
  if (positive.length === 0)
    return slot === "wildcard"
      ? "Something different tonight"
      : kind === "game"
        ? "Ready to play"
        : "Ready to watch";
  return capitalise(positive.map((s) => s.text).join(", "));
}

export function compareScored(a: Scored, b: Scored): number {
  if (b.score !== a.score) return b.score - a.score;
  return a.item.key < b.item.key ? -1 : a.item.key > b.item.key ? 1 : 0;
}

/** Score and rank every candidate that passes the hard filters. */
export function rankCandidates(candidates: UnifiedItem[], ctx: PickerContext): Scored[] {
  return candidates
    .filter((i) => excludedBecause(i, ctx) === null)
    .map((item) => {
      const signals = signalsFor(item, ctx);
      return { item, signals, score: signals.reduce((s, h) => s + h.score, 0) };
    })
    .sort(compareScored);
}

/** FNV-1a string hash, then mulberry32: a small seeded generator for the wildcard. */
export function seededRandom(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0;
  let a = h;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The wildcard seed: local date + profile (+ reroll page), so a given evening is reproducible. */
export function wildcardSeed(ctx: PickerContext): string {
  const local = new Date(ctx.now.getTime() + ctx.utcOffsetMin * 60_000).toISOString().slice(0, 10);
  return `${local}|${ctx.profile.id}|${ctx.page ?? 0}`;
}

const isGameItem = (i: UnifiedItem) => i.kind === "game";

export function pickTonight(candidates: UnifiedItem[], ctx: PickerContext): PickResult {
  const ranked = rankCandidates(candidates, ctx);
  const picks: Pick[] = [];
  const used = new Set<string>();
  const make = (s: Scored, slot: PickSlot): Pick => {
    used.add(s.item.key);
    return {
      slot,
      item: s.item,
      score: s.score,
      signals: s.signals,
      reason: reasonFor(s.signals, slot, s.item.kind),
    };
  };

  const best = ranked[0];
  if (best) picks.push(make(best, "best"));

  // Finish what you started: the best remaining in-progress item, else the next best overall.
  const finish =
    ranked.find((s) => !used.has(s.item.key) && s.signals.some((h) => h.id === "inProgress")) ??
    ranked.find((s) => !used.has(s.item.key));
  if (finish) {
    picks.push(make(finish, finish.signals.some((h) => h.id === "inProgress") ? "finish" : "runnerUp"));
  }

  // Wildcard: from the top of what is left, of the other type when the answer was "either".
  let pool = ranked.filter((s) => !used.has(s.item.key));
  if (ctx.mode === "either" && best) {
    const other = pool.filter((s) => isGameItem(s.item) !== isGameItem(best.item));
    if (other.length) pool = other;
  }
  pool = pool.slice(0, WILDCARD_POOL);
  if (pool.length) {
    const rnd = seededRandom(wildcardSeed(ctx));
    picks.push(make(pool[Math.floor(rnd() * pool.length)] as Scored, "wildcard"));
  }
  return { ranked, picks, remaining: ranked.length };
}
