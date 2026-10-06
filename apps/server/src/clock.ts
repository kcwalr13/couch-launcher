/** Injectable clock. Mock mode can pin it with COUCH_NOW so fixtures and screenshots are stable. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export function fixedClock(iso: string): Clock {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) throw new Error(`invalid time: ${iso}`);
  return { now: () => new Date(t.getTime()) };
}
