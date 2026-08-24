import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Edit3,
  Plus,
  Search,
  Trash2,
  UserRoundCheck,
  UserRoundX,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatDateTime } from '@/lib/format';
import { useToast } from '@/lib/toast-context';
import type { AdminUser, DataPage, UserRole } from '@/lib/types';
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
  errorMessage,
  optionalString,
  submitForm,
} from './resource-page-shared';

interface UserInput {
  phone: string;
  nickname?: string;
  name?: string;
  cpf?: string;
  email?: string;
  password?: string;
  role: UserRole;
  address?: string;
  isActive?: boolean;
}

export function UsersPage() {
  const queryClient = useQueryClient();
  const { can, user: currentUser } = useAuth();
  const { showToast } = useToast();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<AdminUser | 'new' | null>(null);
  const [deleting, setDeleting] = useState<AdminUser | null>(null);
  const limit = 25;

  const users = useQuery({
    queryKey: ['users', page, limit],
    queryFn: () =>
      api.get<DataPage<AdminUser>>('/users', { query: { page, limit } }),
    enabled: can('admin'),
  });

  const save = useMutation({
    mutationFn: (input: { id?: string; body: UserInput }) =>
      input.id
        ? api.patch<AdminUser>(`/users/${input.id}`, input.body)
        : api.post<AdminUser>('/users', input.body),
    onSuccess: async (_, input) => {
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      setEditing(null);
      showToast({
        tone: 'success',
        title: input.id ? 'Usuario actualizado' : 'Usuario creado',
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
    mutationFn: (id: string) => api.delete<void>(`/users/${id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      setDeleting(null);
      showToast({ tone: 'success', title: 'Usuario eliminado' });
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
    if (!term) return users.data?.data ?? [];
    return (users.data?.data ?? []).filter((user) =>
      [user.name, user.nickname, user.phone, user.email, user.cpf, user.role]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase()
        .includes(term),
    );
  }, [search, users.data]);

  if (!can('admin')) {
    return (
      <main className="page">
        <ResourcePageHeader
          title="Usuarios"
          description="Administración de cuentas y permisos."
        />
        <AccessDenied message="Solo un administrador puede consultar o modificar usuarios." />
      </main>
    );
  }

  return (
    <main className="page">
      <ResourcePageHeader
        title="Usuarios"
        description="Crea cuentas internas, asigna roles y bloquea accesos cuando sea necesario."
        actions={
          <button
            className="button button--primary"
            type="button"
            onClick={() => setEditing('new')}
          >
            <Plus aria-hidden="true" size={18} /> Nuevo usuario
          </button>
        }
      />

      <section className="panel" aria-label="Listado de usuarios">
        <div className="toolbar">
          <label className="search-field" htmlFor="user-search">
            <Search aria-hidden="true" size={18} />
            <span className="sr-only">Filtrar la página actual</span>
            <input
              id="user-search"
              type="search"
              placeholder="Filtrar esta página"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <span className="toolbar__meta">
            {users.data?.meta.total ?? 0} cuentas
          </span>
        </div>

        {users.isLoading ? <LoadingPanel /> : null}
        {users.isError ? (
          <ErrorPanel error={users.error} onRetry={() => users.refetch()} />
        ) : null}
        {users.isSuccess && visible.length === 0 ? (
          <EmptyPanel
            title={
              search ? 'Sin coincidencias en esta página' : 'No hay usuarios'
            }
            description={
              search
                ? 'Limpia el filtro o cambia de página.'
                : 'Crea una cuenta para comenzar.'
            }
          />
        ) : null}
        {visible.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Usuario</th>
                  <th>Contacto</th>
                  <th>Rol</th>
                  <th>Acceso</th>
                  <th>Creado</th>
                  <th className="table-actions">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <strong>
                        {user.name || user.nickname || 'Sin nombre'}
                      </strong>
                      {user.id === currentUser?.id ? (
                        <small className="table-note">Tu cuenta</small>
                      ) : null}
                    </td>
                    <td>
                      <span>{user.phone}</span>
                      {user.email ? (
                        <small className="table-note">{user.email}</small>
                      ) : null}
                    </td>
                    <td>
                      <span className="role-pill">{roleLabel(user.role)}</span>
                    </td>
                    <td>
                      <span
                        className={
                          user.isActive
                            ? 'inline-state inline-state--positive'
                            : 'inline-state inline-state--negative'
                        }
                      >
                        {user.isActive ? (
                          <UserRoundCheck aria-hidden="true" size={17} />
                        ) : (
                          <UserRoundX aria-hidden="true" size={17} />
                        )}
                        {user.isActive ? 'Activo' : 'Bloqueado'}
                      </span>
                    </td>
                    <td>{formatDateTime(user.createdAt)}</td>
                    <td className="table-actions">
                      <button
                        className="icon-button"
                        type="button"
                        aria-label={`Editar ${user.name || user.phone}`}
                        onClick={() => setEditing(user)}
                      >
                        <Edit3 aria-hidden="true" size={18} />
                      </button>
                      <button
                        className="icon-button icon-button--danger"
                        type="button"
                        disabled={user.id === currentUser?.id}
                        aria-label={`Eliminar ${user.name || user.phone}`}
                        title={
                          user.id === currentUser?.id
                            ? 'No puedes eliminar tu propia sesión'
                            : undefined
                        }
                        onClick={() => setDeleting(user)}
                      >
                        <Trash2 aria-hidden="true" size={18} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {users.data ? (
          <Pagination
            page={users.data.meta.page}
            limit={users.data.meta.limit}
            total={users.data.meta.total}
            pages={users.data.meta.pages}
            onPageChange={setPage}
          />
        ) : null}
      </section>

      {editing ? (
        <UserEditor
          user={editing}
          busy={save.isPending}
          onClose={() => !save.isPending && setEditing(null)}
          onSave={(body) =>
            save.mutate({
              id: editing === 'new' ? undefined : editing.id,
              body,
            })
          }
        />
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title="Eliminar usuario"
          description={`Se eliminará la cuenta ${deleting.name || deleting.phone}. Esta acción puede fallar si existen relaciones que deban conservarse.`}
          confirmLabel="Eliminar cuenta"
          busy={remove.isPending}
          onClose={() => setDeleting(null)}
          onConfirm={() => remove.mutate(deleting.id)}
        />
      ) : null}
    </main>
  );
}

function UserEditor({
  user,
  busy,
  onSave,
  onClose,
}: {
  user: AdminUser | 'new';
  busy: boolean;
  onSave: (input: UserInput) => void;
  onClose: () => void;
}) {
  const creating = user === 'new';
  const existing = creating ? null : user;
  return (
    <Modal
      title={creating ? 'Nuevo usuario' : 'Editar usuario'}
      description="Las cuentas operator y admin pueden entrar al panel según sus permisos."
      onClose={onClose}
      wide
    >
      <form
        onSubmit={(event) =>
          submitForm(event, (form) => {
            const body: UserInput = {
              phone: String(form.get('phone') ?? '').trim(),
              nickname: optionalString(form, 'nickname'),
              name: optionalString(form, 'name'),
              cpf: optionalString(form, 'cpf'),
              email: optionalString(form, 'email'),
              password: optionalString(form, 'password'),
              role: String(form.get('role')) as UserRole,
              address: optionalString(form, 'address'),
              ...(creating ? {} : { isActive: form.get('isActive') === 'on' }),
            };
            onSave(body);
          })
        }
      >
        <div className="form-grid">
          <Field
            label="Teléfono"
            htmlFor="user-phone"
            required
            hint="De 8 a 15 dígitos; acepta formato internacional."
          >
            <input
              id="user-phone"
              name="phone"
              required
              autoFocus
              defaultValue={existing?.phone}
            />
          </Field>
          <Field label="Rol" htmlFor="user-role" required>
            <select
              id="user-role"
              name="role"
              required
              defaultValue={existing?.role ?? 'customer'}
            >
              <option value="customer">Cliente</option>
              <option value="operator">Operador</option>
              <option value="admin">Administrador</option>
            </select>
          </Field>
          <Field label="Nombre" htmlFor="user-name">
            <input
              id="user-name"
              name="name"
              minLength={2}
              maxLength={120}
              defaultValue={existing?.name}
            />
          </Field>
          <Field label="Apodo" htmlFor="user-nickname">
            <input
              id="user-nickname"
              name="nickname"
              minLength={2}
              maxLength={50}
              defaultValue={existing?.nickname}
            />
          </Field>
          <Field label="Correo" htmlFor="user-email">
            <input
              id="user-email"
              name="email"
              type="email"
              maxLength={150}
              defaultValue={existing?.email}
            />
          </Field>
          <Field label="CPF" htmlFor="user-cpf">
            <input
              id="user-cpf"
              name="cpf"
              defaultValue={existing?.cpf}
              placeholder="529.982.247-25"
            />
          </Field>
          <Field
            label={creating ? 'Contraseña' : 'Nueva contraseña'}
            htmlFor="user-password"
            hint="8–72 caracteres, con mayúscula, minúscula y número. Déjala vacía para conservarla."
          >
            <input
              id="user-password"
              name="password"
              type="password"
              minLength={8}
              maxLength={72}
              autoComplete="new-password"
            />
          </Field>
          <Field label="Dirección" htmlFor="user-address">
            <input
              id="user-address"
              name="address"
              maxLength={250}
              defaultValue={existing?.address}
            />
          </Field>
        </div>
        {!creating ? (
          <label className="check-field">
            <input
              name="isActive"
              type="checkbox"
              defaultChecked={existing?.isActive}
            />
            <span>Permitir que esta cuenta inicie sesión</span>
          </label>
        ) : null}
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
            {busy
              ? 'Guardando…'
              : creating
                ? 'Crear usuario'
                : 'Guardar cambios'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function roleLabel(role: UserRole) {
  if (role === 'admin') return 'Administrador';
  if (role === 'operator') return 'Operador';
  return 'Cliente';
}

export default UsersPage;
