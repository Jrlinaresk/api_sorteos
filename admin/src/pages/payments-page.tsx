import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  CircleAlert,
  RefreshCw,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import { useMemo, type FormEvent } from 'react';
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
import { api } from '@/lib/api';
import {
  compactId,
  formatCents,
  formatDateTime,
  formatInteger,
  formatMoney,
} from '@/lib/format';
import type {
  PaymentsPage as PaymentsPageResponse,
  PaymentStatus,
} from '@/lib/types';
import {
  PAYMENT_ATTENTION_STATUSES,
  PAYMENT_STATUS_OPTIONS,
  paymentDocumentId,
  positiveInteger,
} from './orders-payments-shared';

const DEFAULT_LIMIT = 50;

export function PaymentsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const page = positiveInteger(searchParams.get('page'), 1);
  const limit = positiveInteger(searchParams.get('limit'), DEFAULT_LIMIT, 200);
  const rawStatus = searchParams.get('status');
  const status = PAYMENT_STATUS_OPTIONS.some(
    (option) => option.value === rawStatus,
  )
    ? (rawStatus as PaymentStatus)
    : undefined;
  const provider = searchParams.get('provider') ?? '';
  const appliedSearch = searchParams.get('search') ?? '';

  const paymentsQuery = useQuery({
    queryKey: ['payments', 'admin', { page, limit, status: status ?? '' }],
    queryFn: () =>
      api.get<PaymentsPageResponse>('/payments/admin', {
        query: { page, limit, status },
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

  const loadedPayments = useMemo(
    () => paymentsQuery.data?.data ?? [],
    [paymentsQuery.data?.data],
  );
  const visiblePayments = useMemo(() => {
    const needle = appliedSearch.trim().toLocaleLowerCase('es');
    return loadedPayments.filter((payment) => {
      if (provider && payment.provider !== provider) return false;
      if (!needle) return true;
      return [
        paymentDocumentId(payment),
        payment.txid,
        payment.externalId,
        payment.endToEndId,
        payment.order,
        payment.campaign,
        payment.user,
      ].some((value) =>
        String(value ?? '')
          .toLocaleLowerCase('es')
          .includes(needle),
      );
    });
  }, [appliedSearch, loadedPayments, provider]);

  const currentPageTotals = useMemo(
    () => ({
      received: loadedPayments.reduce(
        (sum, payment) => sum + (payment.receivedAmountCents ?? 0),
        0,
      ),
      refunded: loadedPayments.reduce(
        (sum, payment) => sum + (payment.refundedAmountCents ?? 0),
        0,
      ),
      attention: loadedPayments.filter((payment) =>
        PAYMENT_ATTENTION_STATUSES.has(payment.status),
      ).length,
    }),
    [loadedPayments],
  );

  const resultPage = paymentsQuery.data?.page ?? page;
  const totalPages = Math.max(1, paymentsQuery.data?.pages ?? 1);
  const total = paymentsQuery.data?.total ?? 0;
  const hasLocalFilters = Boolean(provider || appliedSearch);
  const hasAnyFilters = Boolean(status || hasLocalFilters);

  return (
    <main className="page" aria-label="Pagos">
      <PageHeader
        eyebrow="Control financiero"
        title="Pagos Pix"
        description="Supervisa cobros, importes recibidos, devoluciones y excepciones que requieren intervención."
        actions={
          <Button
            type="button"
            variant="secondary"
            onClick={() => void paymentsQuery.refetch()}
            busy={paymentsQuery.isFetching}
          >
            <RefreshCw size={17} aria-hidden="true" />
            Actualizar
          </Button>
        }
      />

      {currentPageTotals.attention > 0 ? (
        <InlineAlert tone="warning" title="Hay pagos que requieren atención">
          <p>
            Esta página contiene {formatInteger(currentPageTotals.attention)}{' '}
            pago(s) en revisión, con devolución pendiente, disputa o
            contracargo.
          </p>
        </InlineAlert>
      ) : null}

      <section
        className="metric-grid"
        aria-label="Resumen de la página cargada"
      >
        <article className="metric-card">
          <span>Registros en página</span>
          <strong>{formatInteger(loadedPayments.length)}</strong>
          <small>{formatInteger(total)} en el resultado completo</small>
        </article>
        <article className="metric-card">
          <span>Recibido en página</span>
          <strong>{formatCents(currentPageTotals.received, 'BRL')}</strong>
          <small>No representa un cierre contable global</small>
        </article>
        <article className="metric-card">
          <span>Devuelto en página</span>
          <strong>{formatCents(currentPageTotals.refunded, 'BRL')}</strong>
        </article>
        <article className="metric-card">
          <span>Atención</span>
          <strong>{formatInteger(currentPageTotals.attention)}</strong>
          <small>Estados financieros sensibles</small>
        </article>
      </section>

      <SectionCard
        title="Filtros"
        description="El estado se consulta en el servidor; proveedor y búsqueda se aplican a la página cargada."
      >
        <form
          className="filters"
          onSubmit={submitSearch}
          role="search"
          key={appliedSearch}
        >
          <label className="field field--wide">
            <span>Buscar en esta página</span>
            <span className="input-with-icon">
              <Search size={17} aria-hidden="true" />
              <input
                name="search"
                type="search"
                defaultValue={appliedSearch}
                maxLength={160}
                placeholder="ID, txid, pedido, campaña o usuario"
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
              {PAYMENT_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Proveedor en página</span>
            <select
              value={provider}
              onChange={(event) =>
                updateFilters({ provider: event.target.value || undefined })
              }
            >
              <option value="">Todos</option>
              <option value="efi">Efí</option>
              <option value="mock">Mock</option>
            </select>
          </label>

          <label className="field field--compact">
            <span>Filas</span>
            <select
              value={limit}
              onChange={(event) =>
                updateFilters({ limit: Number(event.target.value) })
              }
            >
              {[20, 50, 100, 200].map((size) => (
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
              disabled={!hasAnyFilters}
            >
              Limpiar
            </Button>
          </div>
        </form>
      </SectionCard>

      {hasLocalFilters ? (
        <InlineAlert tone="info" title="Filtro local">
          <p>
            Se muestran {formatInteger(visiblePayments.length)} de{' '}
            {formatInteger(loadedPayments.length)} pagos cargados en esta
            página. Para evitar resultados parciales, usa el filtro de estado
            antes de buscar.
          </p>
        </InlineAlert>
      ) : null}

      <SectionCard
        title="Cobros"
        description={`${formatInteger(total)} pagos en el resultado del servidor`}
      >
        {paymentsQuery.isPending ? (
          <LoadingState label="Cargando pagos…" />
        ) : paymentsQuery.isError ? (
          <ErrorState
            error={paymentsQuery.error}
            onRetry={() => void paymentsQuery.refetch()}
          />
        ) : visiblePayments.length === 0 ? (
          <EmptyState
            title={
              hasAnyFilters ? 'No hay coincidencias' : 'Todavía no hay pagos'
            }
            description={
              hasLocalFilters && loadedPayments.length > 0
                ? 'La búsqueda local no coincide con los pagos de esta página.'
                : hasAnyFilters
                  ? 'Prueba con otro estado o limpia los filtros.'
                  : 'Los cobros aparecerán cuando se inicien checkouts.'
            }
            action={
              hasAnyFilters ? (
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
              aria-busy={paymentsQuery.isFetching || undefined}
            >
              <table className="data-table">
                <caption className="sr-only">
                  Pagos Pix con importes recibidos, devueltos y estado operativo
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Pago</th>
                    <th scope="col">Txid / pedido</th>
                    <th scope="col">Estado</th>
                    <th scope="col" className="numeric-cell">
                      Esperado
                    </th>
                    <th scope="col" className="numeric-cell">
                      Recibido
                    </th>
                    <th scope="col" className="numeric-cell">
                      Devuelto
                    </th>
                    <th scope="col">Fechas</th>
                    <th scope="col">
                      <span className="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visiblePayments.map((payment) => {
                    const id = paymentDocumentId(payment);
                    const needsAttention = PAYMENT_ATTENTION_STATUSES.has(
                      payment.status,
                    );
                    return (
                      <tr
                        key={id}
                        className={
                          needsAttention ? 'row--attention' : undefined
                        }
                      >
                        <td>
                          <strong>{compactId(id)}</strong>
                          <small>{payment.provider.toUpperCase()}</small>
                          {needsAttention ? (
                            <small className="attention-label">
                              <CircleAlert size={14} aria-hidden="true" />{' '}
                              Revisión
                            </small>
                          ) : null}
                        </td>
                        <td>
                          <span className="mono-value">
                            {compactId(payment.txid)}
                          </span>
                          <small>Pedido {compactId(payment.order)}</small>
                          <small>Campaña {compactId(payment.campaign)}</small>
                        </td>
                        <td>
                          <StatusBadge status={payment.status} />
                        </td>
                        <td className="numeric-cell">
                          <strong>
                            {formatMoney(payment.amount, payment.currency)}
                          </strong>
                        </td>
                        <td className="numeric-cell">
                          {formatCents(
                            payment.receivedAmountCents,
                            payment.currency,
                          )}
                        </td>
                        <td className="numeric-cell">
                          {formatCents(
                            payment.refundedAmountCents,
                            payment.currency,
                          )}
                        </td>
                        <td>
                          <span>{formatDateTime(payment.createdAt)}</span>
                          {payment.paidAt ? (
                            <small>
                              Pagado {formatDateTime(payment.paidAt)}
                            </small>
                          ) : (
                            <small>
                              Vence {formatDateTime(payment.expiresAt)}
                            </small>
                          )}
                        </td>
                        <td className="table-actions">
                          <Link
                            className="button button--secondary"
                            to={`/payments/${encodeURIComponent(id)}`}
                            aria-label={`Ver pago ${id}`}
                          >
                            Ver detalle
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination
              page={resultPage}
              totalPages={totalPages}
              total={total}
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

export default PaymentsPage;
