import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { CheckCircle2, CircleAlert, Info, X } from 'lucide-react';

type ToastTone = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  title: string;
  message?: string;
  tone: ToastTone;
}

interface ToastContextValue {
  showToast: (toast: Omit<ToastItem, 'id'>) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counter = useRef(0);
  const remove = useCallback((id: number) => {
    setToasts((items) => items.filter((item) => item.id !== id));
  }, []);
  const showToast = useCallback(
    (toast: Omit<ToastItem, 'id'>) => {
      const id = (counter.current += 1);
      setToasts((items) => [...items.slice(-3), { ...toast, id }]);
      window.setTimeout(() => remove(id), toast.tone === 'error' ? 8000 : 4500);
    },
    [remove],
  );
  const value = useMemo(() => ({ showToast }), [showToast]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-region" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => {
          const Icon =
            toast.tone === 'success'
              ? CheckCircle2
              : toast.tone === 'error'
                ? CircleAlert
                : Info;
          return (
            <div className={`toast toast--${toast.tone}`} key={toast.id}>
              <Icon aria-hidden="true" size={20} />
              <div>
                <strong>{toast.title}</strong>
                {toast.message ? <p>{toast.message}</p> : null}
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Cerrar notificación"
                onClick={() => remove(toast.id)}
              >
                <X size={17} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast debe usarse dentro de ToastProvider');
  return value;
}
