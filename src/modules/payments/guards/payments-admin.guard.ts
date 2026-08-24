import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { Request } from 'express';

@Injectable()
export class PaymentsAdminGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    if (this.config.get<string>('PAYMENTS_ADMIN_GUARD_ENABLED') === 'false') {
      return true;
    }
    const expected = this.config.get<string>('PAYMENTS_ADMIN_API_KEY');
    if (!expected) {
      if (
        (this.config.get<string>('NODE_ENV') ?? process.env.NODE_ENV) !==
        'production'
      ) {
        return true;
      }
      throw new UnauthorizedException(
        'PAYMENTS_ADMIN_API_KEY no está configurada',
      );
    }
    const request = context.switchToHttp().getRequest<Request>();
    const received = request.header('x-admin-api-key') ?? '';
    if (!secureEqual(received, expected)) {
      throw new UnauthorizedException('Credencial administrativa inválida');
    }
    return true;
  }
}

function secureEqual(received: string, expected: string): boolean {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
