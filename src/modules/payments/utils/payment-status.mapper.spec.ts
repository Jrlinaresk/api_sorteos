import { PaymentStatus } from '../payment.enums';
import {
  mapEfiChargeStatus,
  mapEfiRefundStatus,
} from './payment-status.mapper';

describe('Efí payment status mapper', () => {
  it.each([
    ['ATIVA', PaymentStatus.Active],
    ['CONCLUIDA', PaymentStatus.Paid],
    ['REMOVIDA_PELO_USUARIO_RECEBEDOR', PaymentStatus.Cancelled],
    ['REMOVIDA_PELO_PSP', PaymentStatus.Rejected],
  ])('maps charge status %s', (providerStatus, expected) => {
    expect(mapEfiChargeStatus(providerStatus)).toBe(expected);
  });

  it('does not accidentally approve an unknown charge status', () => {
    expect(mapEfiChargeStatus('NEW_UNKNOWN_STATUS')).toBe(
      PaymentStatus.UnderReview,
    );
  });

  it.each([
    ['EM_PROCESSAMENTO', PaymentStatus.RefundPending],
    ['DEVOLVIDO', PaymentStatus.Refunded],
    ['NAO_REALIZADO', PaymentStatus.Paid],
  ])('maps refund status %s', (providerStatus, expected) => {
    expect(mapEfiRefundStatus(providerStatus)).toBe(expected);
  });
});
