import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  CalendarClock,
  FilterX,
  Pencil,
  Plus,
  Search,
  Star,
  Trophy,
} from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Pagination,
  SectionCard,
  StatusBadge,
} from '@/components/ui';
import { api } from '@/lib/api';
import {
  formatDateTime,
  formatInteger,
  formatMoney,
  percent,
} from '@/lib/format';
import { statusLabel } from '@/lib/status';
import type { CampaignStatus, Category, DataPage } from '@/lib/types';
import { entityId } from '@/lib/types';
import type { AdminCampaign } from './campaigns-lifecycle';

const campaignStatuses: CampaignStatus[] = [
  'draft',
  'scheduled',
  'active',
  'open',
  'expired',
  'sold_out',
  'awaiting_draw',
  'drawn',
  'closed',
  'cancelled',
];

function positiveInteger(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function categoryIdentifier(campaign: AdminCampaign): string {
  if (!campaign.category) return '';
  return typeof campaign.category === 'string'
    ? campaign.category
    : entityId(campaign.category);
}

export function CampaignsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const page = positiveInteger(searchParams.get('page'), 1);
  const limit = Math.min(100, positiveInteger(searchParams.get('limit'), 25));
  const rawStatus = searchParams.get('status');
  const status = campaignStatuses.includes(rawStatus as CampaignStatus)
    ? (rawStatus as CampaignStatus)
    : undefined;
  const category = searchParams.get('category') ?? '';
  const featured = searchParams.get('featured');
  const search = searchParams.get('search')?.trim() ?? '';
  const [searchDraft, setSearchDraft] = useState(search);

  const categoriesQuery = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get<Category[]>('/categories'),
    staleTime: 60_000,
  });

  const campaignsQuery = useQuery({
    queryKey: [
      'campaigns',
      'page',
      { page, limit, status, category, featured, search },
    ],
    queryFn: () =>
      api.get<DataPage<AdminCampaign>>('/admin/campaigns/page', {
        query: {
          page,
          limit,
          status,
          category: category || undefined,
          featured:
            featured === 'true'
              ? true
              : featured === 'false'
                ? false
                : undefined,
          search: search || undefined,
        },
      }),
    placeholderData: keepPreviousData,
  });

  const categoryNames = useMemo(
    () =>
      new Map(
        (categoriesQuery.data ?? []).map((item) => [entityId(item), item.name]),
      ),
    [categoriesQuery.data],
  );

  const updateParams = (
    values: Record<string, string | number | undefined>,
    replace = true,
  ) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined || value === '') next.delete(key);
      else next.set(key, String(value));
    }
    setSearchParams(next, { replace });
  };

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    updateParams({ search: searchDraft.trim() || undefined, page: 1 });
  };

  const clearFilters = () => {
    setSearchDraft('');
    setSearchParams(new URLSearchParams({ page: '1', limit: String(limit) }), {
      replace: true,
    });
  };

  const hasFilters = Boolean(status || category || featured || search);
  const rows = campaignsQuery.data?.data ?? [];
  const meta = campaignsQuery.data?.meta;

  return (
    <main className="page-stack" id="campaigns-content">
      <PageHeader
        eyebrow="Operación comercial"
        title="Campañas"
        description="Controla catálogo, ventas, calendario y el ciclo de vida de cada sorteo."
        actions={
          <Link className="button button--primary" to="/campaigns/new">
            <Plus size={18} aria-hidden="true" />
            Nueva campaña
          </Link>
        }
      />

      <SectionCard
        title="Filtros"
        description="La búsqueda y los filtros se aplican en el servidor."
      >
        <form className="filters-grid" role="search" onSubmit={submitSearch}>
          <label className="field field--search">
            <span>Buscar campaña</span>
            <span className="input-with-icon">
              <Search size={17} aria-hidden="true" />
              <input
                type="search"
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
                placeholder="Nombre, descripción o premio"
                maxLength={100}
              />
            </span>
          </label>

          <label className="field">
            <span>Estado</span>
            <select
              value={status ?? ''}
              onChange={(event) =>
                updateParams({
                  status: event.target.value || undefined,
                  page: 1,
                })
              }
            >
              <option value="">Todos los estados</option>
              {campaignStatuses.map((item) => (
                <option key={item} value={item}>
                  {statusLabel(item)}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Categoría</span>
            <select
              value={category}
              onChange={(event) =>
                updateParams({
                  category: event.target.value || undefined,
                  page: 1,
                })
              }
              disabled={categoriesQuery.isLoading}
            >
              <option value="">Todas las categorías</option>
              {(categoriesQuery.data ?? []).map((item) => (
                <option key={entityId(item)} value={entityId(item)}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Visibilidad</span>
            <select
              value={featured ?? ''}
              onChange={(event) =>
                updateParams({
                  featured: event.target.value || undefined,
                  page: 1,
                })
              }
            >
              <option value="">Todas</option>
              <option value="true">Solo destacadas</option>
              <option value="false">No destacadas</option>
            </select>
          </label>

          <label className="field field--compact">
            <span>Filas por página</span>
            <select
              value={limit}
              onChange={(event) =>
                updateParams({ limit: Number(event.target.value), page: 1 })
              }
            >
              {[12, 25, 50, 100].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <div className="filter-actions">
            <button className="button button--primary" type="submit">
              <Search size={17} aria-hidden="true" />
              Buscar
            </button>
            <button
              className="button button--ghost"
              type="button"
              onClick={clearFilters}
              disabled={!hasFilters}
            >
              <FilterX size={17} aria-hidden="true" />
              Limpiar
            </button>
          </div>
        </form>
      </SectionCard>

      <SectionCard
        title="Catálogo administrativo"
        description={
          meta
            ? `${formatInteger(meta.total)} campañas encontradas`
            : 'Campañas de todos los estados'
        }
        actions={
          campaignsQuery.isFetching && !campaignsQuery.isLoading ? (
            <span className="query-activity" role="status">
              Actualizando…
            </span>
          ) : undefined
        }
      >
        {campaignsQuery.isLoading ? (
          <LoadingState label="Cargando campañas…" />
        ) : campaignsQuery.isError ? (
          <ErrorState
            error={campaignsQuery.error}
            onRetry={() => campaignsQuery.refetch()}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            title={
              hasFilters ? 'No hay coincidencias' : 'Todavía no hay campañas'
            }
            description={
              hasFilters
                ? 'Prueba otra búsqueda o limpia los filtros.'
                : 'Crea el primer borrador para comenzar a configurar el catálogo.'
            }
            action={
              hasFilters ? (
                <button
                  className="button button--secondary"
                  type="button"
                  onClick={clearFilters}
                >
                  Limpiar filtros
                </button>
              ) : (
                <Link className="button button--primary" to="/campaigns/new">
                  Crear campaña
                </Link>
              )
            }
          />
        ) : (
          <>
            <div className="table-scroll">
              <table className="data-table campaign-table">
                <caption className="sr-only">
                  Campañas administrables y progreso de ventas
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Campaña</th>
                    <th scope="col">Estado</th>
                    <th scope="col">Ventas</th>
                    <th scope="col">Precio</th>
                    <th scope="col">Cierre</th>
                    <th scope="col">
                      <span className="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((campaign) => {
                    const id = entityId(campaign);
                    const progress = percent(
                      campaign.soldCount,
                      campaign.totalTitles,
                    );
                    const categoryName = categoryNames.get(
                      categoryIdentifier(campaign),
                    );
                    return (
                      <tr key={id}>
                        <td>
                          <div className="entity-cell">
                            <div className="entity-cell__title">
                              {campaign.featured ? (
                                <Star
                                  className="featured-icon"
                                  size={16}
                                  aria-label="Destacada"
                                />
                              ) : null}
                              <strong>{campaign.name}</strong>
                            </div>
                            <span>{categoryName ?? campaign.prizeTitle}</span>
                            <code>{campaign.slug}</code>
                          </div>
                        </td>
                        <td>
                          <StatusBadge status={campaign.status} />
                        </td>
                        <td>
                          <div className="progress-cell">
                            <div className="progress-cell__label">
                              <span>
                                {formatInteger(campaign.soldCount)} pagados
                              </span>
                              <strong>
                                {progress.toFixed(progress >= 10 ? 0 : 1)}%
                              </strong>
                            </div>
                            <progress
                              value={campaign.soldCount}
                              max={Math.max(1, campaign.totalTitles)}
                              aria-label={`${progress.toFixed(1)}% vendido`}
                            />
                            {campaign.reservedCount ? (
                              <small>
                                {formatInteger(campaign.reservedCount)}{' '}
                                reservados
                              </small>
                            ) : null}
                          </div>
                        </td>
                        <td>
                          <strong>
                            {formatMoney(
                              campaign.ticketPrice,
                              campaign.currency,
                            )}
                          </strong>
                          <small className="table-secondary">por título</small>
                        </td>
                        <td>
                          <span className="date-cell">
                            <CalendarClock size={15} aria-hidden="true" />
                            {formatDateTime(campaign.closesAt)}
                          </span>
                        </td>
                        <td>
                          <div className="row-actions">
                            <Link
                              className="button button--ghost button--compact"
                              to={`/draws?campaignId=${encodeURIComponent(id)}`}
                              aria-label={`Gestionar sorteo de ${campaign.name}`}
                            >
                              <Trophy size={16} aria-hidden="true" />
                              Sorteo
                            </Link>
                            <Link
                              className="button button--secondary button--compact"
                              to={`/campaigns/${encodeURIComponent(id)}`}
                              aria-label={`Editar ${campaign.name}`}
                            >
                              <Pencil size={16} aria-hidden="true" />
                              Editar
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination
              page={meta?.page ?? page}
              totalPages={meta?.pages ?? 1}
              total={meta?.total}
              onPageChange={(nextPage) =>
                updateParams({ page: nextPage }, false)
              }
            />
          </>
        )}
      </SectionCard>
    </main>
  );
}

export default CampaignsPage;
