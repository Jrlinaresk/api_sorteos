import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  CalendarClock,
  RefreshCw,
  Trash2,
  Trophy,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  Button,
  ConfirmDialog,
  InlineAlert,
  SectionCard,
  StatusBadge,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatDateTime, fromDateTimeLocal } from '@/lib/format';
import { statusLabel } from '@/lib/status';
import { useToast } from '@/lib/toast-context';
import type { Campaign, CampaignStatus } from '@/lib/types';
import { entityId } from '@/lib/types';

export interface AdminCampaign extends Campaign {
  allocationCursor?: number;
  contractLockedAt?: string;
  lifecycleExtensions?: Array<{
    previousClosesAt: string;
    closesAt: string;
    reason: string;
    extendedAt: string;
    extendedBy: string;
  }>;
}

interface CampaignTransitionsResponse {
  campaignId: string;
  status: CampaignStatus;
  allowedTransitions: CampaignStatus[];
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.correlationId
      ? `${error.message} · Referencia ${error.correlationId}`
      : error.message;
  }
  return error instanceof Error
    ? error.message
    : 'Ocurrió un error inesperado.';
}

export function campaignIdentifier(campaign: Campaign | string): string {
  return typeof campaign === 'string' ? campaign : entityId(campaign);
}

export function CampaignLifecyclePanel({
  campaign,
  onChanged,
  onDeleted,
}: {
  campaign: AdminCampaign;
  onChanged?: (campaign: AdminCampaign) => void;
  onDeleted?: () => void;
}) {
  const id = campaignIdentifier(campaign);
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const { showToast } = useToast();
  const [pendingTransition, setPendingTransition] =
    useState<CampaignStatus | null>(null);
  const [extensionDate, setExtensionDate] = useState('');
  const [extensionReason, setExtensionReason] = useState('');
  const [extensionError, setExtensionError] = useState('');
  const [confirmExtension, setConfirmExtension] = useState<{
    closesAt: string;
    reason: string;
  } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const transitionsQuery = useQuery({
    queryKey: ['campaigns', id, 'transitions'],
    queryFn: () =>
      api.get<CampaignTransitionsResponse>(
        `/admin/campaigns/${encodeURIComponent(id)}/transitions`,
      ),
    enabled: Boolean(id),
    staleTime: 15_000,
  });

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['campaigns'] }),
      queryClient.invalidateQueries({ queryKey: ['campaign', id] }),
      queryClient.invalidateQueries({
        queryKey: ['campaigns', id, 'transitions'],
      }),
      queryClient.invalidateQueries({ queryKey: ['draw', id] }),
    ]);
  };

  const transitionMutation = useMutation({
    mutationFn: (status: CampaignStatus) =>
      api.patch<AdminCampaign>(
        `/admin/campaigns/${encodeURIComponent(id)}/status`,
        { status },
      ),
    onSuccess: async (updated) => {
      setPendingTransition(null);
      onChanged?.(updated);
      showToast({
        tone: 'success',
        title: 'Estado actualizado',
        message: `${campaign.name} ahora está ${statusLabel(updated.status).toLowerCase()}.`,
      });
      await invalidate();
    },
    onError: (error) =>
      showToast({
        tone: 'error',
        title: 'No se pudo cambiar el estado',
        message: errorMessage(error),
      }),
  });

  const extensionMutation = useMutation({
    mutationFn: (payload: { closesAt: string; reason: string }) =>
      api.post<AdminCampaign>(
        `/admin/campaigns/${encodeURIComponent(id)}/extension`,
        payload,
      ),
    onSuccess: async (updated) => {
      setConfirmExtension(null);
      setExtensionDate('');
      setExtensionReason('');
      setExtensionError('');
      onChanged?.(updated);
      showToast({
        tone: 'success',
        title: 'Campaña prorrogada',
        message: `Las ventas se reabrieron hasta ${formatDateTime(updated.closesAt)}.`,
      });
      await invalidate();
    },
    onError: (error) =>
      showToast({
        tone: 'error',
        title: 'No se pudo aplicar la prórroga',
        message: errorMessage(error),
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: () =>
      api.delete<void>(`/admin/campaigns/${encodeURIComponent(id)}`),
    onSuccess: async () => {
      setConfirmDelete(false);
      showToast({
        tone: 'success',
        title: 'Campaña eliminada',
        message: `${campaign.name} fue eliminada definitivamente.`,
      });
      await invalidate();
      onDeleted?.();
    },
    onError: (error) =>
      showToast({
        tone: 'error',
        title: 'No se pudo eliminar la campaña',
        message: errorMessage(error),
      }),
  });

  const allowedTransitions =
    transitionsQuery.data?.allowedTransitions ??
    campaign.allowedTransitions ??
    [];
  const hasActivity =
    (campaign.allocationCursor ?? 0) > 0 ||
    campaign.soldCount > 0 ||
    campaign.reservedCount > 0;
  const isAdmin = can('admin');
  const prepareExtension = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const closesAt = fromDateTimeLocal(extensionDate);
    const reason = extensionReason.trim();
    if (!closesAt || new Date(closesAt).getTime() <= Date.now()) {
      setExtensionError('Selecciona una nueva fecha de cierre futura.');
      return;
    }
    if (!reason) {
      setExtensionError('Explica el motivo administrativo de la prórroga.');
      return;
    }
    setExtensionError('');
    setConfirmExtension({ closesAt, reason });
  };

  return (
    <div className="campaign-lifecycle-stack">
      <SectionCard
        title="Ciclo de vida"
        description="Las acciones se calculan en el servidor para el estado actual."
        actions={
          <StatusBadge
            status={transitionsQuery.data?.status ?? campaign.status}
          />
        }
      >
        {transitionsQuery.isError ? (
          <InlineAlert
            tone="danger"
            title="No se pudieron consultar las acciones"
          >
            <p>{errorMessage(transitionsQuery.error)}</p>
            <Button
              type="button"
              variant="secondary"
              onClick={() => transitionsQuery.refetch()}
            >
              <RefreshCw size={16} aria-hidden="true" />
              Reintentar
            </Button>
          </InlineAlert>
        ) : null}

        <div
          className="lifecycle-actions"
          aria-label="Transiciones disponibles"
        >
          {transitionsQuery.isLoading ? (
            <p className="muted-text" role="status">
              Consultando acciones disponibles…
            </p>
          ) : allowedTransitions.length ? (
            allowedTransitions.map((status) => (
              <Button
                key={status}
                type="button"
                variant={status === 'cancelled' ? 'danger' : 'secondary'}
                onClick={() => setPendingTransition(status)}
                disabled={transitionMutation.isPending}
              >
                <ArrowRight size={16} aria-hidden="true" />
                Pasar a {statusLabel(status).toLowerCase()}
              </Button>
            ))
          ) : (
            <p className="muted-text">
              No hay transiciones manuales disponibles.
            </p>
          )}
          <Link
            className="button button--ghost"
            to={`/draws?campaignId=${encodeURIComponent(id)}`}
          >
            <Trophy size={16} aria-hidden="true" />
            Gestionar sorteo
          </Link>
        </div>
      </SectionCard>

      {campaign.status === 'expired' ? (
        <SectionCard
          title="Prórroga administrativa"
          description="Reabre una campaña vencida y conserva actor, fecha y motivo."
        >
          {isAdmin ? (
            <form className="form-grid" onSubmit={prepareExtension} noValidate>
              <label className="field">
                <span>Nueva fecha de cierre</span>
                <input
                  type="datetime-local"
                  value={extensionDate}
                  onChange={(event) => setExtensionDate(event.target.value)}
                  required
                  aria-describedby={
                    extensionError ? 'campaign-extension-error' : undefined
                  }
                />
              </label>
              <label className="field field--wide">
                <span>Motivo de la prórroga</span>
                <textarea
                  rows={3}
                  maxLength={500}
                  value={extensionReason}
                  onChange={(event) => setExtensionReason(event.target.value)}
                  required
                  aria-describedby={
                    extensionError ? 'campaign-extension-error' : undefined
                  }
                />
              </label>
              {extensionError ? (
                <p
                  id="campaign-extension-error"
                  className="field-error"
                  role="alert"
                >
                  {extensionError}
                </p>
              ) : null}
              <div className="form-actions field--wide">
                <Button type="submit">
                  <CalendarClock size={17} aria-hidden="true" />
                  Revisar prórroga
                </Button>
              </div>
            </form>
          ) : (
            <InlineAlert tone="info" title="Acción reservada a administradores">
              Un operador puede consultar la campaña, pero no reabrir sus
              ventas.
            </InlineAlert>
          )}
        </SectionCard>
      ) : null}

      <SectionCard
        title="Zona de riesgo"
        description="La eliminación física solo es posible antes de cualquier reserva o venta."
      >
        {hasActivity ? (
          <InlineAlert tone="warning" title="Esta campaña ya tiene actividad">
            No puede eliminarse. Utiliza el ciclo de cancelación y reembolso que
            corresponda.
          </InlineAlert>
        ) : null}
        <Button
          type="button"
          variant="danger"
          disabled={hasActivity}
          onClick={() => setConfirmDelete(true)}
        >
          <Trash2 size={17} aria-hidden="true" />
          Eliminar campaña
        </Button>
      </SectionCard>

      <ConfirmDialog
        open={Boolean(pendingTransition)}
        title="Confirmar cambio de estado"
        description={
          <p>
            Vas a cambiar <strong>{campaign.name}</strong> de{' '}
            <strong>{statusLabel(campaign.status)}</strong> a{' '}
            <strong>{statusLabel(pendingTransition ?? undefined)}</strong>. El
            servidor volverá a validar ventas, reservas y configuración.
          </p>
        }
        confirmLabel="Cambiar estado"
        danger={pendingTransition === 'cancelled'}
        confirmationText={
          pendingTransition === 'cancelled' ? campaign.slug : undefined
        }
        busy={transitionMutation.isPending}
        onClose={() => setPendingTransition(null)}
        onConfirm={() => {
          if (pendingTransition) transitionMutation.mutate(pendingTransition);
        }}
      />

      <ConfirmDialog
        open={Boolean(confirmExtension)}
        title="Confirmar prórroga excepcional"
        description={
          confirmExtension ? (
            <div>
              <p>
                Las ventas se reabrirán hasta{' '}
                <strong>{formatDateTime(confirmExtension.closesAt)}</strong>.
              </p>
              <p>Motivo: {confirmExtension.reason}</p>
            </div>
          ) : (
            <span />
          )
        }
        confirmLabel="Prorrogar y reabrir"
        busy={extensionMutation.isPending}
        onClose={() => setConfirmExtension(null)}
        onConfirm={() => {
          if (confirmExtension) extensionMutation.mutate(confirmExtension);
        }}
      />

      <ConfirmDialog
        open={confirmDelete}
        title="Eliminar campaña definitivamente"
        description={
          <p>
            Esta acción elimina <strong>{campaign.name}</strong> y no puede
            deshacerse.
          </p>
        }
        confirmLabel="Eliminar definitivamente"
        confirmationText={campaign.slug}
        danger
        busy={deleteMutation.isPending}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => deleteMutation.mutate()}
      />
    </div>
  );
}
