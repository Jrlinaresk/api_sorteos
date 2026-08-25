import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

export const ADMIN_SESSION_HEADER = 'x-admin-session';
export const ADMIN_SESSION_HEADER_VALUE = 'browser';

/**
 * La cookie administrativa es host-only, pero SameSite separa sitios, no
 * orígenes. Por eso un portal cliente alojado en otro subdominio no debe poder
 * usarla aunque su origen forme parte del CORS público de la API.
 */
@Injectable()
export class AdminSessionOriginGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.header(ADMIN_SESSION_HEADER) !== ADMIN_SESSION_HEADER_VALUE) {
      throw new ForbiddenException(
        'Cabecera de sesión administrativa inválida',
      );
    }

    const origin = request.header('origin');
    if (!origin) {
      // Los clientes no navegador pueden omitir Origin, pero un navegador que
      // declare un contexto cruzado nunca puede aprovechar esa excepción.
      const fetchSite = request.header('sec-fetch-site');
      if (fetchSite && !['same-origin', 'none'].includes(fetchSite)) {
        throw new ForbiddenException('Origen administrativo no permitido');
      }
      return true;
    }

    const normalizedOrigin = this.normalizeOrigin(origin);
    if (!normalizedOrigin || normalizedOrigin === 'null') {
      throw new ForbiddenException('Origen administrativo no permitido');
    }

    const allowed = new Set(this.configuredOrigins());
    // En producción el Host puede pertenecer a un reverse proxy que también
    // publica el portal cliente. Solo la lista administrativa explícita es una
    // raíz de confianza. La inferencia por Host queda limitada al HMR local.
    if (this.config.get<string>('NODE_ENV') !== 'production') {
      const requestOrigin = this.requestOrigin(request);
      if (requestOrigin) allowed.add(requestOrigin);
    }
    if (!allowed.has(normalizedOrigin)) {
      throw new ForbiddenException('Origen administrativo no permitido');
    }
    return true;
  }

  private configuredOrigins(): string[] {
    return (this.config.get<string>('ADMIN_PANEL_ORIGINS') || '')
      .split(',')
      .map((value) => this.normalizeOrigin(value))
      .filter((value): value is string => Boolean(value));
  }

  private requestOrigin(request: Request): string | undefined {
    const host = request.get('host');
    if (!host) return undefined;
    return this.normalizeOrigin(`${request.protocol}://${host}`);
  }

  private normalizeOrigin(value: string): string | undefined {
    try {
      const url = new URL(value.trim());
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.pathname !== '/' ||
        url.search ||
        url.hash ||
        url.username ||
        url.password
      ) {
        return undefined;
      }
      return url.origin;
    } catch {
      return undefined;
    }
  }
}
