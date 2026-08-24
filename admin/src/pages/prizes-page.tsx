import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  Edit3,
  Eye,
  Gift,
  Plus,
  Trash2,
  Trophy,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatDateTime, formatMoney } from '@/lib/format';
import { useToast } from '@/lib/toast-context';
import type {
  CampaignSummary,
  DataPage,
  MainAward,
  PrizeAward,
} from '@/lib/types';
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

type PrizeTab = 'inventory' | 'awards' | 'main';
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

interface AdminMainAward extends MainAward {
  notificationAttempts?: number;
  notificationCompletedAt?: string;
  createdAt?: string;
  updatedAt?: string;
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
  const [mainDetail, setMainDetail] = useState<AdminMainAward | null>(null);
  const [fulfillingMain, setFulfillingMain] = useState<AdminMainAward | null>(
    null,
  );
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
  const mainAwards = useQuery({
    queryKey: ['admin-main-awards', page, limit, campaignId, status],
    queryFn: () =>
      api.get<DataPage<AdminMainAward>>('/admin/main-awards', {
        query: { page, limit, campaignId, status },
      }),
    enabled: tab === 'main' && can('admin'),
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
  const fulfillMain = useMutation({
    mutationFn: (input: {
      publicId: string;
      reference: string;
      notes?: string;
    }) =>
      api.post<AdminMainAward>(
        `/admin/main-awards/${encodeURIComponent(input.publicId)}/fulfill`,
        { reference: input.reference, notes: input.notes },
      ),
    onSuccess: async (updated) => {
      await queryClient.invalidateQueries({
        queryKey: ['admin-main-awards'],
      });
      setMainDetail((current) =>
        current?.publicId === updated.publicId ? updated : current,
      );
      setFulfillingMain(null);
      showToast({
        tone: 'success',
        title: 'Entrega principal registrada',
        message: `Comprobante: ${updated.fulfillmentReference ?? 'registrado'}`,
      });
    },
    onError: (error) =>
      showToast({
        tone: 'error',
        title: 'No se pudo registrar la entrega',
        message: errorMessage(error),
      }),
  });

  const activeQuery =
    tab === 'inventory' ? prizes : tab === 'awards' ? awards : mainAwards;
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
        title="Premios y entregas"
        description="Configura premios instantáneos y controla la entrega trazable del premio principal."
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
        {can('admin') ? (
          <button
            role="tab"
            aria-selected={tab === 'main'}
            className={tab === 'main' ? 'is-active' : ''}
            type="button"
            onClick={() => {
              setTab('main');
              setPage(1);
              setStatus('');
              setSearch('');
            }}
          >
            Premio principal
          </button>
        ) : null}
      </div>
      <section className="panel" role="tabpanel">
        <div className="filters">
          {tab !== 'main' ? (
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
          ) : null}
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
                : tab === 'awards'
                  ? ['awarded', 'claimed', 'fulfilled', 'reversed']
                  : ['pending', 'claimed', 'fulfilled']
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
        {tab === 'main' && mainAwards.data?.data.length ? (
          <MainAwardsTable
            items={mainAwards.data.data}
            onDetail={setMainDetail}
            onFulfill={setFulfillingMain}
          />
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
      {mainDetail ? (
        <MainAwardDetail
          item={mainDetail}
          onClose={() => setMainDetail(null)}
          onFulfill={() => {
            setFulfillingMain(mainDetail);
            setMainDetail(null);
          }}
        />
      ) : null}
      {fulfillingMain ? (
        <MainAwardFulfillment
          item={fulfillingMain}
          busy={fulfillMain.isPending}
          onClose={() => !fulfillMain.isPending && setFulfillingMain(null)}
          onSave={(reference, notes) =>
            fulfillMain.mutate({
              publicId: fulfillingMain.publicId,
              reference,
              notes,
            })
          }
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

function MainAwardsTable({
  items,
  onDetail,
  onFulfill,
}: {
  items: AdminMainAward[];
  onDetail: (item: AdminMainAward) => void;
  onFulfill: (item: AdminMainAward) => void;
}) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Premio</th>
            <th>Ganador</th>
            <th>Campaña</th>
            <th>Elección</th>
            <th>Estado</th>
            <th>Fecha</th>
            <th className="table-actions">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.publicId}>
              <td>
                <strong>{item.prizeTitle}</strong>
                <small className="table-note">
                  Título {item.winningNumber} · pedido {item.orderPublicId}
                </small>
              </td>
              <td>
                {item.winnerSnapshot.name}
                <small className="table-note">
                  {item.winnerSnapshot.phone}
                </small>
              </td>
              <td>{campaignLabel(item.campaign)}</td>
              <td>
                {item.choice === 'cash'
                  ? `Efectivo · ${formatMoney(item.cashAlternative ?? 0, item.currency)}`
                  : item.choice === 'physical'
                    ? 'Premio físico'
                    : 'Sin reclamar'}
              </td>
              <td>
                <StatusBadge status={item.status} />
              </td>
              <td>{formatDateTime(item.awardedAt)}</td>
              <td className="table-actions">
                <button
                  className="icon-button"
                  type="button"
                  aria-label={`Ver premio de ${item.winnerSnapshot.name}`}
                  onClick={() => onDetail(item)}
                >
                  <Eye aria-hidden="true" size={18} />
                </button>
                {item.status === 'claimed' ? (
                  <button
                    className="button button--primary button--compact"
                    type="button"
                    onClick={() => onFulfill(item)}
                  >
                    <Gift aria-hidden="true" size={16} /> Registrar entrega
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

function MainAwardDetail({
  item,
  onClose,
  onFulfill,
}: {
  item: AdminMainAward;
  onClose: () => void;
  onFulfill: () => void;
}) {
  return (
    <Modal
      title="Trazabilidad del premio principal"
      description={`${item.publicId} · título ganador ${item.winningNumber}`}
      onClose={onClose}
      wide
    >
      <div className="detail-layout">
        <section>
          <h3>Ganador y elección</h3>
          <dl className="detail-list">
            <div>
              <dt>Nombre</dt>
              <dd>{item.winnerSnapshot.name}</dd>
            </div>
            <div>
              <dt>Teléfono</dt>
              <dd>{item.winnerSnapshot.phone}</dd>
            </div>
            <div>
              <dt>Correo</dt>
              <dd>{item.winnerSnapshot.email}</dd>
            </div>
            <div>
              <dt>Pedido</dt>
              <dd>{item.orderPublicId}</dd>
            </div>
            <div>
              <dt>Elección</dt>
              <dd>
                {item.choice === 'cash'
                  ? 'Alternativa en efectivo'
                  : item.choice === 'physical'
                    ? 'Premio físico'
                    : 'Pendiente'}
              </dd>
            </div>
          </dl>
        </section>
        <section>
          <h3>Entrega y notificación</h3>
          <dl className="detail-list">
            <div>
              <dt>Estado</dt>
              <dd>
                <StatusBadge status={item.status} />
              </dd>
            </div>
            <div>
              <dt>Adjudicado</dt>
              <dd>{formatDateTime(item.awardedAt)}</dd>
            </div>
            <div>
              <dt>Reclamado</dt>
              <dd>{formatDateTime(item.claimedAt)}</dd>
            </div>
            <div>
              <dt>Entregado</dt>
              <dd>{formatDateTime(item.fulfilledAt)}</dd>
            </div>
            <div>
              <dt>Comprobante</dt>
              <dd>{item.fulfillmentReference || '—'}</dd>
            </div>
            <div>
              <dt>Intentos de aviso</dt>
              <dd>{item.notificationAttempts ?? 0}</dd>
            </div>
          </dl>
        </section>
      </div>
      {item.fulfillmentNotes ? (
        <div className="message-preview">
          <h3>Notas de entrega</h3>
          <p>{item.fulfillmentNotes}</p>
        </div>
      ) : null}
      {item.lastNotificationError ? (
        <div className="inline-alert inline-alert--danger" role="alert">
          {item.lastNotificationError}
        </div>
      ) : null}
      <div className="modal__actions">
        <button
          className="button button--secondary"
          type="button"
          onClick={onClose}
        >
          Cerrar
        </button>
        {item.status === 'claimed' ? (
          <button
            className="button button--primary"
            type="button"
            onClick={onFulfill}
          >
            <Gift aria-hidden="true" size={17} /> Registrar entrega
          </button>
        ) : null}
      </div>
    </Modal>
  );
}

function MainAwardFulfillment({
  item,
  busy,
  onClose,
  onSave,
}: {
  item: AdminMainAward;
  busy: boolean;
  onClose: () => void;
  onSave: (reference: string, notes?: string) => void;
}) {
  return (
    <Modal
      title="Registrar entrega del premio principal"
      description={`${item.winnerSnapshot.name} · ${item.prizeTitle}`}
      onClose={onClose}
    >
      <div className="inline-alert inline-alert--warning">
        <strong>Registro irreversible</strong>
        <p>
          {item.choice === 'cash'
            ? 'Marcar como entregado no ejecuta la transferencia. Confirma primero el pago externo.'
            : 'Confirma primero el acta, tracking o comprobante de entrega física.'}
        </p>
      </div>
      <form
        onSubmit={(event) =>
          submitForm(event, (form) =>
            onSave(
              String(form.get('reference') ?? '').trim(),
              optionalString(form, 'notes'),
            ),
          )
        }
      >
        <Field
          label="Comprobante o referencia"
          htmlFor="main-award-reference"
          hint="Transferencia, tracking o acta; obligatorio en este panel."
          required
        >
          <input
            id="main-award-reference"
            name="reference"
            required
            minLength={4}
            maxLength={160}
            autoFocus
          />
        </Field>
        <Field label="Notas verificables" htmlFor="main-award-notes">
          <textarea
            id="main-award-notes"
            name="notes"
            rows={4}
            maxLength={1000}
          />
        </Field>
        <div className="modal__actions">
          <button
            className="button button--secondary"
            type="button"
            onClick={onClose}
            disabled={busy}
          >
            Cancelar
          </button>
          <button
            className="button button--danger"
            type="submit"
            disabled={busy}
          >
            {busy ? 'Registrando…' : 'Confirmar entrega'}
          </button>
        </div>
      </form>
    </Modal>
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
