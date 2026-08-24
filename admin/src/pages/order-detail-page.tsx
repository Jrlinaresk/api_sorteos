import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download, ExternalLink, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Button,
  DefinitionList,
  EmptyState,
  ErrorState,
  InlineAlert,
  LoadingState,
  PageHeader,
  SectionCard,
  StatusBadge,
} from '@/components/ui';
import { api, downloadFile } from '@/lib/api';
import {
  compactId,
  formatCents,
  formatDateTime,
  formatInteger,
  formatMoney,
} from '@/lib/format';
import { useToast } from '@/lib/toast-context';
import type { Order, PaymentSummary, PrizeAward, Quota } from '@/lib/types';
import {
  campaignName,
  CopyValue,
  paymentId,
  relationId,
} from './orders-payments-shared';

interface OrderPaymentDetail extends PaymentSummary {
  txid?: string;
  endToEndId?: string;
  amountCents?: number;
  receivedAmountCents?: number;
  refundedAmountCents?: number;
  cancelledAt?: string;
  refundedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface AdminOrderDetail extends Omit<Order, 'payment'> {
  payment?: OrderPaymentDetail | string;
  instantPrizes?: Array<PrizeAward | Record<string, unknown>>;
  promotion?: { quantity: number; totalPrice: number; label?: string };
  termsHash?: string;
}

function objectLabel(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  const title = record.title ?? record.name ?? record.publicId;
  return typeof title === 'string' ? title : '';
}

export function OrderDetailPage() {
  const { publicId = '' } = useParams<{ publicId: string }>();
  const { showToast } = useToast();
  const [downloading, setDownloading] = useState(false);

  const orderQuery = useQuery({
    queryKey: ['orders', 'admin', 'detail', publicId],
    queryFn: () =>
      api.get<AdminOrderDetail>(
        `/admin/orders/${encodeURIComponent(publicId)}`,
      ),
    enabled: Boolean(publicId),
  });

  if (!publicId) {
    return (
      <main className="page" aria-label="Detalle de orden">
        <ErrorState
          error={new Error('Falta el identificador público de la orden.')}
        />
      </main>
    );
  }

  if (orderQuery.isPending) {
    return (
      <main className="page" aria-label="Detalle de orden">
        <LoadingState label="Cargando detalle de la orden…" />
      </main>
    );
  }

  if (orderQuery.isError) {
    return (
      <main className="page" aria-label="Detalle de orden">
        <PageHeader
          title="Detalle de orden"
          actions={
            <Link className="button button--secondary" to="/orders">
              <ArrowLeft size={17} aria-hidden="true" />
              Volver a órdenes
            </Link>
          }
        />
        <ErrorState
          error={orderQuery.error}
          onRetry={() => void orderQuery.refetch()}
        />
      </main>
    );
  }

  const order = orderQuery.data;
  const campaignId = relationId(order.campaign);
  const payment =
    typeof order.payment === 'object' && order.payment
      ? order.payment
      : undefined;
  const linkedPaymentId = paymentId(order.payment);
  const account =
    typeof order.user === 'object' && order.user ? order.user : undefined;
  const quotas = (order.quotas ?? []) as Quota[];
  const history = order.statusHistory ?? [];
  const attribution = Object.entries(order.attribution ?? {}).filter(
    ([, value]) => value !== undefined && value !== null && value !== '',
  );

  const downloadParticipants = async () => {
    if (!campaignId || downloading) return;
    setDownloading(true);
    try {
      await downloadFile(
        `/admin/orders/campaign/${campaignId}/participants.csv`,
        `participantes-${campaignId}.csv`,
      );
      showToast({
        tone: 'success',
        title: 'CSV descargado',
        message: `Incluye todos los participantes pagados de ${campaignName(order.campaign)}.`,
      });
    } catch (error) {
      showToast({
        tone: 'error',
        title: 'No se pudo descargar el CSV',
        message: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <main className="page" aria-label={`Orden ${order.publicId}`}>
      <PageHeader
        eyebrow="Detalle operativo"
        title={`Orden ${compactId(order.publicId)}`}
        description={`Creada ${formatDateTime(order.createdAt ?? order.reservedAt)} · ${campaignName(order.campaign)}`}
        actions={
          <>
            <Link className="button button--secondary" to="/orders">
              <ArrowLeft size={17} aria-hidden="true" />
              Volver
            </Link>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void orderQuery.refetch()}
              busy={orderQuery.isFetching}
            >
              <RefreshCw size={17} aria-hidden="true" />
              Actualizar
            </Button>
            <Button
              type="button"
              onClick={() => void downloadParticipants()}
              disabled={!campaignId}
              busy={downloading}
              title="Descargar todos los participantes pagados de esta campaña"
            >
              <Download size={17} aria-hidden="true" />
              CSV de la campaña
            </Button>
          </>
        }
      />

      {['in_review', 'disputed'].includes(order.status) ? (
        <InlineAlert
          tone={order.status === 'disputed' ? 'danger' : 'warning'}
          title={
            order.status === 'disputed'
              ? 'Orden disputada'
              : 'Orden pendiente de revisión financiera'
          }
        >
          <p>
            Revisa el pago y su historial antes de realizar cualquier entrega o
            intervención manual.
          </p>
        </InlineAlert>
      ) : null}

      <section className="metric-grid" aria-label="Resumen de la orden">
        <article className="metric-card">
          <span>Estado</span>
          <strong>
            <StatusBadge status={order.status} />
          </strong>
        </article>
        <article className="metric-card">
          <span>Total</span>
          <strong>{formatMoney(order.total, order.currency)}</strong>
          <small>
            Subtotal {formatMoney(order.subtotal, order.currency)} · descuento{' '}
            {formatMoney(order.discount, order.currency)}
          </small>
        </article>
        <article className="metric-card">
          <span>Títulos asignados</span>
          <strong>{formatInteger(order.allocatedQuantity)}</strong>
          <small>
            {formatInteger(order.selectedQuantity)} comprados ·{' '}
            {formatInteger(order.bonusQuantity)} bonus
          </small>
        </article>
        <article className="metric-card">
          <span>Pago</span>
          <strong>
            {payment ? (
              <StatusBadge status={payment.status} />
            ) : (
              'Sin pago asociado'
            )}
          </strong>
          {payment ? <small>{payment.provider.toUpperCase()}</small> : null}
        </article>
      </section>

      <div className="detail-grid">
        <SectionCard
          title="Identificación"
          description="Referencias inmutables del pedido."
        >
          <DefinitionList
            items={[
              {
                label: 'ID público',
                value: <CopyValue value={order.publicId} label="ID público" />,
              },
              {
                label: 'ID interno',
                value: (
                  <CopyValue value={relationId(order)} label="ID interno" />
                ),
              },
              {
                label: 'Campaña',
                value: (
                  <span>
                    {campaignName(order.campaign)}{' '}
                    <CopyValue value={campaignId} label="ID de campaña" />
                  </span>
                ),
              },
              { label: 'Reservada', value: formatDateTime(order.reservedAt) },
              { label: 'Vence', value: formatDateTime(order.expiresAt) },
              { label: 'Pagada', value: formatDateTime(order.paidAt) },
              { label: 'Cancelada', value: formatDateTime(order.cancelledAt) },
              { label: 'Devuelta', value: formatDateTime(order.refundedAt) },
            ]}
          />
        </SectionCard>

        <SectionCard
          title="Comprador"
          description="Datos capturados al confirmar el checkout."
        >
          <DefinitionList
            items={[
              { label: 'Nombre', value: order.buyer.name },
              {
                label: 'Teléfono',
                value: <CopyValue value={order.buyer.phone} label="teléfono" />,
              },
              {
                label: 'Correo',
                value: <CopyValue value={order.buyer.email} label="correo" />,
              },
              {
                label: 'CPF',
                value: <CopyValue value={order.buyer.cpf} label="CPF" />,
              },
              {
                label: 'Cuenta vinculada',
                value: account
                  ? account.nickname ||
                    account.name ||
                    account.email ||
                    account.phone
                  : typeof order.user === 'string'
                    ? compactId(order.user)
                    : 'Compra invitada',
              },
              {
                label: 'Estado de cuenta',
                value: account
                  ? account.isActive
                    ? 'Activa'
                    : 'Inactiva'
                  : '—',
              },
            ]}
          />
        </SectionCard>
      </div>

      <SectionCard
        title="Pago asociado"
        description="Resumen financiero persistido dentro de la orden."
        actions={
          linkedPaymentId ? (
            <Link
              className="button button--secondary"
              to={`/payments/${encodeURIComponent(linkedPaymentId)}`}
            >
              Abrir pago
              <ExternalLink size={16} aria-hidden="true" />
            </Link>
          ) : undefined
        }
      >
        {payment ? (
          <DefinitionList
            items={[
              {
                label: 'ID del pago',
                value: (
                  <CopyValue value={linkedPaymentId} label="ID del pago" />
                ),
              },
              {
                label: 'Estado',
                value: <StatusBadge status={payment.status} />,
              },
              { label: 'Proveedor', value: payment.provider.toUpperCase() },
              {
                label: 'Txid Pix',
                value: <CopyValue value={payment.txid} label="txid Pix" />,
              },
              {
                label: 'EndToEndId',
                value: (
                  <CopyValue value={payment.endToEndId} label="EndToEndId" />
                ),
              },
              {
                label: 'Importe',
                value: formatMoney(payment.amount, payment.currency),
              },
              {
                label: 'Recibido',
                value:
                  payment.receivedAmountCents === undefined
                    ? '—'
                    : formatCents(
                        payment.receivedAmountCents,
                        payment.currency,
                      ),
              },
              {
                label: 'Devuelto',
                value:
                  payment.refundedAmountCents === undefined
                    ? '—'
                    : formatCents(
                        payment.refundedAmountCents,
                        payment.currency,
                      ),
              },
              { label: 'Vence', value: formatDateTime(payment.expiresAt) },
              { label: 'Pagado', value: formatDateTime(payment.paidAt) },
            ]}
          />
        ) : (
          <EmptyState
            title="Sin pago asociado"
            description="La orden todavía no conserva una referencia a una cobranza."
          />
        )}
      </SectionCard>

      <SectionCard
        title="Títulos asignados"
        description={`${formatInteger(quotas.length || order.titleNumbers?.length)} registros disponibles en el detalle.`}
      >
        {quotas.length ? (
          <div className="table-wrap">
            <table className="data-table data-table--compact">
              <caption className="sr-only">
                Títulos asignados a la orden
              </caption>
              <thead>
                <tr>
                  <th scope="col">Número</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Tipo</th>
                  <th scope="col">Pagado</th>
                  <th scope="col">Premio instantáneo</th>
                </tr>
              </thead>
              <tbody>
                {quotas.map((quota) => {
                  const quotaRecord = quota as Quota & {
                    instantPrize?: unknown;
                  };
                  return (
                    <tr key={relationId(quota) || quota.number}>
                      <td>
                        <strong className="mono-value">{quota.number}</strong>
                      </td>
                      <td>
                        <StatusBadge status={quota.status} />
                      </td>
                      <td>{quota.isBonus ? 'Bonus' : 'Comprado'}</td>
                      <td>{formatDateTime(quota.paidAt)}</td>
                      <td>
                        {objectLabel(quotaRecord.instantPrize) ||
                          compactId(relationId(quotaRecord.instantPrize))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : order.titleNumbers?.length ? (
          <ul className="token-list" aria-label="Números de título">
            {order.titleNumbers.map((number) => (
              <li key={number}>
                <code>{number}</code>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title="No hay títulos en el detalle"
            description="La orden no tiene cuotas pobladas ni una copia de números asignados."
          />
        )}
      </SectionCard>

      {order.instantPrizes?.length ? (
        <SectionCard
          title="Premios instantáneos"
          description="Adjudicaciones relacionadas con la orden."
        >
          <ul className="stack-list">
            {order.instantPrizes.map((prize, index) => {
              const record = prize as unknown as Record<string, unknown>;
              const id = relationId(prize) || String(index);
              return (
                <li key={id}>
                  <strong>{objectLabel(prize) || `Premio ${index + 1}`}</strong>
                  <StatusBadge
                    status={
                      typeof record.status === 'string'
                        ? record.status
                        : undefined
                    }
                  />
                  <small>{compactId(id)}</small>
                </li>
              );
            })}
          </ul>
        </SectionCard>
      ) : null}

      <div className="detail-grid">
        <SectionCard
          title="Historial de estado"
          description="Secuencia registrada por el backend."
        >
          {history.length ? (
            <ol className="timeline">
              {history.map((entry, index) => (
                <li key={`${entry.status}-${entry.at}-${index}`}>
                  <div>
                    <StatusBadge status={entry.status} />
                    <time dateTime={entry.at}>{formatDateTime(entry.at)}</time>
                  </div>
                  {entry.reason ? <p>{entry.reason}</p> : null}
                  {entry.actor ? <small>Actor: {entry.actor}</small> : null}
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState
              title="Sin historial"
              description="No se recibieron transiciones para esta orden."
            />
          )}
        </SectionCard>

        <SectionCard
          title="Contrato y atribución"
          description="Consentimiento y origen comercial capturados."
        >
          <DefinitionList
            items={[
              { label: 'Versión de términos', value: order.termsVersion },
              {
                label: 'Aceptados',
                value: formatDateTime(order.termsAcceptedAt),
              },
              {
                label: 'Hash de términos',
                value: (
                  <CopyValue value={order.termsHash} label="hash de términos" />
                ),
              },
              {
                label: 'Promoción',
                value: order.promotion
                  ? `${order.promotion.label ?? 'Promoción'} · ${formatInteger(order.promotion.quantity)} por ${formatMoney(order.promotion.totalPrice, order.currency)}`
                  : 'Sin promoción',
              },
            ]}
          />
          {attribution.length ? (
            <dl className="definition-list definition-list--compact">
              {attribution.map(([key, value]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>{String(value)}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="muted-text">Sin atribución comercial registrada.</p>
          )}
        </SectionCard>
      </div>
    </main>
  );
}

export default OrderDetailPage;
