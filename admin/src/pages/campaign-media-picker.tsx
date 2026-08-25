import { useQuery } from '@tanstack/react-query';
import { Check, Image, Plus, Search, Video } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui';
import { api } from '@/lib/api';
import type { DataPage, MediaAsset } from '@/lib/types';
import {
  EmptyPanel,
  ErrorPanel,
  LoadingPanel,
  Modal,
  Pagination,
} from './resource-page-shared';

const PAGE_LIMIT = 18;

function mediaAssetUrl(asset: MediaAsset): string {
  return (
    asset.publicUrl ??
    asset.url ??
    `/api/v1/media/${encodeURIComponent(asset.id)}`
  );
}

export function CampaignMediaPicker({
  selectedMediaIds,
  onSelect,
  onClose,
}: {
  selectedMediaIds: ReadonlySet<string>;
  onSelect: (asset: MediaAsset) => void;
  onClose: () => void;
}) {
  const [page, setPage] = useState(1);
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const mediaQuery = useQuery({
    queryKey: ['campaign-media-picker', page, search],
    queryFn: () =>
      api.get<DataPage<MediaAsset>>('/admin/media', {
        query: {
          page,
          limit: PAGE_LIMIT,
          status: 'active',
          search: search || undefined,
        },
      }),
    staleTime: 15_000,
  });

  const applySearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPage(1);
    setSearch(searchDraft.trim());
  };

  return (
    <Modal
      title="Biblioteca de medios"
      description="Selecciona imágenes o vídeos ya cargados para esta campaña."
      onClose={onClose}
      wide
    >
      <form
        className="campaign-media-picker__toolbar"
        role="search"
        onSubmit={applySearch}
      >
        <label className="field field--search">
          <span>Buscar archivo</span>
          <div className="input-with-action">
            <input
              autoFocus
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              maxLength={80}
              placeholder="Nombre o tipo MIME"
            />
            <Button type="submit" variant="secondary">
              <Search size={16} aria-hidden="true" />
              Buscar
            </Button>
          </div>
        </label>
        <Link className="button button--ghost" to="/media">
          Administrar biblioteca
        </Link>
      </form>

      {mediaQuery.isLoading ? (
        <LoadingPanel label="Cargando archivos disponibles…" />
      ) : mediaQuery.isError ? (
        <ErrorPanel
          error={mediaQuery.error}
          onRetry={() => mediaQuery.refetch()}
        />
      ) : mediaQuery.data?.data.length ? (
        <>
          <ul className="campaign-media-picker__grid">
            {mediaQuery.data.data.map((asset) => {
              const selected = selectedMediaIds.has(asset.id);
              return (
                <li className="campaign-media-picker__card" key={asset.id}>
                  <div className="campaign-media-picker__preview">
                    {asset.kind === 'image' ? (
                      <img src={mediaAssetUrl(asset)} alt="" loading="lazy" />
                    ) : (
                      <Video size={32} aria-hidden="true" />
                    )}
                  </div>
                  <div className="campaign-media-picker__body">
                    <span className="campaign-media-picker__kind">
                      {asset.kind === 'image' ? (
                        <Image size={14} aria-hidden="true" />
                      ) : (
                        <Video size={14} aria-hidden="true" />
                      )}
                      {asset.kind === 'image' ? 'Imagen' : 'Vídeo'}
                    </span>
                    <strong title={asset.originalName ?? asset.id}>
                      {asset.originalName ?? asset.id}
                    </strong>
                    <Button
                      type="button"
                      variant={selected ? 'secondary' : 'primary'}
                      disabled={selected}
                      onClick={() => onSelect(asset)}
                    >
                      {selected ? (
                        <Check size={16} aria-hidden="true" />
                      ) : (
                        <Plus size={16} aria-hidden="true" />
                      )}
                      {selected ? 'Añadido' : 'Agregar'}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
          {mediaQuery.isFetching ? (
            <p className="campaign-media-picker__activity" role="status">
              Actualizando biblioteca…
            </p>
          ) : null}
          <Pagination
            page={mediaQuery.data.meta.page}
            total={mediaQuery.data.meta.total}
            limit={mediaQuery.data.meta.limit}
            pages={mediaQuery.data.meta.pages}
            onPageChange={setPage}
          />
        </>
      ) : (
        <EmptyPanel
          title="No hay archivos disponibles"
          description={
            search
              ? 'Prueba otra búsqueda o carga un archivo en la Biblioteca.'
              : 'Carga una imagen o un vídeo en la Biblioteca antes de seleccionarlo.'
          }
          action={
            <Link className="button button--secondary" to="/media">
              Ir a la Biblioteca
            </Link>
          }
        />
      )}
    </Modal>
  );
}
