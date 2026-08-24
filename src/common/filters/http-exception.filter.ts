import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let code: string | undefined;
    let meta: Record<string, unknown> | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
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

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message,
      ...(code ? { code } : {}),
      ...(meta ? { meta } : {}),
    });
  }
}
