import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, Eye, Plus, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDateTime, fromDateTimeLocal } from '@/lib/format';
import { useToast } from '@/lib/toast-context';
import type { DataPage, Notification } from '@/lib/types';
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
  optionalString,
  submitForm,
} from './resource-page-shared';

const notificationTypes = [
  'general',
  'campaign',
  'order',
  'payment',
  'winner',
  'promotion',
  'system',
];
const deliveryStatuses = [
  'pending',
  'processing',
  'skipped',
  'sent',
  'partially_sent',
  'failed',
];

interface NotificationInput {
  userId: string;
  title: string;
  body: string;
  type?: string;
  eventKey?: string;
  data?: Record<string, unknown>;
  imageUrl?: string;
  actionUrl?: string;
  expiresAt?: string;
  deliverPush: boolean;
}

export function NotificationsPage() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [page, setPage] = useState(1);
  const [userId, setUserId] = useState('');
  const [type, setType] = useState('');
  const [deliveryStatus, setDeliveryStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState<Notification | null>(null);
  const [delivering, setDelivering] = useState<Notification | null>(null);
  const limit = 25;

  const notifications = useQuery({
    queryKey: [
      'admin-notifications',
      page,
      limit,
      userId,
      type,
      deliveryStatus,
    ],
    queryFn: () =>
      api.get<DataPage<Notification>>('/admin/notifications', {
        query: { page, limit, userId, type, deliveryStatus },
      }),
  });

  const create = useMutation({
    mutationFn: (body: NotificationInput) =>
      api.post<Notification>('/admin/notifications', body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['admin-notifications'],
      });
      setCreating(false);
      showToast({ tone: 'success', title: 'Notificación creada' });
    },
    onError: (error) =>
      showToast({
        tone: 'error',
        title: 'No se pudo crear',
        message: errorMessage(error),
      }),
  });

  const deliver = useMutation({
    mutationFn: (id: string) =>
      api.post<Notification>(`/admin/notifications/${id}/deliver`),
    onSuccess: async (notification) => {
      await queryClient.invalidateQueries({
        queryKey: ['admin-notifications'],
      });
      setDelivering(null);
      setDetail((current) =>
        current?.id === notification.id ? notification : current,
      );
      showToast({
        tone: 'success',
        title: 'Entrega procesada',
        message: `Estado: ${notification.deliveryStatus}`,
      });
    },
    onError: (error) =>
      showToast({
        tone: 'error',
        title: 'No se pudo entregar',
        message: errorMessage(error),
      }),
  });

  const setFilter = (setter: (value: string) => void, value: string) => {
    setter(value);
    setPage(1);
  };

  return (
    <main className="page">
      <ResourcePageHeader
        title="Notificaciones"
        description="Gestiona el inbox de usuarios y observa el resultado real de las entregas push."
        actions={
          <button
            className="button button--primary"
            type="button"
            onClick={() => setCreating(true)}
          >
            <Plus aria-hidden="true" size={18} /> Nueva notificación
          </button>
        }
      />

      <section className="panel" aria-label="Historial de notificaciones">
        <div className="filters">
          <label>
            <span>ID de usuario</span>
            <input
              value={userId}
              placeholder="ObjectId exacto"
              onChange={(event) =>
                setFilter(setUserId, event.target.value.trim())
              }
            />
          </label>
          <label>
            <span>Tipo</span>
            <select
              value={type}
              onChange={(event) => setFilter(setType, event.target.value)}
            >
              <option value="">Todos</option>
              {notificationTypes.map((item) => (
                <option key={item} value={item}>
                  {typeLabel(item)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Entrega</span>
            <select
              value={deliveryStatus}
              onChange={(event) =>
                setFilter(setDeliveryStatus, event.target.value)
              }
            >
              <option value="">Todos</option>
              {deliveryStatuses.map((item) => (
                <option key={item} value={item}>
                  {deliveryLabel(item)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {notifications.isLoading ? <LoadingPanel /> : null}
        {notifications.isError ? (
          <ErrorPanel
            error={notifications.error}
            onRetry={() => notifications.refetch()}
          />
        ) : null}
        {notifications.isSuccess && !notifications.data.data.length ? (
          <EmptyPanel
            title="No hay notificaciones"
            description="No existen resultados para estos filtros."
          />
        ) : null}
        {notifications.data?.data.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Mensaje</th>
                  <th>Usuario</th>
                  <th>Tipo</th>
                  <th>Entrega</th>
                  <th>Intentos</th>
                  <th>Creada</th>
                  <th className="table-actions">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {notifications.data.data.map((notification) => (
                  <tr key={notification.id}>
                    <td>
                      <strong>{notification.title}</strong>
                      <small className="table-note">
                        {truncate(notification.body, 90)}
                      </small>
                    </td>
                    <td>
                      <code>{notification.userId}</code>
                    </td>
                    <td>{typeLabel(notification.type)}</td>
                    <td>
                      <StatusBadge status={notification.deliveryStatus} />
                      {notification.lastDeliveryError ? (
                        <small className="table-note table-note--error">
                          {truncate(notification.lastDeliveryError, 70)}
                        </small>
                      ) : null}
                    </td>
                    <td>{notification.deliveryAttempts}</td>
                    <td>{formatDateTime(notification.createdAt)}</td>
                    <td className="table-actions">
                      <button
                        className="icon-button"
                        type="button"
                        aria-label={`Ver ${notification.title}`}
                        onClick={() => setDetail(notification)}
                      >
                        <Eye aria-hidden="true" size={18} />
                      </button>
                      <button
                        className="icon-button"
                        type="button"
                        aria-label={`Intentar entrega de ${notification.title}`}
                        disabled={notification.deliveryStatus === 'processing'}
                        onClick={() => setDelivering(notification)}
                      >
                        <RefreshCw aria-hidden="true" size={18} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {notifications.data ? (
          <Pagination
            page={notifications.data.meta.page}
            limit={notifications.data.meta.limit}
            total={notifications.data.meta.total}
            pages={notifications.data.meta.pages}
            onPageChange={setPage}
          />
        ) : null}
      </section>

      {creating ? (
        <NotificationEditor
          busy={create.isPending}
          onClose={() => !create.isPending && setCreating(false)}
          onSave={(body) => create.mutate(body)}
          onError={(message) =>
            showToast({ tone: 'error', title: 'Datos inválidos', message })
          }
        />
      ) : null}

      {detail ? (
        <Modal
          title={detail.title}
          description={`Notificación ${detail.id}`}
          onClose={() => setDetail(null)}
          wide
        >
          <div className="detail-layout">
            <section>
              <h3>Contenido</h3>
              <p className="message-preview">{detail.body}</p>
              {detail.imageUrl ? (
                <p>
                  <a href={detail.imageUrl} target="_blank" rel="noreferrer">
                    Abrir imagen
                  </a>
                </p>
              ) : null}
              {detail.actionUrl ? (
                <p>
                  <a href={detail.actionUrl} target="_blank" rel="noreferrer">
                    Abrir destino
                  </a>
                </p>
              ) : null}
            </section>
            <section>
              <h3>Entrega</h3>
              <dl className="detail-list">
                <div>
                  <dt>Estado</dt>
                  <dd>
                    <StatusBadge status={detail.deliveryStatus} />
                  </dd>
                </div>
                <div>
                  <dt>Intentos</dt>
                  <dd>{detail.deliveryAttempts}</dd>
                </div>
                <div>
                  <dt>Aceptadas</dt>
                  <dd>{detail.deliveryAccepted}</dd>
                </div>
                <div>
                  <dt>Rechazadas</dt>
                  <dd>{detail.deliveryRejected}</dd>
                </div>
                <div>
                  <dt>Código</dt>
                  <dd>{detail.deliveryCode || '—'}</dd>
                </div>
                <div>
                  <dt>Entregada</dt>
                  <dd>{formatDateTime(detail.deliveredAt)}</dd>
                </div>
              </dl>
              {detail.lastDeliveryError ? (
                <div className="inline-alert inline-alert--error">
                  {detail.lastDeliveryError}
                </div>
              ) : null}
            </section>
          </div>
          <details>
            <summary>Datos estructurados</summary>
            <pre className="json-view">
              {JSON.stringify(detail.data ?? {}, null, 2)}
            </pre>
          </details>
          <div className="modal__actions">
            <button
              className="button button--secondary"
              type="button"
              onClick={() => setDetail(null)}
            >
              Cerrar
            </button>
            <button
              className="button button--primary"
              type="button"
              onClick={() => {
                setDetail(null);
                setDelivering(detail);
              }}
            >
              <BellRing aria-hidden="true" size={17} /> Intentar entrega
            </button>
          </div>
        </Modal>
      ) : null}

      {delivering ? (
        <ConfirmDialog
          title="Intentar entrega push"
          description={`Se iniciará un intento real de entrega para “${delivering.title}”. El resultado quedará registrado.`}
          confirmLabel="Entregar ahora"
          danger={false}
          busy={deliver.isPending}
          onClose={() => setDelivering(null)}
          onConfirm={() => deliver.mutate(delivering.id)}
        />
      ) : null}
    </main>
  );
}

function NotificationEditor({
  busy,
  onSave,
  onClose,
  onError,
}: {
  busy: boolean;
  onSave: (body: NotificationInput) => void;
  onClose: () => void;
  onError: (message: string) => void;
}) {
  return (
    <Modal
      title="Nueva notificación"
      description="Primero se guarda en el inbox; el push es una entrega adicional."
      onClose={onClose}
      wide
    >
      <form
        onSubmit={(event) =>
          submitForm(event, (form) => {
            let data: Record<string, unknown> | undefined;
            const rawData = String(form.get('data') ?? '').trim();
            try {
              if (rawData) {
                const parsed: unknown = JSON.parse(rawData);
                if (
                  !parsed ||
                  typeof parsed !== 'object' ||
                  Array.isArray(parsed)
                )
                  throw new Error();
                data = parsed as Record<string, unknown>;
              }
            } catch {
              onError('El campo de datos debe contener un objeto JSON válido.');
              return;
            }
            onSave({
              userId: String(form.get('userId') ?? '').trim(),
              title: String(form.get('title') ?? '').trim(),
              body: String(form.get('body') ?? '').trim(),
              type: optionalString(form, 'type'),
              eventKey: optionalString(form, 'eventKey'),
              data,
              imageUrl: optionalString(form, 'imageUrl'),
              actionUrl: optionalString(form, 'actionUrl'),
              expiresAt: fromDateTimeLocal(optionalString(form, 'expiresAt')),
              deliverPush: form.get('deliverPush') === 'on',
            });
          })
        }
      >
        <div className="form-grid">
          <Field label="ID del usuario" htmlFor="notification-user" required>
            <input
              id="notification-user"
              name="userId"
              required
              pattern="[a-fA-F0-9]{24}"
              autoFocus
            />
          </Field>
          <Field label="Tipo" htmlFor="notification-type">
            <select id="notification-type" name="type" defaultValue="general">
              {notificationTypes.map((item) => (
                <option key={item} value={item}>
                  {typeLabel(item)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Título" htmlFor="notification-title" required>
            <input
              id="notification-title"
              name="title"
              required
              maxLength={140}
            />
          </Field>
          <Field
            label="Clave idempotente"
            htmlFor="notification-event-key"
            hint="8–160 caracteres; evita duplicados del mismo evento."
          >
            <input
              id="notification-event-key"
              name="eventKey"
              minLength={8}
              maxLength={160}
              pattern="[A-Za-z0-9._:-]+"
            />
          </Field>
          <div className="form-grid__full">
            <Field label="Mensaje" htmlFor="notification-body" required>
              <textarea
                id="notification-body"
                name="body"
                required
                rows={5}
                maxLength={2000}
              />
            </Field>
          </div>
          <Field label="URL de imagen" htmlFor="notification-image">
            <input
              id="notification-image"
              name="imageUrl"
              type="url"
              maxLength={2048}
            />
          </Field>
          <Field label="URL o ruta de acción" htmlFor="notification-action">
            <input
              id="notification-action"
              name="actionUrl"
              maxLength={2048}
              placeholder="/mi-cuenta o https://…"
            />
          </Field>
          <Field label="Expira" htmlFor="notification-expires">
            <input
              id="notification-expires"
              name="expiresAt"
              type="datetime-local"
            />
          </Field>
          <div className="form-grid__full">
            <Field
              label="Datos JSON"
              htmlFor="notification-data"
              hint='Objeto opcional, por ejemplo {"orderId":"…"}'
            >
              <textarea
                id="notification-data"
                name="data"
                rows={4}
                defaultValue="{}"
                spellCheck={false}
              />
            </Field>
          </div>
        </div>
        <label className="check-field">
          <input name="deliverPush" type="checkbox" />
          <span>Solicitar entrega push inmediatamente después de guardar</span>
        </label>
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
            {busy ? 'Creando…' : 'Crear notificación'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function typeLabel(value: string) {
  return (
    (
      {
        general: 'General',
        campaign: 'Campaña',
        order: 'Orden',
        payment: 'Pago',
        winner: 'Ganador',
        promotion: 'Promoción',
        system: 'Sistema',
      } as Record<string, string>
    )[value] ?? value
  );
}

function deliveryLabel(value: string) {
  return (
    (
      {
        pending: 'Pendiente',
        processing: 'Procesando',
        skipped: 'Omitida',
        sent: 'Enviada',
        partially_sent: 'Parcial',
        failed: 'Fallida',
      } as Record<string, string>
    )[value] ?? value
  );
}

function truncate(value: string, max: number) {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

export default NotificationsPage;
