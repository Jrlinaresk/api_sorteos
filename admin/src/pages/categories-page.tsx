import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Edit3, Plus, Search, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useToast } from '@/lib/toast-context';
import type { Category } from '@/lib/types';
import {
  ConfirmDialog,
  EmptyPanel,
  ErrorPanel,
  Field,
  LoadingPanel,
  Modal,
  ResourcePageHeader,
  errorMessage,
  idOf,
  optionalString,
  submitForm,
} from './resource-page-shared';

export function CategoriesPage() {
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const { showToast } = useToast();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);

  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get<Category[]>('/categories'),
  });

  const save = useMutation({
    mutationFn: (input: {
      id?: string;
      body: { name: string; description?: string };
    }) =>
      input.id
        ? api.patch<Category>(`/categories/${input.id}`, input.body)
        : api.post<Category>('/categories', input.body),
    onSuccess: async (_, input) => {
      await queryClient.invalidateQueries({ queryKey: ['categories'] });
      setEditing(null);
      showToast({
        tone: 'success',
        title: input.id ? 'Categoría actualizada' : 'Categoría creada',
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
    mutationFn: (id: string) => api.delete<void>(`/categories/${id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['categories'] });
      setDeleting(null);
      showToast({ tone: 'success', title: 'Categoría eliminada' });
    },
    onError: (error) =>
      showToast({
        tone: 'error',
        title: 'No se pudo eliminar',
        message: errorMessage(error),
      }),
  });

  const visible = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    if (!term) return categories.data ?? [];
    return (categories.data ?? []).filter((category) =>
      `${category.name} ${category.description ?? ''}`
        .toLocaleLowerCase()
        .includes(term),
    );
  }, [categories.data, search]);

  return (
    <main className="page">
      <ResourcePageHeader
        title="Categorías"
        description="Organiza las campañas sin dejar categorías referenciadas sin control."
        actions={
          can('operator', 'admin') ? (
            <button
              className="button button--primary"
              type="button"
              onClick={() => setEditing('new')}
            >
              <Plus aria-hidden="true" size={18} /> Nueva categoría
            </button>
          ) : null
        }
      />

      <section className="panel" aria-label="Listado de categorías">
        <div className="toolbar">
          <label className="search-field" htmlFor="category-search">
            <Search aria-hidden="true" size={18} />
            <span className="sr-only">Buscar categorías</span>
            <input
              id="category-search"
              type="search"
              placeholder="Buscar por nombre o descripción"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <span className="toolbar__meta">{visible.length} categorías</span>
        </div>

        {categories.isLoading ? <LoadingPanel /> : null}
        {categories.isError ? (
          <ErrorPanel
            error={categories.error}
            onRetry={() => categories.refetch()}
          />
        ) : null}
        {categories.isSuccess && visible.length === 0 ? (
          <EmptyPanel
            title={search ? 'Sin coincidencias' : 'Todavía no hay categorías'}
            description={
              search
                ? 'Prueba con otro término.'
                : 'Crea la primera para clasificar tus campañas.'
            }
          />
        ) : null}
        {visible.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Descripción</th>
                  <th className="table-actions">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((category) => (
                  <tr key={idOf(category)}>
                    <td>
                      <strong>{category.name}</strong>
                    </td>
                    <td>{category.description || '—'}</td>
                    <td className="table-actions">
                      {can('operator', 'admin') ? (
                        <button
                          className="icon-button"
                          type="button"
                          aria-label={`Editar ${category.name}`}
                          onClick={() => setEditing(category)}
                        >
                          <Edit3 aria-hidden="true" size={18} />
                        </button>
                      ) : null}
                      {can('admin') ? (
                        <button
                          className="icon-button icon-button--danger"
                          type="button"
                          aria-label={`Eliminar ${category.name}`}
                          onClick={() => setDeleting(category)}
                        >
                          <Trash2 aria-hidden="true" size={18} />
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {editing ? (
        <Modal
          title={editing === 'new' ? 'Nueva categoría' : 'Editar categoría'}
          description="El nombre debe ser único y tener entre 3 y 50 caracteres."
          onClose={() => !save.isPending && setEditing(null)}
        >
          <form
            onSubmit={(event) =>
              submitForm(event, (form) =>
                save.mutate({
                  id: editing === 'new' ? undefined : idOf(editing),
                  body: {
                    name: String(form.get('name') ?? '').trim(),
                    description: optionalString(form, 'description'),
                  },
                }),
              )
            }
          >
            <div className="form-grid form-grid--one">
              <Field label="Nombre" htmlFor="category-name" required>
                <input
                  id="category-name"
                  name="name"
                  required
                  minLength={3}
                  maxLength={50}
                  autoFocus
                  defaultValue={editing === 'new' ? '' : editing.name}
                />
              </Field>
              <Field
                label="Descripción"
                htmlFor="category-description"
                hint="Máximo 200 caracteres."
              >
                <textarea
                  id="category-description"
                  name="description"
                  rows={4}
                  maxLength={200}
                  defaultValue={editing === 'new' ? '' : editing.description}
                />
              </Field>
            </div>
            <div className="modal__actions">
              <button
                className="button button--secondary"
                type="button"
                onClick={() => setEditing(null)}
              >
                Cancelar
              </button>
              <button
                className="button button--primary"
                type="submit"
                disabled={save.isPending}
              >
                {save.isPending ? 'Guardando…' : 'Guardar categoría'}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title="Eliminar categoría"
          description={`Se eliminará “${deleting.name}”. El backend impedirá la operación si está asociada a una campaña.`}
          confirmLabel="Eliminar definitivamente"
          busy={remove.isPending}
          onClose={() => setDeleting(null)}
          onConfirm={() => remove.mutate(idOf(deleting))}
        />
      ) : null}
    </main>
  );
}

export default CategoriesPage;
