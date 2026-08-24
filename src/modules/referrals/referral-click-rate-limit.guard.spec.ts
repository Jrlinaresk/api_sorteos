import {
  FixedWindowReferralRateLimiter,
  hashReferralClientAddress,
} from './referral-click-rate-limit.guard';

describe('FixedWindowReferralRateLimiter', () => {
  it('blocks requests over the configured window limit', () => {
    const limiter = new FixedWindowReferralRateLimiter(2, 1_000, 10);

    expect(limiter.consume('client', 100).allowed).toBe(true);
    expect(limiter.consume('client', 200).allowed).toBe(true);
    expect(limiter.consume('client', 300).allowed).toBe(false);
  });

  it('opens a fresh bucket after the window expires', () => {
    const limiter = new FixedWindowReferralRateLimiter(1, 1_000, 10);

    expect(limiter.consume('client', 100).allowed).toBe(true);
    expect(limiter.consume('client', 200).allowed).toBe(false);
    expect(limiter.consume('client', 1_100).allowed).toBe(true);
  });

  it('uses a stable keyed hash instead of retaining the raw address', () => {
    const request = { ip: '203.0.113.10' };
    const first = hashReferralClientAddress(request, 'stable-test-secret');

    expect(first).toBe(
      hashReferralClientAddress(request, 'stable-test-secret'),
    );
    expect(first).not.toBe(
      hashReferralClientAddress(request, 'another-test-secret'),
    );
    expect(first).not.toContain(request.ip);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });
});
