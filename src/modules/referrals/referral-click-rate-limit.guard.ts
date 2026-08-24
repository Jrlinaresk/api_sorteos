import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { createHmac, randomBytes } from 'node:crypto';

interface ReferralRequest {
  ip?: string;
  socket?: { remoteAddress?: string };
}

interface RateBucket {
  count: number;
  resetAt: number;
}

const processHashKey =
  process.env.REFERRAL_IP_HASH_SECRET ?? randomBytes(32).toString('hex');

export function referralClientAddress(request: ReferralRequest): string {
  return (
    request.ip?.trim() || request.socket?.remoteAddress?.trim() || 'unknown'
  );
}

/** Hash unidireccional y con clave; nunca se conserva la IP cruda. */
export function hashReferralClientAddress(request: ReferralRequest): string {
  return createHmac('sha256', processHashKey)
    .update(referralClientAddress(request))
    .digest('hex');
}

/**
 * Límite de ventana fija acotado en memoria. Para múltiples réplicas se debe
 * reemplazar por un guard respaldado por Redis u otro almacén compartido.
 */
export class FixedWindowReferralRateLimiter {
  private readonly buckets = new Map<string, RateBucket>();

  constructor(
    private readonly limit = 60,
    private readonly windowMs = 60_000,
    private readonly maxEntries = 20_000,
  ) {}

  consume(
    key: string,
    now = Date.now(),
  ): { allowed: boolean; retryAfterSeconds: number } {
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.ensureCapacity(now, key);
      bucket = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(key, bucket);
    }

    bucket.count += 1;
    return {
      allowed: bucket.count <= this.limit,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000)),
    };
  }

  private ensureCapacity(now: number, incomingKey: string): void {
    if (this.buckets.has(incomingKey) || this.buckets.size < this.maxEntries) {
      return;
    }
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
    if (this.buckets.size < this.maxEntries) return;
    const oldestKey = this.buckets.keys().next().value as string | undefined;
    if (oldestKey) this.buckets.delete(oldestKey);
  }
}

@Injectable()
export class ReferralClickRateLimitGuard implements CanActivate {
  private readonly limiter = new FixedWindowReferralRateLimiter();

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<ReferralRequest>();
    const response = context.switchToHttp().getResponse<{
      setHeader(name: string, value: string): void;
    }>();
    const result = this.limiter.consume(hashReferralClientAddress(request));
    if (!result.allowed) {
      response.setHeader('Retry-After', String(result.retryAfterSeconds));
      throw new HttpException(
        'Demasiadas solicitudes de atribución',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
