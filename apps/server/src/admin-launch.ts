import { randomBytes, timingSafeEqual } from 'node:crypto';

/** A launch capability is separate from the administrator's manual code. */
export class AdminLaunch {
  readonly token = randomBytes(32).toString('base64url');
  private consumed = false;
  private readonly expiresAt: number;

  constructor(
    readonly origin: string,
    private readonly accessCode: string,
    private readonly now: () => number = Date.now,
  ) {
    this.expiresAt = now() + 5 * 60_000;
  }

  consume(candidate: string): string | undefined {
    if (this.consumed || this.now() >= this.expiresAt) return undefined;
    const supplied = Buffer.from(candidate);
    const expected = Buffer.from(this.token);
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    )
      return undefined;
    this.consumed = true;
    return this.accessCode;
  }
}

export function browserOrigin(bind: string, port: number): string {
  const address =
    bind === '0.0.0.0' ? '127.0.0.1' : bind === '::' ? '::1' : bind;
  return `http://${address.includes(':') ? `[${address}]` : address}:${port}`;
}

export function isLoopback(address: string | undefined): boolean {
  return (
    address === '::1' || !!address?.match(/^(?:::ffff:)?127\.\d+\.\d+\.\d+$/)
  );
}
