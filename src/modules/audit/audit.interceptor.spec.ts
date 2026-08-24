import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, throwError } from 'rxjs';
import { AuditInterceptor } from './audit.interceptor';
import { AuditCategory } from './enums/audit-category.enum';

describe('AuditInterceptor error privacy', () => {
  it('no persiste el mensaje crudo de un fallo interno', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue({
        action: 'payments.internal',
        category: AuditCategory.SYSTEM,
        resourceType: 'payment',
      }),
    } as unknown as Reflector;
    const audit = { tryRecord: jest.fn().mockResolvedValue(undefined) };
    const interceptor = new AuditInterceptor(reflector, audit as never);
    const response = {
      statusCode: 500,
      setHeader: jest.fn(),
    };
    const request = {
      method: 'POST',
      params: {},
      query: {},
      body: {},
      ip: '127.0.0.1',
      originalUrl: '/api/v1/payments/admin',
      get: jest.fn((name: string) =>
        name === 'x-correlation-id' ? 'test-correlation' : undefined,
      ),
    };
    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
      getHandler: () => function handler() {},
      getClass: () => class TestController {},
    } as unknown as ExecutionContext;
    const next = {
      handle: () =>
        throwError(
          () =>
            new Error('mongodb://admin:super-secret@db/customer@example.test'),
        ),
    } as CallHandler;

    await expect(
      lastValueFrom(interceptor.intercept(context, next)),
    ).rejects.toThrow('super-secret');
    expect(audit.tryRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'failure',
        errorMessage: 'Unexpected internal error',
      }),
    );
  });
});
