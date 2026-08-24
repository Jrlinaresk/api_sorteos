import {
  mergePixReceipts,
  parseBrlCents,
  summarizeEfiPixEntries,
} from './payment-finance';
import { PaymentStatus } from './payment.enums';

describe('payment finance primitives', () => {
  it('parses BRL directly into integer cents', () => {
    expect(parseBrlCents('10.01')).toBe(1001);
    expect(parseBrlCents('10,01')).toBe(1001);
    expect(parseBrlCents('0.001')).toBeUndefined();
    expect(parseBrlCents('NaN')).toBeUndefined();
  });

  it('does not double count a duplicate Pix receipt', () => {
    const entry = {
      endToEndId: 'E123',
      valor: '15.00',
      horario: '2026-08-24T10:00:00.000Z',
    };
    const summary = summarizeEfiPixEntries([entry, { ...entry }]);
    expect(summary.receivedAmountCents).toBe(1500);
    expect(summary.receipts).toHaveLength(1);
    expect(summary.integrityError).toBeUndefined();
  });

  it('flags incompatible data for an already stored endToEndId', () => {
    const merged = mergePixReceipts(
      [
        {
          endToEndId: 'E123',
          amountCents: 1000,
          paidAt: new Date('2026-08-24T10:00:00.000Z'),
        },
      ],
      [
        {
          endToEndId: 'E123',
          amountCents: 1100,
          paidAt: new Date('2026-08-24T10:00:00.000Z'),
        },
      ],
    );
    expect(merged.integrityError).toContain('otros datos');
    expect(merged.receipts[0].amountCents).toBe(1000);
  });

  it('sums only completed provider refunds in cents', () => {
    const summary = summarizeEfiPixEntries([
      {
        endToEndId: 'E123',
        valor: '15.00',
        horario: '2026-08-24T10:00:00.000Z',
        devolucoes: [
          { id: 'R1', valor: '5.00', status: 'DEVOLVIDO' },
          { id: 'R2', valor: '2.00', status: 'EM_PROCESSAMENTO' },
        ],
      },
    ]);
    expect(summary.refundedAmountCents).toBe(500);
    expect(summary.refunds.map((refund) => refund.status)).toEqual([
      PaymentStatus.Refunded,
      PaymentStatus.RefundPending,
    ]);
  });
});
