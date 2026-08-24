import { INestApplication } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Connection, Model } from 'mongoose';
import * as request from 'supertest';
import { App } from 'supertest/types';
import { User, UserDocument } from '../src/modules/users/schemas/user.schema';
import { UserRole } from '../src/modules/users/enums/user-role.enum';

describe('Sorteos API transaction journey (e2e)', () => {
  let app: INestApplication<App>;
  let connection: Connection;
  let users: Model<UserDocument>;

  beforeAll(async () => {
    const uri = process.env.MONGODB_INTEGRATION_URI;
    if (!uri) {
      throw new Error(
        'MONGODB_INTEGRATION_URI es obligatorio; use una base exclusiva con replica set',
      );
    }
    process.env.NODE_ENV = 'test';
    process.env.MONGODB_URI = uri;
    process.env.MONGODB_AUTO_INDEX = 'true';
    process.env.JWT_SECRET = 'e2e-jwt-secret-with-at-least-32-characters';
    process.env.EMAIL_CODE_SECRET =
      'e2e-email-secret-with-at-least-32-characters';
    process.env.PAYMENTS_PUBLIC_SECRET_KEY =
      'e2e-payment-secret-with-at-least-32-characters';
    process.env.CHECKOUT_ACCESS_SECRET_KEY =
      'e2e-checkout-secret-with-at-least-32-characters';
    process.env.PAYMENTS_PROVIDER = 'mock';
    process.env.PAYMENTS_ALLOW_MOCK = 'true';

    const { AppModule } = await import('../src/app.module');
    const testingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = testingModule.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    connection = app.get<Connection>(getConnectionToken());
    if (!connection.db?.databaseName.endsWith('_e2e')) {
      throw new Error('La URI de integración debe apuntar a una base terminada en _e2e');
    }
    await connection.dropDatabase();
    await connection.syncIndexes();
    users = app.get<Model<UserDocument>>(getModelToken(User.name));
  }, 60_000);

  afterAll(async () => {
    if (connection?.db?.databaseName.endsWith('_e2e')) {
      await connection.dropDatabase();
    }
    await app?.close();
  }, 30_000);

  it('completes auth, checkout, Pix, titles, draw, result and refund atomically', async () => {
    const http = app.getHttpServer();
    const registration = await request(http)
      .post('/api/v1/auth/register')
      .send({
        phone: '+5511999999999',
        password: 'AdminE2e9Secure',
        name: 'Admin E2E',
        nickname: 'admin-e2e',
        cpf: '52998224725',
        email: 'admin-e2e@example.test',
      })
      .expect(201);
    await users.updateOne(
      { _id: registration.body.user.id },
      { $set: { role: UserRole.ADMIN } },
    );

    const login = await request(http)
      .post('/api/v1/auth/login')
      .send({ phone: '+5511999999999', password: 'AdminE2e9Secure' })
      .expect(200);
    const authorization = `Bearer ${login.body.accessToken}`;

    const createdCampaign = await request(http)
      .post('/api/v1/admin/campaigns')
      .set('Authorization', authorization)
      .send({
        name: 'Sorteo transaccional E2E',
        slug: 'sorteo-transaccional-e2e',
        shortDescription: 'Prueba integral',
        regulationHtml: '<p>Reglamento E2E inmutable</p>',
        termsVersion: 'v1',
        status: 'active',
        totalTitles: 20,
        quotaDigits: 2,
        itemPrice: 15000,
        ticketPrice: 1,
        itemCondition: 'new',
        prizeTitle: 'Premio E2E',
        minimumOrderAmount: 1,
        maxTitlesPerOrder: 20,
        quantitySuggestions: [10],
        drawMethod: 'manual_external',
      })
      .expect(201);
    const campaignId = String(
      createdCampaign.body._id ?? createdCampaign.body.id,
    );
    expect(campaignId).toMatch(/^[a-f0-9]{24}$/);

    const checkout = await request(http)
      .post('/api/v1/checkout')
      .send({
        campaignSlug: 'sorteo-transaccional-e2e',
        quantity: 10,
        buyer: {
          name: 'Compradora E2E',
          phone: '+5511988888888',
          email: 'buyer-e2e@example.test',
          cpf: '11144477735',
        },
        termsVersion: 'v1',
        idempotencyKey: 'e2e-checkout-request-000001',
      })
      .expect(201);
    expect(checkout.body.order.termsHash).toMatch(/^[a-f0-9]{64}$/);
    expect(checkout.body.order.quotas).toHaveLength(10);
    const orderPublicId = checkout.body.order.publicId;
    const orderToken = checkout.body.orderAccessToken;
    const winningNumber = checkout.body.order.quotas[0].number;

    await request(http)
      .post('/api/v1/payments/webhooks/mock')
      .send({
        txid: checkout.body.payment.txid,
        status: 'paid',
        eventId: 'e2e-payment-paid-1',
        endToEndId: 'E2E123456789',
      })
      .expect(200)
      .expect(({ body }) => expect(body.processed).toBe(1));

    await request(http)
      .get(`/api/v1/checkout/${orderPublicId}`)
      .set('X-Order-Token', orderToken)
      .expect(200)
      .expect(({ body }) => {
        expect(body.order.status).toBe('paid');
        expect(body.order.quotas).toHaveLength(10);
        expect(body.order.quotas.every((quota: any) => quota.status === 'paid')).toBe(
          true,
        );
      });

    const refundableCheckout = await request(http)
      .post('/api/v1/checkout')
      .send({
        campaignSlug: 'sorteo-transaccional-e2e',
        quantity: 10,
        buyer: {
          name: 'Comprador reembolsable E2E',
          phone: '+5511977777777',
          email: 'refund-e2e@example.test',
          cpf: '12345678909',
        },
        termsVersion: 'v1',
        idempotencyKey: 'e2e-checkout-request-000002',
      })
      .expect(201);
    await request(http)
      .post('/api/v1/payments/webhooks/mock')
      .send({
        txid: refundableCheckout.body.payment.txid,
        status: 'paid',
        eventId: 'e2e-payment-paid-2',
        endToEndId: 'E2E987654321',
      })
      .expect(200)
      .expect(({ body }) => expect(body.processed).toBe(1));

    const refundableOrderPublicId = refundableCheckout.body.order.publicId;
    const refundableOrderToken = refundableCheckout.body.orderAccessToken;
    const refundablePaymentId = refundableCheckout.body.payment.id;

    await request(http)
      .post(`/api/v1/admin/campaigns/${campaignId}/draw/verify/manual-external`)
      .set('Authorization', authorization)
      .send({
        winningNumber,
        evidenceUrl: 'https://example.test/evidence/e2e',
        explanation: 'Resultado externo de la prueba E2E',
      })
      .expect(201);

    await request(http)
      .post(`/api/v1/admin/campaigns/${campaignId}/draw/publish`)
      .set('Authorization', authorization)
      .expect(201)
      .expect(({ body }) => {
        expect(body.status).toBe('published');
        expect(body.outcomes[0].winningNumber).toBe(winningNumber);
      });

    await request(http)
      .get('/api/v1/campaigns/sorteo-transaccional-e2e/result')
      .expect(200)
      .expect(({ body }) => {
        expect(body.status).toBe('published');
        expect(body.outcomes[0].winner.name).toContain('Compradora');
      });

    await request(http)
      .post(`/api/v1/payments/admin/${refundablePaymentId}/refund`)
      .set('Authorization', authorization)
      .send({
        idempotencyKey: 'e2e-refund-request-000001',
        reason: 'Validar reversión integral E2E',
      })
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe('refunded'));

    await request(http)
      .get(`/api/v1/checkout/${refundableOrderPublicId}`)
      .set('X-Order-Token', refundableOrderToken)
      .expect(200)
      .expect(({ body }) => {
        expect(body.order.status).toBe('refunded');
        expect(body.order.quotas).toHaveLength(10);
        expect(body.order.quotas.every((quota: any) => quota.historical)).toBe(
          true,
        );
      });
  }, 60_000);
});
