import {
  Bell,
  ChevronRight,
  CircleDollarSign,
  CreditCard,
  Dices,
  Image,
  LayoutDashboard,
  LogOut,
  Menu,
  ScrollText,
  Settings,
  ShoppingCart,
  Tags,
  Ticket,
  Trophy,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth-context';
import { useToast } from '@/lib/toast-context';
import type { UserRole } from '@/lib/types';

interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
  roles?: UserRole[];
}

const navSections: Array<{ label: string; items: NavItem[] }> = [
  {
    label: 'Operación',
    items: [
      { label: 'Resumen', path: '/', icon: LayoutDashboard },
      { label: 'Campañas', path: '/campaigns', icon: Ticket },
      { label: 'Pedidos', path: '/orders', icon: ShoppingCart },
      { label: 'Pagos', path: '/payments', icon: CreditCard },
      { label: 'Sorteos', path: '/draws', icon: Dices },
      { label: 'Premios', path: '/prizes', icon: Trophy },
    ],
  },
  {
    label: 'Crecimiento',
    items: [
      { label: 'Referidos', path: '/referrals', icon: CircleDollarSign },
      { label: 'Notificaciones', path: '/notifications', icon: Bell },
      { label: 'Biblioteca', path: '/media', icon: Image },
    ],
  },
  {
    label: 'Sistema',
    items: [
      { label: 'Categorías', path: '/categories', icon: Tags },
      { label: 'Configuración', path: '/settings', icon: Settings },
      { label: 'Usuarios', path: '/users', icon: Users, roles: ['admin'] },
      { label: 'Auditoría', path: '/audit', icon: ScrollText, roles: ['admin'] },
    ],
  },
];

const pathLabels: Record<string, string> = {
  campaigns: 'Campañas',
  new: 'Nueva campaña',
  orders: 'Pedidos',
  payments: 'Pagos',
  draws: 'Sorteos',
  prizes: 'Premios',
  referrals: 'Referidos',
  notifications: 'Notificaciones',
  media: 'Biblioteca',
  categories: 'Categorías',
  settings: 'Configuración',
  users: 'Usuarios',
  audit: 'Auditoría',
};

export function AppShell() {
  const { user, can, logout } = useAuth();
  const { showToast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const segments = useMemo(
    () => location.pathname.split('/').filter(Boolean),
    [location.pathname],
  );
  const currentTitle =
    pathLabels[segments[0] ?? ''] ?? (segments.length ? 'Detalle' : 'Resumen');
  const displayName = user?.name || user?.nickname || user?.phone || 'Operador';
  const initials = displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
      navigate('/login', { replace: true });
    } catch (error) {
      showToast({
        tone: 'error',
        title: 'No se pudo cerrar la sesión',
        message: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Saltar al contenido</a>
      {sidebarOpen ? (
        <button
          className="sidebar-scrim"
          type="button"
          aria-label="Cerrar navegación"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}
      <aside className={`sidebar ${sidebarOpen ? 'sidebar--open' : ''}`} aria-label="Navegación principal">
        <div className="sidebar__brand">
          <span className="brand-mark" aria-hidden="true">S</span>
          <div>
            <strong>Sorteos</strong>
            <span>Centro de control</span>
          </div>
          <button
            className="icon-button sidebar__close"
            type="button"
            aria-label="Cerrar menú"
            onClick={() => setSidebarOpen(false)}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <nav className="sidebar__nav">
          {navSections.map((section) => {
            const items = section.items.filter(
              (item) => !item.roles || can(...item.roles),
            );
            if (!items.length) return null;
            return (
              <div className="nav-section" key={section.label}>
                <p>{section.label}</p>
                {items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      end={item.path === '/'}
                      onClick={() => setSidebarOpen(false)}
                      className={({ isActive }) =>
                        `nav-link ${isActive ? 'nav-link--active' : ''}`
                      }
                    >
                      <Icon size={19} strokeWidth={1.8} aria-hidden="true" />
                      <span>{item.label}</span>
                    </NavLink>
                  );
                })}
              </div>
            );
          })}
        </nav>
        <div className="sidebar__footer">
          <div className="user-chip">
            <span className="avatar" aria-hidden="true">{initials || 'OP'}</span>
            <div>
              <strong>{displayName}</strong>
              <span>{user?.role === 'admin' ? 'Administrador' : 'Operador'}</span>
            </div>
          </div>
          <button
            className="logout-button"
            type="button"
            onClick={handleLogout}
            disabled={loggingOut}
          >
            <LogOut size={18} aria-hidden="true" />
            {loggingOut ? 'Cerrando…' : 'Cerrar sesión'}
          </button>
        </div>
      </aside>
      <div className="app-shell__content">
        <header className="topbar">
          <button
            className="icon-button topbar__menu"
            type="button"
            aria-label="Abrir menú"
            aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen(true)}
          >
            <Menu size={22} aria-hidden="true" />
          </button>
          <nav className="breadcrumbs" aria-label="Migas de pan">
            <NavLink to="/">Panel</NavLink>
            {segments.length ? <ChevronRight size={15} aria-hidden="true" /> : null}
            {segments.length ? <span aria-current="page">{currentTitle}</span> : null}
          </nav>
          <div className="topbar__identity">
            <span className="topbar__status"><i /> Sesión protegida</span>
            <span className="avatar" aria-hidden="true">{initials || 'OP'}</span>
          </div>
        </header>
        <main id="main-content" className="page-content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
