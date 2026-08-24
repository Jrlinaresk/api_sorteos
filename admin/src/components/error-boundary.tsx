import { Component, type ErrorInfo, type ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';

interface ErrorBoundaryState {
  failed: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<
  { children: ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { failed: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Admin panel render error', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="fatal-error">
        <span className="fatal-error__icon" aria-hidden="true">
          <CircleAlert />
        </span>
        <p className="eyebrow">Error de interfaz</p>
        <h1>El panel no pudo mostrar esta pantalla</h1>
        <p>
          Tus datos no se modificaron. Recarga la página para recuperar una sesión
          limpia.
        </p>
        {this.state.error?.message ? (
          <code>{this.state.error.message}</code>
        ) : null}
        <button className="button button--primary" onClick={() => window.location.reload()}>
          Recargar el panel
        </button>
      </main>
    );
  }
}
