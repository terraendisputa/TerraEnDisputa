export type RateLimitSurface =
  | 'admin-login'
  | 'seat-claim'
  | 'join'
  | 'protocol-abuse'
  | 'game-command'
  | 'game-read';

export interface RateLimitPolicy {
  readonly windowMs: number;
  readonly source: number;
  readonly target: number;
  readonly global: number;
}

export const DEFAULT_RATE_LIMIT_POLICIES: Readonly<
  Record<RateLimitSurface, RateLimitPolicy>
> = {
  'admin-login': { windowMs: 5 * 60_000, source: 10, target: 25, global: 100 },
  'seat-claim': {
    windowMs: 5 * 60_000,
    source: 10,
    target: 5,
    global: 200,
  },
  join: { windowMs: 60_000, source: 20, target: 30, global: 300 },
  'game-command': { windowMs: 1000, source: 30, target: 120, global: 600 },
  // Every announced change makes each open screen read its view again.
  'game-read': { windowMs: 1000, source: 30, target: 240, global: 1200 },
  'protocol-abuse': {
    windowMs: 60_000,
    source: 30,
    target: 100,
    global: 500,
  },
};

interface Counter {
  count: number;
  expiresAt: number;
}

export class LayeredRateLimiter {
  private readonly counters = new Map<string, Counter>();

  constructor(
    private readonly policies = DEFAULT_RATE_LIMIT_POLICIES,
    private readonly now: () => number = Date.now,
    private readonly maximumEntries = 4_096,
  ) {}

  consume(surface: RateLimitSurface, source: string, target: string): boolean {
    const now = this.now();
    this.expire(now);
    const policy = this.policies[surface];
    const keys = [
      [`${surface}:source:${source}`, policy.source],
      [`${surface}:target:${target}`, policy.target],
      [`${surface}:global`, policy.global],
    ] as const;
    if (
      this.counters.size +
        keys.filter(([key]) => !this.counters.has(key)).length >
      this.maximumEntries
    )
      return false;
    if (
      keys.some(([key, limit]) => (this.counters.get(key)?.count ?? 0) >= limit)
    )
      return false;
    for (const [key] of keys) {
      const current = this.counters.get(key);
      this.counters.set(key, {
        count: (current?.count ?? 0) + 1,
        expiresAt: current?.expiresAt ?? now + policy.windowMs,
      });
    }
    return true;
  }

  private expire(now: number): void {
    for (const [key, counter] of this.counters)
      if (counter.expiresAt <= now) this.counters.delete(key);
  }
}
