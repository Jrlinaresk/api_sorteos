import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Edit3, Plus, Trash2, Trophy } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatDateTime, formatMoney } from '@/lib/format';
import { useToast } from '@/lib/toast-context';
import type { CampaignSummary, DataPage, PrizeAward } from '@/lib/types';
import {
  AccessDenied,
  ConfirmDialog,
  EmptyPanel,
  ErrorPanel,
  Field,
  LoadingPanel,
  Modal,
  Pagination,
  ResourcePageHeader,
  StatusBadge,
  errorMessage,
  numberValue,
  optionalString,
  submitForm,
} from './resource-page-shared';

type PrizeTab = 'inventory' | 'awards';
type Mechanic = 'winning_title' | 'roulette' | 'scratch';

interface AdminPrize {
  _id?: string;
  id?: string;
  campaign: CampaignSummary | string;
  title: string;
  description?: string;
  mechanic: Mechanic;
  quotaNumber?: string;
  cashValue?: number;
  alternativeTitle?: string;
  imageUrl?: string;
  mediaId?: string;
  stock: number;
  remainingStock?: number;
  weight?: number;
  sortOrder?: number;
  status?: string;
  createdAt?: string;
}

interface PrizeInput {
  campaignId: string;
  title: string;
  description?: string;
  mechanic: Mechanic;
  quotaNumber?: string;
  cashValue?: number;
  alternativeTitle?: string;
  imageUrl?: string;
  mediaId?: string;
  stock?: number;
  weight?: number;
  sortOrder?: number;
}

export function PrizesPage() {
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const { showToast } = useToast();
  const [tab, setTab] = useState<PrizeTab>('inventory');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [status, setStatus] = useState('');
  const [mechanic, setMechanic] = useState('');
  const [editing, setEditing] = useState<AdminPrize | 'new' | null>(null);
  const [deleting, setDeleting] = useState<AdminPrize | null>(null);
  const [fulfilling, setFulfilling] = useState<PrizeAward | null>(null);
  const limit = 25;

  const prizes = useQuery({
    queryKey: [
      'admin-prizes',
      page,
      limit,
      search,
      campaignId,
      status,
      mechanic,
    ],
    queryFn: () =>
      api.get<DataPage<AdminPrize>>('/admin/prizes', {
        query: { page, limit, search, campaignId, status, mechanic },
      }),
    enabled: tab === 'inventory' && can('operator', 'admin'),
  });
  const awards = useQuery({
    queryKey: ['admin-prize-awards', page, limit, search, campaignId, status],
    queryFn: () =>
      api.get<DataPage<PrizeAward>>('/admin/prizes/awards', {
        query: { page, limit, search, campaignId, status },
      }),
    enabled: tab === 'awards' && can('operator', 'admin'),
  });
  const save = useMutation({
    mutationFn: (input: { id?: string; body: PrizeInput }) =>
      input.id
        ? api.patch<AdminPrize>(`/admin/prizes/${input.id}`, input.body)
        : api.post<AdminPrize>('/admin/prizes', input.body),
    onSuccess: async (_, input) => {
      await queryClient.invalidateQueries({ queryKey: ['admin-prizes'] });
      setEditing(null);
      showToast({
        tone: 'success',
        title: input.id ? 'Premio actualizado' : 'Premio creado',
      });
    },
    onError: (error) =>
      showToast({
        tone: 'error',
        title: 'No se pudo guardar',
        message: errorMessage(error),
      }),
  });
  const remove = useMutation({
    mutationFn: (id: string) =>
      api.delete<{ deleted: boolean }>(`/admin/prizes/${id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-prizes'] });
      setDeleting(null);
      showToast({ tone: 'success', title: 'Premio eliminado' });
    },
    onError: (error) =>
      showToast({
        tone: 'error',
        title: 'No se pudo eliminar',
        message: errorMessage(error),
      }),
  });
  const fulfill = useMutation({
    mutationFn: (publicId: string) =>
      api.post<PrizeAward>(`/admin/prizes/awards/${publicId}/fulfill`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-prize-awards'] });
      setFulfilling(null);
      showToast({ tone: 'success', title: 'Premio marcado como entregado' });
    },
    onError: (error) =>
      showToast({
        tone: 'error',
        title: 'No se pudo completar',
        message: errorMessage(error),
      }),
  });

  const activeQuery = tab === 'inventory' ? prizes : awards;
  const setFilter = (setter: (value: string) => void, value: string) => {
    setter(value);
    setPage(1);
  };

  if (!can('operator', 'admin'))
    return (
      <main className="page">
        <ResourcePageHeader
          title="Premios instantáneos"
          description="Inventario y entregas."
        />
        <AccessDenied message="Necesitas un rol de operador o administrador." />
      </main>
    );

  return (
    <main className="page">
      <ResourcePageHeader
        title="Premios instantáneos"
        description="Configura el inventario y gestiona la cola de premios adjudicados."
        actions={
          tab === 'inventory' ? (
            <button
              className="button button--primary"
              type="button"
              onClick={() => setEditing('new')}
            >
              <Plus aria-hidden="true" size={18} /> Nuevo premio
            </button>
          ) : null
        }
      />
      <div className="tabs" role="tablist" aria-label="Premios">
        <button
          role="tab"
          aria-selected={tab === 'inventory'}
          className={tab === 'inventory' ? 'is-active' : ''}
          type="button"
          onClick={() => {
            setTab('inventory');
            setPage(1);
            setStatus('');
          }}
        >
          Inventario
        </button>
        <button
          role="tab"
          aria-selected={tab === 'awards'}
          className={tab === 'awards' ? 'is-active' : ''}
          type="button"
          onClick={() => {
            setTab('awards');
            setPage(1);
            setStatus('');
          }}
        >
          Adjudicaciones
        </button>
      </div>
      <section className="panel" role="tabpanel">
        <div className="filters">
          <label>
            <span>Buscar</span>
            <input
              type="search"
              maxLength={120}
              value={search}
              onChange={(event) => setFilter(setSearch, event.target.value)}
              placeholder={
                tab === 'inventory'
                  ? 'Título o número'
                  : 'Ganador o identificador'
              }
            />
          </label>
          <label>
            <span>ID de campaña</span>
            <input
              value={campaignId}
              onChange={(event) =>
                setFilter(setCampaignId, event.target.value.trim())
              }
            />
          </label>
          {tab === 'inventory' ? (
            <label>
              <span>Mecánica</span>
              <select
                value={mechanic}
                onChange={(event) => setFilter(setMechanic, event.target.value)}
              >
                <option value="">Todas</option>
                <option value="winning_title">Título ganador</option>
                <option value="roulette">Ruleta</option>
                <option value="scratch">Raspadita</option>
              </select>
            </label>
          ) : null}
          <label>
            <span>Estado</span>
            <select
              value={status}
              onChange={(event) => setFilter(setStatus, event.target.value)}
            >
              <option value="">Todos</option>
              {(tab === 'inventory'
                ? [
                    'active',
                    'exhausted',
                    'awarded',
                    'claimed',
                    'fulfilled',
                    'cancelled',
                  ]
                : ['awarded', 'claimed', 'fulfilled', 'reversed']
              ).map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
        </div>
        {activeQuery.isLoading ? <LoadingPanel /> : null}
        {activeQuery.isError ? (
          <ErrorPanel
            error={activeQuery.error}
            onRetry={() => activeQuery.refetch()}
          />
        ) : null}
        {activeQuery.isSuccess && !activeQuery.data?.data.length ? (
          <EmptyPanel
            title="No hay resultados"
            description="No se encontraron premios con estos filtros."
          />
        ) : null}
        {tab === 'inventory' && prizes.data?.data.length ? (
          <PrizeInventoryTable
            items={prizes.data.data}
            onEdit={setEditing}
            onDelete={setDeleting}
          />
        ) : null}
        {tab === 'awards' && awards.data?.data.length ? (
          <AwardsTable items={awards.data.data} onFulfill={setFulfilling} />
        ) : null}
        {activeQuery.data ? (
          <Pagination
            page={activeQuery.data.meta.page}
            limit={activeQuery.data.meta.limit}
            total={activeQuery.data.meta.total}
            pages={activeQuery.data.meta.pages}
            onPageChange={setPage}
          />
        ) : null}
      </section>
      {editing ? (
        <PrizeEditor
          item={editing}
          busy={save.isPending}
          onClose={() => setEditing(null)}
          onSave={(body) =>
            save.mutate({
              id: editing === 'new' ? undefined : prizeId(editing),
              body,
            })
          }
        />
      ) : null}
      {deleting ? (
        <ConfirmDialog
          title="Eliminar definición de premio"
          description={`Se intentará eliminar “${deleting.title}”. El backend rechazará la operación si ya tiene adjudicaciones.`}
          confirmLabel="Eliminar premio"
          busy={remove.isPending}
          onClose={() => setDeleting(null)}
          onConfirm={() => remove.mutate(prizeId(deleting))}
        />
      ) : null}
      {fulfilling ? (
        <ConfirmDialog
          title="Confirmar entrega"
          description={`Confirma que “${fulfilling.title}” fue entregado a ${fulfilling.winnerSnapshot.name}. Esta acción cambia el estado operativo del premio.`}
          confirmLabel="Marcar como entregado"
          danger={false}
          busy={fulfill.isPending}
          onClose={() => setFulfilling(null)}
          onConfirm={() => fulfill.mutate(fulfilling.publicId)}
        />
      ) : null}
    </main>
  );
}

function PrizeInventoryTable({
  items,
  onEdit,
  onDelete,
}: {
  items: AdminPrize[];
  onEdit: (item: AdminPrize) => void;
  onDelete: (item: AdminPrize) => void;
}) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Premio</th>
            <th>Campaña</th>
            <th>Mecánica</th>
            <th>Inventario</th>
            <th>Valor</th>
            <th>Estado</th>
            <th className="table-actions">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={prizeId(item)}>
              <td>
                <strong>{item.title}</strong>
                <small className="table-note">
                  {item.quotaNumber || item.description || '—'}
                </small>
              </td>
              <td>{campaignLabel(item.campaign)}</td>
              <td>{mechanicLabel(item.mechanic)}</td>
              <td>
                {item.remainingStock ?? item.stock} / {item.stock}
              </td>
              <td>
                {item.cashValue !== undefined
                  ? formatMoney(item.cashValue)
                  : '—'}
              </td>
              <td>
                <StatusBadge status={item.status} />
              </td>
              <td className="table-actions">
                <button
                  className="icon-button"
                  type="button"
                  aria-label={`Editar ${item.title}`}
                  onClick={() => onEdit(item)}
                >
                  <Edit3 aria-hidden="true" size={18} />
                </button>
                <button
                  className="icon-button icon-button--danger"
                  type="button"
                  aria-label={`Eliminar ${item.title}`}
                  onClick={() => onDelete(item)}
                >
                  <Trash2 aria-hidden="true" size={18} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AwardsTable({
  items,
  onFulfill,
}: {
  items: PrizeAward[];
  onFulfill: (item: PrizeAward) => void;
}) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Adjudicación</th>
            <th>Ganador</th>
            <th>Premio</th>
            <th>Campaña</th>
            <th>Estado</th>
            <th>Fecha</th>
            <th className="table-actions">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.publicId}>
              <td>
                <strong>{item.publicId}</strong>
                <small className="table-note">
                  {mechanicLabel(item.mechanic)}
                </small>
              </td>
              <td>
                {item.winnerSnapshot.name}
                <small className="table-note">
                  {item.winnerSnapshot.phone}
                </small>
              </td>
              <td>
                {item.title}
                {item.cashValue !== undefined ? (
                  <small className="table-note">
                    {formatMoney(item.cashValue)}
                  </small>
                ) : null}
              </td>
              <td>{campaignLabel(item.campaign)}</td>
              <td>
                <StatusBadge status={item.status} />
              </td>
              <td>{formatDateTime(item.awardedAt)}</td>
              <td className="table-actions">
                {item.status === 'claimed' ? (
                  <button
                    className="button button--primary"
                    type="button"
                    onClick={() => onFulfill(item)}
                  >
                    <CheckCircle2 aria-hidden="true" size={16} /> Entregar
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PrizeEditor({
  item,
  busy,
  onSave,
  onClose,
}: {
  item: AdminPrize | 'new';
  busy: boolean;
  onSave: (body: PrizeInput) => void;
  onClose: () => void;
}) {
  const existing = item === 'new' ? null : item;
  return (
    <Modal
      title={existing ? 'Editar premio' : 'Nuevo premio'}
      description="El título ganador requiere un número; ruleta y raspadita usan stock y peso."
      onClose={onClose}
      wide
    >
      <form
        onSubmit={(event) =>
          submitForm(event, (form) =>
            onSave({
              campaignId: String(form.get('campaignId') ?? '').trim(),
              title: String(form.get('title') ?? '').trim(),
              description: optionalString(form, 'description'),
              mechanic: String(form.get('mechanic')) as Mechanic,
              quotaNumber: optionalString(form, 'quotaNumber'),
              cashValue: optionalNumber(form, 'cashValue'),
              alternativeTitle: optionalString(form, 'alternativeTitle'),
              imageUrl: optionalString(form, 'imageUrl'),
              mediaId: optionalString(form, 'mediaId'),
              stock: optionalNumber(form, 'stock'),
              weight: optionalNumber(form, 'weight'),
              sortOrder: numberValue(form, 'sortOrder'),
            }),
          )
        }
      >
        <div className="form-grid">
          <Field label="ID de campaña" htmlFor="prize-campaign" required>
            <input
              id="prize-campaign"
              name="campaignId"
              required
              pattern="[a-fA-F0-9]{24}"
              defaultValue={
                typeof existing?.campaign === 'string'
                  ? existing.campaign
                  : existing?.campaign.id || existing?.campaign._id
              }
              autoFocus
            />
          </Field>
          <Field label="Mecánica" htmlFor="prize-mechanic" required>
            <select
              id="prize-mechanic"
              name="mechanic"
              required
              defaultValue={existing?.mechanic ?? 'winning_title'}
            >
              <option value="winning_title">Título ganador</option>
              <option value="roulette">Ruleta</option>
              <option value="scratch">Raspadita</option>
            </select>
          </Field>
          <Field label="Título" htmlFor="prize-title" required>
            <input
              id="prize-title"
              name="title"
              required
              maxLength={180}
              defaultValue={existing?.title}
            />
          </Field>
          <Field label="Número ganador" htmlFor="prize-quota">
            <input
              id="prize-quota"
              name="quotaNumber"
              maxLength={20}
              defaultValue={existing?.quotaNumber}
            />
          </Field>
          <div className="form-grid__full">
            <Field label="Descripción" htmlFor="prize-description">
              <textarea
                id="prize-description"
                name="description"
                rows={3}
                maxLength={500}
                defaultValue={existing?.description}
              />
            </Field>
          </div>
          <Field label="Stock" htmlFor="prize-stock">
            <input
              id="prize-stock"
              name="stock"
              type="number"
              min={1}
              defaultValue={existing?.stock ?? 1}
            />
          </Field>
          <Field label="Peso" htmlFor="prize-weight">
            <input
              id="prize-weight"
              name="weight"
              type="number"
              min={0}
              step="any"
              defaultValue={existing?.weight}
            />
          </Field>
          <Field label="Valor en efectivo" htmlFor="prize-cash">
            <input
              id="prize-cash"
              name="cashValue"
              type="number"
              min={0}
              step="0.01"
              defaultValue={existing?.cashValue}
            />
          </Field>
          <Field label="Alternativa" htmlFor="prize-alternative">
            <input
              id="prize-alternative"
              name="alternativeTitle"
              maxLength={180}
              defaultValue={existing?.alternativeTitle}
            />
          </Field>
          <Field label="URL de imagen" htmlFor="prize-image">
            <input
              id="prize-image"
              name="imageUrl"
              type="url"
              defaultValue={existing?.imageUrl}
            />
          </Field>
          <Field label="ID de medio" htmlFor="prize-media">
            <input
              id="prize-media"
              name="mediaId"
              pattern="[a-fA-F0-9]{24}"
              defaultValue={existing?.mediaId}
            />
          </Field>
          <Field label="Orden" htmlFor="prize-order">
            <input
              id="prize-order"
              name="sortOrder"
              type="number"
              defaultValue={existing?.sortOrder ?? 0}
            />
          </Field>
        </div>
        <div className="modal__actions">
          <button
            className="button button--secondary"
            type="button"
            onClick={onClose}
          >
            Cancelar
          </button>
          <button
            className="button button--primary"
            type="submit"
            disabled={busy}
          >
            <Trophy aria-hidden="true" size={17} />{' '}
            {busy ? 'Guardando…' : 'Guardar premio'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function prizeId(item: AdminPrize) {
  return item.id ?? item._id ?? '';
}
function campaignLabel(value: CampaignSummary | string) {
  return typeof value === 'string'
    ? value
    : value.name || value.id || value._id || '—';
}
function mechanicLabel(value: string) {
  return (
    (
      {
        winning_title: 'Título ganador',
        roulette: 'Ruleta',
        scratch: 'Raspadita',
      } as Record<string, string>
    )[value] ?? value
  );
}
function optionalNumber(form: FormData, key: string) {
  const raw = String(form.get(key) ?? '').trim();
  return raw ? Number(raw) : undefined;
}

export default PrizesPage;
