import { LoaderCircle } from 'lucide-react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/auth-context';
import type { UserRole } from '@/lib/types';

export function ProtectedRoute() {
  const auth = useAuth();
  const location = useLocation();

  if (auth.status === 'loading') {
    return (
      <main className="session-loading" aria-busy="true">
        <div className="brand-mark" aria-hidden="true">S</div>
        <LoaderCircle className="spin" aria-hidden="true" />
        <p>Preparando tu sesión segura…</p>
      </main>
    );
  }

  if (auth.status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}

export function RoleRoute({ roles }: { roles: UserRole[] }) {
  const { can } = useAuth();
  return can(...roles) ? <Outlet /> : <Navigate to="/" replace />;
}
