/**
 * Turns keyboard events and Gamepad API polling into controller actions.
 * Keyboard is the primary path (Steam Input key-mapped layout); the Gamepad API is second.
 * When both report the same action within DEDUPE_MS (a pad seen both ways), the gamepad copy is dropped.
 */
import { type Action, DIRECTIONS, GAMEPAD_BUTTONS, KEY_BINDINGS, STICK_THRESHOLD } from "./actions.ts";
import { Repeater } from "./repeat.ts";

const DEDUPE_MS = 80;

export type ActionSource = "keyboard" | "gamepad";

export class InputController {
  private readonly keyRepeat: Repeater<Action>;
  private readonly padRepeat: Repeater<Action>;
  private lastKeyboard = new Map<Action, number>();
  private prevPad = new Map<number, Set<Action>>();
  private raf = 0;
  private stopped = false;

  constructor(private readonly onAction: (a: Action, source: ActionSource) => void) {
    this.keyRepeat = new Repeater((a) => this.emit(a, "keyboard"));
    this.padRepeat = new Repeater((a) => this.emit(a, "gamepad"));
  }

  private emit(a: Action, source: ActionSource) {
    if (source === "keyboard") this.lastKeyboard.set(a, performance.now());
    else {
      const k = this.lastKeyboard.get(a);
      if (k !== undefined && performance.now() - k < DEDUPE_MS) return;
    }
    this.onAction(a, source);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const a = KEY_BINDINGS[e.key];
    if (!a) return;
    e.preventDefault();
    if (e.repeat) return; // our own repeater handles holds
    if (DIRECTIONS.has(a)) this.keyRepeat.press(a);
    else this.emit(a, "keyboard");
  };

  private onKeyUp = (e: KeyboardEvent) => {
    const a = KEY_BINDINGS[e.key];
    if (a && DIRECTIONS.has(a)) this.keyRepeat.release(a);
  };

  private onBlur = () => {
    this.keyRepeat.release();
    this.padRepeat.release();
  };

  /** Actions currently held on one pad (buttons plus left stick). */
  static padActions(p: Gamepad): Set<Action> {
    const out = new Set<Action>();
    p.buttons.forEach((b, i) => {
      const a = GAMEPAD_BUTTONS[i];
      if (a && (b.pressed || b.value > 0.5)) out.add(a);
    });
    const [x = 0, y = 0] = p.axes;
    if (Math.abs(x) > STICK_THRESHOLD || Math.abs(y) > STICK_THRESHOLD) {
      if (Math.abs(x) > Math.abs(y)) out.add(x < 0 ? "left" : "right");
      else out.add(y < 0 ? "up" : "down");
    }
    return out;
  }

  /** One polling step; exposed for tests. */
  pollGamepads = () => {
    const pads = typeof navigator.getGamepads === "function" ? navigator.getGamepads() : [];
    const seen = new Set<number>();
    for (const p of pads) {
      if (!p?.connected) continue;
      seen.add(p.index);
      const now = InputController.padActions(p);
      const before = this.prevPad.get(p.index) ?? new Set<Action>();
      for (const a of now) {
        if (before.has(a)) continue;
        if (DIRECTIONS.has(a)) this.padRepeat.press(a);
        else this.emit(a, "gamepad");
      }
      for (const a of before) if (!now.has(a) && DIRECTIONS.has(a)) this.padRepeat.release(a);
      this.prevPad.set(p.index, now);
    }
    for (const idx of [...this.prevPad.keys()]) {
      if (!seen.has(idx)) {
        for (const a of this.prevPad.get(idx) ?? []) if (DIRECTIONS.has(a)) this.padRepeat.release(a);
        this.prevPad.delete(idx);
      }
    }
  };

  private loop = () => {
    if (this.stopped) return;
    this.pollGamepads();
    this.raf = requestAnimationFrame(this.loop);
  };

  start(): () => void {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    this.raf = requestAnimationFrame(this.loop);
    return () => {
      this.stopped = true;
      cancelAnimationFrame(this.raf);
      window.removeEventListener("keydown", this.onKeyDown);
      window.removeEventListener("keyup", this.onKeyUp);
      window.removeEventListener("blur", this.onBlur);
      this.onBlur();
    };
  }
}
