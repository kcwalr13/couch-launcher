/** Controller actions and their keyboard / gamepad bindings. */

export type Action =
  | "up"
  | "down"
  | "left"
  | "right"
  | "select"
  | "back"
  | "tonight"
  | "options"
  | "prevTab"
  | "nextTab"
  | "settings";

export const DIRECTIONS = new Set<Action>(["up", "down", "left", "right"]);

/**
 * Keyboard bindings. The shipped Steam Input layout (steam-input/) emits exactly these keys:
 * D-pad/left stick = arrows, A = Enter, B = Escape, X = x, Y = y, LB = q, RB = e, Start = s.
 */
export const KEY_BINDINGS: Record<string, Action> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  Enter: "select",
  " ": "select",
  Escape: "back",
  Backspace: "back",
  BrowserBack: "back",
  x: "tonight",
  X: "tonight",
  y: "options",
  Y: "options",
  q: "prevTab",
  Q: "prevTab",
  PageUp: "prevTab",
  e: "nextTab",
  E: "nextTab",
  PageDown: "nextTab",
  s: "settings",
  S: "settings",
  ContextMenu: "settings",
};

/** W3C "standard" gamepad mapping. Button 16 (guide) is reserved by Steam and never bound. */
export const GAMEPAD_BUTTONS: Record<number, Action> = {
  0: "select",
  1: "back",
  2: "tonight",
  3: "options",
  4: "prevTab",
  5: "nextTab",
  9: "settings",
  12: "up",
  13: "down",
  14: "left",
  15: "right",
};

export const STICK_THRESHOLD = 0.5;
