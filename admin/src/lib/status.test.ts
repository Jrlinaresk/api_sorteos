import { statusLabel, statusTone } from './status';

describe('status helpers', () => {
  it('traduce los estados operativos conocidos', () => {
    expect(statusLabel('awaiting_draw')).toBe('Esperando sorteo');
    expect(statusLabel('refund_pending')).toBe('Devolución pendiente');
  });

  it('mantiene legible un estado nuevo del backend', () => {
    expect(statusLabel('provider_paused')).toBe('provider paused');
    expect(statusTone('provider_paused')).toBe('neutral');
  });

  it('clasifica alertas financieras con el tono correcto', () => {
    expect(statusTone('paid')).toBe('positive');
    expect(statusTone('under_review')).toBe('warning');
    expect(statusTone('chargeback')).toBe('negative');
  });
});
