import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff, LoaderCircle, LockKeyhole, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

const schema = z.object({
  phone: z.string().trim().min(6, 'Escribe un teléfono válido'),
  password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres'),
});

type LoginValues = z.infer<typeof schema>;

export function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [showPassword, setShowPassword] = useState(false);
  const [requestError, setRequestError] = useState<{
    message: string;
    correlationId?: string;
  } | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({ resolver: zodResolver(schema) });

  if (auth.status === 'authenticated') return <Navigate to="/" replace />;

  const from = (location.state as { from?: { pathname?: string } } | null)?.from
    ?.pathname;
  const onSubmit = async (values: LoginValues) => {
    setRequestError(null);
    try {
      await auth.login(values.phone, values.password);
      navigate(from && from !== '/login' ? from : '/', { replace: true });
    } catch (error) {
      setRequestError({
        message:
          error instanceof Error
            ? error.message
            : 'No pudimos iniciar sesión. Revisa tus datos.',
        correlationId: error instanceof ApiError ? error.correlationId : undefined,
      });
    }
  };

  return (
    <main className="login-page">
      <section className="login-story" aria-label="Panel de administración de sorteos">
        <div className="login-story__glow" aria-hidden="true" />
        <div className="login-story__content">
          <span className="login-story__pill">
            <ShieldCheck size={17} aria-hidden="true" />
            Operación centralizada
          </span>
          <p className="eyebrow">Sorteos · Centro de control</p>
          <h1>Todo el negocio, bajo una sola operación.</h1>
          <p>
            Campañas, ventas, Pix, premios y trazabilidad en una interfaz conectada
            directamente al mismo backend.
          </p>
          <ul>
            <li><span>01</span> Visión financiera en tiempo real</li>
            <li><span>02</span> Flujos críticos protegidos por permisos</li>
            <li><span>03</span> Historial auditable de cada acción</li>
          </ul>
        </div>
        <p className="login-story__foot">Acceso exclusivo para el equipo autorizado</p>
      </section>
      <section className="login-panel">
        <div className="login-card">
          <header>
            <span className="brand-mark" aria-hidden="true">S</span>
            <div>
              <p className="eyebrow">Área segura</p>
              <h2>Bienvenido de nuevo</h2>
              <p>Ingresa con tu cuenta de operador o administrador.</p>
            </div>
          </header>
          <form onSubmit={handleSubmit(onSubmit)} noValidate>
            {requestError ? (
              <div className="form-error" role="alert">
                <strong>No se pudo iniciar sesión</strong>
                <span>{requestError.message}</span>
                {requestError.correlationId ? (
                  <small>Referencia: {requestError.correlationId}</small>
                ) : null}
              </div>
            ) : null}
            <label className="field">
              <span>Teléfono</span>
              <input
                {...register('phone')}
                type="tel"
                inputMode="tel"
                autoComplete="username"
                placeholder="Ej. +55 11 99999-9999"
                aria-invalid={Boolean(errors.phone)}
                aria-describedby={errors.phone ? 'phone-error' : undefined}
                autoFocus
              />
              {errors.phone ? <small id="phone-error" className="field-error">{errors.phone.message}</small> : null}
            </label>
            <label className="field">
              <span>Contraseña</span>
              <span className="input-with-action">
                <input
                  {...register('password')}
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Tu contraseña"
                  aria-invalid={Boolean(errors.password)}
                  aria-describedby={errors.password ? 'password-error' : undefined}
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  onClick={() => setShowPassword((visible) => !visible)}
                >
                  {showPassword ? <EyeOff size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />}
                </button>
              </span>
              {errors.password ? <small id="password-error" className="field-error">{errors.password.message}</small> : null}
            </label>
            <button className="button button--primary login-submit" type="submit" disabled={isSubmitting}>
              {isSubmitting ? <LoaderCircle className="spin" size={18} aria-hidden="true" /> : <LockKeyhole size={18} aria-hidden="true" />}
              {isSubmitting ? 'Verificando…' : 'Entrar al panel'}
            </button>
          </form>
          <footer>
            <ShieldCheck size={16} aria-hidden="true" />
            La renovación de sesión usa una cookie HttpOnly y no expone el token de larga duración al navegador.
          </footer>
        </div>
      </section>
    </main>
  );
}
