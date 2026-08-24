import { AlertCircle, LoaderCircle, X } from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  type FormEvent,
  type ReactNode,
} from 'react';
import { ApiError } from '@/lib/api';
import { statusLabel, statusTone } from '@/lib/status';

export function ResourcePageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions ? <div className="page-header__actions">{actions}</div> : null}
    </header>
  );
}

export function LoadingPanel({
  label = 'Cargando datos…',
}: {
  label?: string;
}) {
  return (
    <div className="state-panel state-panel--loading" role="status">
      <LoaderCircle className="spin" aria-hidden="true" size={22} />
      <span>{label}</span>
    </div>
  );
}

export function ErrorPanel({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  const apiError = error instanceof ApiError ? error : null;
  const message =
    error instanceof Error ? error.message : 'No se pudieron cargar los datos.';
  return (
    <div className="state-panel state-panel--error" role="alert">
      <AlertCircle aria-hidden="true" size={22} />
      <div>
        <strong>Ocurrió un problema</strong>
        <p>{message}</p>
        {apiError?.correlationId ? (
          <small>Referencia: {apiError.correlationId}</small>
        ) : null}
      </div>
      {onRetry ? (
        <button
          className="button button--secondary"
          type="button"
          onClick={onRetry}
        >
          Reintentar
        </button>
      ) : null}
    </div>
  );
}

export function EmptyPanel({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function StatusBadge({ status }: { status?: string }) {
  return (
    <span className={`status-badge status-badge--${statusTone(status)}`}>
      {statusLabel(status)}
    </span>
  );
}

export function Pagination({
  page,
  total,
  limit,
  pages,
  onPageChange,
}: {
  page: number;
  total: number;
  limit: number;
  pages?: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, pages ?? Math.ceil(total / limit));
  const start = total ? (page - 1) * limit + 1 : 0;
  const end = Math.min(page * limit, total);
  return (
    <nav className="pagination" aria-label="Paginación">
      <p>
        {start}–{end} de {total}
      </p>
      <div>
        <button
          className="button button--secondary"
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Anterior
        </button>
        <span aria-current="page">
          Página {page} de {totalPages}
        </span>
        <button
          className="button button--secondary"
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Siguiente
        </button>
      </div>
    </nav>
  );
}

export function Modal({
  title,
  description,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const focusHandle = window.requestAnimationFrame(() => {
      dialogRef.current
        ?.querySelector<HTMLElement>(
          '[autofocus], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)',
        )
        ?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusHandle);
      document.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className={`modal${wide ? ' modal--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal__header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description ? <p id={descriptionId}>{description}</p> : null}
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Cerrar"
            onClick={onClose}
          >
            <X aria-hidden="true" size={20} />
          </button>
        </header>
        <div className="modal__body">{children}</div>
      </section>
    </div>
  );
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  busy,
  danger = true,
  onConfirm,
  onClose,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  busy?: boolean;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title={title} description={description} onClose={onClose}>
      <div className="modal__actions">
        <button
          className="button button--secondary"
          type="button"
          onClick={onClose}
        >
          Cancelar
        </button>
        <button
          className={`button ${danger ? 'button--danger' : 'button--primary'}`}
          type="button"
          disabled={busy}
          onClick={onConfirm}
        >
          {busy ? 'Procesando…' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export function AccessDenied({ message }: { message: string }) {
  return (
    <div className="state-panel state-panel--error" role="alert">
      <AlertCircle aria-hidden="true" size={22} />
      <div>
        <strong>Acceso restringido</strong>
        <p>{message}</p>
      </div>
    </div>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  required,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {children}
      {hint ? <small>{hint}</small> : null}
    </div>
  );
}

export function submitForm(
  event: FormEvent<HTMLFormElement>,
  action: (form: FormData) => void,
) {
  event.preventDefault();
  action(new FormData(event.currentTarget));
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Error inesperado';
}

export function optionalString(form: FormData, key: string) {
  const value = String(form.get(key) ?? '').trim();
  return value || undefined;
}

export function numberValue(form: FormData, key: string, fallback = 0) {
  const value = Number(form.get(key));
  return Number.isFinite(value) ? value : fallback;
}

export function idOf(value: { id?: string; _id?: string }): string {
  return value.id ?? value._id ?? '';
}
