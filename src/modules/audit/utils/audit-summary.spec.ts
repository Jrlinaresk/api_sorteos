import { summarizeAuditValue } from './audit-summary';

describe('summarizeAuditValue', () => {
  it('elimina secretos incluso dentro de objetos anidados', () => {
    expect(
      summarizeAuditValue({
        phone: '+5511999999999',
        password: 'secret-value',
        nested: { accessToken: 'jwt', name: 'João' },
      }),
    ).toEqual({
      phone: '+5511999999999',
      password: '[REDACTED]',
      nested: { accessToken: '[REDACTED]', name: 'João' },
    });
  });

  it('limita cadenas, ciclos y colecciones grandes', () => {
    const circular: Record<string, unknown> = { text: 'x'.repeat(700) };
    circular.self = circular;
    const value = summarizeAuditValue(circular) as Record<string, unknown>;
    expect(String(value.text).length).toBe(501);
    expect(value.self).toBe('[CIRCULAR]');
  });
});
