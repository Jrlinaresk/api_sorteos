import {
  configurePrivateApiCaching,
  privateApiCachePolicy,
} from './private-api-cache.config';

describe('private API cache policy', () => {
  it.each([
    ['/api/v1/auth/login', 'Authorization'],
    ['/api/v1/client/session/refresh', 'Cookie'],
    ['/api/v1/me/orders', 'Authorization'],
    ['/api/v1/checkout/ORDER-1', 'X-Order-Token'],
    ['/api/v1/orders/access/confirm', 'Authorization'],
    ['/api/v1/payments/507f1f77bcf86cd799439011', 'X-Payment-Token'],
    ['/api/v1/prizes/attempts/ATTEMPT/play', 'X-Prize-Token'],
    ['/api/v1/prizes/attempts/ATTEMPT/play', 'Authorization'],
    ['/api/v1/prizes/attempts/order/ORDER-1', 'Authorization'],
    ['/api/v1/prize-awards/order/ORDER-1', 'Authorization'],
    ['/api/v1/prize-awards/AWARD/claim', 'X-Order-Token'],
    ['/api/v1/main-awards/AWARD', 'Authorization'],
  ])('protege %s y varía por %s', (path, varyHeader) => {
    expect(privateApiCachePolicy(path)?.vary).toContain(varyHeader);
  });

  it.each([
    '/api/v1/campaigns',
    '/api/v1/campaigns/CAMP/prizes',
    '/api/v1/results',
    '/api/v1/payments/webhooks/efi',
    '/api/v1/payments/admin',
  ])('no deshabilita la caché de la superficie no tokenizada %s', (path) => {
    expect(privateApiCachePolicy(path)).toBeUndefined();
  });

  it('protege cualquier representación autenticada aunque viva fuera de /me', () => {
    expect(
      privateApiCachePolicy('/api/v1/notifications/inbox', {
        authorization: 'Bearer access-token',
      })?.vary,
    ).toContain('Authorization');
    expect(
      privateApiCachePolicy('/api/v1/campaigns', {
        'x-order-token': 'opaque-token',
      })?.vary,
    ).toContain('X-Order-Token');
  });

  it('aplica no-store y Vary sin cortar la cadena Express', () => {
    let middleware: ((...args: never[]) => void) | undefined;
    const express = {
      use: jest.fn((handler: (...args: never[]) => void) => {
        middleware = handler;
      }),
    };
    configurePrivateApiCaching(express as never);
    const response = { setHeader: jest.fn(), vary: jest.fn() };
    const next = jest.fn();

    middleware?.(
      {
        originalUrl: '/api/v1/client/session/me',
        path: '',
        headers: {},
      } as never,
      response as never,
      next as never,
    );

    expect(response.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'private, no-store, max-age=0',
    );
    expect(response.vary).toHaveBeenCalledWith('Cookie');
    expect(response.vary).toHaveBeenCalledWith('Authorization');
    expect(next).toHaveBeenCalledTimes(1);
  });
});
