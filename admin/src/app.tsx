import { lazy } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/app-shell';
import { ProtectedRoute, RoleRoute } from '@/components/protected-route';
import { LoginPage } from '@/pages/login-page';
import { NotFoundPage } from '@/pages/not-found-page';

const AuditPage = lazy(() =>
  import('@/pages/audit-page').then(({ AuditPage }) => ({
    default: AuditPage,
  })),
);
const CampaignEditorPage = lazy(() =>
  import('@/pages/campaign-editor-page').then(({ CampaignEditorPage }) => ({
    default: CampaignEditorPage,
  })),
);
const CampaignsPage = lazy(() =>
  import('@/pages/campaigns-page').then(({ CampaignsPage }) => ({
    default: CampaignsPage,
  })),
);
const CategoriesPage = lazy(() =>
  import('@/pages/categories-page').then(({ CategoriesPage }) => ({
    default: CategoriesPage,
  })),
);
const DashboardPage = lazy(() =>
  import('@/pages/dashboard-page').then(({ DashboardPage }) => ({
    default: DashboardPage,
  })),
);
const DrawsPage = lazy(() =>
  import('@/pages/draws-page').then(({ DrawsPage }) => ({
    default: DrawsPage,
  })),
);
const MediaPage = lazy(() =>
  import('@/pages/media-page').then(({ MediaPage }) => ({
    default: MediaPage,
  })),
);
const NotificationsPage = lazy(() =>
  import('@/pages/notifications-page').then(({ NotificationsPage }) => ({
    default: NotificationsPage,
  })),
);
const OrderDetailPage = lazy(() =>
  import('@/pages/order-detail-page').then(({ OrderDetailPage }) => ({
    default: OrderDetailPage,
  })),
);
const OrdersPage = lazy(() =>
  import('@/pages/orders-page').then(({ OrdersPage }) => ({
    default: OrdersPage,
  })),
);
const PaymentDetailPage = lazy(() =>
  import('@/pages/payment-detail-page').then(({ PaymentDetailPage }) => ({
    default: PaymentDetailPage,
  })),
);
const PaymentsPage = lazy(() =>
  import('@/pages/payments-page').then(({ PaymentsPage }) => ({
    default: PaymentsPage,
  })),
);
const PrizesPage = lazy(() =>
  import('@/pages/prizes-page').then(({ PrizesPage }) => ({
    default: PrizesPage,
  })),
);
const ReferralsPage = lazy(() =>
  import('@/pages/referrals-page').then(({ ReferralsPage }) => ({
    default: ReferralsPage,
  })),
);
const SettingsPage = lazy(() =>
  import('@/pages/settings-page').then(({ SettingsPage }) => ({
    default: SettingsPage,
  })),
);
const UsersPage = lazy(() =>
  import('@/pages/users-page').then(({ UsersPage }) => ({
    default: UsersPage,
  })),
);

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="campaigns" element={<CampaignsPage />} />
          <Route path="campaigns/new" element={<CampaignEditorPage />} />
          <Route path="campaigns/:id" element={<CampaignEditorPage />} />
          <Route path="orders" element={<OrdersPage />} />
          <Route path="orders/:publicId" element={<OrderDetailPage />} />
          <Route path="payments" element={<PaymentsPage />} />
          <Route path="payments/:id" element={<PaymentDetailPage />} />
          <Route path="draws" element={<DrawsPage />} />
          <Route path="prizes" element={<PrizesPage />} />
          <Route path="referrals" element={<ReferralsPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="media" element={<MediaPage />} />
          <Route path="categories" element={<CategoriesPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route element={<RoleRoute roles={['admin']} />}>
            <Route path="users" element={<UsersPage />} />
            <Route path="audit" element={<AuditPage />} />
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
