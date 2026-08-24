import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Inbox,
  LoaderCircle,
  X,
} from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import { ApiError } from '@/lib/api';
import { statusLabel, statusTone } from '@/lib/status';

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-header__copy">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {description ? <p className="page-header__description">{description}</p> : null}
      </div>
      {actions ? <div className="page-header__actions">{actions}</div> : null}
    </header>
  );
}

export function SectionCard({
  title,
  description,
  actions,
  children,
  className = '',
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`section-card ${className}`.trim()}>
      {title || description || actions ? (
        <header className="section-card__header">
          <div>
            {title ? <h2>{title}</h2> : null}
            {description ? <p>{description}</p> : null}
          </div>
          {actions ? <div className="section-card__actions">{actions}</div> : null}
        </header>
      ) : null}
      <div className="section-card__body">{children}</div>
    </section>
  );
}

export function StatusBadge({ status }: { status?: string }) {
  return (
    <span className={`status-badge status-badge--${statusTone(status)}`}>
      <span aria-hidden="true" className="status-badge__dot" />
      {statusLabel(status)}
    </span>
  );
}

export function Button({
  variant = 'primary',
  busy = false,
  children,
  disabled,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  busy?: boolean;
}) {
  return (
    <button
      className={`button button--${variant} ${className}`.trim()}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...props}
    >
      {busy ? <LoaderCircle className="spin" size={17} aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export function LoadingState({ label = 'Cargando información…' }: { label?: string }) {
  return (
    <div className="state-panel state-panel--loading" role="status">
      <LoaderCircle className="spin" aria-hidden="true" />
      <p>{label}</p>
    </div>
  );
}

export function EmptyState({
  title = 'Todavía no hay información',
  description,
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="state-panel state-panel--empty">
      <span className="state-panel__icon" aria-hidden="true">
        <Inbox />
      </span>
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {action ? <div>{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
  title = 'No pudimos cargar esta información',
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
}) {
  const message = error instanceof Error ? error.message : 'Ocurrió un error inesperado.';
  const correlationId = error instanceof ApiError ? error.correlationId : undefined;
  return (
    <div className="state-panel state-panel--error" role="alert">
      <span className="state-panel__icon" aria-hidden="true">
        <CircleAlert />
      </span>
      <h3>{title}</h3>
      <p>{message}</p>
      {correlationId ? (
        <p className="technical-reference">Referencia: {correlationId}</p>
      ) : null}
      {onRetry ? (
        <Button type="button" variant="secondary" onClick={onRetry}>
          Reintentar
        </Button>
      ) : null}
    </div>
  );
}

export function Pagination({
  page,
  totalPages,
  total,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  total?: number;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <nav className="pagination" aria-label="Paginación">
      <p>
        Página <strong>{page}</strong> de <strong>{totalPages}</strong>
        {typeof total === 'number' ? ` · ${total} registros` : ''}
      </p>
      <div>
        <Button
          type="button"
          variant="secondary"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label="Página anterior"
        >
          <ChevronLeft size={17} aria-hidden="true" />
          Anterior
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          aria-label="Página siguiente"
        >
          Siguiente
          <ChevronRight size={17} aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirmar',
  confirmationText,
  busy = false,
  danger = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  confirmationText?: string;
  busy?: boolean;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (!open) {
      setTyped('');
      return;
    }
    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [busy, onClose, open]);

  if (!open) return null;
  const valid = !confirmationText || typed.trim() === confirmationText;
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target && !busy) onClose();
    }}>
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <header className="dialog__header">
          <span className={`dialog__icon ${danger ? 'dialog__icon--danger' : ''}`} aria-hidden="true">
            <AlertTriangle />
          </span>
          <div>
            <h2 id={titleId}>{title}</h2>
            <div id={descriptionId} className="dialog__description">{description}</div>
          </div>
          <button
            ref={closeRef}
            className="icon-button"
            type="button"
            aria-label="Cerrar diálogo"
            onClick={onClose}
            disabled={busy}
          >
            <X size={19} aria-hidden="true" />
          </button>
        </header>
        {confirmationText ? (
          <label className="field">
            <span>
              Escribe <strong>{confirmationText}</strong> para continuar
            </span>
            <input
              autoComplete="off"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
            />
          </label>
        ) : null}
        <footer className="dialog__actions">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Volver
          </Button>
          <Button
            type="button"
            variant={danger ? 'danger' : 'primary'}
            onClick={onConfirm}
            disabled={!valid}
            busy={busy}
          >
            {confirmLabel}
          </Button>
        </footer>
      </div>
    </div>
  );
}

export function InlineAlert({
  tone = 'warning',
  title,
  children,
}: {
  tone?: 'warning' | 'danger' | 'info' | 'success';
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className={`inline-alert inline-alert--${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <CircleAlert size={19} aria-hidden="true" />
      <div>
        {title ? <strong>{title}</strong> : null}
        <div>{children}</div>
      </div>
    </div>
  );
}

export function DefinitionList({
  items,
}: {
  items: Array<{ label: string; value: ReactNode }>;
}) {
  return (
    <dl className="definition-list">
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value || '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
