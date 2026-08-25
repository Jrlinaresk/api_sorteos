import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import type { Express, NextFunction, Request, Response } from 'express';
import { static as serveStatic } from 'express';

type AdminPanelLogger = Pick<Logger, 'log' | 'warn'>;

/**
 * Sirve la SPA administrativa desde el mismo proceso que la API. Vite escribe
 * los artefactos versionados en dist/admin después de compilar Nest.
 */
export function configureAdminPanel(
  express: Express,
  config: ConfigService,
  logger: AdminPanelLogger,
): boolean {
  express.use(
    ['/api/v1/admin', '/api/v1/payments/admin', '/api/v1/users'],
    (_request: Request, response: Response, next: NextFunction) => {
      response.setHeader('Cache-Control', 'private, no-store, max-age=0');
      response.setHeader('Pragma', 'no-cache');
      response.setHeader('Expires', '0');
      next();
    },
  );

  if (config.get<string>('ADMIN_PANEL_ENABLED') === 'false') {
    logger.log('Panel administrativo deshabilitado por configuración');
    return false;
  }

  const root = resolve(process.cwd(), 'dist', 'admin');
  const indexFile = join(root, 'index.html');
  if (!existsSync(indexFile)) {
    const message =
      'No se encontró dist/admin/index.html; ejecute pnpm build:admin para servir /admin';
    if (config.get<string>('NODE_ENV') === 'production') {
      throw new Error(message);
    }
    logger.warn(message);
    return false;
  }

  express.use(
    '/admin/assets',
    serveStatic(join(root, 'assets'), {
      dotfiles: 'deny',
      index: false,
      immutable: true,
      maxAge: '1y',
      fallthrough: false,
    }),
  );
  express.use(
    '/admin',
    serveStatic(root, {
      dotfiles: 'deny',
      index: false,
      maxAge: 0,
      fallthrough: true,
      setHeaders: (response, filePath) => {
        if (filePath.endsWith('.html')) {
          response.setHeader('Cache-Control', 'no-store');
        }
      },
    }),
  );
  express.get(
    /^\/admin(?:\/.*)?$/,
    (_request: Request, response: Response, next: NextFunction) => {
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
      response.sendFile(indexFile, (error) => {
        if (error) next(error);
      });
    },
  );
  logger.log('Panel administrativo disponible en /admin');
  return true;
}
