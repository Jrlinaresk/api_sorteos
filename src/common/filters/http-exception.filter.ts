import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Request, Response } from 'express';

type ErrorLogger = Pick<Logger, 'error'>;

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    private readonly logger: ErrorLogger = new Logger(AllExceptionsFilter.name),
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let code: string | undefined;
    let meta: Record<string, unknown> | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      // Los mensajes 5xx suelen envolver errores de drivers o proveedores.
      // Nunca se consideran contenido público, aunque sean HttpException.
      if (status < HttpStatus.INTERNAL_SERVER_ERROR) {
        const responseBody = exception.getResponse();
        message =
          typeof responseBody === 'string'
            ? responseBody
            : (responseBody as any).message || message;
        if (responseBody && typeof responseBody === 'object') {
          const structured = responseBody as Record<string, unknown>;
          if (
            typeof structured.code === 'string' &&
            /^[A-Z0-9_]{1,80}$/.test(structured.code)
          ) {
            code = structured.code;
          }
          if (
            structured.meta &&
            typeof structured.meta === 'object' &&
            !Array.isArray(structured.meta)
          ) {
            meta = structured.meta as Record<string, unknown>;
          }
        }
      }
    }

    const correlationId = this.correlationId(request, response);
    const path = this.requestPath(request);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      const rawErrorName =
        exception instanceof Error && exception.name
          ? exception.name.slice(0, 120)
          : 'UnknownError';
      const errorName =
        rawErrorName.replace(/[^A-Za-z0-9_.:-]/g, '') || 'UnknownError';
      this.logger.error({
        event: 'http.unexpected_error',
        statusCode: status,
        correlationId,
        method: this.requestMethod(request),
        path,
        error: {
          name: errorName,
          stack: this.safeStack(exception, errorName),
        },
      });
    }

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path,
      correlationId,
      message,
      ...(code ? { code } : {}),
      ...(meta ? { meta } : {}),
    });
  }

  private correlationId(request: Request, response: Response): string {
    const current = response.getHeader?.('X-Correlation-Id');
    const provided =
      typeof current === 'string'
        ? current
        : (request.get?.('x-correlation-id') ??
          request.headers?.['x-correlation-id']);
    const raw = Array.isArray(provided) ? provided[0] : provided;
    const safe = raw
      ?.trim()
      .replace(/[^A-Za-z0-9._:-]/g, '')
      .slice(0, 100);
    const correlationId = safe || randomUUID();
    response.setHeader?.('X-Correlation-Id', correlationId);
    return correlationId;
  }

  private requestPath(request: Request): string {
    const candidate = request.originalUrl || request.path || request.url || '/';
    return candidate.split('?', 1)[0].slice(0, 2_048) || '/';
  }

  private requestMethod(request: Request): string {
    const method = request.method?.toUpperCase();
    return method && /^[A-Z]{1,16}$/.test(method) ? method : 'UNKNOWN';
  }

  /**
   * Conserva únicamente marcos de ejecución. La primera línea de Error.stack
   * contiene el mensaje original y puede incluir credenciales de drivers o de
   * proveedores, por lo que se reemplaza por un encabezado neutro.
   */
  private safeStack(exception: unknown, errorName: string): string {
    if (!(exception instanceof Error) || !exception.stack) {
      return `${errorName}: unexpected internal error`;
    }
    const frames = exception.stack
      .split(/\r?\n/)
      .slice(1)
      .map((line) => line.trimEnd())
      .filter((line) => /^\s*at\s/.test(line))
      .slice(0, 30)
      .join('\n')
      .replace(/[\r\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
      .slice(0, 8_000);
    return frames
      ? `${errorName}: unexpected internal error\n${frames}`
      : `${errorName}: unexpected internal error`;
  }
}
