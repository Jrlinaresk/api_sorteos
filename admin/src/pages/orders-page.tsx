import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Download, RefreshCw, Search, SlidersHorizontal } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Button,
  EmptyState,
  ErrorState,
  InlineAlert,
  LoadingState,
  PageHeader,
  Pagination,
  SectionCard,
  StatusBadge,
} from '@/components/ui';
import { api, downloadFile } from '@/lib/api';
import {
  compactId,
  formatDateTime,
  formatInteger,
  formatMoney,
} from '@/lib/format';
import { useToast } from '@/lib/toast-context';
import type { Campaign, DataPage, Order, OrderStatus } from '@/lib/types';
import {
  campaignName,
  ORDER_STATUS_OPTIONS,
  paymentId,
  positiveInteger,
  relationId,
} from './orders-payments-shared';

const DEFAULT_LIMIT = 20;

export function OrdersPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { showToast } = useToast();
  const page = positiveInteger(searchParams.get('page'), 1);
  const limit = positiveInteger(searchParams.get('limit'), DEFAULT_LIMIT, 100);
  const rawStatus = searchParams.get('status');
  const status = ORDER_STATUS_OPTIONS.some(
    (option) => option.value === rawStatus,
  )
    ? (rawStatus as OrderStatus)
    : undefined;
  const campaignId = searchParams.get('campaignId') ?? '';
  const appliedSearch = searchParams.get('search') ?? '';
  const [downloading, setDownloading] = useState(false);

  const campaignsQuery = useQuery({
    queryKey: ['campaigns', 'options'],
    queryFn: () => api.get<Campaign[]>('/admin/campaigns'),
    staleTime: 5 * 60_000,
  });

  const ordersQuery = useQuery({
    queryKey: [
      'orders',
      'admin',
      { page, limit, status: status ?? '', campaignId, search: appliedSearch },
    ],
    queryFn: () =>
      api.get<DataPage<Order>>('/admin/orders', {
        query: {
          page,
          limit,
          status: status ?? undefined,
          campaignId: campaignId || undefined,
          search: appliedSearch || undefined,
        },
      }),
    placeholderData: keepPreviousData,
  });

  const updateFilters = (
    updates: Record<string, string | number | undefined>,
    resetPage = true,
  ) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined || value === '') next.delete(key);
      else next.set(key, String(value));
    }
    if (resetPage) next.set('page', '1');
    setSearchParams(next, { replace: true });
  };

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const search = String(form.get('search') ?? '').trim();
    updateFilters({ search: search || undefined });
  };

  const clearFilters = () => {
    setSearchParams(new URLSearchParams({ page: '1', limit: String(limit) }), {
      replace: true,
    });
  };

  const selectedCampaign = campaignsQuery.data?.find(
    (campaign) => relationId(campaign) === campaignId,
  );

  const downloadParticipants = async () => {
    if (!campaignId || downloading) return;
    setDownloading(true);
    try {
      const filenamePart = (selectedCampaign?.slug || campaignId).replace(
        /[^a-zA-Z0-9_-]/g,
        '-',
      );
      await downloadFile(
        `/admin/orders/campaign/${campaignId}/participants.csv`,
        `participantes-${filenamePart}.csv`,
      );
      showToast({
        tone: 'success',
        title: 'CSV descargado',
        message: `Participantes de ${selectedCampaign?.name ?? campaignId}`,
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

  const orders = ordersQuery.data?.data ?? [];
  const meta = ordersQuery.data?.meta;
  const totalPages = Math.max(
    1,
    meta?.pages ?? Math.ceil((meta?.total ?? 0) / (meta?.limit ?? limit)),
  );
  const hasFilters = Boolean(status || campaignId || appliedSearch);

  return (
    <main className="page" aria-label="Órdenes">
      <PageHeader
        eyebrow="Operación comercial"
        title="Órdenes"
        description="Consulta compradores, reservas, títulos asignados y el estado financiero de cada pedido."
        actions={
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void ordersQuery.refetch()}
              busy={ordersQuery.isFetching}
            >
              <RefreshCw size={17} aria-hidden="true" />
              Actualizar
            </Button>
            <Button
              type="button"
              onClick={() => void downloadParticipants()}
              disabled={!campaignId}
              busy={downloading}
              title={
                campaignId
                  ? 'Descargar todos los participantes pagados de la campaña'
                  : 'Selecciona una campaña para descargar participantes'
              }
            >
              <Download size={17} aria-hidden="true" />
              CSV de participantes
            </Button>
          </>
        }
      />

      <SectionCard
        title="Filtros"
        description="La búsqueda cubre ID público, nombre, teléfono, correo y CPF."
      >
        <form
          className="filters"
          onSubmit={submitSearch}
          role="search"
          key={appliedSearch}
        >
          <label className="field field--wide">
            <span>Buscar orden o comprador</span>
            <span className="input-with-icon">
              <Search size={17} aria-hidden="true" />
              <input
                name="search"
                type="search"
                defaultValue={appliedSearch}
                maxLength={120}
                placeholder="ID, nombre, teléfono, correo o CPF"
              />
            </span>
          </label>

          <label className="field">
            <span>Estado</span>
            <select
              value={status ?? ''}
              onChange={(event) =>
                updateFilters({ status: event.target.value || undefined })
              }
            >
              <option value="">Todos los estados</option>
              {ORDER_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Campaña</span>
            <select
              value={campaignId}
              onChange={(event) =>
                updateFilters({ campaignId: event.target.value || undefined })
              }
              aria-describedby={
                campaignsQuery.isError ? 'campaign-filter-error' : undefined
              }
            >
              <option value="">Todas las campañas</option>
              {campaignId && !selectedCampaign ? (
                <option value={campaignId}>{compactId(campaignId)}</option>
              ) : null}
              {(campaignsQuery.data ?? []).map((campaign) => {
                const id = relationId(campaign);
                return (
                  <option key={id} value={id}>
                    {campaign.name}
                  </option>
                );
              })}
            </select>
            {campaignsQuery.isError ? (
              <small id="campaign-filter-error" role="status">
                No se pudo cargar el catálogo; el resto de filtros sigue
                disponible.
              </small>
            ) : null}
          </label>

          <label className="field field--compact">
            <span>Filas</span>
            <select
              value={limit}
              onChange={(event) =>
                updateFilters({ limit: Number(event.target.value) })
              }
            >
              {[20, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>

          <div className="filters__actions">
            <Button type="submit">
              <SlidersHorizontal size={17} aria-hidden="true" />
              Aplicar
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={clearFilters}
              disabled={!hasFilters}
            >
              Limpiar
            </Button>
          </div>
        </form>
      </SectionCard>

      {campaignId ? (
        <InlineAlert tone="info" title="Exportación por campaña">
          <p>
            El CSV incluye todos los títulos pagados de{' '}
            <strong>{selectedCampaign?.name ?? compactId(campaignId)}</strong>,
            no solo los registros visibles en esta página.
          </p>
        </InlineAlert>
      ) : null}

      <SectionCard
        title="Resultados"
        description={
          typeof meta?.total === 'number'
            ? `${formatInteger(meta.total)} órdenes encontradas`
            : 'Órdenes encontradas'
        }
      >
        {ordersQuery.isPending ? (
          <LoadingState label="Cargando órdenes…" />
        ) : ordersQuery.isError ? (
          <ErrorState
            error={ordersQuery.error}
            onRetry={() => void ordersQuery.refetch()}
          />
        ) : orders.length === 0 ? (
          <EmptyState
            title={
              hasFilters ? 'No hay coincidencias' : 'Todavía no hay órdenes'
            }
            description={
              hasFilters
                ? 'Prueba con otros filtros o limpia la búsqueda.'
                : 'Las órdenes aparecerán cuando comience el checkout.'
            }
            action={
              hasFilters ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={clearFilters}
                >
                  Limpiar filtros
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <div
              className="table-wrap"
              aria-busy={ordersQuery.isFetching || undefined}
            >
              <table className="data-table">
                <caption className="sr-only">
                  Órdenes administrativas, comprador, campaña, importe y estado
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Orden</th>
                    <th scope="col">Comprador</th>
                    <th scope="col">Campaña</th>
                    <th scope="col">Estado</th>
                    <th scope="col" className="numeric-cell">
                      Títulos
                    </th>
                    <th scope="col" className="numeric-cell">
                      Total
                    </th>
                    <th scope="col">Creada</th>
                    <th scope="col">
                      <span className="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => {
                    const campaign = order.campaign;
                    const payment =
                      typeof order.payment === 'object' && order.payment
                        ? order.payment
                        : undefined;
                    return (
                      <tr key={order.publicId}>
                        <td>
                          <strong>{compactId(order.publicId)}</strong>
                          {payment ? (
                            <small>
                              Pago: <StatusBadge status={payment.status} />
                            </small>
                          ) : null}
                        </td>
                        <td>
                          <strong>{order.buyer.name}</strong>
                          <small>{order.buyer.phone}</small>
                          <small>{order.buyer.email}</small>
                        </td>
                        <td>
                          <span>{campaignName(campaign)}</span>
                          <small>{compactId(relationId(campaign))}</small>
                        </td>
                        <td>
                          <StatusBadge status={order.status} />
                        </td>
                        <td className="numeric-cell">
                          {formatInteger(order.allocatedQuantity)}
                          {order.bonusQuantity > 0 ? (
                            <small>
                              +{formatInteger(order.bonusQuantity)} bonus
                            </small>
                          ) : null}
                        </td>
                        <td className="numeric-cell">
                          <strong>
                            {formatMoney(order.total, order.currency)}
                          </strong>
                        </td>
                        <td>
                          {formatDateTime(order.createdAt ?? order.reservedAt)}
                          {order.paidAt ? (
                            <small>Pagada {formatDateTime(order.paidAt)}</small>
                          ) : null}
                        </td>
                        <td className="table-actions">
                          <Link
                            className="button button--secondary"
                            to={`/orders/${encodeURIComponent(order.publicId)}`}
                            aria-label={`Ver orden ${order.publicId}`}
                          >
                            Ver detalle
                          </Link>
                          {paymentId(order.payment) ? (
                            <Link
                              className="button button--ghost"
                              to={`/payments/${encodeURIComponent(paymentId(order.payment))}`}
                              aria-label={`Ver pago de la orden ${order.publicId}`}
                            >
                              Ver pago
                            </Link>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination
              page={meta?.page ?? page}
              totalPages={totalPages}
              total={meta?.total}
              onPageChange={(nextPage) =>
                updateFilters({ page: nextPage }, false)
              }
            />
          </>
        )}
      </SectionCard>
    </main>
  );
}

export default OrdersPage;
