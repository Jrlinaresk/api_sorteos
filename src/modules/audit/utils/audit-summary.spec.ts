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
      phone: '[REDACTED]',
      password: '[REDACTED]',
      nested: { accessToken: '[REDACTED]', name: '[REDACTED]' },
    });
  });

  it('redacta búsquedas libres que pueden contener CPF, correo o nombre', () => {
    expect(
      summarizeAuditValue({
        query: { search: '123.456.789-00', q: 'ana@example.com' },
        filter: 'João da Silva',
        status: 'paid',
      }),
    ).toEqual({
      query: { search: '[REDACTED]', q: '[REDACTED]' },
      filter: '[REDACTED]',
      status: 'paid',
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
