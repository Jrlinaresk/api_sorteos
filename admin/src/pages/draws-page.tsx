import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeftRight,
  CheckCircle2,
  ExternalLink,
  FileCheck2,
  Fingerprint,
  KeyRound,
  Landmark,
  Search,
  ShieldAlert,
  Trophy,
} from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useForm, type FieldError } from 'react-hook-form';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import {
  Button,
  ConfirmDialog,
  DefinitionList,
  EmptyState,
  ErrorState,
  InlineAlert,
  LoadingState,
  PageHeader,
  SectionCard,
  StatusBadge,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { compactId, formatDateTime, formatInteger } from '@/lib/format';
import { statusLabel } from '@/lib/status';
import { useToast } from '@/lib/toast-context';
import type { DataPage, DrawMethod, DrawResult } from '@/lib/types';
import { entityId } from '@/lib/types';
import type { AdminCampaign } from './campaigns-lifecycle';

interface DrawCampaign extends AdminCampaign {
  drawCommitment?: string;
  drawCommittedAt?: string;
  drawCommittedBy?: string;
}

interface AdminDrawResult extends Omit<DrawResult, 'outcomes'> {
  extraction?: string;
  firstPrize?: string;
  secondPrize?: string;
  sourcePublishedAt?: string;
  sourceFetchedAt?: string;
  sourceConfirmedAt?: string;
  commitment?: string;
  revealedSecret?: string;
  externalEntropy?: string;
  entropyDigest?: string;
  rawEvidence?: Record<string, unknown>;
  outcomes: Array<{
    position: number;
    prizeTitle: string;
    winningNumber: string;
    quota?: string;
    order?: string;
    user?: string;
    winnerSnapshot?: { name: string; phone: string };
    winner?: { name: string; phone: string };
  }>;
}

interface CommitmentResponse {
  campaignId: string;
  commitment: string;
  committedAt: string;
  rule: string;
}

const drawMethodLabels: Record<DrawMethod, string> = {
  federal_lottery: 'Lotería Federal CAIXA',
  manual_external: 'Resultado externo manual',
  cryptographic: 'Criptográfico con baliza NIST',
};

const commitmentSchema = z.object({
  commitment: z
    .string()
    .trim()
    .regex(
      /^[a-f0-9]{64}$/,
      'Escribe un SHA-256 hexadecimal de 64 caracteres.',
    ),
});
const manualSchema = z.object({
  winningNumber: z
    .string()
    .trim()
    .regex(
      /^\d{1,12}$/,
      'El número ganador debe contener entre 1 y 12 dígitos.',
    ),
  evidenceUrl: z
    .string()
    .trim()
    .url('Escribe una URL válida.')
    .refine(
      (value) => value.startsWith('https://'),
      'La evidencia debe usar HTTPS.',
    ),
  explanation: z
    .string()
    .trim()
    .min(10, 'Describe cómo se obtuvo el resultado.')
    .max(500),
});
const revealSchema = z.object({
  reveal: z
    .string()
    .min(16, 'La revelación debe tener al menos 16 caracteres.')
    .max(500),
});

type CommitmentValues = z.infer<typeof commitmentSchema>;
type ManualValues = z.infer<typeof manualSchema>;
type RevealValues = z.infer<typeof revealSchema>;

function ErrorMessage({ error }: { error?: FieldError }) {
  return error ? (
    <span className="field-error" role="alert">
      {error.message}
    </span>
  ) : null;
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

function canRetryDraw(error: unknown, failureCount: number): boolean {
  return (
    !(error instanceof ApiError && error.status === 404) && failureCount < 2
  );
}

export function DrawsPage() {
  const { campaignId: routeCampaignId } = useParams<{ campaignId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = routeCampaignId || searchParams.get('campaignId') || '';
  const [campaignSearch, setCampaignSearch] = useState('');
  const [campaignSearchDraft, setCampaignSearchDraft] = useState('');
  const [publishConfirmation, setPublishConfirmation] = useState(false);
  const queryClient = useQueryClient();
  const { user, can } = useAuth();
  const { showToast } = useToast();

  const campaignsQuery = useQuery({
    queryKey: ['campaigns', 'draw-picker', campaignSearch],
    queryFn: () =>
      api.get<DataPage<DrawCampaign>>('/admin/campaigns/page', {
        query: {
          page: 1,
          limit: 100,
          search: campaignSearch || undefined,
        },
      }),
    staleTime: 15_000,
  });

  const campaignQuery = useQuery({
    queryKey: ['campaign', selectedId],
    queryFn: () =>
      api.get<DrawCampaign>(
        `/admin/campaigns/${encodeURIComponent(selectedId)}`,
      ),
    enabled: Boolean(selectedId),
  });

  const drawQuery = useQuery({
    queryKey: ['draw', selectedId],
    queryFn: async () => {
      try {
        return await api.get<AdminDrawResult>(
          `/admin/campaigns/${encodeURIComponent(selectedId)}/draw`,
        );
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
    enabled: Boolean(selectedId),
    retry: (failureCount, error) => canRetryDraw(error, failureCount),
  });

  const campaign = campaignQuery.data;
  const result = drawQuery.data;
  const isAdmin = can('admin');
  const fullySold = Boolean(
    campaign &&
    campaign.soldCount === campaign.totalTitles &&
    campaign.reservedCount === 0,
  );
  const drawable = Boolean(
    campaign &&
    fullySold &&
    ['sold_out', 'awaiting_draw'].includes(campaign.status),
  );

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['draw', selectedId] }),
      queryClient.invalidateQueries({ queryKey: ['campaign', selectedId] }),
      queryClient.invalidateQueries({ queryKey: ['campaigns'] }),
    ]);
  };

  const commitmentForm = useForm<CommitmentValues>({
    resolver: zodResolver(commitmentSchema),
    defaultValues: { commitment: '' },
  });
  const manualForm = useForm<ManualValues>({
    resolver: zodResolver(manualSchema),
    defaultValues: { winningNumber: '', evidenceUrl: '', explanation: '' },
  });
  const revealForm = useForm<RevealValues>({
    resolver: zodResolver(revealSchema),
    defaultValues: { reveal: '' },
  });

  useEffect(() => {
    commitmentForm.reset({ commitment: campaign?.drawCommitment ?? '' });
  }, [campaign?.drawCommitment, commitmentForm]);

  const commitmentMutation = useMutation({
    mutationFn: (values: CommitmentValues) =>
      api.post<CommitmentResponse>(
        `/admin/campaigns/${encodeURIComponent(selectedId)}/draw/cryptographic/commit`,
        { commitment: values.commitment.trim().toLowerCase() },
      ),
    onSuccess: async (committed) => {
      showToast({
        tone: 'success',
        title: 'Compromiso publicado',
        message: `Quedó fijado ${compactId(committed.commitment)} antes de las ventas.`,
      });
      await refresh();
    },
    onError: (error) =>
      showToast({
        tone: 'error',
        title: 'No se pudo fijar el compromiso',
        message: errorMessage(error),
      }),
  });

  const federalMutation = useMutation({
    mutationFn: () =>
      api.post<AdminDrawResult>(
        `/admin/campaigns/${encodeURIComponent(selectedId)}/draw/verify/federal-lottery`,
        {},
      ),
    onSuccess: async () => {
      showToast({
        tone: 'success',
        title: 'Resultado Federal verificado',
        message:
          'Las dos lecturas oficiales coincidieron y la evidencia quedó guardada.',
      });
      await refresh();
    },
    onError: (error) =>
      showToast({
        tone: 'error',
        title: 'No se pudo verificar CAIXA',
        message: errorMessage(error),
      }),
  });

  const manualMutation = useMutation({
    mutationFn: (values: ManualValues) =>
      api.post<AdminDrawResult>(
        `/admin/campaigns/${encodeURIComponent(selectedId)}/draw/verify/manual-external`,
        values,
      ),
    onSuccess: async () => {
      manualForm.reset();
      showToast({
        tone: 'success',
        title: 'Resultado externo verificado',
        message: 'El número y su evidencia quedaron bloqueados para revisión.',
      });
      await refresh();
    },
    onError: (error) =>
      showToast({
        tone: 'error',
        title: 'No se pudo registrar el resultado',
        message: errorMessage(error),
      }),
  });

  const cryptographicMutation = useMutation({
    mutationFn: (values: RevealValues) =>
      api.post<AdminDrawResult>(
        `/admin/campaigns/${encodeURIComponent(selectedId)}/draw/verify/cryptographic`,
        values,
      ),
    onSuccess: async () => {
      revealForm.reset();
      showToast({
        tone: 'success',
        title: 'Sorteo criptográfico verificado',
        message:
          'La revelación coincide con el compromiso y se combinó con la baliza externa.',
      });
      await refresh();
    },
    onError: (error) =>
      showToast({
        tone: 'error',
        title: 'No se pudo verificar la revelación',
        message: errorMessage(error),
      }),
  });

  const publishMutation = useMutation({
    mutationFn: () =>
      api.post<AdminDrawResult>(
        `/admin/campaigns/${encodeURIComponent(selectedId)}/draw/publish`,
      ),
    onSuccess: async () => {
      setPublishConfirmation(false);
      showToast({
        tone: 'success',
        title: 'Resultado publicado',
        message:
          'El resultado ya es público, inmutable y la campaña quedó sorteada.',
      });
      await refresh();
    },
    onError: (error) =>
      showToast({
        tone: 'error',
        title: 'No se pudo publicar el resultado',
        message: errorMessage(error),
      }),
  });

  const verifiedByCurrentUser = Boolean(
    result?.verifiedBy && user?.id && result.verifiedBy === user.id,
  );
  const canPublish = Boolean(
    isAdmin &&
    result?.status === 'verified' &&
    !verifiedByCurrentUser &&
    campaign?.status === 'awaiting_draw' &&
    fullySold,
  );

  const chooseCampaign = (campaignId: string) => {
    if (routeCampaignId) return;
    const next = new URLSearchParams(searchParams);
    if (campaignId) next.set('campaignId', campaignId);
    else next.delete('campaignId');
    setSearchParams(next, { replace: true });
  };

  const submitCampaignSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCampaignSearch(campaignSearchDraft.trim());
  };

  const pickerCampaigns = campaignsQuery.data?.data ?? [];
  const selectedIsMissing = Boolean(
    campaign && !pickerCampaigns.some((item) => entityId(item) === selectedId),
  );

  return (
    <main className="page-stack" id="draws-content">
      <PageHeader
        eyebrow="Resultado principal"
        title="Sorteos"
        description="Verifica evidencia, aplica separación de funciones y publica un resultado inmutable."
        actions={
          campaign ? (
            <Link
              className="button button--secondary"
              to={`/campaigns/${encodeURIComponent(selectedId)}`}
            >
              <ArrowLeftRight size={17} aria-hidden="true" />
              Abrir campaña
            </Link>
          ) : undefined
        }
      />

      <SectionCard
        title="Seleccionar campaña"
        description="La lista incluye borradores para poder fijar compromisos criptográficos antes de vender."
      >
        <form
          className="draw-picker"
          role="search"
          onSubmit={submitCampaignSearch}
        >
          <label className="field field--search">
            <span>Buscar</span>
            <span className="input-with-icon">
              <Search size={17} aria-hidden="true" />
              <input
                type="search"
                value={campaignSearchDraft}
                onChange={(event) => setCampaignSearchDraft(event.target.value)}
                placeholder="Nombre, premio o descripción"
                maxLength={100}
              />
            </span>
          </label>
          <Button type="submit" variant="secondary">
            Buscar
          </Button>
          <label className="field draw-picker__select">
            <span>Campaña</span>
            <select
              value={selectedId}
              onChange={(event) => chooseCampaign(event.target.value)}
              disabled={Boolean(routeCampaignId) || campaignsQuery.isLoading}
            >
              <option value="">Selecciona una campaña</option>
              {selectedIsMissing && campaign ? (
                <option value={selectedId}>
                  {campaign.name} · {statusLabel(campaign.status)}
                </option>
              ) : null}
              {pickerCampaigns.map((item) => (
                <option key={entityId(item)} value={entityId(item)}>
                  {item.name} · {statusLabel(item.status)}
                </option>
              ))}
            </select>
          </label>
        </form>
        {campaignsQuery.isError ? (
          <InlineAlert tone="danger" title="No se pudo cargar el selector">
            {errorMessage(campaignsQuery.error)}
          </InlineAlert>
        ) : null}
      </SectionCard>

      {!selectedId ? (
        <EmptyState
          title="Selecciona una campaña"
          description="Verás su método, preparación financiera, evidencia y acciones permitidas."
        />
      ) : campaignQuery.isLoading || drawQuery.isLoading ? (
        <LoadingState label="Cargando campaña y evidencia…" />
      ) : campaignQuery.isError ? (
        <ErrorState
          error={campaignQuery.error}
          onRetry={() => campaignQuery.refetch()}
        />
      ) : !campaign ? null : (
        <div className="draw-workspace">
          <div className="draw-workspace__main page-stack">
            <SectionCard
              title={campaign.name}
              description={drawMethodLabels[campaign.drawMethod]}
              actions={<StatusBadge status={campaign.status} />}
            >
              <DefinitionList
                items={[
                  { label: 'Premio', value: campaign.prizeTitle },
                  {
                    label: 'Títulos pagados',
                    value: `${formatInteger(campaign.soldCount)} / ${formatInteger(campaign.totalTitles)}`,
                  },
                  {
                    label: 'Reservas',
                    value: formatInteger(campaign.reservedCount),
                  },
                  {
                    label: 'Fecha del sorteo',
                    value: formatDateTime(campaign.drawDate),
                  },
                ]}
              />
              {!fullySold ? (
                <InlineAlert
                  tone="warning"
                  title="Aún no está listo para verificar"
                >
                  El backend exige el 100 % de títulos pagados y ninguna reserva
                  activa.
                </InlineAlert>
              ) : null}
            </SectionCard>

            {campaign.drawMethod === 'federal_lottery' ? (
              <SectionCard
                title="Verificación Federal"
                description="El servidor realiza dos lecturas independientes del concurso configurado."
              >
                <DefinitionList
                  items={[
                    {
                      label: 'Concurso',
                      value: campaign.federalLottery?.contest,
                    },
                    {
                      label: 'Regla',
                      value:
                        campaign.federalLottery?.combination === 'sum'
                          ? 'Suma modular'
                          : 'Concatenación de dígitos',
                    },
                  ]}
                />
                <Button
                  type="button"
                  onClick={() => federalMutation.mutate()}
                  busy={federalMutation.isPending}
                  disabled={!drawable || Boolean(result)}
                >
                  <Landmark size={17} aria-hidden="true" />
                  Conciliar y verificar CAIXA
                </Button>
              </SectionCard>
            ) : null}

            {campaign.drawMethod === 'manual_external' ? (
              <SectionCard
                title="Resultado externo manual"
                description="Solo un administrador puede registrar el número y la evidencia HTTPS."
              >
                {!isAdmin ? (
                  <InlineAlert
                    tone="info"
                    title="Acción reservada a administradores"
                  >
                    Como operador puedes consultar la evidencia, pero no
                    introducir un resultado manual.
                  </InlineAlert>
                ) : (
                  <form
                    className="form-grid"
                    onSubmit={manualForm.handleSubmit((values) =>
                      manualMutation.mutate(values),
                    )}
                    noValidate
                  >
                    <label className="field">
                      <span>Número ganador</span>
                      <input
                        {...manualForm.register('winningNumber')}
                        inputMode="numeric"
                      />
                      <ErrorMessage
                        error={manualForm.formState.errors.winningNumber}
                      />
                    </label>
                    <label className="field field--wide">
                      <span>URL de evidencia</span>
                      <input
                        {...manualForm.register('evidenceUrl')}
                        type="url"
                        placeholder="https://…"
                      />
                      <ErrorMessage
                        error={manualForm.formState.errors.evidenceUrl}
                      />
                    </label>
                    <label className="field field--wide">
                      <span>Explicación auditable</span>
                      <textarea
                        {...manualForm.register('explanation')}
                        rows={4}
                        maxLength={500}
                      />
                      <ErrorMessage
                        error={manualForm.formState.errors.explanation}
                      />
                    </label>
                    <div className="form-actions field--wide">
                      <Button
                        type="submit"
                        busy={manualMutation.isPending}
                        disabled={!drawable || Boolean(result)}
                      >
                        <FileCheck2 size={17} aria-hidden="true" />
                        Verificar resultado
                      </Button>
                    </div>
                  </form>
                )}
              </SectionCard>
            ) : null}

            {campaign.drawMethod === 'cryptographic' ? (
              <>
                <SectionCard
                  title="1. Compromiso previo"
                  description="Debe fijarse en borrador o programada, antes de abrir ventas."
                >
                  {campaign.drawCommitment ? (
                    <InlineAlert tone="success" title="Compromiso fijado">
                      <code>{campaign.drawCommitment}</code>
                      <p>
                        Publicado {formatDateTime(campaign.drawCommittedAt)}.
                      </p>
                    </InlineAlert>
                  ) : null}
                  <form
                    className="form-grid"
                    onSubmit={commitmentForm.handleSubmit((values) =>
                      commitmentMutation.mutate(values),
                    )}
                    noValidate
                  >
                    <label className="field field--wide">
                      <span>SHA-256 de campaignId:secreto</span>
                      <input
                        {...commitmentForm.register('commitment')}
                        autoComplete="off"
                        spellCheck={false}
                        maxLength={64}
                      />
                      <ErrorMessage
                        error={commitmentForm.formState.errors.commitment}
                      />
                    </label>
                    <div className="form-actions field--wide">
                      <Button
                        type="submit"
                        busy={commitmentMutation.isPending}
                        disabled={
                          !['draft', 'scheduled'].includes(campaign.status)
                        }
                      >
                        <Fingerprint size={17} aria-hidden="true" />
                        {campaign.drawCommitment
                          ? 'Confirmar compromiso'
                          : 'Publicar compromiso'}
                      </Button>
                    </div>
                  </form>
                </SectionCard>

                <SectionCard
                  title="2. Revelación y baliza"
                  description="La revelación debe coincidir y se mezcla con el pulso NIST comprometido por fecha."
                >
                  <form
                    className="form-grid"
                    onSubmit={revealForm.handleSubmit((values) =>
                      cryptographicMutation.mutate(values),
                    )}
                    noValidate
                  >
                    <label className="field field--wide">
                      <span>Secreto a revelar</span>
                      <textarea
                        {...revealForm.register('reveal')}
                        rows={3}
                        maxLength={500}
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <ErrorMessage
                        error={revealForm.formState.errors.reveal}
                      />
                    </label>
                    <div className="form-actions field--wide">
                      <Button
                        type="submit"
                        busy={cryptographicMutation.isPending}
                        disabled={
                          !drawable ||
                          !campaign.drawCommitment ||
                          Boolean(result)
                        }
                      >
                        <KeyRound size={17} aria-hidden="true" />
                        Revelar y verificar
                      </Button>
                    </div>
                  </form>
                </SectionCard>
              </>
            ) : null}

            {drawQuery.isError ? (
              <ErrorState
                error={drawQuery.error}
                onRetry={() => drawQuery.refetch()}
              />
            ) : result ? (
              <SectionCard
                title="Resultado y evidencia"
                description="Registro íntegro disponible para revisión antes y después de publicar."
                actions={<StatusBadge status={result.status} />}
              >
                <DefinitionList
                  items={[
                    { label: 'Método', value: drawMethodLabels[result.method] },
                    {
                      label: 'Verificado',
                      value: formatDateTime(result.verifiedAt),
                    },
                    {
                      label: 'Publicado',
                      value: formatDateTime(result.publishedAt),
                    },
                    {
                      label: 'Hash de evidencia',
                      value: <code>{result.evidenceHash}</code>,
                    },
                    { label: 'Regla', value: result.calculationRule },
                    {
                      label: 'Fuente',
                      value: result.sourceUrl ? (
                        <a
                          href={result.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Abrir evidencia{' '}
                          <ExternalLink size={14} aria-hidden="true" />
                        </a>
                      ) : null,
                    },
                  ]}
                />
                <div className="table-scroll">
                  <table className="data-table">
                    <caption className="sr-only">Resultados ganadores</caption>
                    <thead>
                      <tr>
                        <th scope="col">Posición</th>
                        <th scope="col">Premio</th>
                        <th scope="col">Título</th>
                        <th scope="col">Ganador</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.outcomes.map((outcome) => {
                        const winner = outcome.winnerSnapshot ?? outcome.winner;
                        return (
                          <tr
                            key={`${outcome.position}-${outcome.winningNumber}`}
                          >
                            <td>{outcome.position}</td>
                            <td>{outcome.prizeTitle}</td>
                            <td>
                              <code>{outcome.winningNumber}</code>
                            </td>
                            <td>
                              {winner
                                ? `${winner.name} · ${winner.phone}`
                                : 'Sin titular elegible'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {result.rawEvidence ? (
                  <details className="evidence-details">
                    <summary>Ver evidencia técnica completa</summary>
                    <pre>{JSON.stringify(result.rawEvidence, null, 2)}</pre>
                  </details>
                ) : null}
              </SectionCard>
            ) : (
              <InlineAlert tone="info" title="Aún no existe un resultado">
                Completa la verificación correspondiente al método de esta
                campaña.
              </InlineAlert>
            )}
          </div>

          <aside
            className="draw-workspace__aside"
            aria-label="Publicación del resultado"
          >
            <SectionCard
              title="Publicación"
              description="Es el punto irreversible del flujo y requiere un segundo administrador."
            >
              <InlineAlert tone="warning" title="Separación de funciones">
                Quien verificó el resultado no puede publicarlo. La publicación
                crea el premio principal y notifica al ganador.
              </InlineAlert>
              {verifiedByCurrentUser ? (
                <InlineAlert tone="danger" title="Necesitas otro administrador">
                  Tu usuario verificó este resultado; solicita a otra persona
                  administradora que lo publique.
                </InlineAlert>
              ) : null}
              {!isAdmin ? (
                <InlineAlert tone="info" title="Tu rol no publica resultados">
                  Los operadores pueden verificar métodos automáticos; solo
                  administradores publican.
                </InlineAlert>
              ) : null}
              <DefinitionList
                items={[
                  {
                    label: 'Resultado',
                    value: result ? (
                      <StatusBadge status={result.status} />
                    ) : (
                      'Pendiente'
                    ),
                  },
                  {
                    label: 'Campaña',
                    value: <StatusBadge status={campaign.status} />,
                  },
                  { label: '100 % pagado', value: fullySold ? 'Sí' : 'No' },
                  {
                    label: 'Verificador',
                    value: result?.verifiedBy
                      ? compactId(result.verifiedBy)
                      : '—',
                  },
                ]}
              />
              <Button
                type="button"
                className="button--full"
                disabled={!canPublish}
                onClick={() => setPublishConfirmation(true)}
              >
                <Trophy size={17} aria-hidden="true" />
                Publicar resultado
              </Button>
              {result?.status === 'published' ? (
                <p className="success-note">
                  <CheckCircle2 size={16} aria-hidden="true" /> Publicado{' '}
                  {formatDateTime(result.publishedAt)}
                </p>
              ) : null}
            </SectionCard>

            <SectionCard title="Condiciones de seguridad">
              <ul className="check-list">
                <li className={fullySold ? 'is-complete' : ''}>
                  Todos los títulos pagados
                </li>
                <li
                  className={campaign.reservedCount === 0 ? 'is-complete' : ''}
                >
                  Sin reservas abiertas
                </li>
                <li
                  className={
                    result?.status === 'verified' ||
                    result?.status === 'published'
                      ? 'is-complete'
                      : ''
                  }
                >
                  Evidencia verificada
                </li>
                <li className={!verifiedByCurrentUser ? 'is-complete' : ''}>
                  Publicador distinto del verificador
                </li>
              </ul>
            </SectionCard>
          </aside>
        </div>
      )}

      <ConfirmDialog
        open={publishConfirmation}
        title="Publicar resultado inmutable"
        description={
          <div>
            <p>
              Se publicará el título ganador de{' '}
              <strong>{campaign?.name}</strong>, la campaña pasará a sorteada y
              se creará el premio principal.
            </p>
            <p>
              <ShieldAlert size={16} aria-hidden="true" /> Esta operación no
              puede corregirse ni eliminarse después.
            </p>
          </div>
        }
        confirmLabel="Publicar definitivamente"
        confirmationText={campaign?.slug}
        danger
        busy={publishMutation.isPending}
        onClose={() => setPublishConfirmation(false)}
        onConfirm={() => publishMutation.mutate()}
      />
    </main>
  );
}

export default DrawsPage;
