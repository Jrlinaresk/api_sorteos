import { Check, Copy } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useToast } from '@/lib/toast-context';
import type {
  CampaignSummary,
  OrderStatus,
  Payment,
  PaymentStatus,
} from '@/lib/types';

export const ORDER_STATUS_OPTIONS: ReadonlyArray<{
  value: OrderStatus;
  label: string;
}> = [
  { value: 'reserved', label: 'Reservado' },
  { value: 'pending_payment', label: 'Pago pendiente' },
  { value: 'paid', label: 'Pagado' },
  { value: 'in_review', label: 'En revisión' },
  { value: 'expired', label: 'Vencido' },
  { value: 'cancelled', label: 'Cancelado' },
  { value: 'rejected', label: 'Rechazado' },
  { value: 'refunded', label: 'Devuelto' },
  { value: 'disputed', label: 'Disputado' },
];

export const PAYMENT_STATUS_OPTIONS: ReadonlyArray<{
  value: PaymentStatus;
  label: string;
}> = [
  { value: 'created', label: 'Creado' },
  { value: 'pending', label: 'Pendiente' },
  { value: 'active', label: 'Activo' },
  { value: 'paid', label: 'Pagado' },
  { value: 'under_review', label: 'En revisión' },
  { value: 'refund_pending', label: 'Devolución pendiente' },
  { value: 'partially_refunded', label: 'Devolución parcial' },
  { value: 'refunded', label: 'Devuelto' },
  { value: 'expired', label: 'Vencido' },
  { value: 'cancelled', label: 'Cancelado' },
  { value: 'rejected', label: 'Rechazado' },
  { value: 'failed', label: 'Fallido' },
  { value: 'disputed', label: 'Disputado' },
  { value: 'chargeback', label: 'Contracargo' },
];

export const PAYMENT_ATTENTION_STATUSES = new Set<PaymentStatus>([
  'under_review',
  'refund_pending',
  'disputed',
  'chargeback',
]);

export const CANCELLABLE_PAYMENT_STATUSES = new Set<PaymentStatus>([
  'created',
  'pending',
  'active',
  'failed',
]);

/**
 * Los estados que representan movimiento de dinero están deliberadamente
 * ausentes: el backend solo admite que lleguen desde el PSP o conciliación.
 */
export const MANUAL_PAYMENT_TRANSITIONS: Record<
  PaymentStatus,
  readonly PaymentStatus[]
> = {
  created: [
    'pending',
    'active',
    'expired',
    'cancelled',
    'rejected',
    'failed',
    'under_review',
  ],
  pending: [
    'active',
    'expired',
    'cancelled',
    'rejected',
    'failed',
    'under_review',
  ],
  active: ['expired', 'cancelled', 'rejected', 'failed', 'under_review'],
  paid: ['under_review', 'disputed', 'chargeback'],
  expired: ['under_review'],
  cancelled: ['under_review'],
  rejected: ['active'],
  failed: [
    'pending',
    'active',
    'expired',
    'cancelled',
    'rejected',
    'under_review',
  ],
  refund_pending: ['under_review'],
  partially_refunded: ['disputed', 'chargeback'],
  refunded: ['disputed', 'chargeback'],
  under_review: [
    'active',
    'expired',
    'cancelled',
    'rejected',
    'disputed',
    'chargeback',
  ],
  disputed: ['chargeback'],
  chargeback: [],
};

export function positiveInteger(
  value: string | null,
  fallback: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

export function relationId(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  const id = record.id ?? record._id;
  return typeof id === 'string' ? id : String(id ?? '');
}

export function campaignName(
  campaign?: CampaignSummary | string | null,
): string {
  if (!campaign) return 'Sin campaña';
  return typeof campaign === 'string' ? campaign : campaign.name;
}

export function paymentId(payment?: unknown): string {
  return relationId(payment);
}

export function paymentDocumentId(payment?: Payment | null): string {
  return payment?.id ?? payment?._id ?? '';
}

export function recordValue(
  record: Record<string, unknown>,
  key: string,
): unknown {
  return record[key];
}

export function recordText(
  record: Record<string, unknown>,
  key: string,
): string {
  const value = recordValue(record, key);
  if (value === undefined || value === null || value === '') return '';
  return String(value);
}

export function recordNumber(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = recordValue(record, key);
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function newRefundIdempotencyKey(): string {
  const randomPart =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `admin-refund:${randomPart}`;
}

async function copyToClipboard(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('El navegador no permitió copiar');
}

export function CopyValue({
  value,
  label,
  children,
}: {
  value?: string | null;
  label: string;
  children?: ReactNode;
}) {
  const { showToast } = useToast();
  const [copied, setCopied] = useState(false);
  if (!value) return <span>—</span>;

  const copy = async () => {
    try {
      await copyToClipboard(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
      showToast({ tone: 'success', title: `${label} copiado` });
    } catch (error) {
      showToast({
        tone: 'error',
        title: 'No se pudo copiar',
        message: error instanceof Error ? error.message : undefined,
      });
    }
  };

  return (
    <span className="copy-value">
      {children ?? <code>{value}</code>}
      <button
        className="icon-button"
        type="button"
        onClick={() => void copy()}
        aria-label={`Copiar ${label}`}
        title={`Copiar ${label}`}
      >
        {copied ? (
          <Check size={16} aria-hidden="true" />
        ) : (
          <Copy size={16} aria-hidden="true" />
        )}
      </button>
    </span>
  );
}
