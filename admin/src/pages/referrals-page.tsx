import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Edit3, MousePointerClick, Plus, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import {
  formatDateTime,
  formatMoney,
  fromDateTimeLocal,
  toDateTimeLocal,
} from '@/lib/format';
import { useToast } from '@/lib/toast-context';
import {
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

type ReferralTab = 'codes' | 'clicks' | 'commissions';
type CodeStatus = 'active' | 'paused' | 'disabled';
type CommissionStatus =
  'pending' | 'approved' | 'paid' | 'rejected' | 'reversed';

const COMMISSION_STATUS_LABELS: Record<CommissionStatus, string> = {
  pending: 'Pendiente',
  approved: 'Aprobada',
  paid: 'Pagada',
  rejected: 'Rechazada',
  reversed: 'Revertida',
};

const COMMISSION_STATUS_TRANSITIONS: Record<
  CommissionStatus,
  readonly CommissionStatus[]
> = {
  pending: ['approved', 'rejected', 'reversed'],
  approved: ['paid', 'rejected', 'reversed'],
  paid: ['reversed'],
  rejected: [],
  reversed: [],
};

interface ReferralPage<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}
interface CodeItem {
  id: string;
  code: string;
  beneficiaryUserId?: string;
  label?: string;
  status: CodeStatus;
  commissionRateBps: number;
  currency: string;
  campaignId?: string;
  validFrom?: string;
  validUntil?: string;
  maxConversions?: number;
  clicksCount: number;
  conversionsCount: number;
  createdAt: string;
  updatedAt: string;
}
interface ClickItem {
  id: string;
  code: string;
  eventId: string;
  campaignId?: string;
  landingPath?: string;
  referrer?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  attributedOrderId?: string;
  convertedAt?: string;
  createdAt: string;
}
interface CommissionItem {
  id: string;
  code: string;
  orderId: string;
  beneficiaryUserId?: string;
  buyerUserId?: string;
  orderAmount: number;
  commissionBase: number;
  commissionRateBps: number;
  commissionAmount: number;
  currency: string;
  status: CommissionStatus;
  statusChangedAt: string;
  statusReason?: string;
  createdAt: string;
}
interface CodeInput {
  code?: string;
  beneficiaryUserId?: string;
  label?: string;
  commissionRateBps?: number;
  currency?: string;
  campaignId?: string;
  validFrom?: string;
  validUntil?: string;
  maxConversions?: number;
  status?: CodeStatus;
}

export function ReferralsPage() {
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const { showToast } = useToast();
  const [tab, setTab] = useState<ReferralTab>('codes');
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [codeFilter, setCodeFilter] = useState('');
  const [campaignFilter, setCampaignFilter] = useState('');
  const [orderFilter, setOrderFilter] = useState('');
  const [editingCode, setEditingCode] = useState<CodeItem | 'new' | null>(null);
  const [codeTransition, setCodeTransition] = useState<{
    item: CodeItem;
    status: CodeStatus;
  } | null>(null);
  const [commission, setCommission] = useState<CommissionItem | null>(null);
  const limit = 25;

  const codes = useQuery({
    queryKey: ['referral-codes', page, limit, status, campaignFilter],
    queryFn: () =>
      api.get<ReferralPage<CodeItem>>('/admin/referrals/codes', {
        query: { page, limit, status, campaignId: campaignFilter },
      }),
    enabled: tab === 'codes',
  });
  const clicks = useQuery({
    queryKey: ['referral-clicks', page, limit, codeFilter, campaignFilter],
    queryFn: () =>
      api.get<ReferralPage<ClickItem>>('/admin/referrals/clicks', {
        query: { page, limit, code: codeFilter, utmCampaign: campaignFilter },
      }),
    enabled: tab === 'clicks',
  });
  const commissions = useQuery({
    queryKey: ['referral-commissions', page, limit, status, orderFilter],
    queryFn: () =>
      api.get<ReferralPage<CommissionItem>>('/admin/referrals/commissions', {
        query: { page, limit, status, orderId: orderFilter },
      }),
    enabled: tab === 'commissions',
  });

  const saveCode = useMutation({
    mutationFn: (input: { id?: string; body: CodeInput }) =>
      input.id
        ? api.patch<CodeItem>(`/admin/referrals/codes/${input.id}`, input.body)
        : api.post<CodeItem>('/admin/referrals/codes', input.body),
    onSuccess: async (_, input) => {
      await queryClient.invalidateQueries({ queryKey: ['referral-codes'] });
      setEditingCode(null);
      setCodeTransition(null);
      showToast({
        tone: 'success',
        title: input.id ? 'Código actualizado' : 'Código creado',
      });
    },
    onError: (error) =>
      showToast({
        tone: 'error',
        title: 'No se pudo guardar',
        message: errorMessage(error),
      }),
  });
  const updateCommission = useMutation({
    mutationFn: (input: {
      id: string;
      status: CommissionStatus;
      reason?: string;
    }) =>
      api.patch<CommissionItem>(
        `/admin/referrals/commissions/${input.id}/status`,
        { status: input.status, reason: input.reason },
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['referral-commissions'],
      });
      setCommission(null);
      showToast({ tone: 'success', title: 'Estado financiero actualizado' });
    },
    onError: (error) =>
      showToast({
        tone: 'error',
        title: 'No se pudo actualizar',
        message: errorMessage(error),
      }),
  });

  const switchTab = (next: ReferralTab) => {
    setTab(next);
    setPage(1);
    setStatus('');
    setCodeFilter('');
    setCampaignFilter('');
    setOrderFilter('');
  };
  const activeQuery =
    tab === 'codes' ? codes : tab === 'clicks' ? clicks : commissions;
  const activePage = activeQuery.data as ReferralPage<unknown> | undefined;

  return (
    <main className="page">
      <ResourcePageHeader
        title="Referidos"
        description="Administra códigos, atribución de clics y el ciclo financiero de las comisiones."
        actions={
          can('admin') && tab === 'codes' ? (
            <button
              className="button button--primary"
              type="button"
              onClick={() => setEditingCode('new')}
            >
              <Plus aria-hidden="true" size={18} /> Nuevo código
            </button>
          ) : null
        }
      />

      <div className="tabs" role="tablist" aria-label="Módulos de referidos">
        <button
          role="tab"
          aria-selected={tab === 'codes'}
          className={tab === 'codes' ? 'is-active' : ''}
          type="button"
          onClick={() => switchTab('codes')}
        >
          Códigos
        </button>
        <button
          role="tab"
          aria-selected={tab === 'clicks'}
          className={tab === 'clicks' ? 'is-active' : ''}
          type="button"
          onClick={() => switchTab('clicks')}
        >
          Clics
        </button>
        <button
          role="tab"
          aria-selected={tab === 'commissions'}
          className={tab === 'commissions' ? 'is-active' : ''}
          type="button"
          onClick={() => switchTab('commissions')}
        >
          Comisiones
        </button>
      </div>

      <section className="panel" role="tabpanel">
        <ReferralFilters
          tab={tab}
          status={status}
          code={codeFilter}
          campaign={campaignFilter}
          order={orderFilter}
          onStatus={(value) => {
            setStatus(value);
            setPage(1);
          }}
          onCode={(value) => {
            setCodeFilter(value);
            setPage(1);
          }}
          onCampaign={(value) => {
            setCampaignFilter(value);
            setPage(1);
          }}
          onOrder={(value) => {
            setOrderFilter(value);
            setPage(1);
          }}
        />
        {activeQuery.isLoading ? <LoadingPanel /> : null}
        {activeQuery.isError ? (
          <ErrorPanel
            error={activeQuery.error}
            onRetry={() => activeQuery.refetch()}
          />
        ) : null}
        {activeQuery.isSuccess && !activePage?.items.length ? (
          <EmptyPanel
            title="No hay resultados"
            description="No existen registros para los filtros seleccionados."
          />
        ) : null}
        {tab === 'codes' && codes.data?.items.length ? (
          <CodesTable
            items={codes.data.items}
            admin={can('admin')}
            onEdit={setEditingCode}
            onStatus={(item, target) =>
              setCodeTransition({ item, status: target })
            }
          />
        ) : null}
        {tab === 'clicks' && clicks.data?.items.length ? (
          <ClicksTable items={clicks.data.items} />
        ) : null}
        {tab === 'commissions' && commissions.data?.items.length ? (
          <CommissionsTable
            items={commissions.data.items}
            admin={can('admin')}
            onChange={setCommission}
          />
        ) : null}
        {activePage ? (
          <Pagination
            page={activePage.page}
            limit={activePage.limit}
            total={activePage.total}
            onPageChange={setPage}
          />
        ) : null}
      </section>

      {editingCode ? (
        <CodeEditor
          item={editingCode}
          busy={saveCode.isPending}
          onClose={() => setEditingCode(null)}
          onSave={(body) =>
            saveCode.mutate({
              id: editingCode === 'new' ? undefined : editingCode.id,
              body,
            })
          }
        />
      ) : null}
      {codeTransition ? (
        <ConfirmDialog
          title="Cambiar estado del código"
          description={`${codeTransition.item.code} pasará de ${codeStatusLabel(codeTransition.item.status)} a ${codeStatusLabel(codeTransition.status)}.`}
          confirmLabel="Confirmar cambio"
          danger={codeTransition.status === 'disabled'}
          busy={saveCode.isPending}
          onClose={() => setCodeTransition(null)}
          onConfirm={() =>
            saveCode.mutate({
              id: codeTransition.item.id,
              body: { status: codeTransition.status },
            })
          }
        />
      ) : null}
      {commission ? (
        <CommissionEditor
          item={commission}
          busy={updateCommission.isPending}
          onClose={() => setCommission(null)}
          onSave={(statusValue, reason) =>
            updateCommission.mutate({
              id: commission.id,
              status: statusValue,
              reason,
            })
          }
        />
      ) : null}
    </main>
  );
}

function ReferralFilters({
  tab,
  status,
  code,
  campaign,
  order,
  onStatus,
  onCode,
  onCampaign,
  onOrder,
}: {
  tab: ReferralTab;
  status: string;
  code: string;
  campaign: string;
  order: string;
  onStatus: (v: string) => void;
  onCode: (v: string) => void;
  onCampaign: (v: string) => void;
  onOrder: (v: string) => void;
}) {
  return (
    <div className="filters">
      {tab !== 'clicks' ? (
        <label>
          <span>Estado</span>
          <select value={status} onChange={(e) => onStatus(e.target.value)}>
            <option value="">Todos</option>
            {(tab === 'codes'
              ? ['active', 'paused', 'disabled']
              : ['pending', 'approved', 'paid', 'rejected', 'reversed']
            ).map((value) => (
              <option key={value} value={value}>
                {tab === 'codes' ? codeStatusLabel(value) : value}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {tab === 'clicks' ? (
        <label>
          <span>Código</span>
          <input
            value={code}
            maxLength={32}
            onChange={(e) => onCode(e.target.value)}
          />
        </label>
      ) : null}
      {tab !== 'commissions' ? (
        <label>
          <span>{tab === 'codes' ? 'ID de campaña' : 'Campaña UTM'}</span>
          <input
            value={campaign}
            onChange={(e) => onCampaign(e.target.value)}
          />
        </label>
      ) : null}
      {tab === 'commissions' ? (
        <label>
          <span>ID de orden</span>
          <input
            value={order}
            maxLength={120}
            onChange={(e) => onOrder(e.target.value)}
          />
        </label>
      ) : null}
    </div>
  );
}

function CodesTable({
  items,
  admin,
  onEdit,
  onStatus,
}: {
  items: CodeItem[];
  admin: boolean;
  onEdit: (item: CodeItem) => void;
  onStatus: (item: CodeItem, status: CodeStatus) => void;
}) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Código</th>
            <th>Comisión</th>
            <th>Uso</th>
            <th>Estado</th>
            <th>Vigencia</th>
            <th className="table-actions">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>
                <strong>{item.code}</strong>
                <small className="table-note">
                  {item.label || item.beneficiaryUserId || 'Sin beneficiario'}
                </small>
              </td>
              <td>{(item.commissionRateBps / 100).toFixed(2)}%</td>
              <td>
                {item.conversionsCount}
                {item.maxConversions ? ` / ${item.maxConversions}` : ''}
                <small className="table-note">{item.clicksCount} clics</small>
              </td>
              <td>
                <StatusBadge status={item.status} />
              </td>
              <td>{formatDateTime(item.validUntil)}</td>
              <td className="table-actions">
                {admin ? (
                  <>
                    <button
                      className="icon-button"
                      type="button"
                      aria-label={`Editar ${item.code}`}
                      onClick={() => onEdit(item)}
                    >
                      <Edit3 aria-hidden="true" size={18} />
                    </button>
                    <select
                      className="compact-select"
                      aria-label={`Estado de ${item.code}`}
                      value={item.status}
                      onChange={(e) =>
                        onStatus(item, e.target.value as CodeStatus)
                      }
                    >
                      <option value="active">Activo</option>
                      <option value="paused">Pausado</option>
                      <option value="disabled">Desactivado</option>
                    </select>
                  </>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ClicksTable({ items }: { items: ClickItem[] }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Código</th>
            <th>Origen</th>
            <th>Campaña UTM</th>
            <th>Conversión</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>{formatDateTime(item.createdAt)}</td>
              <td>
                <strong>{item.code}</strong>
                <small className="table-note">
                  <MousePointerClick aria-hidden="true" size={14} />{' '}
                  {item.eventId}
                </small>
              </td>
              <td>
                {item.utmSource || item.referrer || 'Directo'}
                <small className="table-note">
                  {item.utmMedium || item.landingPath || ''}
                </small>
              </td>
              <td>{item.utmCampaign || '—'}</td>
              <td>
                {item.attributedOrderId ||
                  (item.convertedAt ? 'Convertido' : 'No convertido')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CommissionsTable({
  items,
  admin,
  onChange,
}: {
  items: CommissionItem[];
  admin: boolean;
  onChange: (item: CommissionItem) => void;
}) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Orden</th>
            <th>Código</th>
            <th>Base</th>
            <th>Comisión</th>
            <th>Estado</th>
            <th>Cambio</th>
            <th className="table-actions">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>
                <strong>{item.orderId}</strong>
                <small className="table-note">
                  {formatDateTime(item.createdAt)}
                </small>
              </td>
              <td>{item.code}</td>
              <td>{formatMoney(item.commissionBase, item.currency)}</td>
              <td>
                <strong>
                  {formatMoney(item.commissionAmount, item.currency)}
                </strong>
                <small className="table-note">
                  {(item.commissionRateBps / 100).toFixed(2)}%
                </small>
              </td>
              <td>
                <StatusBadge status={item.status} />
                {item.statusReason ? (
                  <small className="table-note">{item.statusReason}</small>
                ) : null}
              </td>
              <td>{formatDateTime(item.statusChangedAt)}</td>
              <td className="table-actions">
                {admin ? (
                  <button
                    className="button button--ghost"
                    type="button"
                    onClick={() => onChange(item)}
                  >
                    <RefreshCw aria-hidden="true" size={16} /> Cambiar
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

function CodeEditor({
  item,
  busy,
  onSave,
  onClose,
}: {
  item: CodeItem | 'new';
  busy: boolean;
  onSave: (body: CodeInput) => void;
  onClose: () => void;
}) {
  const existing = item === 'new' ? null : item;
  return (
    <Modal
      title={existing ? `Editar ${existing.code}` : 'Nuevo código'}
      description="La comisión se expresa en puntos básicos: 500 equivale a 5%."
      onClose={onClose}
      wide
    >
      <form
        onSubmit={(event) =>
          submitForm(event, (form) =>
            onSave({
              code: optionalString(form, 'code'),
              beneficiaryUserId: optionalString(form, 'beneficiaryUserId'),
              label: optionalString(form, 'label'),
              commissionRateBps: numberValue(form, 'commissionRateBps'),
              currency: optionalString(form, 'currency'),
              campaignId: optionalString(form, 'campaignId'),
              validFrom: fromDateTimeLocal(optionalString(form, 'validFrom')),
              validUntil: fromDateTimeLocal(optionalString(form, 'validUntil')),
              maxConversions: optionalNumber(form, 'maxConversions'),
            }),
          )
        }
      >
        <div className="form-grid">
          <Field
            label="Código"
            htmlFor="ref-code"
            hint="Opcional al crear; el servidor puede generarlo."
          >
            <input
              id="ref-code"
              name="code"
              minLength={4}
              maxLength={32}
              pattern="[A-Za-z0-9_-]+"
              defaultValue={existing?.code}
              readOnly={Boolean(existing)}
              autoFocus
            />
          </Field>
          <Field label="Etiqueta" htmlFor="ref-label">
            <input
              id="ref-label"
              name="label"
              maxLength={120}
              defaultValue={existing?.label}
            />
          </Field>
          <Field
            label="Beneficiario"
            htmlFor="ref-beneficiary"
            hint="ObjectId del usuario que recibe la comisión."
          >
            <input
              id="ref-beneficiary"
              name="beneficiaryUserId"
              pattern="[a-fA-F0-9]{24}"
              defaultValue={existing?.beneficiaryUserId}
            />
          </Field>
          <Field label="ID de campaña" htmlFor="ref-campaign">
            <input
              id="ref-campaign"
              name="campaignId"
              pattern="[a-fA-F0-9]{24}"
              defaultValue={existing?.campaignId}
            />
          </Field>
          <Field label="Comisión (bps)" htmlFor="ref-rate" required>
            <input
              id="ref-rate"
              name="commissionRateBps"
              type="number"
              min={0}
              max={10000}
              required
              defaultValue={existing?.commissionRateBps ?? 0}
            />
          </Field>
          <Field label="Moneda" htmlFor="ref-currency">
            <input
              id="ref-currency"
              name="currency"
              pattern="[A-Za-z]{3}"
              maxLength={3}
              defaultValue={existing?.currency ?? 'BRL'}
            />
          </Field>
          <Field label="Válido desde" htmlFor="ref-from">
            <input
              id="ref-from"
              name="validFrom"
              type="datetime-local"
              defaultValue={toDateTimeLocal(existing?.validFrom)}
            />
          </Field>
          <Field label="Válido hasta" htmlFor="ref-until">
            <input
              id="ref-until"
              name="validUntil"
              type="datetime-local"
              defaultValue={toDateTimeLocal(existing?.validUntil)}
            />
          </Field>
          <Field label="Máximo de conversiones" htmlFor="ref-max">
            <input
              id="ref-max"
              name="maxConversions"
              type="number"
              min={1}
              defaultValue={existing?.maxConversions}
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
            {busy ? 'Guardando…' : 'Guardar código'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function CommissionEditor({
  item,
  busy,
  onSave,
  onClose,
}: {
  item: CommissionItem;
  busy: boolean;
  onSave: (status: CommissionStatus, reason?: string) => void;
  onClose: () => void;
}) {
  const availableStatuses = [
    item.status,
    ...COMMISSION_STATUS_TRANSITIONS[item.status],
  ];

  return (
    <Modal
      title="Cambiar estado de comisión"
      description={`${item.code} · ${formatMoney(item.commissionAmount, item.currency)} · orden ${item.orderId}`}
      onClose={onClose}
    >
      <form
        onSubmit={(event) =>
          submitForm(event, (form) =>
            onSave(
              String(form.get('status')) as CommissionStatus,
              optionalString(form, 'reason'),
            ),
          )
        }
      >
        <Field label="Nuevo estado" htmlFor="commission-status" required>
          <select
            id="commission-status"
            name="status"
            required
            defaultValue={item.status}
          >
            {availableStatuses.map((status) => (
              <option key={status} value={status}>
                {COMMISSION_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Motivo"
          htmlFor="commission-reason"
          hint="Recomendado para rechazo o reversión; máximo 500 caracteres."
        >
          <textarea
            id="commission-reason"
            name="reason"
            maxLength={500}
            rows={4}
            defaultValue={item.statusReason}
          />
        </Field>
        <div className="inline-alert">
          <strong>Operación financiera</strong>
          <p>
            El backend valida las transiciones y registra el cambio de forma
            transaccional.
          </p>
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
            {busy ? 'Actualizando…' : 'Confirmar estado'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function optionalNumber(form: FormData, key: string) {
  const value = String(form.get(key) ?? '').trim();
  return value ? Number(value) : undefined;
}
function codeStatusLabel(value: string) {
  return (
    (
      {
        active: 'Activo',
        paused: 'Pausado',
        disabled: 'Desactivado',
      } as Record<string, string>
    )[value] ?? value
  );
}

export default ReferralsPage;
