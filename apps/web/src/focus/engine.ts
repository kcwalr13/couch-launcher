/**
 * Spatial navigation as a pure function. A screen describes its focusable layout as rows of
 * keys; the engine moves between them deterministically:
 *  - left/right move within a row and stop at the ends (rows never wrap)
 *  - up/down move between rows and land on the remembered column, clamped to the row length
 *  - empty rows are skipped
 * Focus is never lost: `resolve` maps a stale key to the nearest valid one.
 */

export type Direction = "up" | "down" | "left" | "right";

export interface FocusRow {
  id: string;
  keys: string[];
}

export interface FocusState {
  key: string | null;
  /** The column to aim for when moving vertically. Set by horizontal moves. */
  col: number;
}

export function locate(rows: FocusRow[], key: string | null): { row: number; col: number } | null {
  if (key === null) return null;
  for (let r = 0; r < rows.length; r++) {
    const c = (rows[r] as FocusRow).keys.indexOf(key);
    if (c >= 0) return { row: r, col: c };
  }
  return null;
}

export function firstKey(rows: FocusRow[]): string | null {
  for (const r of rows) if (r.keys.length > 0) return r.keys[0] as string;
  return null;
}

/**
 * Make sure the state points at an existing key. Preference order: the key itself, the
 * `fallback` key (screen default), then the first key.
 */
export function resolve(rows: FocusRow[], state: FocusState, fallback: string | null = null): FocusState {
  const at = locate(rows, state.key);
  if (at) return state;
  const fb = locate(rows, fallback);
  if (fb) return { key: fallback, col: fb.col };
  const first = firstKey(rows);
  return { key: first, col: 0 };
}

export function move(rows: FocusRow[], state: FocusState, dir: Direction): FocusState {
  const at = locate(rows, state.key);
  if (!at) return resolve(rows, state);
  const row = rows[at.row] as FocusRow;
  if (dir === "left" || dir === "right") {
    const c = at.col + (dir === "left" ? -1 : 1);
    if (c < 0 || c >= row.keys.length) return state;
    return { key: row.keys[c] as string, col: c };
  }
  const step = dir === "up" ? -1 : 1;
  for (let r = at.row + step; r >= 0 && r < rows.length; r += step) {
    const target = rows[r] as FocusRow;
    if (target.keys.length === 0) continue;
    const c = Math.min(state.col, target.keys.length - 1);
    return { key: target.keys[c] as string, col: state.col };
  }
  return state;
}

/** Split a flat list into grid rows of `cols` keys (for the Play grid). */
export function gridRows(id: string, keys: string[], cols: number): FocusRow[] {
  const out: FocusRow[] = [];
  for (let i = 0; i < keys.length; i += cols)
    out.push({ id: `${id}-${i / cols}`, keys: keys.slice(i, i + cols) });
  return out;
}
