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
export class PaymentsWebhookGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const expectedHmac = this.config.get<string>('EFI_WEBHOOK_HMAC');
    const requireMtls =
      this.config.get<string>('EFI_WEBHOOK_REQUIRE_MTLS') === 'true';
    const isProduction =
      (this.config.get<string>('NODE_ENV') ?? process.env.NODE_ENV) ===
      'production';

    if (!expectedHmac && !requireMtls) {
      if (!isProduction) return true;
      throw new UnauthorizedException(
        'Configure EFI_WEBHOOK_HMAC o EFI_WEBHOOK_REQUIRE_MTLS',
      );
    }

    if (expectedHmac) {
      const headerHmac = request.header('x-efi-webhook-token') ?? '';
      if (!secureEqual(headerHmac, expectedHmac)) {
        throw new UnauthorizedException('HMAC de webhook inválido');
      }
    }

    if (requireMtls) {
      const headerName =
        this.config.get<string>('EFI_WEBHOOK_MTLS_HEADER') ??
        'x-ssl-client-verify';
      const successValue =
        this.config.get<string>('EFI_WEBHOOK_MTLS_SUCCESS_VALUE') ?? 'SUCCESS';
      if (request.header(headerName) !== successValue) {
        throw new UnauthorizedException('Certificado mTLS de webhook inválido');
      }
    }
    return true;
  }
}

function secureEqual(received: string, expected: string): boolean {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
