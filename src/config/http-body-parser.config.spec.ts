import * as express from 'express';
import * as request from 'supertest';
import {
  configureHttpBodyParsers,
  HTTP_URLENCODED_PARAMETER_LIMIT,
} from './http-body-parser.config';

describe('configureHttpBodyParsers', () => {
  const application = () => {
    const app = express();
    configureHttpBodyParsers(app);
    app.post('/payload', (request_, response) => {
      response.status(204).end();
    });
    return app;
  };

  it('admite el HTML de campaña de 200 KiB dentro de JSON', async () => {
    await request(application())
      .post('/payload')
      .send({ regulationHtml: 'a'.repeat(200 * 1024) })
      .expect(204);
  });

  it('rechaza JSON mayor que el límite fijo de 512 KiB', async () => {
    await request(application())
      .post('/payload')
      .send({ payload: 'a'.repeat(513 * 1024) })
      .expect(413);
  });

  it('rechaza formularios con demasiados parámetros', async () => {
    const payload = Array.from(
      { length: HTTP_URLENCODED_PARAMETER_LIMIT + 1 },
      (_, index) => `field${index}=value`,
    ).join('&');
    await request(application())
      .post('/payload')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(payload)
      .expect(413);
  });
});
