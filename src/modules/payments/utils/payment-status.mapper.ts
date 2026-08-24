import { PaymentStatus } from '../payment.enums';

const EFI_CHARGE_STATUS: Record<string, PaymentStatus> = {
  ATIVA: PaymentStatus.Active,
  CONCLUIDA: PaymentStatus.Paid,
  REMOVIDA_PELO_USUARIO_RECEBEDOR: PaymentStatus.Cancelled,
  REMOVIDA_PELO_PSP: PaymentStatus.Rejected,
};

const EFI_REFUND_STATUS: Record<string, PaymentStatus> = {
  EM_PROCESSAMENTO: PaymentStatus.RefundPending,
  DEVOLVIDO: PaymentStatus.Refunded,
  NAO_REALIZADO: PaymentStatus.Paid,
};

export function mapEfiChargeStatus(status?: string): PaymentStatus {
  if (!status) return PaymentStatus.Pending;
  return EFI_CHARGE_STATUS[status.toUpperCase()] ?? PaymentStatus.UnderReview;
}

export function mapEfiRefundStatus(status?: string): PaymentStatus {
  if (!status) return PaymentStatus.RefundPending;
  return EFI_REFUND_STATUS[status.toUpperCase()] ?? PaymentStatus.UnderReview;
}

export function isRefundStatus(status: PaymentStatus): boolean {
  return [
    PaymentStatus.RefundPending,
    PaymentStatus.PartiallyRefunded,
    PaymentStatus.Refunded,
  ].includes(status);
}
