import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Ban,
  CircleDollarSign,
  RefreshCcw,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
} from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Button,
  ConfirmDialog,
  DefinitionList,
  EmptyState,
  ErrorState,
  InlineAlert,
  LoadingState,
  PageHeader,
  SectionCard,
  StatusBadge,
} from '@/components/ui';
import { api } from '@/lib/api';
import {
  compactId,
  formatCents,
  formatDateTime,
  formatInteger,
  formatMoney,
} from '@/lib/format';
import { useAuth } from '@/lib/auth-context';
import { statusLabel } from '@/lib/status';
import { useToast } from '@/lib/toast-context';
import type { Payment, PaymentStatus } from '@/lib/types';
import {
  CANCELLABLE_PAYMENT_STATUSES,
  CopyValue,
  MANUAL_PAYMENT_TRANSITIONS,
  newRefundIdempotencyKey,
  PAYMENT_ATTENTION_STATUSES,
  paymentDocumentId,
  recordNumber,
  recordText,
} from './orders-payments-shared';

type PaymentAction =
  | { kind: 'reconcile' }
  | { kind: 'retry' }
  | { kind: 'cancel'; reason: string }
  | {
      kind: 'refund';
      idempotencyKey: string;
      amount: number;
      reason: string;
    }
  | { kind: 'status'; status: PaymentStatus; reason: string };

type ActionForm = 'cancel' | 'refund' | 'status' | null;

const REFUNDABLE_STATUSES = new Set<PaymentStatus>([
  'paid',
  'partially_refunded',
  'refund_pending',
]);

const ACTION_SUCCESS: Record<PaymentAction['kind'], string> = {
  reconcile: 'Pago conciliado',
  retry: 'Lifecycle reintentado',
  cancel: 'Cobranza cancelada',
  refund: 'Devolución solicitada',
  status: 'Estado actualizado',
};

function actionConfirmationText(action?: PaymentAction): string | undefined {
  if (!action) return undefined;
  if (action.kind === 'retry') return 'REINTENTAR';
  if (action.kind === 'cancel') return 'CANCELAR';
  if (action.kind === 'refund') return `DEVOLVER ${action.amount.toFixed(2)}`;
  if (action.kind === 'status') return 'CAMBIAR ESTADO';
  return undefined;
}

function actionTitle(action?: PaymentAction): string {
  if (!action) return 'Confirmar acción';
  const titles: Record<PaymentAction['kind'], string> = {
    reconcile: 'Conciliar con el proveedor',
    retry: 'Reintentar el lifecycle',
    cancel: 'Cancelar la cobranza Pix',
    refund: 'Confirmar devolución Pix',
    status: 'Confirmar cambio manual',
  };
  return titles[action.kind];
}

function actionLabel(action?: PaymentAction): string {
  if (!action) return 'Confirmar';
  const labels: Record<PaymentAction['kind'], string> = {
    reconcile: 'Conciliar ahora',
    retry: 'Reintentar ahora',
    cancel: 'Cancelar cobranza',
    refund: 'Solicitar devolución',
    status: 'Cambiar estado',
  };
  return labels[action.kind];
}

function actionDescription(
  action: PaymentAction | null,
  payment: Payment,
): ReactNode {
  if (!action) return null;
  if (action.kind === 'reconcile') {
    return (
      <p>
        Se consultará el estado autoritativo en {payment.provider.toUpperCase()}
        . El resultado puede actualizar la orden y sus títulos mediante el
        lifecycle.
      </p>
    );
  }
  if (action.kind === 'retry') {
    return (
      <p>
        Se volverán a ejecutar callbacks idempotentes hacia órdenes. Hazlo solo
        después de revisar el error de lifecycle y el estado actual.
      </p>
    );
  }
  if (action.kind === 'cancel') {
    return (
      <div>
        <p>
          La cobranza dejará de ser pagable y la reserva relacionada podrá ser
          liberada.
        </p>
        <p>
          <strong>Motivo:</strong> {action.reason}
        </p>
      </div>
    );
  }
  if (action.kind === 'refund') {
    return (
      <div>
        <p>
          Se solicitará una devolución real de{' '}
          <strong>{formatMoney(action.amount, payment.currency)}</strong> por
          Pix. Esta acción no se puede deshacer desde el panel.
        </p>
        <p>
          <strong>Motivo:</strong> {action.reason}
        </p>
        <p>
          <strong>Idempotencia:</strong> <code>{action.idempotencyKey}</code>
        </p>
      </div>
    );
  }
  return (
    <div>
      <p>
        Se cambiará manualmente de{' '}
        <strong>{statusLabel(payment.status)}</strong> a{' '}
        <strong>{statusLabel(action.status)}</strong>. Los estados con
        movimiento de dinero no están disponibles aquí.
      </p>
      <p>
        <strong>Motivo:</strong> {action.reason}
      </p>
    </div>
  );
}

export function PaymentDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const { showToast } = useToast();
  const isAdmin = can('admin');
  const [activeForm, setActiveForm] = useState<ActionForm>(null);
  const [confirmation, setConfirmation] = useState<PaymentAction | null>(null);
  const [formError, setFormError] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [refundMode, setRefundMode] = useState<'total' | 'partial'>('total');
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [refundKey, setRefundKey] = useState(newRefundIdempotencyKey);
  const [manualStatus, setManualStatus] = useState<PaymentStatus | ''>('');
  const [manualReason, setManualReason] = useState('');

  const paymentQuery = useQuery({
    queryKey: ['payments', 'admin', 'detail', id],
    queryFn: () =>
      api.get<Payment>(`/payments/admin/${encodeURIComponent(id)}`),
    enabled: Boolean(id),
  });

  const actionMutation = useMutation<Payment, Error, PaymentAction>({
    mutationFn: async (action) => {
      const base = `/payments/admin/${encodeURIComponent(id)}`;
      switch (action.kind) {
        case 'reconcile':
          return api.post<Payment>(`${base}/reconcile`);
        case 'retry':
          return api.post<Payment>(`${base}/retry-lifecycle`);
        case 'cancel':
          return api.post<Payment>(`${base}/cancel`, { reason: action.reason });
        case 'refund':
          return api.post<Payment>(`${base}/refund`, {
            idempotencyKey: action.idempotencyKey,
            amount: action.amount,
            reason: action.reason,
          });
        case 'status':
          return api.patch<Payment>(`${base}/status`, {
            status: action.status,
            reason: action.reason,
          });
      }
    },
    onSuccess: async (updated, action) => {
      queryClient.setQueryData(['payments', 'admin', 'detail', id], updated);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['payments', 'admin'] }),
        queryClient.invalidateQueries({ queryKey: ['orders', 'admin'] }),
      ]);
      showToast({
        tone: 'success',
        title: ACTION_SUCCESS[action.kind],
        message: `Estado actual: ${statusLabel(updated.status)}.`,
      });
    },
    onError: (error) => {
      showToast({
        tone: 'error',
        title: 'La acción no se completó',
        message: error.message,
      });
    },
  });

  const openForm = (form: ActionForm) => {
    setActiveForm((current) => (current === form ? null : form));
    setFormError('');
  };

  const executeConfirmation = async () => {
    if (!confirmation) return;
    try {
      await actionMutation.mutateAsync(confirmation);
      setConfirmation(null);
      setActiveForm(null);
      setFormError('');
      if (confirmation.kind === 'cancel') setCancelReason('');
      if (confirmation.kind === 'refund') {
        setRefundMode('total');
        setRefundAmount('');
        setRefundReason('');
        setRefundKey(newRefundIdempotencyKey());
      }
      if (confirmation.kind === 'status') {
        setManualStatus('');
        setManualReason('');
      }
    } catch {
      // El mutation presenta el error y conserva el diálogo para revisión.
    }
  };

  if (!id) {
    return (
      <main className="page" aria-label="Detalle de pago">
        <ErrorState error={new Error('Falta el identificador del pago.')} />
      </main>
    );
  }

  if (paymentQuery.isPending) {
    return (
      <main className="page" aria-label="Detalle de pago">
        <LoadingState label="Cargando detalle financiero…" />
      </main>
    );
  }

  if (paymentQuery.isError) {
    return (
      <main className="page" aria-label="Detalle de pago">
        <PageHeader
          title="Detalle de pago"
          actions={
            <Link className="button button--secondary" to="/payments">
              <ArrowLeft size={17} aria-hidden="true" />
              Volver a pagos
            </Link>
          }
        />
        <ErrorState
          error={paymentQuery.error}
          onRetry={() => void paymentQuery.refetch()}
        />
      </main>
    );
  }

  const payment = paymentQuery.data;
  const paymentId = paymentDocumentId(payment) || id;
  const expectedCents =
    payment.amountCents ?? Math.round((payment.amount || 0) * 100);
  const receivedCents = payment.receivedAmountCents ?? 0;
  const refundedCents = payment.refundedAmountCents ?? 0;
  const reservedRefundCents = payment.refundReservedAmountCents ?? 0;
  const availableRefundCents = Math.max(
    0,
    expectedCents - refundedCents - reservedRefundCents,
  );
  const manualTransitions = MANUAL_PAYMENT_TRANSITIONS[payment.status] ?? [];
  const receipts = (payment.receipts ?? []) as Array<Record<string, unknown>>;
  const refunds = (payment.refunds ?? []) as Array<Record<string, unknown>>;
  const history = (payment.statusHistory ?? []) as Array<
    Record<string, unknown>
  >;
  const needsAttention = PAYMENT_ATTENTION_STATUSES.has(payment.status);
  const hasAmountMismatch =
    receivedCents > 0 && receivedCents !== expectedCents;

  const reviewCancel = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const reason = cancelReason.trim();
    if (reason.length < 5) {
      setFormError(
        'Explica el motivo de cancelación con al menos 5 caracteres.',
      );
      return;
    }
    setFormError('');
    setConfirmation({ kind: 'cancel', reason });
  };

  const reviewRefund = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const reason = refundReason.trim();
    const amountCents =
      refundMode === 'total'
        ? availableRefundCents
        : Math.round(Number(refundAmount) * 100);
    if (!REFUNDABLE_STATUSES.has(payment.status)) {
      setFormError(
        `No se puede devolver un pago ${statusLabel(payment.status)}.`,
      );
      return;
    }
    if (!Number.isSafeInteger(amountCents) || amountCents < 1) {
      setFormError('Indica un importe válido mayor que cero.');
      return;
    }
    if (amountCents > availableRefundCents) {
      setFormError(
        `El máximo disponible es ${formatCents(availableRefundCents, payment.currency)}.`,
      );
      return;
    }
    if (reason.length < 8) {
      setFormError(
        'Explica el motivo de la devolución con al menos 8 caracteres.',
      );
      return;
    }
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(refundKey)) {
      setFormError('La clave de idempotencia no tiene un formato válido.');
      return;
    }
    setFormError('');
    setConfirmation({
      kind: 'refund',
      idempotencyKey: refundKey,
      amount: amountCents / 100,
      reason,
    });
  };

  const reviewManualStatus = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const reason = manualReason.trim();
    if (!manualStatus || !manualTransitions.includes(manualStatus)) {
      setFormError('Selecciona una transición manual permitida.');
      return;
    }
    if (reason.length < 8) {
      setFormError('Documenta el motivo del cambio con al menos 8 caracteres.');
      return;
    }
    setFormError('');
    setConfirmation({ kind: 'status', status: manualStatus, reason });
  };

  const activeAction = actionMutation.variables?.kind;

  return (
    <main className="page" aria-label={`Pago ${paymentId}`}>
      <PageHeader
        eyebrow="Trazabilidad financiera"
        title={`Pago ${compactId(paymentId)}`}
        description={`${payment.provider.toUpperCase()} · txid ${compactId(payment.txid)} · creado ${formatDateTime(payment.createdAt)}`}
        actions={
          <>
            <Link className="button button--secondary" to="/payments">
              <ArrowLeft size={17} aria-hidden="true" />
              Volver
            </Link>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void paymentQuery.refetch()}
              busy={paymentQuery.isFetching}
              disabled={actionMutation.isPending}
            >
              <RefreshCw size={17} aria-hidden="true" />
              Actualizar
            </Button>
          </>
        }
      />

      {needsAttention ? (
        <InlineAlert
          tone={
            ['disputed', 'chargeback'].includes(payment.status)
              ? 'danger'
              : 'warning'
          }
          title={`Estado financiero sensible: ${statusLabel(payment.status)}`}
        >
          <p>
            No entregues premios ni fuerces estados sin revisar recibos,
            devoluciones, proveedor y orden relacionada.
          </p>
        </InlineAlert>
      ) : null}

      {hasAmountMismatch ? (
        <InlineAlert tone="danger" title="El importe recibido no coincide">
          <p>
            Esperado: {formatCents(expectedCents, payment.currency)} · recibido:{' '}
            {formatCents(receivedCents, payment.currency)}. Mantén el pago en
            revisión hasta conciliar con el proveedor.
          </p>
        </InlineAlert>
      ) : null}

      {payment.providerError ? (
        <InlineAlert tone="danger" title="Error del proveedor">
          <p>{payment.providerError}</p>
        </InlineAlert>
      ) : null}

      {payment.lifecycleHookError ? (
        <InlineAlert tone="warning" title="Lifecycle incompleto">
          <p>{payment.lifecycleHookError}</p>
          <p>
            Último procesamiento:{' '}
            {formatDateTime(payment.lifecycleHookProcessedAt)}.
          </p>
        </InlineAlert>
      ) : null}

      <section className="metric-grid" aria-label="Resumen financiero">
        <article className="metric-card">
          <span>Estado</span>
          <strong>
            <StatusBadge status={payment.status} />
          </strong>
        </article>
        <article className="metric-card">
          <span>Esperado</span>
          <strong>{formatCents(expectedCents, payment.currency)}</strong>
        </article>
        <article className="metric-card">
          <span>Recibido</span>
          <strong>{formatCents(receivedCents, payment.currency)}</strong>
        </article>
        <article className="metric-card">
          <span>Devuelto / reservado</span>
          <strong>{formatCents(refundedCents, payment.currency)}</strong>
          <small>
            {formatCents(reservedRefundCents, payment.currency)} en proceso
          </small>
        </article>
      </section>

      <SectionCard
        title="Acciones operativas"
        description="Todas las acciones refrescan pagos y órdenes después de completarse."
      >
        <div
          className="action-toolbar"
          role="group"
          aria-label="Acciones del pago"
        >
          <Button
            type="button"
            variant="secondary"
            onClick={() => setConfirmation({ kind: 'reconcile' })}
            busy={actionMutation.isPending && activeAction === 'reconcile'}
            disabled={actionMutation.isPending}
          >
            <RefreshCcw size={17} aria-hidden="true" />
            Conciliar con proveedor
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => setConfirmation({ kind: 'retry' })}
            busy={actionMutation.isPending && activeAction === 'retry'}
            disabled={actionMutation.isPending}
          >
            <RotateCcw size={17} aria-hidden="true" />
            Reintentar lifecycle
          </Button>
          {CANCELLABLE_PAYMENT_STATUSES.has(payment.status) ? (
            <Button
              type="button"
              variant="danger"
              onClick={() => openForm('cancel')}
              disabled={actionMutation.isPending}
              aria-expanded={activeForm === 'cancel'}
            >
              <Ban size={17} aria-hidden="true" />
              Cancelar cobranza
            </Button>
          ) : null}
          {isAdmin ? (
            <>
              <Button
                type="button"
                variant="danger"
                onClick={() => openForm('refund')}
                disabled={
                  actionMutation.isPending ||
                  availableRefundCents < 1 ||
                  !REFUNDABLE_STATUSES.has(payment.status)
                }
                title={
                  !REFUNDABLE_STATUSES.has(payment.status)
                    ? `El estado ${statusLabel(payment.status)} no admite devoluciones.`
                    : undefined
                }
                aria-expanded={activeForm === 'refund'}
              >
                <CircleDollarSign size={17} aria-hidden="true" />
                Devolver
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => openForm('status')}
                disabled={
                  actionMutation.isPending || manualTransitions.length === 0
                }
                aria-expanded={activeForm === 'status'}
              >
                <ShieldAlert size={17} aria-hidden="true" />
                Cambio manual
              </Button>
            </>
          ) : null}
        </div>

        {!isAdmin ? (
          <InlineAlert tone="info" title="Acciones restringidas">
            <p>
              Solo un administrador puede devolver dinero o cambiar estados
              manualmente.
            </p>
          </InlineAlert>
        ) : null}

        {activeForm === 'cancel' ? (
          <form
            className="action-form"
            onSubmit={reviewCancel}
            aria-label="Cancelar cobranza"
          >
            <InlineAlert
              tone="danger"
              title="La cancelación puede liberar títulos"
            >
              <p>
                Comprueba primero que el Pix no haya sido pagado fuera de
                sincronía.
              </p>
            </InlineAlert>
            <label className="field field--wide">
              <span>Motivo de cancelación</span>
              <textarea
                required
                minLength={5}
                maxLength={140}
                rows={3}
                value={cancelReason}
                onChange={(event) => setCancelReason(event.target.value)}
                placeholder="Explica por qué se cancela esta cobranza"
              />
              <small>{cancelReason.length}/140</small>
            </label>
            {formError ? (
              <p className="form-error" role="alert">
                {formError}
              </p>
            ) : null}
            <div className="form-actions">
              <Button
                type="button"
                variant="ghost"
                onClick={() => openForm(null)}
              >
                Cerrar
              </Button>
              <Button type="submit" variant="danger">
                Revisar cancelación
              </Button>
            </div>
          </form>
        ) : null}

        {activeForm === 'refund' && isAdmin ? (
          <form
            className="action-form"
            onSubmit={reviewRefund}
            aria-label="Solicitar devolución Pix"
          >
            <InlineAlert tone="danger" title="Movimiento real de dinero">
              <p>
                Disponible para solicitar:{' '}
                <strong>
                  {formatCents(availableRefundCents, payment.currency)}
                </strong>
                . El backend volverá a validar pedido, premio ganador y entregas
                antes de enviar la devolución.
              </p>
            </InlineAlert>
            <fieldset className="choice-group">
              <legend>Importe de la devolución</legend>
              <label>
                <input
                  type="radio"
                  name="refund-mode"
                  value="total"
                  checked={refundMode === 'total'}
                  onChange={() => setRefundMode('total')}
                />
                Todo el saldo disponible (
                {formatCents(availableRefundCents, payment.currency)})
              </label>
              <label>
                <input
                  type="radio"
                  name="refund-mode"
                  value="partial"
                  checked={refundMode === 'partial'}
                  onChange={() => setRefundMode('partial')}
                />
                Importe parcial
              </label>
            </fieldset>
            <div className="form-grid">
              <label className="field">
                <span>Importe parcial ({payment.currency})</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0.01"
                  max={(availableRefundCents / 100).toFixed(2)}
                  step="0.01"
                  disabled={refundMode !== 'partial'}
                  required={refundMode === 'partial'}
                  value={refundAmount}
                  onChange={(event) => setRefundAmount(event.target.value)}
                />
              </label>
              <label className="field field--wide">
                <span>Clave de idempotencia</span>
                <span className="input-with-action">
                  <input
                    readOnly
                    value={refundKey}
                    aria-describedby="refund-key-help"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setRefundKey(newRefundIdempotencyKey())}
                    title="Generar una clave nueva"
                  >
                    Regenerar
                  </Button>
                </span>
                <small id="refund-key-help">
                  Conserva esta clave si necesitas repetir exactamente la misma
                  solicitud.
                </small>
              </label>
            </div>
            <label className="field field--wide">
              <span>Motivo de la devolución</span>
              <textarea
                required
                minLength={8}
                maxLength={140}
                rows={3}
                value={refundReason}
                onChange={(event) => setRefundReason(event.target.value)}
                placeholder="Motivo verificable para auditoría"
              />
              <small>{refundReason.length}/140</small>
            </label>
            {formError ? (
              <p className="form-error" role="alert">
                {formError}
              </p>
            ) : null}
            <div className="form-actions">
              <Button
                type="button"
                variant="ghost"
                onClick={() => openForm(null)}
              >
                Cerrar
              </Button>
              <Button type="submit" variant="danger">
                Revisar devolución
              </Button>
            </div>
          </form>
        ) : null}

        {activeForm === 'status' && isAdmin ? (
          <form
            className="action-form"
            onSubmit={reviewManualStatus}
            aria-label="Cambio manual de estado"
          >
            <InlineAlert tone="warning" title="No sustituye la conciliación">
              <p>
                Usa esta acción solo para estados operativos. Pagado y estados
                de devolución deben provenir del proveedor.
              </p>
            </InlineAlert>
            <label className="field">
              <span>Nuevo estado</span>
              <select
                required
                value={manualStatus}
                onChange={(event) =>
                  setManualStatus(event.target.value as PaymentStatus)
                }
              >
                <option value="">Seleccionar transición</option>
                {manualTransitions.map((target) => (
                  <option key={target} value={target}>
                    {statusLabel(target)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field field--wide">
              <span>Justificación auditada</span>
              <textarea
                required
                minLength={8}
                maxLength={300}
                rows={4}
                value={manualReason}
                onChange={(event) => setManualReason(event.target.value)}
                placeholder="Evidencia y motivo del cambio manual"
              />
              <small>{manualReason.length}/300</small>
            </label>
            {formError ? (
              <p className="form-error" role="alert">
                {formError}
              </p>
            ) : null}
            <div className="form-actions">
              <Button
                type="button"
                variant="ghost"
                onClick={() => openForm(null)}
              >
                Cerrar
              </Button>
              <Button type="submit">Revisar cambio</Button>
            </div>
          </form>
        ) : null}
      </SectionCard>

      <div className="detail-grid">
        <SectionCard
          title="Identificadores"
          description="Referencias para soporte y conciliación."
        >
          <DefinitionList
            items={[
              {
                label: 'ID del pago',
                value: <CopyValue value={paymentId} label="ID del pago" />,
              },
              {
                label: 'Txid Pix',
                value: <CopyValue value={payment.txid} label="txid Pix" />,
              },
              {
                label: 'ID externo',
                value: (
                  <CopyValue value={payment.externalId} label="ID externo" />
                ),
              },
              {
                label: 'EndToEndId',
                value: (
                  <CopyValue value={payment.endToEndId} label="EndToEndId" />
                ),
              },
              {
                label: 'Pedido interno',
                value: <CopyValue value={payment.order} label="ID de pedido" />,
              },
              {
                label: 'Campaña',
                value: (
                  <CopyValue value={payment.campaign} label="ID de campaña" />
                ),
              },
              {
                label: 'Usuario',
                value: <CopyValue value={payment.user} label="ID de usuario" />,
              },
              { label: 'Proveedor', value: payment.provider.toUpperCase() },
            ]}
          />
        </SectionCard>

        <SectionCard
          title="Fechas y control"
          description="Vigencia y marcas de procesamiento."
        >
          <DefinitionList
            items={[
              { label: 'Creado', value: formatDateTime(payment.createdAt) },
              {
                label: 'Actualizado',
                value: formatDateTime(payment.updatedAt),
              },
              { label: 'Vence', value: formatDateTime(payment.expiresAt) },
              { label: 'Pagado', value: formatDateTime(payment.paidAt) },
              {
                label: 'Cancelado',
                value: formatDateTime(payment.cancelledAt),
              },
              { label: 'Devuelto', value: formatDateTime(payment.refundedAt) },
              { label: 'Recibos Pix', value: formatInteger(receipts.length) },
              {
                label: 'Solicitudes de devolución',
                value: formatInteger(refunds.length),
              },
            ]}
          />
        </SectionCard>
      </div>

      <SectionCard
        title="Recibos Pix"
        description="Entradas financieras deduplicadas por EndToEndId."
      >
        {receipts.length ? (
          <div className="table-wrap">
            <table className="data-table data-table--compact">
              <caption className="sr-only">
                Recibos Pix asociados al pago
              </caption>
              <thead>
                <tr>
                  <th scope="col">EndToEndId</th>
                  <th scope="col" className="numeric-cell">
                    Importe
                  </th>
                  <th scope="col">Pagado</th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((receipt, index) => {
                  const endToEndId = recordText(receipt, 'endToEndId');
                  const amountCents = recordNumber(receipt, 'amountCents') ?? 0;
                  const paidAt = recordText(receipt, 'paidAt');
                  return (
                    <tr key={endToEndId || String(index)}>
                      <td>
                        <CopyValue value={endToEndId} label="EndToEndId" />
                      </td>
                      <td className="numeric-cell">
                        {formatCents(amountCents, payment.currency)}
                      </td>
                      <td>{formatDateTime(paidAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="Sin recibos Pix"
            description="El proveedor todavía no confirmó una entrada financiera."
          />
        )}
      </SectionCard>

      <SectionCard
        title="Devoluciones"
        description="Solicitudes locales y estado comunicado por el proveedor."
      >
        {refunds.length ? (
          <div className="table-wrap">
            <table className="data-table data-table--compact">
              <caption className="sr-only">
                Devoluciones solicitadas para el pago
              </caption>
              <thead>
                <tr>
                  <th scope="col">Idempotencia</th>
                  <th scope="col">Proveedor</th>
                  <th scope="col" className="numeric-cell">
                    Importe
                  </th>
                  <th scope="col">Estado</th>
                  <th scope="col">Solicitada</th>
                  <th scope="col">Completada</th>
                </tr>
              </thead>
              <tbody>
                {refunds.map((refund, index) => {
                  const key = recordText(refund, 'idempotencyKey');
                  const providerRefundId = recordText(
                    refund,
                    'providerRefundId',
                  );
                  const amount = recordNumber(refund, 'amount') ?? 0;
                  const status = recordText(refund, 'status');
                  return (
                    <tr key={key || providerRefundId || String(index)}>
                      <td>
                        <CopyValue value={key} label="clave de idempotencia" />
                      </td>
                      <td>
                        {providerRefundId ? compactId(providerRefundId) : '—'}
                      </td>
                      <td className="numeric-cell">
                        {formatMoney(amount, payment.currency)}
                      </td>
                      <td>
                        <StatusBadge status={status} />
                      </td>
                      <td>
                        {formatDateTime(recordText(refund, 'requestedAt'))}
                      </td>
                      <td>
                        {formatDateTime(recordText(refund, 'completedAt'))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="Sin devoluciones"
            description="No hay solicitudes de devolución registradas."
          />
        )}
      </SectionCard>

      <SectionCard
        title="Historial de estado"
        description="Origen, motivo y fecha de cada transición."
      >
        {history.length ? (
          <ol className="timeline">
            {history.map((entry, index) => {
              const status = recordText(entry, 'status');
              const source = recordText(entry, 'source');
              const occurredAt = recordText(entry, 'occurredAt');
              const reason = recordText(entry, 'reason');
              return (
                <li key={`${status}-${occurredAt}-${index}`}>
                  <div>
                    <StatusBadge status={status} />
                    <span className="timeline__source">
                      {source || 'sistema'}
                    </span>
                    <time dateTime={occurredAt}>
                      {formatDateTime(occurredAt)}
                    </time>
                  </div>
                  {reason ? <p>{reason}</p> : null}
                </li>
              );
            })}
          </ol>
        ) : (
          <EmptyState
            title="Sin historial"
            description="No se recibieron entradas de transición."
          />
        )}
      </SectionCard>

      <ConfirmDialog
        open={Boolean(confirmation)}
        title={actionTitle(confirmation ?? undefined)}
        description={actionDescription(confirmation, payment)}
        confirmLabel={actionLabel(confirmation ?? undefined)}
        confirmationText={actionConfirmationText(confirmation ?? undefined)}
        danger={Boolean(
          confirmation &&
          ['cancel', 'refund', 'status'].includes(confirmation.kind),
        )}
        busy={actionMutation.isPending}
        onClose={() => setConfirmation(null)}
        onConfirm={() => void executeConfirmation()}
      />
    </main>
  );
}

export default PaymentDetailPage;
