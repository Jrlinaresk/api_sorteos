import { Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/app-shell';
import { ProtectedRoute, RoleRoute } from '@/components/protected-route';
import { AuditPage } from '@/pages/audit-page';
import { CampaignEditorPage } from '@/pages/campaign-editor-page';
import { CampaignsPage } from '@/pages/campaigns-page';
import { CategoriesPage } from '@/pages/categories-page';
import { DashboardPage } from '@/pages/dashboard-page';
import { DrawsPage } from '@/pages/draws-page';
import { LoginPage } from '@/pages/login-page';
import { MediaPage } from '@/pages/media-page';
import { NotFoundPage } from '@/pages/not-found-page';
import { NotificationsPage } from '@/pages/notifications-page';
import { OrderDetailPage } from '@/pages/order-detail-page';
import { OrdersPage } from '@/pages/orders-page';
import { PaymentDetailPage } from '@/pages/payment-detail-page';
import { PaymentsPage } from '@/pages/payments-page';
import { PrizesPage } from '@/pages/prizes-page';
import { ReferralsPage } from '@/pages/referrals-page';
import { SettingsPage } from '@/pages/settings-page';
import { UsersPage } from '@/pages/users-page';

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
