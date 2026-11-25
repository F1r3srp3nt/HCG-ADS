export interface Clock {
  now(): Date;
}
export const systemClock: Clock = { now: () => new Date() };

export class FixedClock implements Clock {
  constructor(private t: Date) {}
  now(): Date { return new Date(this.t); }
  set(t: Date | string): void { this.t = new Date(t); }
  advance(ms: number): void { this.t = new Date(this.t.getTime() + ms); }
}

export const iso = (d: Date) => d.toISOString();
export const dayOf = (d: Date) => d.toISOString().slice(0, 10);
