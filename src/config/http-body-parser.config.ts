import { json, RequestHandler, urlencoded } from 'express';

/**
 * Límites deliberadamente estáticos: cubren los HTML largos admitidos por los
 * DTO sin convertir el parser en un amplificador de memoria configurable.
 */
export const HTTP_JSON_BODY_LIMIT = '512kb';
export const HTTP_URLENCODED_BODY_LIMIT = '128kb';
export const HTTP_URLENCODED_PARAMETER_LIMIT = 100;

interface MiddlewareTarget {
  use(middleware: RequestHandler): unknown;
}

export function configureHttpBodyParsers(app: MiddlewareTarget): void {
  app.use(
    json({
      limit: HTTP_JSON_BODY_LIMIT,
      strict: true,
      type: 'application/json',
    }),
  );
  app.use(
    urlencoded({
      extended: false,
      limit: HTTP_URLENCODED_BODY_LIMIT,
      parameterLimit: HTTP_URLENCODED_PARAMETER_LIMIT,
      type: 'application/x-www-form-urlencoded',
    }),
  );
}
