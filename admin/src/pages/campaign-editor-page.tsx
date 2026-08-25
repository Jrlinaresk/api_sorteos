import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  CalendarDays,
  CircleDollarSign,
  Gamepad2,
  Image,
  LayoutTemplate,
  LockKeyhole,
  Save,
  Settings2,
  Share2,
  Ticket,
} from 'lucide-react';
import { useEffect } from 'react';
import { useForm, useWatch, type FieldError } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import {
  Button,
  ErrorState,
  InlineAlert,
  LoadingState,
  PageHeader,
  SectionCard,
  StatusBadge,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { fromDateTimeLocal, toDateTimeLocal } from '@/lib/format';
import { useToast } from '@/lib/toast-context';
import type { Category, PromotionTier } from '@/lib/types';
import { entityId } from '@/lib/types';
import {
  CampaignLifecyclePanel,
  type AdminCampaign,
} from './campaigns-lifecycle';

const finiteNumber = (minimum: number, label: string, integer = false) =>
  z
    .string()
    .trim()
    .refine(
      (value) => {
        if (!value) return false;
        const parsed = Number(value);
        return (
          Number.isFinite(parsed) &&
          parsed >= minimum &&
          (!integer || Number.isSafeInteger(parsed))
        );
      },
      {
        message: `${label} debe ser ${integer ? 'un entero' : 'un número'} mayor o igual a ${minimum}.`,
      },
    );

const optionalNumber = (minimum: number, label: string, maximum?: number) =>
  z
    .string()
    .trim()
    .refine(
      (value) => {
        if (!value) return true;
        const parsed = Number(value);
        return (
          Number.isFinite(parsed) &&
          parsed >= minimum &&
          (maximum === undefined || parsed <= maximum)
        );
      },
      {
        message:
          maximum === undefined
            ? `${label} debe ser mayor o igual a ${minimum}.`
            : `${label} debe estar entre ${minimum} y ${maximum}.`,
      },
    );

const optionalInteger = (minimum: number, label: string, maximum?: number) =>
  z
    .string()
    .trim()
    .refine(
      (value) => {
        if (!value) return true;
        const parsed = Number(value);
        return (
          Number.isSafeInteger(parsed) &&
          parsed >= minimum &&
          (maximum === undefined || parsed <= maximum)
        );
      },
      {
        message:
          maximum === undefined
            ? `${label} debe ser un entero mayor o igual a ${minimum}.`
            : `${label} debe ser un entero entre ${minimum} y ${maximum}.`,
      },
    );

function isHttpsUrl(value: string): boolean {
  if (!value.trim()) return true;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function parseIntegerList(value: string): number[] {
  if (!value.trim()) return [];
  return value
    .split(/[\s,;]+/)
    .map(Number)
    .filter((item) => Number.isSafeInteger(item) && item > 0);
}

function validIntegerList(value: string): boolean {
  if (!value.trim()) return true;
  const tokens = value.split(/[\s,;]+/).filter(Boolean);
  return (
    tokens.length <= 12 &&
    tokens.every((token) => {
      if (!/^\d+$/.test(token)) return false;
      const parsed = Number(token);
      return Number.isSafeInteger(parsed) && parsed > 0;
    })
  );
}

function parsePromotionTiers(value: string): PromotionTier[] {
  if (!value.trim()) return [];
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [quantity, totalPrice, label = ''] = line
        .split('|')
        .map((item) => item.trim());
      return {
        quantity: Number(quantity),
        totalPrice: Number(totalPrice),
        label: label || undefined,
        active: true,
      };
    });
}

function validPromotionTiers(value: string): boolean {
  const tiers = parsePromotionTiers(value);
  return (
    tiers.length <= 20 &&
    tiers.every(
      (tier) =>
        Number.isSafeInteger(tier.quantity) &&
        tier.quantity > 0 &&
        Number.isFinite(tier.totalPrice) &&
        tier.totalPrice >= 0,
    )
  );
}

function parseGameTiers(
  value: string,
): Array<{ quantity: number; attempts: number }> {
  if (!value.trim()) return [];
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [quantity, attempts] = line
        .split(':')
        .map((item) => Number(item.trim()));
      return { quantity, attempts };
    });
}

const campaignFormSchema = z
  .object({
    name: z.string().trim().min(1, 'Escribe el nombre público.').max(180),
    slug: z
      .string()
      .trim()
      .max(120)
      .regex(/^[a-z0-9-]*$/, 'Usa minúsculas, números y guiones.'),
    category: z.string(),
    shortDescription: z.string().max(320),
    description: z.string().max(200_000),
    regulationHtml: z.string().max(200_000),
    termsVersion: z
      .string()
      .trim()
      .min(1, 'Indica una versión de reglamento.')
      .max(40),
    imageUrl: z
      .string()
      .refine(isHttpsUrl, 'La portada debe usar una URL HTTPS.'),
    status: z.enum([
      'draft',
      'scheduled',
      'active',
      'open',
      'expired',
      'sold_out',
      'awaiting_draw',
      'drawn',
      'closed',
      'cancelled',
    ]),
    size: z.enum(['small', 'medium', 'large']),
    costLevel: z.enum(['low', 'medium', 'high']),
    statusLabel: z.string().max(120),
    statusText: z.string().max(320),
    featured: z.boolean(),
    sortOrder: finiteNumber(0, 'El orden', true),
    totalTitles: finiteNumber(1, 'El total de títulos', true),
    quotaDigits: optionalInteger(1, 'Los dígitos', 12),
    currency: z.string().trim().length(3, 'Usa el código ISO de tres letras.'),
    itemPrice: finiteNumber(0, 'El valor del premio'),
    ticketPrice: finiteNumber(0.01, 'El precio del título'),
    itemCondition: z.enum(['new', 'used']),
    prizeTitle: z
      .string()
      .trim()
      .min(1, 'Escribe el premio principal.')
      .max(220),
    cashAlternative: optionalNumber(0, 'La alternativa en efectivo'),
    minimumOrderAmount: optionalNumber(0, 'La compra mínima'),
    maxTitlesPerOrder: optionalInteger(1, 'El máximo por pedido'),
    quantitySuggestions: z
      .string()
      .refine(
        validIntegerList,
        'Usa hasta 12 cantidades enteras positivas separadas por comas.',
      ),
    promotionTiersText: z
      .string()
      .refine(
        validPromotionTiers,
        'Usa una oferta por línea: cantidad|precio|etiqueta.',
      ),
    launchAt: z.string(),
    closesAt: z.string(),
    drawDate: z.string(),
    drawMethod: z.enum(['federal_lottery', 'manual_external', 'cryptographic']),
    federalContest: z
      .string()
      .regex(
        /^(|[1-9]\d{0,9})$/,
        'El concurso admite hasta 10 dígitos y no comienza por cero.',
      ),
    federalFirstDigits: optionalInteger(1, 'Los dígitos del primer premio', 6),
    federalSecondDigits: optionalInteger(
      0,
      'Los dígitos del segundo premio',
      6,
    ),
    federalCombination: z.enum(['concatenate', 'sum']),
    showProgress: z.boolean(),
    showTopBuyers: z.boolean(),
    showMinMaxQuota: z.boolean(),
    showInstantPrizes: z.boolean(),
    showParticipantsDownload: z.boolean(),
    showTitleLookup: z.boolean(),
    showSocialButtons: z.boolean(),
    showCountdown: z.boolean(),
    instantGameEnabled: z.boolean(),
    instantGameMechanic: z.enum(['roulette', 'scratch']),
    instantGameNoPrizeWeight: optionalNumber(0, 'El peso sin premio'),
    instantGameTiersText: z.string(),
    noticeEnabled: z.boolean(),
    noticeTitle: z.string().max(160),
    noticeDescription: z.string().max(500),
    noticeStartsAt: z.string(),
    noticeEndsAt: z.string(),
    doubleChanceEnabled: z.boolean(),
    doubleChanceTitle: z.string().max(160),
    doubleChanceDescription: z.string().max(500),
    doubleChanceStartsAt: z.string(),
    doubleChanceEndsAt: z.string(),
    doubleChanceMultiplier: optionalInteger(2, 'El multiplicador', 10),
    instagram: z.string().max(160),
    telegram: z.string().max(160),
    whatsapp: z.string().max(40),
    seoTitle: z.string().max(180),
    seoDescription: z.string().max(320),
    seoKeywords: z.string(),
    seoShareImageUrl: z
      .string()
      .refine(isHttpsUrl, 'La imagen social debe usar HTTPS.'),
    analyticsEnabled: z.boolean(),
    metaPixelId: z
      .string()
      .regex(/^(|\d{5,32})$/, 'El Meta Pixel debe tener entre 5 y 32 dígitos.'),
    googleTagManagerId: z
      .string()
      .regex(/^(|GTM-[A-Z0-9]{4,32})$/, 'Usa un identificador GTM válido.'),
    progressOverride: optionalNumber(0, 'El progreso manual', 100),
  })
  .superRefine((values, context) => {
    if (
      values.status === 'scheduled' &&
      (!values.launchAt || new Date(values.launchAt).getTime() <= Date.now())
    ) {
      context.addIssue({
        code: 'custom',
        path: ['launchAt'],
        message:
          'Una campaña programada necesita una fecha de lanzamiento futura.',
      });
    }
    if (values.status === 'scheduled' && !values.regulationHtml.trim()) {
      context.addIssue({
        code: 'custom',
        path: ['regulationHtml'],
        message: 'Añade el reglamento antes de programar la campaña.',
      });
    }
    if (
      values.status === 'scheduled' &&
      values.drawMethod === 'cryptographic'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['status'],
        message:
          'Crea primero el borrador, publica el compromiso criptográfico y después prográmalo.',
      });
    }
    if (
      values.status === 'scheduled' &&
      values.drawMethod === 'federal_lottery' &&
      !values.federalContest
    ) {
      context.addIssue({
        code: 'custom',
        path: ['federalContest'],
        message: 'Fija el concurso Federal antes de programar la campaña.',
      });
    }
    const suggestions = parseIntegerList(values.quantitySuggestions);
    const maximumSuggestion = Math.min(
      Number(values.totalTitles),
      numberOrUndefined(values.maxTitlesPerOrder) ?? 20_000,
    );
    if (suggestions.some((suggestion) => suggestion > maximumSuggestion)) {
      context.addIssue({
        code: 'custom',
        path: ['quantitySuggestions'],
        message:
          'Una cantidad sugerida supera el inventario o máximo por pedido.',
      });
    }
    const ticketPrice = Number(values.ticketPrice);
    const maxTitlesPerOrder =
      numberOrUndefined(values.maxTitlesPerOrder) ?? 20_000;
    if (
      parsePromotionTiers(values.promotionTiersText).some(
        (tier) =>
          tier.quantity > maxTitlesPerOrder ||
          tier.totalPrice > ticketPrice * tier.quantity,
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['promotionTiersText'],
        message:
          'Una oferta supera el máximo por pedido o cuesta más que el precio normal.',
      });
    }
    const gameTiers = parseGameTiers(values.instantGameTiersText);
    if (
      values.instantGameEnabled &&
      (!gameTiers.length ||
        gameTiers.some(
          (tier) =>
            !Number.isSafeInteger(tier.quantity) ||
            tier.quantity < 1 ||
            !Number.isSafeInteger(tier.attempts) ||
            tier.attempts < 1 ||
            tier.attempts > 100,
        ))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['instantGameTiersText'],
        message: 'Usa al menos un nivel válido: cantidad:intentos.',
      });
    }
  });

type CampaignFormValues = z.infer<typeof campaignFormSchema>;

const defaultValues: CampaignFormValues = {
  name: '',
  slug: '',
  category: '',
  shortDescription: '',
  description: '',
  regulationHtml: '',
  termsVersion: '1',
  imageUrl: '',
  status: 'draft',
  size: 'large',
  costLevel: 'low',
  statusLabel: 'Adquira já!',
  statusText: '',
  featured: false,
  sortOrder: '0',
  totalTitles: '1000000',
  quotaDigits: '6',
  currency: 'BRL',
  itemPrice: '0',
  ticketPrice: '0.01',
  itemCondition: 'new',
  prizeTitle: '',
  cashAlternative: '',
  minimumOrderAmount: '2',
  maxTitlesPerOrder: '20000',
  quantitySuggestions: '100, 200, 500, 1000',
  promotionTiersText: '',
  launchAt: '',
  closesAt: '',
  drawDate: '',
  drawMethod: 'federal_lottery',
  federalContest: '',
  federalFirstDigits: '3',
  federalSecondDigits: '3',
  federalCombination: 'concatenate',
  showProgress: true,
  showTopBuyers: false,
  showMinMaxQuota: false,
  showInstantPrizes: true,
  showParticipantsDownload: false,
  showTitleLookup: false,
  showSocialButtons: true,
  showCountdown: true,
  instantGameEnabled: false,
  instantGameMechanic: 'roulette',
  instantGameNoPrizeWeight: '95',
  instantGameTiersText: '',
  noticeEnabled: false,
  noticeTitle: '',
  noticeDescription: '',
  noticeStartsAt: '',
  noticeEndsAt: '',
  doubleChanceEnabled: false,
  doubleChanceTitle: '',
  doubleChanceDescription: '',
  doubleChanceStartsAt: '',
  doubleChanceEndsAt: '',
  doubleChanceMultiplier: '2',
  instagram: '',
  telegram: '',
  whatsapp: '',
  seoTitle: '',
  seoDescription: '',
  seoKeywords: '',
  seoShareImageUrl: '',
  analyticsEnabled: false,
  metaPixelId: '',
  googleTagManagerId: '',
  progressOverride: '',
};

function promotionTiersText(tiers?: PromotionTier[]): string {
  return (tiers ?? [])
    .map((tier) => `${tier.quantity}|${tier.totalPrice}|${tier.label ?? ''}`)
    .join('\n');
}

function gameTiersText(campaign?: AdminCampaign): string {
  return (campaign?.instantGame?.tiers ?? [])
    .map((tier) => `${tier.quantity}:${tier.attempts}`)
    .join('\n');
}

function valuesForCampaign(campaign?: AdminCampaign): CampaignFormValues {
  if (!campaign) return defaultValues;
  const modules = campaign.modules;
  return {
    ...defaultValues,
    name: campaign.name ?? '',
    slug: campaign.slug ?? '',
    category:
      typeof campaign.category === 'string'
        ? campaign.category
        : campaign.category
          ? entityId(campaign.category)
          : '',
    shortDescription: campaign.shortDescription ?? '',
    description: campaign.description ?? '',
    regulationHtml: campaign.regulationHtml ?? '',
    termsVersion: campaign.termsVersion ?? '1',
    imageUrl: campaign.imageUrl ?? '',
    status: campaign.status,
    size: campaign.size ?? 'large',
    costLevel: campaign.costLevel ?? 'low',
    statusLabel: campaign.statusLabel ?? '',
    statusText: campaign.statusText ?? '',
    featured: campaign.featured ?? false,
    sortOrder: String(campaign.sortOrder ?? 0),
    totalTitles: String(campaign.totalTitles ?? 1),
    quotaDigits: String(campaign.quotaDigits ?? ''),
    currency: campaign.currency ?? 'BRL',
    itemPrice: String(campaign.itemPrice ?? 0),
    ticketPrice: String(campaign.ticketPrice ?? 0.01),
    itemCondition: campaign.itemCondition ?? 'new',
    prizeTitle: campaign.prizeTitle ?? '',
    cashAlternative:
      campaign.cashAlternative === undefined
        ? ''
        : String(campaign.cashAlternative),
    minimumOrderAmount: String(campaign.minimumOrderAmount ?? 0),
    maxTitlesPerOrder: String(campaign.maxTitlesPerOrder ?? 1),
    quantitySuggestions: (campaign.quantitySuggestions ?? []).join(', '),
    promotionTiersText: promotionTiersText(campaign.promotionTiers),
    launchAt: toDateTimeLocal(campaign.launchAt),
    closesAt: toDateTimeLocal(campaign.closesAt),
    drawDate: toDateTimeLocal(campaign.drawDate),
    drawMethod: campaign.drawMethod,
    federalContest: campaign.federalLottery?.contest ?? '',
    federalFirstDigits: String(campaign.federalLottery?.firstPrizeDigits ?? 3),
    federalSecondDigits: String(
      campaign.federalLottery?.secondPrizeDigits ?? 3,
    ),
    federalCombination: campaign.federalLottery?.combination ?? 'concatenate',
    showProgress: modules?.showProgress ?? true,
    showTopBuyers: modules?.showTopBuyers ?? false,
    showMinMaxQuota: modules?.showMinMaxQuota ?? false,
    showInstantPrizes: modules?.showInstantPrizes ?? true,
    showParticipantsDownload: modules?.showParticipantsDownload ?? false,
    showTitleLookup: modules?.showTitleLookup ?? false,
    showSocialButtons: modules?.showSocialButtons ?? true,
    showCountdown: modules?.showCountdown ?? true,
    instantGameEnabled: campaign.instantGame?.enabled ?? false,
    instantGameMechanic: campaign.instantGame?.mechanic ?? 'roulette',
    instantGameNoPrizeWeight: String(campaign.instantGame?.noPrizeWeight ?? 95),
    instantGameTiersText: gameTiersText(campaign),
    noticeEnabled: campaign.notice?.enabled ?? false,
    noticeTitle: campaign.notice?.title ?? '',
    noticeDescription: campaign.notice?.description ?? '',
    noticeStartsAt: toDateTimeLocal(campaign.notice?.startsAt),
    noticeEndsAt: toDateTimeLocal(campaign.notice?.endsAt),
    doubleChanceEnabled: campaign.doubleChance?.enabled ?? false,
    doubleChanceTitle: campaign.doubleChance?.title ?? '',
    doubleChanceDescription: campaign.doubleChance?.description ?? '',
    doubleChanceStartsAt: toDateTimeLocal(campaign.doubleChance?.startsAt),
    doubleChanceEndsAt: toDateTimeLocal(campaign.doubleChance?.endsAt),
    doubleChanceMultiplier: String(campaign.doubleChance?.multiplier ?? 2),
    instagram: campaign.contacts?.instagram ?? '',
    telegram: campaign.contacts?.telegram ?? '',
    whatsapp: campaign.contacts?.whatsapp ?? '',
    seoTitle: campaign.seo?.title ?? '',
    seoDescription: campaign.seo?.description ?? '',
    seoKeywords: (campaign.seo?.keywords ?? []).join(', '),
    seoShareImageUrl: campaign.seo?.shareImageUrl ?? '',
    analyticsEnabled: campaign.analytics?.enabled ?? false,
    metaPixelId: campaign.analytics?.metaPixelId ?? '',
    googleTagManagerId: campaign.analytics?.googleTagManagerId ?? '',
    progressOverride:
      campaign.progressOverride === undefined
        ? ''
        : String(campaign.progressOverride),
  };
}

function numberOrUndefined(value: string): number | undefined {
  return value.trim() ? Number(value) : undefined;
}

function textOrUndefined(value: string): string | undefined {
  const normalized = value.trim();
  return normalized || undefined;
}

function nullableText(
  value: string,
  isNew: boolean,
): string | null | undefined {
  return textOrUndefined(value) ?? (isNew ? undefined : null);
}

function isoOrUndefined(value: string): string | undefined {
  return fromDateTimeLocal(value);
}

function createPayload(
  values: CampaignFormValues,
  isNew: boolean,
  contractLocked: boolean,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    name: values.name.trim(),
    shortDescription: values.shortDescription,
    description: values.description,
    imageUrl: nullableText(values.imageUrl, isNew),
    category: values.category || (isNew ? undefined : null),
    size: values.size,
    costLevel: values.costLevel,
    statusLabel: values.statusLabel,
    statusText: values.statusText,
    featured: values.featured,
    sortOrder: Number(values.sortOrder),
    closesAt: isoOrUndefined(values.closesAt),
    modules: {
      showProgress: values.showProgress,
      showTopBuyers: values.showTopBuyers,
      showMinMaxQuota: values.showMinMaxQuota,
      showInstantPrizes: values.showInstantPrizes,
      showParticipantsDownload: values.showParticipantsDownload,
      showTitleLookup: values.showTitleLookup,
      showSocialButtons: values.showSocialButtons,
      showCountdown: values.showCountdown,
    },
    notice: {
      enabled: values.noticeEnabled,
      title: textOrUndefined(values.noticeTitle),
      description: textOrUndefined(values.noticeDescription),
      startsAt: isoOrUndefined(values.noticeStartsAt),
      endsAt: isoOrUndefined(values.noticeEndsAt),
    },
    contacts: {
      instagram: textOrUndefined(values.instagram),
      telegram: textOrUndefined(values.telegram),
      whatsapp: textOrUndefined(values.whatsapp),
    },
    seo: {
      title: textOrUndefined(values.seoTitle),
      description: textOrUndefined(values.seoDescription),
      keywords: values.seoKeywords
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
      shareImageUrl: textOrUndefined(values.seoShareImageUrl),
    },
    analytics: {
      enabled: values.analyticsEnabled,
      metaPixelId: textOrUndefined(values.metaPixelId),
      googleTagManagerId: textOrUndefined(values.googleTagManagerId),
    },
  };

  if (isNew) payload.status = values.status;
  if (contractLocked) return payload;

  const quantitySuggestions = parseIntegerList(values.quantitySuggestions);

  return {
    ...payload,
    slug: textOrUndefined(values.slug),
    regulationHtml: values.regulationHtml,
    termsVersion: values.termsVersion.trim(),
    totalTitles: Number(values.totalTitles),
    quotaDigits: numberOrUndefined(values.quotaDigits),
    launchAt: isoOrUndefined(values.launchAt),
    drawDate: isoOrUndefined(values.drawDate),
    currency: values.currency.trim().toUpperCase(),
    itemPrice: Number(values.itemPrice),
    ticketPrice: Number(values.ticketPrice),
    itemCondition: values.itemCondition,
    prizeTitle: values.prizeTitle.trim(),
    cashAlternative:
      numberOrUndefined(values.cashAlternative) ?? (isNew ? undefined : null),
    minimumOrderAmount: numberOrUndefined(values.minimumOrderAmount),
    maxTitlesPerOrder: numberOrUndefined(values.maxTitlesPerOrder),
    ...(quantitySuggestions.length ? { quantitySuggestions } : {}),
    promotionTiers: parsePromotionTiers(values.promotionTiersText),
    drawMethod: values.drawMethod,
    federalLottery:
      values.drawMethod === 'federal_lottery'
        ? {
            firstPrizeDigits: Number(values.federalFirstDigits || 3),
            secondPrizeDigits: Number(values.federalSecondDigits || 0),
            combination: values.federalCombination,
            contest: textOrUndefined(values.federalContest),
          }
        : undefined,
    instantGame: {
      enabled: values.instantGameEnabled,
      mechanic: values.instantGameMechanic,
      noPrizeWeight: Number(values.instantGameNoPrizeWeight || 0),
      tiers: parseGameTiers(values.instantGameTiersText),
    },
    doubleChance: {
      enabled: values.doubleChanceEnabled,
      title: textOrUndefined(values.doubleChanceTitle),
      description: textOrUndefined(values.doubleChanceDescription),
      startsAt: isoOrUndefined(values.doubleChanceStartsAt),
      endsAt: isoOrUndefined(values.doubleChanceEndsAt),
      multiplier: Number(values.doubleChanceMultiplier || 2),
    },
    progressOverride:
      numberOrUndefined(values.progressOverride) ?? (isNew ? undefined : null),
  };
}

function ErrorMessage({ error, id }: { error?: FieldError; id?: string }) {
  return error ? (
    <span className="field-error" id={id} role="alert">
      {error.message}
    </span>
  ) : null;
}

function apiErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.correlationId
      ? `${error.message} · Referencia ${error.correlationId}`
      : error.message;
  }
  return error instanceof Error
    ? error.message
    : 'Ocurrió un error inesperado.';
}

export function CampaignEditorPage() {
  const { id: routeId } = useParams<{ id: string }>();
  const isNew = !routeId || routeId === 'new';
  const id = isNew ? '' : routeId;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const campaignQuery = useQuery({
    queryKey: ['campaign', id],
    queryFn: () =>
      api.get<AdminCampaign>(`/admin/campaigns/${encodeURIComponent(id)}`),
    enabled: !isNew,
  });
  const categoriesQuery = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get<Category[]>('/categories'),
    staleTime: 60_000,
  });

  const campaign = campaignQuery.data;
  const contractLocked = Boolean(
    campaign &&
    (campaign.status !== 'draft' ||
      campaign.contractLockedAt ||
      campaign.soldCount > 0 ||
      campaign.reservedCount > 0),
  );

  const {
    register,
    control,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isDirty },
  } = useForm<CampaignFormValues>({
    resolver: zodResolver(campaignFormSchema),
    defaultValues,
  });

  useEffect(() => {
    if (isNew) reset(defaultValues);
    else if (campaign) reset(valuesForCampaign(campaign));
  }, [campaign, isNew, reset]);

  const saveMutation = useMutation({
    mutationFn: (values: CampaignFormValues) => {
      const payload = createPayload(values, isNew, contractLocked);
      return isNew
        ? api.post<AdminCampaign>('/admin/campaigns', payload)
        : api.patch<AdminCampaign>(
            `/admin/campaigns/${encodeURIComponent(id)}`,
            payload,
          );
    },
    onSuccess: async (saved) => {
      const savedId = entityId(saved);
      showToast({
        tone: 'success',
        title: isNew ? 'Campaña creada' : 'Cambios guardados',
        message: `${saved.name} quedó guardada como ${saved.status}.`,
      });
      queryClient.setQueryData(['campaign', savedId], saved);
      await queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      reset(valuesForCampaign(saved));
      if (isNew)
        navigate(`/campaigns/${encodeURIComponent(savedId)}`, {
          replace: true,
        });
    },
    onError: (error) =>
      showToast({
        tone: 'error',
        title: isNew
          ? 'No se pudo crear la campaña'
          : 'No se pudieron guardar los cambios',
        message: apiErrorMessage(error),
      }),
  });

  const drawMethod = useWatch({ control, name: 'drawMethod' });
  const status = useWatch({ control, name: 'status' });
  const instantGameEnabled = useWatch({
    control,
    name: 'instantGameEnabled',
  });
  const noticeEnabled = useWatch({ control, name: 'noticeEnabled' });
  const doubleChanceEnabled = useWatch({
    control,
    name: 'doubleChanceEnabled',
  });
  const analyticsEnabled = useWatch({ control, name: 'analyticsEnabled' });
  const regulationHtml = useWatch({ control, name: 'regulationHtml' });

  useEffect(() => {
    if (isNew && drawMethod === 'cryptographic' && status === 'scheduled') {
      setValue('status', 'draft', {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
  }, [drawMethod, isNew, setValue, status]);

  if (!isNew && campaignQuery.isLoading) {
    return <LoadingState label="Cargando el contrato de campaña…" />;
  }
  if (!isNew && campaignQuery.isError) {
    return (
      <ErrorState
        error={campaignQuery.error}
        onRetry={() => campaignQuery.refetch()}
        title="No pudimos abrir esta campaña"
      />
    );
  }

  return (
    <main className="page-stack" id="campaign-editor-content">
      <PageHeader
        eyebrow={isNew ? 'Nueva campaña' : 'Edición de campaña'}
        title={isNew ? 'Crear campaña' : (campaign?.name ?? 'Editar campaña')}
        description={
          isNew
            ? 'Comienza con un borrador o deja preparada una publicación programada.'
            : 'El contenido permanece editable; los datos contractuales se congelan al publicar.'
        }
        actions={
          <div className="page-header__actions-group">
            {!isNew && campaign ? (
              <StatusBadge status={campaign.status} />
            ) : null}
            <Link className="button button--secondary" to="/campaigns">
              <ArrowLeft size={17} aria-hidden="true" />
              Volver
            </Link>
          </div>
        }
      />

      <div className="editor-layout">
        <form
          id="campaign-editor-form"
          className="editor-layout__main page-stack"
          onSubmit={handleSubmit((values) => saveMutation.mutate(values))}
          noValidate
        >
          {Object.keys(errors).length ? (
            <InlineAlert tone="danger" title="Revisa el formulario">
              Hay campos incompletos o con formato inválido antes de poder
              guardar.
            </InlineAlert>
          ) : null}

          <SectionCard
            title="Identidad y contenido"
            description="Información pública que verá cada participante."
          >
            <div className="form-grid">
              <label className="field field--wide">
                <span>Nombre público *</span>
                <input
                  {...register('name')}
                  maxLength={180}
                  aria-invalid={Boolean(errors.name)}
                  aria-describedby={
                    errors.name ? 'campaign-name-error' : undefined
                  }
                />
                <ErrorMessage id="campaign-name-error" error={errors.name} />
              </label>
              <label className="field">
                <span>Slug</span>
                <input
                  {...register('slug')}
                  placeholder="se-genera-del-nombre"
                  disabled={contractLocked}
                  aria-invalid={Boolean(errors.slug)}
                />
                <ErrorMessage error={errors.slug} />
              </label>
              <label className="field">
                <span>Categoría</span>
                <select
                  {...register('category')}
                  disabled={categoriesQuery.isLoading}
                >
                  <option value="">Sin categoría</option>
                  {(categoriesQuery.data ?? []).map((category) => (
                    <option key={entityId(category)} value={entityId(category)}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field field--wide">
                <span>Descripción corta</span>
                <input {...register('shortDescription')} maxLength={320} />
              </label>
              <label className="field field--wide">
                <span>Descripción HTML</span>
                <textarea {...register('description')} rows={8} />
                <small>El backend sanitiza el HTML antes de publicarlo.</small>
              </label>
              <label className="field field--wide">
                <span>Reglamento HTML</span>
                <textarea
                  {...register('regulationHtml')}
                  rows={8}
                  disabled={contractLocked}
                />
              </label>
              <label className="field">
                <span>Versión del reglamento *</span>
                <input
                  {...register('termsVersion')}
                  disabled={contractLocked}
                />
                <ErrorMessage error={errors.termsVersion} />
              </label>
              <label className="field">
                <span>
                  <Image size={15} aria-hidden="true" /> URL de portada
                </span>
                <input
                  {...register('imageUrl')}
                  type="url"
                  placeholder="https://…"
                  aria-invalid={Boolean(errors.imageUrl)}
                />
                <ErrorMessage error={errors.imageUrl} />
              </label>
            </div>
          </SectionCard>

          <SectionCard
            title="Premio y economía"
            description="Define el premio, el valor de referencia y el precio de participación."
          >
            <fieldset className="form-fieldset" disabled={contractLocked}>
              <legend className="sr-only">Premio y economía contractual</legend>
              <div className="form-grid">
                <label className="field field--wide">
                  <span>Premio principal *</span>
                  <input {...register('prizeTitle')} maxLength={220} />
                  <ErrorMessage error={errors.prizeTitle} />
                </label>
                <label className="field">
                  <span>
                    <CircleDollarSign size={15} aria-hidden="true" /> Valor del
                    premio
                  </span>
                  <input {...register('itemPrice')} inputMode="decimal" />
                  <ErrorMessage error={errors.itemPrice} />
                </label>
                <label className="field">
                  <span>Alternativa en efectivo</span>
                  <input {...register('cashAlternative')} inputMode="decimal" />
                  <ErrorMessage error={errors.cashAlternative} />
                </label>
                <label className="field">
                  <span>Precio por título *</span>
                  <input {...register('ticketPrice')} inputMode="decimal" />
                  <ErrorMessage error={errors.ticketPrice} />
                </label>
                <label className="field">
                  <span>Moneda</span>
                  <input {...register('currency')} maxLength={3} />
                  <ErrorMessage error={errors.currency} />
                </label>
                <label className="field">
                  <span>Condición del premio</span>
                  <select {...register('itemCondition')}>
                    <option value="new">Nuevo</option>
                    <option value="used">Usado</option>
                  </select>
                </label>
                <label className="field">
                  <span>Compra mínima</span>
                  <input
                    {...register('minimumOrderAmount')}
                    inputMode="decimal"
                  />
                  <ErrorMessage error={errors.minimumOrderAmount} />
                </label>
              </div>
            </fieldset>
          </SectionCard>

          <SectionCard
            title="Títulos y promociones"
            description="Configura inventario, límites y precios por volumen."
          >
            <fieldset className="form-fieldset" disabled={contractLocked}>
              <legend className="sr-only">Inventario contractual</legend>
              <div className="form-grid">
                <label className="field">
                  <span>
                    <Ticket size={15} aria-hidden="true" /> Total de títulos *
                  </span>
                  <input {...register('totalTitles')} inputMode="numeric" />
                  <ErrorMessage error={errors.totalTitles} />
                </label>
                <label className="field">
                  <span>Dígitos por título</span>
                  <input {...register('quotaDigits')} inputMode="numeric" />
                  <ErrorMessage error={errors.quotaDigits} />
                </label>
                <label className="field">
                  <span>Máximo seleccionado por pedido</span>
                  <input
                    {...register('maxTitlesPerOrder')}
                    inputMode="numeric"
                  />
                  <ErrorMessage error={errors.maxTitlesPerOrder} />
                </label>
                <label className="field field--wide">
                  <span>Cantidades sugeridas</span>
                  <input
                    {...register('quantitySuggestions')}
                    placeholder="100, 200, 500"
                  />
                  <small>
                    Hasta 12 cantidades; vacío conserva el valor del servidor.
                  </small>
                  <ErrorMessage error={errors.quantitySuggestions} />
                </label>
                <label className="field field--wide">
                  <span>Ofertas por volumen</span>
                  <textarea
                    {...register('promotionTiersText')}
                    rows={4}
                    placeholder={'100|7.99|Oferta 100\n500|29.90|Oferta 500'}
                  />
                  <small>Una por línea: cantidad|precio total|etiqueta.</small>
                  <ErrorMessage error={errors.promotionTiersText} />
                </label>
              </div>
            </fieldset>
          </SectionCard>

          <SectionCard
            title="Calendario y método de sorteo"
            description="Las fechas se envían al backend como instantes ISO."
          >
            <div className="form-grid">
              {isNew ? (
                <label className="field">
                  <span>Estado inicial</span>
                  <select {...register('status')}>
                    <option value="draft">Borrador</option>
                    <option
                      value="scheduled"
                      disabled={drawMethod === 'cryptographic'}
                    >
                      Programada
                    </option>
                  </select>
                  <ErrorMessage error={errors.status} />
                </label>
              ) : null}
              <label className="field">
                <span>
                  <CalendarDays size={15} aria-hidden="true" /> Lanzamiento
                </span>
                <input
                  type="datetime-local"
                  {...register('launchAt')}
                  disabled={contractLocked}
                />
                <ErrorMessage error={errors.launchAt} />
              </label>
              <label className="field">
                <span>Cierre de ventas</span>
                <input type="datetime-local" {...register('closesAt')} />
              </label>
              <label className="field">
                <span>Fecha o baliza del sorteo</span>
                <input
                  type="datetime-local"
                  {...register('drawDate')}
                  disabled={contractLocked}
                />
              </label>
              <label className="field">
                <span>Método</span>
                <select {...register('drawMethod')} disabled={contractLocked}>
                  <option value="federal_lottery">Lotería Federal CAIXA</option>
                  <option value="manual_external">
                    Resultado externo manual
                  </option>
                  <option value="cryptographic">
                    Criptográfico con baliza
                  </option>
                </select>
              </label>
              {drawMethod === 'federal_lottery' ? (
                <>
                  <label className="field">
                    <span>Concurso Federal</span>
                    <input
                      {...register('federalContest')}
                      disabled={contractLocked}
                    />
                    <ErrorMessage error={errors.federalContest} />
                  </label>
                  <label className="field">
                    <span>Dígitos del primer premio</span>
                    <input
                      {...register('federalFirstDigits')}
                      disabled={contractLocked}
                    />
                    <ErrorMessage error={errors.federalFirstDigits} />
                  </label>
                  <label className="field">
                    <span>Dígitos del segundo premio</span>
                    <input
                      {...register('federalSecondDigits')}
                      disabled={contractLocked}
                    />
                    <ErrorMessage error={errors.federalSecondDigits} />
                  </label>
                  <label className="field">
                    <span>Regla de combinación</span>
                    <select
                      {...register('federalCombination')}
                      disabled={contractLocked}
                    >
                      <option value="concatenate">Concatenar</option>
                      <option value="sum">Sumar y aplicar módulo</option>
                    </select>
                  </label>
                </>
              ) : null}
            </div>
            {status === 'scheduled' && !regulationHtml.trim() ? (
              <InlineAlert tone="warning" title="Falta el reglamento">
                El backend no activará una campaña programada sin reglamento
                vigente.
              </InlineAlert>
            ) : null}
            {isNew && drawMethod === 'cryptographic' ? (
              <InlineAlert tone="info" title="Primero publica el compromiso">
                La campaña se creará como borrador. Después abre Sorteos, fija
                el compromiso criptográfico y prográmala desde sus transiciones.
              </InlineAlert>
            ) : null}
          </SectionCard>

          <SectionCard
            title="Módulos públicos"
            description="Activa únicamente las secciones que la landing debe mostrar."
          >
            <fieldset className="checkbox-grid">
              <legend className="sr-only">Módulos visibles</legend>
              {(
                [
                  ['showProgress', 'Progreso de ventas'],
                  ['showTopBuyers', 'Ranking de compradores'],
                  ['showMinMaxQuota', 'Título menor y mayor'],
                  ['showInstantPrizes', 'Premios instantáneos'],
                  ['showParticipantsDownload', 'Lista de participantes'],
                  ['showTitleLookup', 'Consulta de títulos'],
                  ['showSocialButtons', 'Botones sociales'],
                  ['showCountdown', 'Cuenta regresiva'],
                ] as const
              ).map(([field, label]) => (
                <label className="check-card" key={field}>
                  <input type="checkbox" {...register(field)} />
                  <span>{label}</span>
                </label>
              ))}
            </fieldset>
          </SectionCard>

          <SectionCard
            title="Experiencias promocionales"
            description="Configura aviso temporal, juego instantáneo y títulos adicionales."
          >
            <div className="settings-subsections">
              <fieldset className="form-fieldset" disabled={contractLocked}>
                <legend>
                  <Gamepad2 size={17} aria-hidden="true" /> Juego instantáneo
                </legend>
                <label className="toggle-field">
                  <input type="checkbox" {...register('instantGameEnabled')} />
                  <span>Habilitar juego</span>
                </label>
                {instantGameEnabled ? (
                  <div className="form-grid">
                    <label className="field">
                      <span>Mecánica</span>
                      <select {...register('instantGameMechanic')}>
                        <option value="roulette">Ruleta</option>
                        <option value="scratch">Rasca y gana</option>
                      </select>
                    </label>
                    <label className="field">
                      <span>Peso sin premio</span>
                      <input
                        {...register('instantGameNoPrizeWeight')}
                        inputMode="decimal"
                      />
                      <ErrorMessage error={errors.instantGameNoPrizeWeight} />
                    </label>
                    <label className="field field--wide">
                      <span>Intentos por compra</span>
                      <textarea
                        {...register('instantGameTiersText')}
                        rows={3}
                        placeholder={'100:1\n500:3'}
                      />
                      <small>Una línea por nivel: cantidad:intentos.</small>
                      <ErrorMessage error={errors.instantGameTiersText} />
                    </label>
                  </div>
                ) : null}
              </fieldset>

              <fieldset className="form-fieldset">
                <legend>Aviso temporal</legend>
                <label className="toggle-field">
                  <input type="checkbox" {...register('noticeEnabled')} />
                  <span>Mostrar aviso</span>
                </label>
                {noticeEnabled ? (
                  <div className="form-grid">
                    <label className="field">
                      <span>Título</span>
                      <input {...register('noticeTitle')} />
                    </label>
                    <label className="field field--wide">
                      <span>Descripción</span>
                      <textarea {...register('noticeDescription')} rows={3} />
                    </label>
                    <label className="field">
                      <span>Desde</span>
                      <input
                        type="datetime-local"
                        {...register('noticeStartsAt')}
                      />
                    </label>
                    <label className="field">
                      <span>Hasta</span>
                      <input
                        type="datetime-local"
                        {...register('noticeEndsAt')}
                      />
                    </label>
                  </div>
                ) : null}
              </fieldset>

              <fieldset className="form-fieldset" disabled={contractLocked}>
                <legend>Doble oportunidad</legend>
                <label className="toggle-field">
                  <input type="checkbox" {...register('doubleChanceEnabled')} />
                  <span>Asignar títulos adicionales</span>
                </label>
                {doubleChanceEnabled ? (
                  <div className="form-grid">
                    <label className="field">
                      <span>Título</span>
                      <input {...register('doubleChanceTitle')} />
                    </label>
                    <label className="field">
                      <span>Multiplicador</span>
                      <input {...register('doubleChanceMultiplier')} />
                    </label>
                    <label className="field field--wide">
                      <span>Descripción</span>
                      <textarea
                        {...register('doubleChanceDescription')}
                        rows={3}
                      />
                    </label>
                    <label className="field">
                      <span>Desde</span>
                      <input
                        type="datetime-local"
                        {...register('doubleChanceStartsAt')}
                      />
                    </label>
                    <label className="field">
                      <span>Hasta</span>
                      <input
                        type="datetime-local"
                        {...register('doubleChanceEndsAt')}
                      />
                    </label>
                  </div>
                ) : null}
              </fieldset>
            </div>
          </SectionCard>

          <SectionCard
            title="Presentación, SEO y medición"
            description="Ordena el catálogo y controla la información para compartir."
          >
            <div className="form-grid">
              <label className="field">
                <span>Tamaño visual</span>
                <select {...register('size')}>
                  <option value="small">Pequeño</option>
                  <option value="medium">Mediano</option>
                  <option value="large">Grande</option>
                </select>
              </label>
              <label className="field">
                <span>Nivel de precio</span>
                <select {...register('costLevel')}>
                  <option value="low">Bajo</option>
                  <option value="medium">Medio</option>
                  <option value="high">Alto</option>
                </select>
              </label>
              <label className="field">
                <span>Orden</span>
                <input {...register('sortOrder')} inputMode="numeric" />
                <ErrorMessage error={errors.sortOrder} />
              </label>
              <label className="field">
                <span>Progreso manual</span>
                <input
                  {...register('progressOverride')}
                  inputMode="decimal"
                  disabled={contractLocked}
                />
                <ErrorMessage error={errors.progressOverride} />
              </label>
              <label className="toggle-field">
                <input type="checkbox" {...register('featured')} />
                <span>Destacar en el catálogo</span>
              </label>
              <label className="field">
                <span>Etiqueta pública</span>
                <input {...register('statusLabel')} />
              </label>
              <label className="field field--wide">
                <span>Texto de estado</span>
                <input {...register('statusText')} />
              </label>
            </div>
            <div className="form-grid section-divider">
              <label className="field">
                <span>
                  <Share2 size={15} aria-hidden="true" /> Instagram
                </span>
                <input {...register('instagram')} />
              </label>
              <label className="field">
                <span>Telegram</span>
                <input {...register('telegram')} />
              </label>
              <label className="field">
                <span>WhatsApp</span>
                <input {...register('whatsapp')} />
              </label>
              <label className="field">
                <span>Título SEO</span>
                <input {...register('seoTitle')} />
              </label>
              <label className="field field--wide">
                <span>Descripción SEO</span>
                <textarea {...register('seoDescription')} rows={3} />
              </label>
              <label className="field">
                <span>Palabras clave</span>
                <input
                  {...register('seoKeywords')}
                  placeholder="moto, premio, brasil"
                />
              </label>
              <label className="field">
                <span>Imagen para compartir</span>
                <input type="url" {...register('seoShareImageUrl')} />
                <ErrorMessage error={errors.seoShareImageUrl} />
              </label>
            </div>
            <fieldset className="form-fieldset section-divider">
              <legend>
                <Settings2 size={17} aria-hidden="true" /> Analítica
              </legend>
              <label className="toggle-field">
                <input type="checkbox" {...register('analyticsEnabled')} />
                <span>Habilitar medición</span>
              </label>
              {analyticsEnabled ? (
                <div className="form-grid">
                  <label className="field">
                    <span>Meta Pixel ID</span>
                    <input {...register('metaPixelId')} />
                    <ErrorMessage error={errors.metaPixelId} />
                  </label>
                  <label className="field">
                    <span>Google Tag Manager</span>
                    <input
                      {...register('googleTagManagerId')}
                      placeholder="GTM-XXXX"
                    />
                    <ErrorMessage error={errors.googleTagManagerId} />
                  </label>
                </div>
              ) : null}
            </fieldset>
          </SectionCard>
        </form>

        <aside
          className="editor-layout__aside"
          aria-label="Acciones de campaña"
        >
          <SectionCard
            title="Guardar"
            description={
              isDirty ? 'Hay cambios sin guardar.' : 'Todo está al día.'
            }
          >
            {contractLocked ? (
              <InlineAlert tone="info" title="Contrato bloqueado">
                <LockKeyhole size={16} aria-hidden="true" /> Solo se enviarán
                contenido y presentación editables.
              </InlineAlert>
            ) : null}
            <Button
              type="submit"
              form="campaign-editor-form"
              busy={saveMutation.isPending}
              className="button--full"
            >
              <Save size={17} aria-hidden="true" />
              {isNew ? 'Crear campaña' : 'Guardar cambios'}
            </Button>
            {!isNew && campaign ? (
              <Link
                className="button button--ghost button--full"
                to={`/draws?campaignId=${encodeURIComponent(entityId(campaign))}`}
              >
                <LayoutTemplate size={17} aria-hidden="true" />
                Abrir sorteo
              </Link>
            ) : null}
          </SectionCard>

          {!isNew && campaign ? (
            <CampaignLifecyclePanel
              campaign={campaign}
              onChanged={(updated) => {
                queryClient.setQueryData(['campaign', id], updated);
                reset(valuesForCampaign(updated));
              }}
              onDeleted={() => navigate('/campaigns', { replace: true })}
            />
          ) : null}
        </aside>
      </div>
    </main>
  );
}

export default CampaignEditorPage;
