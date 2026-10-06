/**
 * Hold-to-repeat for directions: the first press fires at once, then after 400 ms it repeats at
 * eight steps per second until released. The browser's own key repeat is ignored so timing is
 * identical for keyboards, Steam Input key emulation and the Gamepad API.
 */
export const REPEAT_DELAY_MS = 400;
export const REPEAT_INTERVAL_MS = 125;

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
}

export class Repeater<T> {
  private held: T | null = null;
  private timeout: unknown = null;
  private interval: unknown = null;

  constructor(
    private readonly fire: (v: T) => void,
    private readonly timers: Timers = globalThis as unknown as Timers,
  ) {}

  press(v: T): void {
    this.release();
    this.held = v;
    this.fire(v);
    this.timeout = this.timers.setTimeout(() => {
      this.interval = this.timers.setInterval(() => {
        if (this.held !== null) this.fire(this.held);
      }, REPEAT_INTERVAL_MS);
    }, REPEAT_DELAY_MS);
  }

  /** Release the held value (or a specific one, ignoring releases of other values). */
  release(v?: T): void {
    if (v !== undefined && v !== this.held) return;
    this.held = null;
    if (this.timeout !== null) this.timers.clearTimeout(this.timeout);
    if (this.interval !== null) this.timers.clearInterval(this.interval);
    this.timeout = null;
    this.interval = null;
  }

  get current(): T | null {
    return this.held;
  }
}
