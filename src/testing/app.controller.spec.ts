import { HealthController } from '../health/health.controller';

describe('HealthController', () => {
  it('reports a live process without exposing secrets', () => {
    const response = new HealthController({} as any).live();
    expect(response.status).toBe('ok');
    expect(response.uptime).toBeGreaterThanOrEqual(0);
    expect(response).not.toHaveProperty('env');
  });

  it('reports MongoDB readiness', async () => {
    const command = jest.fn().mockResolvedValue({ ok: 1 });
    const controller = new HealthController({
      readyState: 1,
      db: { admin: () => ({ command }) },
    } as any);
    await expect(controller.check()).resolves.toEqual(
      expect.objectContaining({ dependencies: { mongodb: 'ok' } }),
    );
  });
});
