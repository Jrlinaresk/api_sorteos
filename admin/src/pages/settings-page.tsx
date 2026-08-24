import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, CopyPlus, Edit3, Eye, Rocket } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatDateTime } from '@/lib/format';
import { useToast } from '@/lib/toast-context';
import type { DataPage, SiteSettings } from '@/lib/types';
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
  submitForm,
} from './resource-page-shared';

type SettingsEditorState =
  | { mode: 'new'; item?: SiteSettings }
  | { mode: 'edit' | 'view'; item: SiteSettings };
type SettingsAction = { kind: 'publish' | 'archive'; item: SiteSettings };

interface SettingsPayload {
  brand: Record<string, unknown>;
  contact?: Record<string, unknown>;
  social?: Record<string, unknown>;
  theme?: Record<string, unknown>;
  legal?: Record<string, unknown>;
  featureFlags?: Record<string, boolean>;
  changeNote?: string;
}

const emptySettings: SettingsPayload = {
  brand: { siteName: 'Sorteos' },
  contact: {},
  social: {},
  theme: { mode: 'dark', primaryColor: '#22C55E', secondaryColor: '#111827' },
  legal: {},
  featureFlags: {},
};

export function SettingsPage() {
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const { showToast } = useToast();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [editor, setEditor] = useState<SettingsEditorState | null>(null);
  const [action, setAction] = useState<SettingsAction | null>(null);
  const limit = 25;

  const versions = useQuery({
    queryKey: ['admin-settings', page, limit, status],
    queryFn: () =>
      api.get<DataPage<SiteSettings>>('/admin/settings', {
        query: { page, limit, status },
      }),
  });

  const save = useMutation({
    mutationFn: (input: { version?: number; body: SettingsPayload }) =>
      input.version
        ? api.patch<SiteSettings>(
            `/admin/settings/${input.version}`,
            input.body,
          )
        : api.post<SiteSettings>('/admin/settings', input.body),
    onSuccess: async (_, input) => {
      await queryClient.invalidateQueries({ queryKey: ['admin-settings'] });
      setEditor(null);
      showToast({
        tone: 'success',
        title: input.version ? 'Borrador actualizado' : 'Versión creada',
      });
    },
    onError: (error) =>
      showToast({
        tone: 'error',
        title: 'No se pudo guardar',
        message: errorMessage(error),
      }),
  });

  const transition = useMutation({
    mutationFn: ({ kind, item }: SettingsAction) =>
      kind === 'publish'
        ? api.post<SiteSettings>(`/admin/settings/${item.version}/publish`)
        : api.delete<SiteSettings>(`/admin/settings/${item.version}`),
    onSuccess: async (_, input) => {
      await queryClient.invalidateQueries({ queryKey: ['admin-settings'] });
      setAction(null);
      showToast({
        tone: 'success',
        title:
          input.kind === 'publish'
            ? 'Configuración publicada'
            : 'Versión archivada',
      });
    },
    onError: (error) =>
      showToast({
        tone: 'error',
        title: 'No se pudo cambiar la versión',
        message: errorMessage(error),
      }),
  });

  const newest = versions.data?.data[0];

  return (
    <main className="page">
      <ResourcePageHeader
        title="Configuración del sitio"
        description="Versiona marca, contacto, tema, legales y funciones sin editar una versión publicada."
        actions={
          can('admin') ? (
            <button
              className="button button--primary"
              type="button"
              onClick={() => setEditor({ mode: 'new', item: newest })}
            >
              <CopyPlus aria-hidden="true" size={18} /> Nueva versión
            </button>
          ) : null
        }
      />

      <section className="panel" aria-label="Versiones de configuración">
        <div className="toolbar">
          <label className="inline-filter" htmlFor="settings-status">
            <span>Estado</span>
            <select
              id="settings-status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
            >
              <option value="">Todos</option>
              <option value="draft">Borrador</option>
              <option value="published">Publicada</option>
              <option value="archived">Archivada</option>
            </select>
          </label>
          <span className="toolbar__meta">
            {versions.data?.meta.total ?? 0} versiones
          </span>
        </div>

        {versions.isLoading ? <LoadingPanel /> : null}
        {versions.isError ? (
          <ErrorPanel
            error={versions.error}
            onRetry={() => versions.refetch()}
          />
        ) : null}
        {versions.isSuccess && !versions.data.data.length ? (
          <EmptyPanel
            title="No hay versiones"
            description="Crea la primera versión para personalizar la experiencia pública."
            action={
              can('admin') ? (
                <button
                  className="button button--primary"
                  type="button"
                  onClick={() => setEditor({ mode: 'new' })}
                >
                  Crear versión
                </button>
              ) : undefined
            }
          />
        ) : null}
        {versions.data?.data.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Versión</th>
                  <th>Marca</th>
                  <th>Estado</th>
                  <th>Nota</th>
                  <th>Publicada</th>
                  <th>Actualizada</th>
                  <th className="table-actions">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {versions.data.data.map((item) => (
                  <tr key={item.version}>
                    <td>
                      <strong>v{item.version}</strong>
                    </td>
                    <td>{String(item.brand.siteName ?? 'Sin nombre')}</td>
                    <td>
                      <StatusBadge status={item.status} />
                    </td>
                    <td>{item.changeNote || '—'}</td>
                    <td>{formatDateTime(item.publishedAt)}</td>
                    <td>{formatDateTime(item.updatedAt)}</td>
                    <td className="table-actions">
                      <button
                        className="icon-button"
                        type="button"
                        aria-label={`Ver versión ${item.version}`}
                        onClick={() => setEditor({ mode: 'view', item })}
                      >
                        <Eye aria-hidden="true" size={18} />
                      </button>
                      {can('admin') && item.status === 'draft' ? (
                        <>
                          <button
                            className="icon-button"
                            type="button"
                            aria-label={`Editar versión ${item.version}`}
                            onClick={() => setEditor({ mode: 'edit', item })}
                          >
                            <Edit3 aria-hidden="true" size={18} />
                          </button>
                          <button
                            className="icon-button icon-button--positive"
                            type="button"
                            aria-label={`Publicar versión ${item.version}`}
                            onClick={() => setAction({ kind: 'publish', item })}
                          >
                            <Rocket aria-hidden="true" size={18} />
                          </button>
                          <button
                            className="icon-button icon-button--danger"
                            type="button"
                            aria-label={`Archivar versión ${item.version}`}
                            onClick={() => setAction({ kind: 'archive', item })}
                          >
                            <Archive aria-hidden="true" size={18} />
                          </button>
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {versions.data ? (
          <Pagination
            page={versions.data.meta.page}
            limit={versions.data.meta.limit}
            total={versions.data.meta.total}
            pages={versions.data.meta.pages}
            onPageChange={setPage}
          />
        ) : null}
      </section>

      {editor ? (
        <SettingsEditor
          state={editor}
          busy={save.isPending}
          onClose={() => !save.isPending && setEditor(null)}
          onError={(message) =>
            showToast({ tone: 'error', title: 'JSON inválido', message })
          }
          onSave={(body) =>
            save.mutate({
              version: editor.mode === 'edit' ? editor.item.version : undefined,
              body,
            })
          }
        />
      ) : null}

      {action ? (
        <ConfirmDialog
          title={
            action.kind === 'publish'
              ? `Publicar versión ${action.item.version}`
              : `Archivar versión ${action.item.version}`
          }
          description={
            action.kind === 'publish'
              ? 'Esta versión pasará a ser la configuración pública vigente. La versión anterior conservará su historial.'
              : 'La versión dejará de estar disponible para edición, pero se conservará en el historial.'
          }
          confirmLabel={
            action.kind === 'publish'
              ? 'Publicar configuración'
              : 'Archivar versión'
          }
          danger={action.kind === 'archive'}
          busy={transition.isPending}
          onClose={() => setAction(null)}
          onConfirm={() => transition.mutate(action)}
        />
      ) : null}
    </main>
  );
}

function SettingsEditor({
  state,
  busy,
  onSave,
  onClose,
  onError,
}: {
  state: SettingsEditorState;
  busy: boolean;
  onSave: (payload: SettingsPayload) => void;
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const item = state.item;
  const source: SettingsPayload = item
    ? {
        brand: item.brand,
        contact: item.contact,
        social: item.social,
        theme: item.theme,
        legal: item.legal,
        featureFlags: item.featureFlags,
        changeNote: state.mode === 'new' ? undefined : item.changeNote,
      }
    : emptySettings;
  const readonly = state.mode === 'view';
  const title =
    state.mode === 'new'
      ? 'Nueva versión'
      : state.mode === 'edit'
        ? `Editar versión ${item?.version}`
        : `Versión ${item?.version}`;

  return (
    <Modal
      title={title}
      description="Cada sección usa JSON para conservar todas las opciones soportadas por el backend."
      onClose={onClose}
      wide
    >
      <form
        onSubmit={(event) =>
          submitForm(event, (form) => {
            if (readonly) return;
            try {
              const brand = parseObject(form, 'brand');
              if (
                typeof brand.siteName !== 'string' ||
                brand.siteName.trim().length < 2
              ) {
                onError(
                  'brand.siteName es obligatorio y debe tener al menos 2 caracteres.',
                );
                return;
              }
              const featureFlags = parseObject(form, 'featureFlags');
              if (
                Object.values(featureFlags).some(
                  (value) => typeof value !== 'boolean',
                )
              ) {
                onError(
                  'Todos los valores de featureFlags deben ser booleanos.',
                );
                return;
              }
              onSave({
                brand,
                contact: parseObject(form, 'contact'),
                social: parseObject(form, 'social'),
                theme: parseObject(form, 'theme'),
                legal: parseObject(form, 'legal'),
                featureFlags: featureFlags as Record<string, boolean>,
                changeNote:
                  String(form.get('changeNote') ?? '').trim() || undefined,
              });
            } catch (error) {
              onError(
                error instanceof Error
                  ? error.message
                  : 'Revisa las secciones.',
              );
            }
          })
        }
      >
        <div className="settings-editor-grid">
          <JsonField
            name="brand"
            label="Marca"
            value={source.brand}
            required
            readonly={readonly}
            hint='Incluye "siteName". También admite legalName, tagline, logoUrl y faviconUrl.'
          />
          <JsonField
            name="theme"
            label="Tema"
            value={source.theme ?? {}}
            readonly={readonly}
            hint="mode: light, dark o system; colores en formato #RRGGBB."
          />
          <JsonField
            name="contact"
            label="Contacto"
            value={source.contact ?? {}}
            readonly={readonly}
            hint="supportEmail, supportPhone, whatsapp y address."
          />
          <JsonField
            name="social"
            label="Redes sociales"
            value={source.social ?? {}}
            readonly={readonly}
            hint="URLs HTTPS de instagram, facebook, youtube, telegram, tiktok o x."
          />
          <JsonField
            name="legal"
            label="Legal"
            value={source.legal ?? {}}
            readonly={readonly}
            hint="privacyPolicyUrl, termsUrl, responsibleCompany, cnpj y regulationText."
          />
          <JsonField
            name="featureFlags"
            label="Funciones"
            value={source.featureFlags ?? {}}
            readonly={readonly}
            hint="Objeto de claves y valores true/false."
          />
        </div>
        <Field
          label="Nota del cambio"
          htmlFor="settings-change-note"
          hint="Describe el motivo de esta versión (máximo 500 caracteres)."
        >
          <textarea
            id="settings-change-note"
            name="changeNote"
            rows={3}
            maxLength={500}
            defaultValue={source.changeNote}
            readOnly={readonly}
          />
        </Field>
        <div className="modal__actions">
          <button
            className="button button--secondary"
            type="button"
            onClick={onClose}
          >
            {readonly ? 'Cerrar' : 'Cancelar'}
          </button>
          {!readonly ? (
            <button
              className="button button--primary"
              type="submit"
              disabled={busy}
            >
              {busy ? 'Guardando…' : 'Guardar borrador'}
            </button>
          ) : null}
        </div>
      </form>
    </Modal>
  );
}

function JsonField({
  name,
  label,
  value,
  hint,
  required,
  readonly,
}: {
  name: string;
  label: string;
  value: Record<string, unknown>;
  hint: string;
  required?: boolean;
  readonly: boolean;
}) {
  return (
    <Field
      label={label}
      htmlFor={`settings-${name}`}
      hint={hint}
      required={required}
    >
      <textarea
        className="code-input"
        id={`settings-${name}`}
        name={name}
        rows={9}
        required={required}
        readOnly={readonly}
        spellCheck={false}
        defaultValue={JSON.stringify(value, null, 2)}
      />
    </Field>
  );
}

function parseObject(form: FormData, name: string): Record<string, unknown> {
  const raw = String(form.get(name) ?? '').trim() || '{}';
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`La sección “${name}” no contiene JSON válido.`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`La sección “${name}” debe ser un objeto JSON.`);
  }
  return parsed as Record<string, unknown>;
}

export default SettingsPage;
