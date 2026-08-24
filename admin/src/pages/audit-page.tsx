import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Eye, Search } from 'lucide-react';
import { api, downloadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatDateTime, fromDateTimeLocal } from '@/lib/format';
import { useToast } from '@/lib/toast-context';
import type { AuditLog, DataPage } from '@/lib/types';
import {
  AccessDenied,
  EmptyPanel,
  ErrorPanel,
  LoadingPanel,
  Modal,
  Pagination,
  ResourcePageHeader,
  StatusBadge,
  errorMessage,
} from './resource-page-shared';

interface AuditFilters {
  action: string;
  category: string;
  outcome: string;
  actorId: string;
  actorRole: string;
  resourceType: string;
  resourceId: string;
  correlationId: string;
  from: string;
  to: string;
}

const initialFilters: AuditFilters = {
  action: '',
  category: '',
  outcome: '',
  actorId: '',
  actorRole: '',
  resourceType: '',
  resourceId: '',
  correlationId: '',
  from: '',
  to: '',
};

export function AuditPage() {
  const { can } = useAuth();
  const { showToast } = useToast();
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState(initialFilters);
  const [filters, setFilters] = useState(initialFilters);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const limit = 25;
  const query = queryFor(filters);

  const logs = useQuery({
    queryKey: ['audit-logs', page, limit, filters],
    queryFn: () =>
      api.get<DataPage<AuditLog>>('/admin/audit-logs', {
        query: { page, limit, ...query },
      }),
    enabled: can('admin'),
  });
  const detail = useQuery({
    queryKey: ['audit-log', detailId],
    queryFn: () => api.get<AuditLog>(`/admin/audit-logs/${detailId}`),
    enabled: can('admin') && Boolean(detailId),
  });

  const updateDraft = (key: keyof AuditFilters, value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const exportCsv = async () => {
    setExporting(true);
    try {
      await downloadFile(
        '/admin/audit-logs/export.csv',
        `auditoria-${new Date().toISOString().slice(0, 10)}.csv`,
        query,
      );
      showToast({ tone: 'success', title: 'Auditoría exportada' });
    } catch (error) {
      showToast({
        tone: 'error',
        title: 'No se pudo exportar',
        message: errorMessage(error),
      });
    } finally {
      setExporting(false);
    }
  };

  if (!can('admin')) {
    return (
      <main className="page">
        <ResourcePageHeader
          title="Auditoría"
          description="Registro inmutable de operaciones administrativas."
        />
        <AccessDenied message="La auditoría contiene datos sensibles y solo está disponible para administradores." />
      </main>
    );
  }

  return (
    <main className="page">
      <ResourcePageHeader
        title="Auditoría"
        description="Consulta el registro append-only por actor, recurso, resultado o correlación."
        actions={
          <button
            className="button button--secondary"
            type="button"
            disabled={exporting}
            onClick={exportCsv}
          >
            <Download aria-hidden="true" size={18} />{' '}
            {exporting ? 'Exportando…' : 'Exportar CSV'}
          </button>
        }
      />

      <section className="panel" aria-label="Filtros de auditoría">
        <form
          className="filters filters--audit"
          onSubmit={(event) => {
            event.preventDefault();
            setFilters(draft);
            setPage(1);
          }}
        >
          <label>
            <span>Acción exacta</span>
            <input
              value={draft.action}
              maxLength={120}
              placeholder="settings.version.publish"
              onChange={(event) => updateDraft('action', event.target.value)}
            />
          </label>
          <label>
            <span>Categoría</span>
            <select
              value={draft.category}
              onChange={(event) => updateDraft('category', event.target.value)}
            >
              <option value="">Todas</option>
              <option value="administration">Administración</option>
              <option value="security">Seguridad</option>
              <option value="data_access">Acceso a datos</option>
              <option value="system">Sistema</option>
            </select>
          </label>
          <label>
            <span>Resultado</span>
            <select
              value={draft.outcome}
              onChange={(event) => updateDraft('outcome', event.target.value)}
            >
              <option value="">Todos</option>
              <option value="success">Correcto</option>
              <option value="failure">Error</option>
            </select>
          </label>
          <label>
            <span>Rol del actor</span>
            <select
              value={draft.actorRole}
              onChange={(event) => updateDraft('actorRole', event.target.value)}
            >
              <option value="">Todos</option>
              <option value="admin">Administrador</option>
              <option value="operator">Operador</option>
              <option value="customer">Cliente</option>
            </select>
          </label>
          <label>
            <span>ID del actor</span>
            <input
              value={draft.actorId}
              maxLength={80}
              onChange={(event) => updateDraft('actorId', event.target.value)}
            />
          </label>
          <label>
            <span>Tipo de recurso</span>
            <input
              value={draft.resourceType}
              maxLength={120}
              placeholder="site_settings"
              onChange={(event) =>
                updateDraft('resourceType', event.target.value)
              }
            />
          </label>
          <label>
            <span>ID del recurso</span>
            <input
              value={draft.resourceId}
              maxLength={120}
              onChange={(event) =>
                updateDraft('resourceId', event.target.value)
              }
            />
          </label>
          <label>
            <span>Correlación</span>
            <input
              value={draft.correlationId}
              maxLength={100}
              onChange={(event) =>
                updateDraft('correlationId', event.target.value)
              }
            />
          </label>
          <label>
            <span>Desde</span>
            <input
              type="datetime-local"
              value={draft.from}
              onChange={(event) => updateDraft('from', event.target.value)}
            />
          </label>
          <label>
            <span>Hasta</span>
            <input
              type="datetime-local"
              value={draft.to}
              onChange={(event) => updateDraft('to', event.target.value)}
            />
          </label>
          <div className="filters__actions">
            <button
              className="button button--secondary"
              type="button"
              onClick={() => {
                setDraft(initialFilters);
                setFilters(initialFilters);
                setPage(1);
              }}
            >
              Limpiar
            </button>
            <button className="button button--primary" type="submit">
              <Search aria-hidden="true" size={17} /> Aplicar filtros
            </button>
          </div>
        </form>
      </section>

      <section className="panel" aria-label="Eventos de auditoría">
        {logs.isLoading ? <LoadingPanel /> : null}
        {logs.isError ? (
          <ErrorPanel error={logs.error} onRetry={() => logs.refetch()} />
        ) : null}
        {logs.isSuccess && !logs.data.data.length ? (
          <EmptyPanel
            title="No hay eventos"
            description="Ningún evento coincide con los filtros aplicados."
          />
        ) : null}
        {logs.data?.data.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Acción</th>
                  <th>Actor</th>
                  <th>Recurso</th>
                  <th>Resultado</th>
                  <th>Correlación</th>
                  <th className="table-actions">Detalle</th>
                </tr>
              </thead>
              <tbody>
                {logs.data.data.map((log) => (
                  <tr key={log.id}>
                    <td>{formatDateTime(log.createdAt)}</td>
                    <td>
                      <strong>{log.action}</strong>
                      <small className="table-note">
                        {categoryLabel(log.category)}
                      </small>
                    </td>
                    <td>
                      {log.actorLabel || log.actorId || 'Sistema'}
                      {log.actorRole ? (
                        <small className="table-note">{log.actorRole}</small>
                      ) : null}
                    </td>
                    <td>
                      {log.resourceType || '—'}
                      {log.resourceId ? (
                        <small className="table-note">
                          <code>{log.resourceId}</code>
                        </small>
                      ) : null}
                    </td>
                    <td>
                      <StatusBadge status={log.outcome} />
                      {log.errorCode ? (
                        <small className="table-note table-note--error">
                          {log.errorCode}
                        </small>
                      ) : null}
                    </td>
                    <td>
                      <code>{shortId(log.correlationId)}</code>
                    </td>
                    <td className="table-actions">
                      <button
                        className="icon-button"
                        type="button"
                        aria-label={`Ver evento ${log.action}`}
                        onClick={() => setDetailId(log.id)}
                      >
                        <Eye aria-hidden="true" size={18} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {logs.data ? (
          <Pagination
            page={logs.data.meta.page}
            limit={logs.data.meta.limit}
            total={logs.data.meta.total}
            pages={logs.data.meta.pages}
            onPageChange={setPage}
          />
        ) : null}
      </section>

      {detailId ? (
        <Modal
          title="Detalle de auditoría"
          description={detailId}
          onClose={() => setDetailId(null)}
          wide
        >
          {detail.isLoading ? <LoadingPanel /> : null}
          {detail.isError ? (
            <ErrorPanel error={detail.error} onRetry={() => detail.refetch()} />
          ) : null}
          {detail.data ? <AuditDetail log={detail.data} /> : null}
          <div className="modal__actions">
            <button
              className="button button--secondary"
              type="button"
              onClick={() => setDetailId(null)}
            >
              Cerrar
            </button>
          </div>
        </Modal>
      ) : null}
    </main>
  );
}

function AuditDetail({ log }: { log: AuditLog }) {
  return (
    <div className="audit-detail">
      <dl className="detail-list detail-list--grid">
        <div>
          <dt>Acción</dt>
          <dd>{log.action}</dd>
        </div>
        <div>
          <dt>Resultado</dt>
          <dd>
            <StatusBadge status={log.outcome} />
          </dd>
        </div>
        <div>
          <dt>Categoría</dt>
          <dd>{categoryLabel(log.category)}</dd>
        </div>
        <div>
          <dt>Fecha</dt>
          <dd>{formatDateTime(log.createdAt)}</dd>
        </div>
        <div>
          <dt>Actor</dt>
          <dd>
            {log.actorId || 'Sistema'}{' '}
            {log.actorRole ? `(${log.actorRole})` : ''}
          </dd>
        </div>
        <div>
          <dt>IP</dt>
          <dd>{log.ip || '—'}</dd>
        </div>
        <div>
          <dt>Recurso</dt>
          <dd>
            {log.resourceType || '—'} {log.resourceId || ''}
          </dd>
        </div>
        <div>
          <dt>Correlación</dt>
          <dd>
            <code>{log.correlationId || '—'}</code>
          </dd>
        </div>
      </dl>
      {log.errorMessage ? (
        <div className="inline-alert inline-alert--error">
          <strong>{log.errorCode || 'Error'}</strong>
          <p>{log.errorMessage}</p>
        </div>
      ) : null}
      <div className="detail-json-grid">
        <JsonDetail title="Antes" value={log.before} />
        <JsonDetail title="Después" value={log.after} />
        <JsonDetail title="Metadatos" value={log.metadata} />
      </div>
    </div>
  );
}

function JsonDetail({
  title,
  value,
}: {
  title: string;
  value?: Record<string, unknown>;
}) {
  return (
    <details open={value !== undefined}>
      <summary>{title}</summary>
      <pre className="json-view">
        {value === undefined ? 'Sin datos' : JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}

function queryFor(filters: AuditFilters) {
  return {
    action: filters.action.trim() || undefined,
    category: filters.category || undefined,
    outcome: filters.outcome || undefined,
    actorId: filters.actorId.trim() || undefined,
    actorRole: filters.actorRole || undefined,
    resourceType: filters.resourceType.trim() || undefined,
    resourceId: filters.resourceId.trim() || undefined,
    correlationId: filters.correlationId.trim() || undefined,
    from: fromDateTimeLocal(filters.from),
    to: fromDateTimeLocal(filters.to),
  };
}

function categoryLabel(value: string) {
  return (
    (
      {
        administration: 'Administración',
        security: 'Seguridad',
        data_access: 'Acceso a datos',
        system: 'Sistema',
      } as Record<string, string>
    )[value] ?? value
  );
}

function shortId(value?: string) {
  if (!value) return '—';
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-5)}` : value;
}

export default AuditPage;
