import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateNotificationDto } from './create-notification.dto';

describe('CreateNotificationDto actionUrl', () => {
  const base = {
    userId: '507f1f77bcf86cd799439011',
    title: 'Pagamento confirmado',
    body: 'Seus títulos já estão disponíveis.',
  };

  it('acepta rutas internas del portal', async () => {
    const dto = plainToInstance(CreateNotificationDto, {
      ...base,
      actionUrl: '/minha-conta/titulos?pedido=abc',
    });
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it.each([
    'https://phishing.example/conta',
    '//phishing.example/conta',
    '/\\phishing.example/conta',
    'javascript:alert(1)',
    '/conta\nhttps://phishing.example',
  ])('rechaza destinos externos o ambiguos: %s', async (actionUrl) => {
    const dto = plainToInstance(CreateNotificationDto, {
      ...base,
      actionUrl,
    });
    await expect(validate(dto)).resolves.not.toHaveLength(0);
  });
});
