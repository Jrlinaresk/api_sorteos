import { INestApplication } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Connection, Model } from 'mongoose';
import * as request from 'supertest';
import { App } from 'supertest/types';
import { User, UserDocument } from '../src/modules/users/schemas/user.schema';
import { UserRole } from '../src/modules/users/enums/user-role.enum';
import { EmailService } from '../src/modules/email/email.service';

describe('Sorteos API transaction journey (e2e)', () => {
  let app: INestApplication<App>;
  let connection: Connection;
  let users: Model<UserDocument>;
  const sentCodes: Array<{ recipient: string; code: string }> = [];
  const transactionalEmails: Array<{ recipient: string; eventKey: string }> =
    [];

  async function waitForCode(
    recipient: string,
    fromIndex: number,
  ): Promise<string> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const message = sentCodes
        .slice(fromIndex)
        .find((candidate) => candidate.recipient === recipient);
      if (message) return message.code;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`No se recibió el código para ${recipient}`);
  }

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
    process.env.DRAW_MANUAL_EXTERNAL_ENABLED = 'true';

    const { AppModule } = await import('../src/app.module');
    const testingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(EmailService)
      .useValue({
        sendVerificationEmail: async (recipient: string, code: string) => {
          sentCodes.push({ recipient, code });
        },
        sendTransactionalEmail: async (recipient: string, eventKey: string) => {
          transactionalEmails.push({ recipient, eventKey });
        },
      })
      .compile();
    app = testingModule.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    connection = app.get<Connection>(getConnectionToken());
    if (!connection.db?.databaseName.endsWith('_e2e')) {
      throw new Error(
        'La URI de integración debe apuntar a una base terminada en _e2e',
      );
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
    const registrationCodeIndex = sentCodes.length;
    const pendingRegistration = await request(http)
      .post('/api/v1/auth/register')
      .send({
        phone: '+5511999999999',
        password: 'AdminE2e9Secure',
        name: 'Admin E2E',
        nickname: 'admin-e2e',
        cpf: '52998224725',
        email: 'admin-e2e@example.test',
      })
      .expect(202)
      .expect(({ body }) => {
        expect(body.verificationRequired).toBe(true);
        expect(body.registrationId).toEqual(expect.any(String));
      });
    const registrationCode = await waitForCode(
      'admin-e2e@example.test',
      registrationCodeIndex,
    );
    const registration = await request(http)
      .post('/api/v1/auth/register/confirm')
      .send({
        email: 'admin-e2e@example.test',
        code: registrationCode,
        registrationId: pendingRegistration.body.registrationId,
      })
      .expect(200);
    await users.updateOne(
      { _id: registration.body.user.id },
      { $set: { role: UserRole.ADMIN } },
    );

    const login = await request(http)
      .post('/api/v1/auth/login')
      .send({ phone: '+5511999999999', password: 'AdminE2e9Secure' })
      .expect(200);
    const authorization = `Bearer ${login.body.accessToken}`;

    const publisherCodeIndex = sentCodes.length;
    const pendingPublisherRegistration = await request(http)
      .post('/api/v1/auth/register')
      .send({
        phone: '+5511966666666',
        password: 'PublisherE2e9Secure',
        name: 'Publisher E2E',
        nickname: 'publisher-e2e',
        cpf: '11144477735',
        email: 'publisher-e2e@example.test',
      })
      .expect(202)
      .expect(({ body }) => {
        expect(body.verificationRequired).toBe(true);
        expect(body.registrationId).toEqual(expect.any(String));
      });
    const publisherCode = await waitForCode(
      'publisher-e2e@example.test',
      publisherCodeIndex,
    );
    const publisherRegistration = await request(http)
      .post('/api/v1/auth/register/confirm')
      .send({
        email: 'publisher-e2e@example.test',
        code: publisherCode,
        registrationId: pendingPublisherRegistration.body.registrationId,
      })
      .expect(200);
    await users.updateOne(
      { _id: publisherRegistration.body.user.id },
      { $set: { role: UserRole.ADMIN } },
    );
    const publisherLogin = await request(http)
      .post('/api/v1/auth/login')
      .send({ phone: '+5511966666666', password: 'PublisherE2e9Secure' })
      .expect(200);
    const publisherAuthorization = `Bearer ${publisherLogin.body.accessToken}`;

    const createdCampaign = await request(http)
      .post('/api/v1/admin/campaigns')
      .set('Authorization', authorization)
      .send({
        name: 'Sorteo transaccional E2E',
        slug: 'sorteo-transaccional-e2e',
        shortDescription: 'Prueba integral',
        regulationHtml: '<p>Reglamento E2E inmutable</p>',
        termsVersion: 'v1',
        status: 'draft',
        totalTitles: 20,
        quotaDigits: 2,
        itemPrice: 15000,
        ticketPrice: 1,
        itemCondition: 'new',
        prizeTitle: 'Premio E2E',
        cashAlternative: 10000,
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

    await request(http)
      .patch(`/api/v1/admin/campaigns/${campaignId}/status`)
      .set('Authorization', authorization)
      .send({ status: 'active' })
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe('active'));

    const checkout = await request(http)
      .post('/api/v1/checkout')
      .set('Authorization', authorization)
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
        expect(
          body.order.quotas.every((quota: any) => quota.status === 'paid'),
        ).toBe(true);
      });

    await request(http)
      .get('/api/v1/me/orders')
      .set('Authorization', authorization)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              publicId: orderPublicId,
              status: 'paid',
            }),
          ]),
        );
      });

    await request(http)
      .get(`/api/v1/me/titles?campaignId=${campaignId}`)
      .set('Authorization', authorization)
      .expect(200)
      .expect(({ body }) => {
        expect(body.meta).toEqual(
          expect.objectContaining({ total: 10, page: 1 }),
        );
        expect(body.data).toHaveLength(10);
        expect(body.data).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ number: winningNumber, status: 'paid' }),
          ]),
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
    let refundableOrderToken = refundableCheckout.body.orderAccessToken;
    const refundablePaymentId = refundableCheckout.body.payment.id;

    const recovery = await request(http)
      .post('/api/v1/orders/access/request')
      .send({
        phone: '+55 (11) 97777-7777',
        email: 'REFUND-E2E@EXAMPLE.TEST',
        campaignId,
      })
      .expect(202);
    const recoveryEmail = sentCodes.find(
      (message) => message.recipient === 'refund-e2e@example.test',
    );
    expect(recoveryEmail?.code).toMatch(/^\d{6}$/);

    const recovered = await request(http)
      .post('/api/v1/orders/access/confirm')
      .send({
        challengeId: recovery.body.challengeId,
        code: recoveryEmail?.code,
      })
      .expect(200);
    const recoveredOrder = recovered.body.orders.find(
      (order: { id?: string }) => order.id === refundableOrderPublicId,
    );
    expect(recoveredOrder?.accessToken).toEqual(expect.any(String));

    await request(http)
      .get(`/api/v1/checkout/${refundableOrderPublicId}`)
      .set('X-Order-Token', refundableOrderToken)
      .expect(403);
    refundableOrderToken = recoveredOrder.accessToken;
    await request(http)
      .get(`/api/v1/checkout/${refundableOrderPublicId}`)
      .set('X-Order-Token', refundableOrderToken)
      .expect(200);

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
      .set('Authorization', publisherAuthorization)
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

    const mainAward = await request(http)
      .get(`/api/v1/main-awards/order/${orderPublicId}`)
      .set('Authorization', authorization)
      .expect(200)
      .expect(({ body }) => {
        expect(body.status).toBe('pending');
        expect(body.campaignId).toBe(campaignId);
        expect(body.availableChoices).toEqual(['physical', 'cash']);
      });

    await request(http)
      .post(`/api/v1/main-awards/${mainAward.body.publicId}/claim`)
      .set('Authorization', authorization)
      .send({ choice: 'cash' })
      .expect(201)
      .expect(({ body }) => {
        expect(body.status).toBe('claimed');
        expect(body.choice).toBe('cash');
      });

    await request(http)
      .post(`/api/v1/admin/main-awards/${mainAward.body.publicId}/fulfill`)
      .set('Authorization', publisherAuthorization)
      .send({
        reference: 'E2E-MAIN-PRIZE-TRANSFER',
        notes: 'Entrega integral validada por la prueba E2E',
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body.status).toBe('fulfilled');
        expect(body.fulfillmentReference).toBe('E2E-MAIN-PRIZE-TRANSFER');
      });

    const concurrentRefunds = await Promise.all([
      request(http)
        .post(`/api/v1/payments/admin/${refundablePaymentId}/refund`)
        .set('Authorization', authorization)
        .send({
          idempotencyKey: 'e2e-refund-concurrent-000001',
          amount: 7,
          reason: 'Validar reserva concurrente E2E A',
        }),
      request(http)
        .post(`/api/v1/payments/admin/${refundablePaymentId}/refund`)
        .set('Authorization', authorization)
        .send({
          idempotencyKey: 'e2e-refund-concurrent-000002',
          amount: 7,
          reason: 'Validar reserva concurrente E2E B',
        }),
    ]);
    expect(concurrentRefunds.map((response) => response.status).sort()).toEqual(
      [200, 400],
    );
    expect(
      concurrentRefunds.find((response) => response.status === 200)?.body
        .status,
    ).toBe('partially_refunded');

    await request(http)
      .post(`/api/v1/payments/admin/${refundablePaymentId}/refund`)
      .set('Authorization', authorization)
      .send({
        idempotencyKey: 'e2e-refund-remainder-000003',
        reason: 'Completar saldo restante después de la carrera E2E',
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

    expect(transactionalEmails).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          recipient: 'buyer-e2e@example.test',
          eventKey: `main-award:${mainAward.body.publicId}:email`,
        }),
        expect.objectContaining({
          recipient: 'refund-e2e@example.test',
          eventKey: `fulfillment:${refundablePaymentId}:paid`,
        }),
        expect.objectContaining({
          recipient: 'refund-e2e@example.test',
          eventKey: `fulfillment:${refundablePaymentId}:refunded`,
        }),
      ]),
    );
  }, 60_000);
});
