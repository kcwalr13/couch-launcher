/**
 * Human text for times and durations. Pure: callers pass "now" and their UTC offset, so the
 * same output is produced by the service, the UI and the tests.
 */

const DAY = 86_400_000;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Whole calendar days between two instants in the given UTC offset (0 = same day). */
export function calendarDaysAgo(iso: string, now: Date, offsetMin = 0): number | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const shift = offsetMin * 60_000;
  const day = (ms: number) => Math.floor((ms + shift) / DAY);
  return day(now.getTime()) - day(t);
}

/** "today", "yesterday", "on Tuesday" (within a week), "on 3 Sep" (older), "on 3 Sep 2024" (other year). */
export function relativeDay(iso: string | null, now: Date, offsetMin = 0): string | null {
  if (!iso) return null;
  const d = calendarDaysAgo(iso, now, offsetMin);
  if (d === null) return null;
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  const local = new Date(Date.parse(iso) + offsetMin * 60_000);
  if (d < 7) return `on ${WEEKDAYS[local.getUTCDay()]}`;
  const nowLocal = new Date(now.getTime() + offsetMin * 60_000);
  const base = `on ${local.getUTCDate()} ${MONTHS[local.getUTCMonth()]}`;
  return local.getUTCFullYear() === nowLocal.getUTCFullYear() ? base : `${base} ${local.getUTCFullYear()}`;
}

/** "42 minutes", "1 hour", "1 hour 5 minutes", "2 hours". */
export function durationText(totalMinutes: number): string {
  const m = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(m / 60);
  const r = m % 60;
  const hs = h === 1 ? "1 hour" : `${h} hours`;
  const ms = r === 1 ? "1 minute" : `${r} minutes`;
  if (h === 0) return ms;
  return r === 0 ? hs : `${hs} ${ms}`;
}

/** "35 h played", "45 min played", or null for none. */
export function playtimeText(min: number | null): string | null {
  if (!min) return null;
  if (min < 60) return `${min} min played`;
  return `${Math.round(min / 60)} h played`;
}

/** Remaining time of a media item in minutes (rounded up). */
export function remainingMinutes(
  progress: { positionSec: number; durationSec: number } | null,
): number | null {
  if (!progress || progress.durationSec <= 0) return null;
  return Math.ceil(Math.max(0, progress.durationSec - progress.positionSec) / 60);
}
