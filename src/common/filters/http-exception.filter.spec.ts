import {
  ArgumentsHost,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { AllExceptionsFilter } from './http-exception.filter';

describe('AllExceptionsFilter structured errors', () => {
  const httpHost = (
    request: Record<string, unknown>,
    response: Record<string, unknown>,
  ) =>
    ({
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => request,
      }),
    }) as unknown as ArgumentsHost;

  it('conserva solo code y meta explícitos de una excepción HTTP', () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const setHeader = jest.fn();
    const host = httpHost(
      { url: '/api/v1/orders/access/confirm' },
      { status, setHeader },
    );
    const exception = new BadRequestException({
      message: 'Filtre por campaña',
      code: 'ORDER_ACCESS_CAMPAIGN_REQUIRED',
      meta: { hasMore: true },
      secret: 'no debe exponerse',
    });

    new AllExceptionsFilter().catch(exception, host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        path: '/api/v1/orders/access/confirm',
        message: 'Filtre por campaña',
        code: 'ORDER_ACCESS_CAMPAIGN_REQUIRED',
        meta: { hasMore: true },
      }),
    );
    expect(json.mock.calls[0][0]).not.toHaveProperty('secret');
    expect(setHeader).toHaveBeenCalledWith(
      'X-Correlation-Id',
      expect.stringMatching(/^[0-9a-f-]{36}$/),
    );
  });

  it('registra un 5xx con pila y correlation ID sin filtrar datos de la petición', () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const setHeader = jest.fn();
    const logger = { error: jest.fn() };
    const exception = new Error(
      'password=super-secreto mongodb://admin:clave@mongodb:27017/app',
    );
    const host = httpHost(
      {
        method: 'post',
        originalUrl: '/api/v1/payments?token=secreto-en-query',
        headers: {
          authorization: 'Bearer no-debe-aparecer',
          'x-correlation-id': 'trace-123<script>',
        },
        body: { card: 'no-debe-aparecer' },
      },
      { status, setHeader },
    );

    new AllExceptionsFilter(logger).catch(exception, host);

    expect(logger.error).toHaveBeenCalledWith({
      event: 'http.unexpected_error',
      statusCode: 500,
      correlationId: 'trace-123script',
      method: 'POST',
      path: '/api/v1/payments',
      error: {
        name: 'Error',
        stack: expect.stringContaining('Error: unexpected internal error'),
      },
    });
    const serialized = JSON.stringify(logger.error.mock.calls[0][0]);
    expect(serialized).not.toContain('super-secreto');
    expect(serialized).not.toContain('admin:clave');
    expect(serialized).not.toContain('token=');
    expect(serialized).not.toContain('Bearer');
    expect(serialized).not.toContain('card');
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 500,
        path: '/api/v1/payments',
        correlationId: 'trace-123script',
        message: 'Internal server error',
      }),
    );
  });

  it('también registra HttpException 5xx y no registra errores esperados 4xx', () => {
    const logger = { error: jest.fn() };
    const json = jest.fn();
    const response = {
      status: jest.fn().mockReturnValue({ json }),
      setHeader: jest.fn(),
    };
    const host = httpHost({ method: 'GET', path: '/health' }, response);

    new AllExceptionsFilter(logger).catch(
      new InternalServerErrorException('fallo controlado'),
      host,
    );
    new AllExceptionsFilter(logger).catch(
      new BadRequestException('entrada inválida'),
      host,
    );

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(json.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        statusCode: 500,
        message: 'Internal server error',
      }),
    );
    expect(JSON.stringify(json.mock.calls[0][0])).not.toContain(
      'fallo controlado',
    );
  });
});
