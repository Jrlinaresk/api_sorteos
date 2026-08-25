import type { Express, NextFunction, Request, Response } from 'express';

export interface PrivateApiCachePolicy {
  vary: string[];
}

/**
 * Devuelve política solo para respuestas privadas o protegidas por tokens
 * opacos. Las colecciones públicas (campañas, premios visibles, resultados)
 * quedan fuera para conservar su capacidad de caché.
 */
export function privateApiCachePolicy(
  requestPath: string,
  headers: Record<string, unknown> = {},
): PrivateApiCachePolicy | undefined {
  const path = requestPath.split('?', 1)[0].replace(/\/$/, '');
  const origin = ['Origin'];
  const presentedCredentials = [
    ['authorization', 'Authorization'],
    ['x-order-token', 'X-Order-Token'],
    ['x-payment-token', 'X-Payment-Token'],
    ['x-prize-token', 'X-Prize-Token'],
  ]
    .filter(([name]) => headers[name] !== undefined)
    .map(([, canonicalName]) => canonicalName);

  if (
    path === '/api/v1/auth' ||
    path.startsWith('/api/v1/auth/') ||
    path === '/api/v1/client/session' ||
    path.startsWith('/api/v1/client/session/')
  ) {
    return {
      vary: unique([
        ...origin,
        'Cookie',
        'Authorization',
        'X-Client-Session',
        ...presentedCredentials,
      ]),
    };
  }

  if (path === '/api/v1/me' || path.startsWith('/api/v1/me/')) {
    return { vary: [...origin, 'Authorization'] };
  }

  if (path === '/api/v1/checkout' || path.startsWith('/api/v1/checkout/')) {
    return { vary: [...origin, 'Authorization', 'X-Order-Token'] };
  }

  if (
    path === '/api/v1/orders/access' ||
    path.startsWith('/api/v1/orders/access/')
  ) {
    return { vary: [...origin, 'Authorization'] };
  }

  if (
    /^\/api\/v1\/payments\/(?!admin(?:\/|$)|webhooks(?:\/|$))[^/]+$/.test(path)
  ) {
    return { vary: [...origin, 'X-Payment-Token'] };
  }

  if (
    path.startsWith('/api/v1/prizes/attempts/order/') ||
    path.startsWith('/api/v1/prize-awards/order/') ||
    /^\/api\/v1\/prize-awards\/[^/]+\/claim$/.test(path)
  ) {
    return {
      vary: [...origin, 'Authorization', 'X-Order-Token'],
    };
  }

  if (/^\/api\/v1\/prizes\/attempts\/[^/]+\/play$/.test(path)) {
    return { vary: [...origin, 'Authorization', 'X-Prize-Token'] };
  }

  if (
    path === '/api/v1/main-awards' ||
    path.startsWith('/api/v1/main-awards/')
  ) {
    return { vary: [...origin, 'Authorization', 'X-Order-Token'] };
  }

  if (presentedCredentials.length) {
    return { vary: unique([...origin, ...presentedCredentials]) };
  }

  return undefined;
}

export function configurePrivateApiCaching(express: Express): void {
  express.use(
    (request: Request, response: Response, next: NextFunction): void => {
      const policy = privateApiCachePolicy(
        request.originalUrl || request.path,
        request.headers,
      );
      if (!policy) {
        next();
        return;
      }

      response.setHeader('Cache-Control', 'private, no-store, max-age=0');
      response.setHeader('Pragma', 'no-cache');
      response.setHeader('Expires', '0');
      for (const header of policy.vary) response.vary(header);
      next();
    },
  );
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
