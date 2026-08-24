import { PaymentStatus } from './payment.enums';
import { mapEfiRefundStatus } from './utils/payment-status.mapper';

export interface PixReceiptSnapshot {
  endToEndId: string;
  amountCents: number;
  paidAt: Date;
}

export interface PixRefundSnapshot {
  providerRefundId: string;
  endToEndId: string;
  amountCents: number;
  status: PaymentStatus;
}

export interface PixReceiptSummary {
  receipts: PixReceiptSnapshot[];
  refunds: PixRefundSnapshot[];
  receivedAmountCents: number;
  refundedAmountCents: number;
  integrityError?: string;
}

/**
 * Pix/BRL is a two-decimal currency. Financial comparisons must never use
 * floating-point addition, so provider values are parsed directly to cents.
 */
export function parseBrlCents(value: unknown): number | undefined {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return undefined;
    const cents = Math.round(value * 100);
    return Math.abs(value * 100 - cents) < 1e-7 ? cents : undefined;
  }
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().replace(',', '.');
  const match = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) return undefined;
  const cents =
    Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents > 0 ? cents : undefined;
}

export function centsToAmount(cents: number): number {
  return Number((cents / 100).toFixed(2));
}

export function summarizeEfiPixEntries(items: unknown[]): PixReceiptSummary {
  const byEndToEndId = new Map<string, PixReceiptSnapshot>();
  const refundById = new Map<string, PixRefundSnapshot>();
  const errors = new Set<string>();

  for (const raw of items) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      errors.add('Pix recibido con formato inválido');
      continue;
    }
    const item = raw as Record<string, unknown>;
    const endToEndId =
      typeof item.endToEndId === 'string' ? item.endToEndId.trim() : '';
    const amountCents = parseBrlCents(item.valor);
    const paidAt =
      typeof item.horario === 'string' ? new Date(item.horario) : undefined;
    if (
      !endToEndId ||
      !amountCents ||
      !paidAt ||
      !Number.isFinite(paidAt.getTime())
    ) {
      errors.add('Pix sin endToEndId, valor u horario válido');
      continue;
    }

    const previous = byEndToEndId.get(endToEndId);
    if (previous) {
      if (
        previous.amountCents !== amountCents ||
        previous.paidAt.getTime() !== paidAt.getTime()
      ) {
        errors.add(`endToEndId ${endToEndId} repetido con datos incompatibles`);
      }
    } else {
      byEndToEndId.set(endToEndId, { endToEndId, amountCents, paidAt });
    }

    const refunds = Array.isArray(item.devolucoes) ? item.devolucoes : [];
    for (const rawRefund of refunds) {
      if (
        !rawRefund ||
        typeof rawRefund !== 'object' ||
        Array.isArray(rawRefund)
      ) {
        errors.add('Devolución Pix con formato inválido');
        continue;
      }
      const refund = rawRefund as Record<string, unknown>;
      const providerRefundId =
        typeof refund.id === 'string' ? refund.id.trim() : '';
      const refundAmountCents = parseBrlCents(refund.valor);
      if (!providerRefundId || !refundAmountCents) {
        errors.add('Devolución Pix sin id o valor válido');
        continue;
      }
      const snapshot: PixRefundSnapshot = {
        providerRefundId,
        endToEndId,
        amountCents: refundAmountCents,
        status: mapEfiRefundStatus(
          typeof refund.status === 'string' ? refund.status : undefined,
        ),
      };
      const key = `${endToEndId}:${providerRefundId}`;
      const previousRefund = refundById.get(key);
      if (
        previousRefund &&
        (previousRefund.amountCents !== snapshot.amountCents ||
          previousRefund.status !== snapshot.status)
      ) {
        errors.add(
          `Devolución ${providerRefundId} repetida con datos incompatibles`,
        );
      } else {
        refundById.set(key, snapshot);
      }
    }
  }

  const receipts = [...byEndToEndId.values()].sort((a, b) =>
    a.endToEndId.localeCompare(b.endToEndId),
  );
  const refunds = [...refundById.values()];
  return {
    receipts,
    refunds,
    receivedAmountCents: receipts.reduce(
      (sum, receipt) => sum + receipt.amountCents,
      0,
    ),
    refundedAmountCents: refunds
      .filter((refund) => refund.status === PaymentStatus.Refunded)
      .reduce((sum, refund) => sum + refund.amountCents, 0),
    integrityError: errors.size
      ? [...errors].join(' | ').slice(0, 1000)
      : undefined,
  };
}

export function mergePixReceipts(
  stored: PixReceiptSnapshot[],
  incoming: PixReceiptSnapshot[],
): { receipts: PixReceiptSnapshot[]; integrityError?: string } {
  const byEndToEndId = new Map<string, PixReceiptSnapshot>();
  const errors = new Set<string>();
  for (const receipt of [...stored, ...incoming]) {
    const normalized = {
      endToEndId: String(receipt.endToEndId),
      amountCents: Number(receipt.amountCents),
      paidAt: new Date(receipt.paidAt),
    };
    const previous = byEndToEndId.get(normalized.endToEndId);
    if (
      previous &&
      (previous.amountCents !== normalized.amountCents ||
        previous.paidAt.getTime() !== normalized.paidAt.getTime())
    ) {
      errors.add(
        `endToEndId ${normalized.endToEndId} ya estaba registrado con otros datos`,
      );
      continue;
    }
    byEndToEndId.set(normalized.endToEndId, normalized);
  }
  return {
    receipts: [...byEndToEndId.values()].sort(
      (a, b) => a.paidAt.getTime() - b.paidAt.getTime(),
    ),
    integrityError: errors.size
      ? [...errors].join(' | ').slice(0, 1000)
      : undefined,
  };
}
