import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, FileImage, HardDrive, Trash2, Upload, Video } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatBytes, formatDateTime, percent } from '@/lib/format';
import { useToast } from '@/lib/toast-context';
import type { DataPage, MediaAsset } from '@/lib/types';
import {
  ConfirmDialog,
  EmptyPanel,
  ErrorPanel,
  LoadingPanel,
  Pagination,
  ResourcePageHeader,
  StatusBadge,
  errorMessage,
  submitForm,
} from './resource-page-shared';

interface AdminMediaAsset extends MediaAsset {
  checksumSha256?: string;
  referenceCount?: number;
  extension?: string;
  uploadedBy?: string;
  deletedBy?: string;
}

interface UsageCounter {
  bytes: number;
  objects: number;
  maxBytes: number;
  remainingBytes: number;
}

interface MediaUsage {
  global: UsageCounter;
  currentUser: UsageCounter;
  deletedRetentionDays: number;
}

type MediaAction = { kind: 'delete' | 'purge'; asset: AdminMediaAsset };

export function MediaPage() {
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const { showToast } = useToast();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('active');
  const [kind, setKind] = useState('');
  const [referenced, setReferenced] = useState('');
  const [search, setSearch] = useState('');
  const [action, setAction] = useState<MediaAction | null>(null);
  const limit = 24;

  const assets = useQuery({
    queryKey: ['admin-media', page, limit, status, kind, referenced, search],
    queryFn: () =>
      api.get<DataPage<AdminMediaAsset>>('/admin/media', {
        query: { page, limit, status, kind, referenced, search },
      }),
  });
  const usage = useQuery({
    queryKey: ['admin-media-usage'],
    queryFn: () => api.get<MediaUsage>('/admin/media/storage-usage'),
  });

  const upload = useMutation({
    mutationFn: (form: FormData) => api.post<AdminMediaAsset>('/admin/media', form),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-media'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-media-usage'] }),
      ]);
      showToast({ tone: 'success', title: 'Archivo subido' });
    },
    onError: (error) =>
      showToast({ tone: 'error', title: 'No se pudo subir', message: errorMessage(error) }),
  });

  const remove = useMutation({
    mutationFn: ({ kind: actionKind, asset }: MediaAction) =>
      api.delete<{ deleted?: boolean; purged?: boolean }>(
        `/admin/media/${asset.id}${actionKind === 'purge' ? '/purge' : ''}`,
      ),
    onSuccess: async (_, input) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-media'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-media-usage'] }),
      ]);
      setAction(null);
      showToast({ tone: 'success', title: input.kind === 'purge' ? 'Archivo purgado' : 'Archivo enviado a retención' });
    },
    onError: (error) =>
      showToast({ tone: 'error', title: 'No se pudo eliminar', message: errorMessage(error) }),
  });

  const setFilter = (setter: (value: string) => void, value: string) => {
    setter(value);
    setPage(1);
  };

  const copyUrl = async (asset: AdminMediaAsset) => {
    const relative = asset.publicUrl || asset.url || `/api/v1/media/${asset.id}`;
    const absolute = new URL(relative, window.location.origin).toString();
    try {
      await navigator.clipboard.writeText(absolute);
      showToast({ tone: 'success', title: 'URL copiada' });
    } catch {
      showToast({ tone: 'error', title: 'No se pudo copiar', message: absolute });
    }
  };

  return (
    <main className="page">
      <ResourcePageHeader
        title="Biblioteca de medios"
        description="Sube imágenes y videos validados, controla referencias y consumo de almacenamiento."
      />

      {usage.data ? (
        <section className="metric-grid metric-grid--two" aria-label="Uso de almacenamiento">
          <UsageCard title="Almacenamiento global" counter={usage.data.global} />
          <UsageCard title="Tu almacenamiento" counter={usage.data.currentUser} />
        </section>
      ) : null}
      {usage.isError ? <ErrorPanel error={usage.error} onRetry={() => usage.refetch()} /> : null}

      <section className="panel upload-panel" aria-labelledby="media-upload-title">
        <div>
          <h2 id="media-upload-title">Subir archivo</h2>
          <p>JPEG, PNG, WebP, MP4 o WebM. El servidor valida firma, tamaño y cuota.</p>
        </div>
        <form
          className="upload-form"
          onSubmit={(event) =>
            submitForm(event, (form) => {
              const file = form.get('file');
              if (!(file instanceof File) || !file.size) {
                showToast({ tone: 'error', title: 'Selecciona un archivo' });
                return;
              }
              upload.mutate(form, { onSuccess: () => event.currentTarget.reset() });
            })
          }
        >
          <label className="file-picker" htmlFor="media-file">
            <Upload aria-hidden="true" size={20} />
            <span>Elegir archivo</span>
            <input
              id="media-file"
              name="file"
              type="file"
              required
              accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
            />
          </label>
          <button className="button button--primary" type="submit" disabled={upload.isPending}>
            {upload.isPending ? 'Subiendo…' : 'Subir'}
          </button>
        </form>
      </section>

      <section className="panel" aria-label="Archivos almacenados">
        <div className="filters">
          <label>
            <span>Buscar</span>
            <input
              type="search"
              value={search}
              maxLength={80}
              placeholder="Nombre del archivo"
              onChange={(event) => setFilter(setSearch, event.target.value)}
            />
          </label>
          <label>
            <span>Estado</span>
            <select value={status} onChange={(event) => setFilter(setStatus, event.target.value)}>
              <option value="">Todos</option>
              <option value="active">Activos</option>
              <option value="deleted">En retención</option>
              <option value="purging">Purgando</option>
            </select>
          </label>
          <label>
            <span>Tipo</span>
            <select value={kind} onChange={(event) => setFilter(setKind, event.target.value)}>
              <option value="">Todos</option>
              <option value="image">Imágenes</option>
              <option value="video">Videos</option>
            </select>
          </label>
          <label>
            <span>Referencias</span>
            <select value={referenced} onChange={(event) => setFilter(setReferenced, event.target.value)}>
              <option value="">Todos</option>
              <option value="true">En uso</option>
              <option value="false">Sin uso</option>
            </select>
          </label>
        </div>

        {assets.isLoading ? <LoadingPanel /> : null}
        {assets.isError ? <ErrorPanel error={assets.error} onRetry={() => assets.refetch()} /> : null}
        {assets.isSuccess && !assets.data.data.length ? (
          <EmptyPanel title="No hay archivos con estos filtros" description="Cambia los filtros o sube un nuevo archivo." />
        ) : null}
        {assets.data?.data.length ? (
          <div className="media-grid">
            {assets.data.data.map((asset) => {
              const url = asset.publicUrl || asset.url || `/api/v1/media/${asset.id}`;
              const references = asset.referenceCount ?? asset.references?.length ?? 0;
              return (
                <article className="media-card" key={asset.id}>
                  <div className="media-card__preview">
                    {asset.kind === 'image' && asset.status === 'active' ? (
                      <img src={url} alt="" loading="lazy" />
                    ) : asset.kind === 'video' ? (
                      <Video aria-hidden="true" size={34} />
                    ) : (
                      <FileImage aria-hidden="true" size={34} />
                    )}
                  </div>
                  <div className="media-card__body">
                    <div className="media-card__title">
                      <strong title={asset.originalName}>{asset.originalName || asset.id}</strong>
                      <StatusBadge status={asset.status} />
                    </div>
                    <dl className="compact-details">
                      <div><dt>Tamaño</dt><dd>{formatBytes(asset.size)}</dd></div>
                      <div><dt>Referencias</dt><dd>{references}</dd></div>
                      <div><dt>Subido</dt><dd>{formatDateTime(asset.createdAt)}</dd></div>
                    </dl>
                    <div className="card-actions">
                      {asset.status === 'active' ? (
                        <button className="button button--ghost" type="button" onClick={() => copyUrl(asset)}>
                          <Copy aria-hidden="true" size={17} /> Copiar URL
                        </button>
                      ) : null}
                      {can('admin') && asset.status === 'active' ? (
                        <button
                          className="button button--danger-ghost"
                          type="button"
                          disabled={references > 0}
                          title={references ? 'El archivo tiene referencias activas' : undefined}
                          onClick={() => setAction({ kind: 'delete', asset })}
                        >
                          <Trash2 aria-hidden="true" size={17} /> Eliminar
                        </button>
                      ) : null}
                      {can('admin') && asset.status === 'deleted' ? (
                        <button className="button button--danger-ghost" type="button" onClick={() => setAction({ kind: 'purge', asset })}>
                          <Trash2 aria-hidden="true" size={17} /> Purgar
                        </button>
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}
        {assets.data ? (
          <Pagination
            page={assets.data.meta.page}
            limit={assets.data.meta.limit}
            total={assets.data.meta.total}
            pages={assets.data.meta.pages}
            onPageChange={setPage}
          />
        ) : null}
      </section>

      {action ? (
        <ConfirmDialog
          title={action.kind === 'purge' ? 'Purgar archivo físicamente' : 'Eliminar archivo'}
          description={
            action.kind === 'purge'
              ? `Se intentará borrar “${action.asset.originalName}” del proveedor. Solo es posible después de ${usage.data?.deletedRetentionDays ?? 'los'} días de retención.`
              : `“${action.asset.originalName}” dejará de estar disponible y entrará en el periodo de retención.`
          }
          confirmLabel={action.kind === 'purge' ? 'Purgar definitivamente' : 'Enviar a retención'}
          busy={remove.isPending}
          onClose={() => setAction(null)}
          onConfirm={() => remove.mutate(action)}
        />
      ) : null}
    </main>
  );
}

function UsageCard({ title, counter }: { title: string; counter: UsageCounter }) {
  const used = percent(counter.bytes, counter.maxBytes);
  return (
    <article className="metric-card storage-card">
      <div className="metric-card__icon"><HardDrive aria-hidden="true" size={20} /></div>
      <div>
        <span>{title}</span>
        <strong>{formatBytes(counter.bytes)} / {formatBytes(counter.maxBytes)}</strong>
        <div className="progress" role="progressbar" aria-label={`${title}: ${used.toFixed(0)}% usado`} aria-valuenow={used} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${used}%` }} />
        </div>
        <small>{counter.objects} archivos · {formatBytes(counter.remainingBytes)} disponibles</small>
      </div>
    </article>
  );
}

export default MediaPage;
