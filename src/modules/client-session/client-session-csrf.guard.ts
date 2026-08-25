import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

export const CLIENT_SESSION_HEADER = 'x-client-session';
export const CLIENT_SESSION_HEADER_VALUE = 'browser';

/**
 * Las mutaciones de esta superficie dependen de una cookie HttpOnly. Exigir
 * una cabecera no-simple obliga al navegador a superar el preflight CORS y
 * evita login/refresh/logout CSRF incluso cuando SameSite=None sea necesario.
 */
@Injectable()
export class ClientSessionCsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      method?: string;
      headers: Record<string, string | string[] | undefined>;
    }>();
    const method = request.method?.toUpperCase() ?? 'GET';
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return true;

    const header = request.headers[CLIENT_SESSION_HEADER];
    if (
      typeof header === 'string' &&
      header.toLowerCase() === CLIENT_SESSION_HEADER_VALUE
    ) {
      return true;
    }
    throw new ForbiddenException('Solicitud de sesión web no válida');
  }
}
