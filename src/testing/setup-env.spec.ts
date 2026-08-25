import { spawnSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

describe('setup-env.sh', () => {
  it('configura orígenes y correo capturable para desarrollo local', () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'api-sorteos-env-'));
    const outputPath = join(temporaryDirectory, '.env.docker.local');
    const scriptPath = resolve(__dirname, '../../setup-env.sh');

    try {
      const result = spawnSync(
        'bash',
        [scriptPath, '--development', '--output', outputPath],
        { encoding: 'utf8' },
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');

      const environment = Object.fromEntries(
        readFileSync(outputPath, 'utf8')
          .split('\n')
          .filter((line) => line && !line.startsWith('#'))
          .map((line) => {
            const separator = line.indexOf('=');
            return [line.slice(0, separator), line.slice(separator + 1)];
          }),
      );

      expect(environment.CORS_ORIGINS).toBe(
        'http://127.0.0.1:8080,http://localhost:8080,' +
          'http://127.0.0.1:5173,http://localhost:5173,' +
          'http://127.0.0.1:5174,http://localhost:5174',
      );
      expect(environment.ADMIN_PANEL_ORIGINS).toBe(
        'http://127.0.0.1:8080,http://localhost:8080,' +
          'http://127.0.0.1:5173,http://localhost:5173',
      );
      expect(environment.ADMIN_PANEL_ORIGINS).not.toContain(':5174');
      expect(environment).toMatchObject({
        SMTP_HOST: 'mailpit',
        SMTP_PORT: '1025',
        SMTP_USER: '',
        SMTP_PASS: '',
        SMTP_FROM: 'Sorteos Local <no-reply@sorteos.local>',
        SMTP_SECURE: 'false',
        SMTP_REQUIRE_TLS: 'false',
      });
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
