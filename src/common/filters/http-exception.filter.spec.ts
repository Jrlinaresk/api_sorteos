import { ArgumentsHost, BadRequestException } from '@nestjs/common';
import { AllExceptionsFilter } from './http-exception.filter';

describe('AllExceptionsFilter structured errors', () => {
  it('conserva solo code y meta explícitos de una excepción HTTP', () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({ url: '/api/v1/orders/access/confirm' }),
      }),
    } as unknown as ArgumentsHost;
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
  });
});
