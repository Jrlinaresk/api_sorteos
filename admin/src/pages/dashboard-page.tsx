import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  CircleAlert,
  CircleDollarSign,
  Clock3,
  ShoppingCart,
  Ticket,
  Trophy,
  Users,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  SectionCard,
  StatusBadge,
} from '@/components/ui';
import { api } from '@/lib/api';
import { formatCents, formatDateTime, formatInteger } from '@/lib/format';
import type { DashboardSummary } from '@/lib/types';

export function DashboardPage() {
  const [days, setDays] = useState(30);
  const dashboard = useQuery({
    queryKey: ['dashboard', days],
    queryFn: () =>
      api.get<DashboardSummary>('/admin/dashboard', { query: { days } }),
    refetchInterval: 60_000,
  });

  if (dashboard.isLoading)
    return <LoadingState label="Preparando el resumen operativo…" />;
  if (dashboard.isError)
    return (
      <ErrorState error={dashboard.error} onRetry={() => dashboard.refetch()} />
    );
  if (!dashboard.data) return <EmptyState />;
  const data = dashboard.data;
  const attentionTotal =
    data.orders.attention + data.finance.paymentsUnderReview;
  const pendingPrizes = data.prizes.instantClaimed + data.prizes.mainClaimed;

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Pulso del negocio"
        title="Resumen operativo"
        description={`Datos actualizados ${formatDateTime(data.generatedAt)} · periodo móvil de ${days} días.`}
        actions={
          <label className="compact-field">
            <span>Periodo</span>
            <select
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
            >
              <option value={7}>7 días</option>
              <option value={30}>30 días</option>
              <option value={90}>90 días</option>
              <option value={365}>12 meses</option>
            </select>
          </label>
        }
      />

      {attentionTotal > 0 ||
      data.campaigns.awaitingDraw > 0 ||
      pendingPrizes > 0 ? (
        <section
          className="attention-strip"
          aria-label="Pendientes de atención"
        >
          <div>
            <span className="attention-strip__icon">
              <CircleAlert aria-hidden="true" />
            </span>
            <div>
              <strong>Hay tareas que necesitan atención</strong>
              <p>
                Resuelve primero las excepciones financieras y los sorteos
                listos.
              </p>
            </div>
          </div>
          <div className="attention-strip__links">
            {attentionTotal > 0 ? (
              <Link to="/payments">{attentionTotal} pagos/pedidos</Link>
            ) : null}
            {data.campaigns.awaitingDraw > 0 ? (
              <Link to="/draws">{data.campaigns.awaitingDraw} sorteos</Link>
            ) : null}
            {pendingPrizes > 0 ? (
              <Link to="/prizes">{pendingPrizes} entregas</Link>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="metric-grid" aria-label="Indicadores principales">
        <MetricCard
          label="Ingreso neto acumulado"
          value={formatCents(data.finance.netCents)}
          meta={`${formatInteger(data.finance.paymentCount)} pagos`}
          icon={CircleDollarSign}
          tone="teal"
        />
        <MetricCard
          label="Pedidos pagados"
          value={formatInteger(data.orders.paid)}
          meta={`${formatInteger(data.orders.pending)} pendientes`}
          icon={ShoppingCart}
          tone="blue"
        />
        <MetricCard
          label="Campañas activas"
          value={formatInteger(data.campaigns.active)}
          meta={`${formatInteger(data.campaigns.total)} en total`}
          icon={Ticket}
          tone="violet"
        />
        <MetricCard
          label="Usuarios activos"
          value={formatInteger(data.users.active)}
          meta={`${formatInteger(data.users.total)} registrados`}
          icon={Users}
          tone="amber"
        />
      </section>

      <div className="dashboard-grid dashboard-grid--main">
        <SectionCard
          title="Ventas del periodo"
          description="Ingresos confirmados por día, sin descontar devoluciones posteriores."
          actions={
            <span className="legend">
              <i /> Ingreso cobrado
            </span>
          }
          className="sales-card"
        >
          <SalesChart rows={data.dailySales} />
        </SectionCard>
        <SectionCard
          title="Colas operativas"
          description="Trabajo pendiente que requiere intervención."
        >
          <div className="queue-list">
            <QueueItem
              icon={CircleAlert}
              label="Pagos con incidencia"
              value={data.finance.paymentsUnderReview}
              path="/payments"
              urgent={data.finance.paymentsUnderReview > 0}
            />
            <QueueItem
              icon={Clock3}
              label="Campañas por sortear"
              value={data.campaigns.awaitingDraw}
              path="/draws"
              urgent={data.campaigns.awaitingDraw > 0}
            />
            <QueueItem
              icon={Trophy}
              label="Premios reclamados"
              value={pendingPrizes}
              path="/prizes"
              urgent={pendingPrizes > 0}
            />
            <QueueItem
              icon={ShoppingCart}
              label="Pedidos bajo revisión"
              value={data.orders.attention}
              path="/orders"
              urgent={data.orders.attention > 0}
            />
          </div>
        </SectionCard>
      </div>

      <div className="dashboard-grid dashboard-grid--tables">
        <SectionCard
          title="Pedidos recientes"
          description="Última actividad de compra registrada."
          actions={
            <Link className="text-link" to="/orders">
              Ver todos <ArrowRight size={15} aria-hidden="true" />
            </Link>
          }
        >
          {data.recentOrders.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Pedido</th>
                    <th>Comprador</th>
                    <th>Campaña</th>
                    <th>Estado</th>
                    <th className="number-cell">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentOrders.map((order) => (
                    <tr key={order.id}>
                      <td>
                        <Link
                          className="table-link"
                          to={`/orders/${order.publicId}`}
                        >
                          {order.publicId.slice(0, 8)}
                        </Link>
                        <small>{formatDateTime(order.createdAt)}</small>
                      </td>
                      <td>{order.buyerName || 'Sin nombre'}</td>
                      <td>{order.campaign?.name || '—'}</td>
                      <td>
                        <StatusBadge status={order.status} />
                      </td>
                      <td className="number-cell">
                        <strong>
                          {formatCents(order.totalCents, order.currency)}
                        </strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="Aún no hay pedidos"
              description="La actividad aparecerá aquí cuando lleguen compras."
            />
          )}
        </SectionCard>

        <SectionCard
          title="Campañas con más ventas"
          description="Acumulado histórico confirmado."
        >
          {data.topCampaigns.length ? (
            <ol className="ranking-list">
              {data.topCampaigns.map((campaign, index) => (
                <li key={campaign.campaignId}>
                  <span className="ranking-list__position">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <div>
                    <Link to={`/campaigns/${campaign.campaignId}`}>
                      {campaign.name}
                    </Link>
                    <span>
                      {formatInteger(campaign.titles)} títulos ·{' '}
                      {formatInteger(campaign.orders)} pedidos
                    </span>
                  </div>
                  <strong>{formatCents(campaign.revenueCents)}</strong>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState title="Sin ventas confirmadas" />
          )}
        </SectionCard>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  meta,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  meta: string;
  icon: typeof Ticket;
  tone: string;
}) {
  return (
    <article className="metric-card">
      <span className={`metric-card__icon metric-card__icon--${tone}`}>
        <Icon aria-hidden="true" />
      </span>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        <span>{meta}</span>
      </div>
    </article>
  );
}

function QueueItem({
  icon: Icon,
  label,
  value,
  path,
  urgent,
}: {
  icon: typeof Ticket;
  label: string;
  value: number;
  path: string;
  urgent: boolean;
}) {
  return (
    <Link to={path} className="queue-item">
      <span
        className={`queue-item__icon ${urgent ? 'queue-item__icon--urgent' : ''}`}
      >
        <Icon size={19} aria-hidden="true" />
      </span>
      <span>{label}</span>
      <strong>{formatInteger(value)}</strong>
      <ArrowRight size={17} aria-hidden="true" />
    </Link>
  );
}

function SalesChart({ rows }: { rows: DashboardSummary['dailySales'] }) {
  const chart = useMemo(() => {
    if (!rows.length) return null;
    const max = Math.max(...rows.map((row) => row.revenueCents), 1);
    const width = 760;
    const height = 220;
    const padding = 12;
    const usableWidth = width - padding * 2;
    const usableHeight = height - padding * 2;
    const points = rows.map((row, index) => ({
      x:
        padding +
        (rows.length === 1
          ? usableWidth / 2
          : (index / (rows.length - 1)) * usableWidth),
      y: padding + usableHeight - (row.revenueCents / max) * usableHeight,
    }));
    const line = points.map((point) => `${point.x},${point.y}`).join(' ');
    const area = `${padding},${height - padding} ${line} ${width - padding},${height - padding}`;
    return { width, height, points, line, area, max };
  }, [rows]);

  if (!chart)
    return (
      <EmptyState
        title="Sin ventas en este periodo"
        description="Prueba un rango mayor o espera nuevas confirmaciones de pago."
      />
    );
  return (
    <div className="sales-chart">
      <div className="sales-chart__summary">
        <strong>
          {formatCents(rows.reduce((sum, row) => sum + row.revenueCents, 0))}
        </strong>
        <span>
          {formatInteger(rows.reduce((sum, row) => sum + row.orders, 0))}{' '}
          pedidos confirmados
        </span>
      </div>
      <svg
        viewBox={`0 0 ${chart.width} ${chart.height}`}
        role="img"
        aria-label={`Gráfico de ingresos diarios. Máximo diario ${formatCents(chart.max)}.`}
      >
        <defs>
          <linearGradient id="sales-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity=".3" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75, 1].map((part) => (
          <line
            key={part}
            x1="12"
            x2="748"
            y1={12 + 196 * part}
            y2={12 + 196 * part}
            className="chart-grid-line"
          />
        ))}
        <polygon points={chart.area} fill="url(#sales-fill)" />
        <polyline points={chart.line} fill="none" className="chart-line" />
        {chart.points.map((point, index) => (
          <circle
            key={rows[index].date}
            cx={point.x}
            cy={point.y}
            r="3.5"
            className="chart-point"
          >
            <title>
              {rows[index].date}: {formatCents(rows[index].revenueCents)}
            </title>
          </circle>
        ))}
      </svg>
      <div className="sales-chart__axis">
        <span>{rows[0]?.date}</span>
        <span>{rows.at(-1)?.date}</span>
      </div>
    </div>
  );
}
