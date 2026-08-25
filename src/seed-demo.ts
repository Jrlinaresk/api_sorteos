import * as bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import mongoose, { ClientSession, Types } from 'mongoose';
import {
  AuditCategory,
  AuditOutcome,
} from './modules/audit/enums/audit-category.enum';
import { EmailVerificationPurpose } from './modules/email/enums/email-verification-purpose.enum';
import { TransactionalEmailStatus } from './modules/email/schema/transactional-email.schema';
import {
  MainPrizeAwardStatus,
  MainPrizeChoice,
  MainPrizeClaimSource,
} from './modules/main-awards/schemas/main-prize-award.schema';
import { MediaKind } from './modules/media/media-types';
import { MediaAssetStatus } from './modules/media/schemas/media-asset.schema';
import {
  NotificationDeliveryCode,
  NotificationDeliveryStatus,
  NotificationType,
} from './modules/notifications/schemas/notification.schema';
import {
  PushProviderKind,
  PushSubscriptionDisableReason,
} from './modules/notifications/schemas/push-subscription.schema';
import { OrderStatus } from './modules/orders/schemas/order.schema';
import { QuotaStatus } from './modules/orders/schemas/quota.schema';
import {
  PaymentCurrency,
  PaymentEventSource,
  PaymentProviderName,
  PaymentStatus,
} from './modules/payments/payment.enums';
import { PaymentOutboxStatus } from './modules/payments/schemas/payment-outbox.schema';
import { RefundOperationStatus } from './modules/payments/schemas/refund-operation.schema';
import {
  InstantPrizeStatus,
  PrizeMechanic,
} from './modules/prizes/schemas/instant-prize.schema';
import {
  PrizeAttemptOutcome,
  PrizeAttemptStatus,
} from './modules/prizes/schemas/prize-attempt.schema';
import { PrizeAwardStatus } from './modules/prizes/schemas/prize-award.schema';
import { ProductCategory } from './modules/products/enums/product-category.enum';
import { ReferralCodeStatus } from './modules/referrals/schemas/referral-code.schema';
import { ReferralCommissionStatus } from './modules/referrals/schemas/referral-commission.schema';
import {
  CampaignStatus,
  DrawMethod,
  MediaType,
} from './modules/riffles/schema/raffle.schema';
import {
  SettingsVersionStatus,
  ThemeMode,
} from './modules/settings/enums/settings-status.enum';
import { TxStatus } from './modules/transactions/schemas/transaction.schema';
import { UserRole } from './modules/users/enums/user-role.enum';
import { DrawResultStatus } from './modules/draws/schemas/draw-result.schema';

const DEMO_CONFIRMATION = 'local-manual-testing';
const DEMO_PASSWORD = 'DemoManual2026!';
const DEMO_EMAIL_SUFFIX = '.demo@sorteos.local';
const DEMO_SLUG_SUFFIX = '-demo';
const DEMO_ORDER_PREFIX = 'demo-order-';
const TERMS_HTML =
  '<h2>Regulamento de demonstração</h2><p>Dados fictícios para testes manuais locais.</p>';
const TERMS_HASH = createHash('sha256').update(TERMS_HTML).digest('hex');

type AnyDocument = Record<string, any> & { _id: any };

interface DemoContext {
  now: Date;
  passwordHash: string;
  media: { size: number; checksum: string };
}

interface SeedResult {
  collections: Array<{ name: string; count: number }>;
  credentials: Array<{
    role: UserRole;
    name: string;
    login: string;
    password: string;
  }>;
  publicCampaign: string;
  guestOrder: { publicId: string; accessToken: string };
}

function demoId(sequence: number): Types.ObjectId {
  return new Types.ObjectId(`de${sequence.toString(16).padStart(22, '0')}`);
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function addMilliseconds(value: Date, milliseconds: number): Date {
  return new Date(value.getTime() + milliseconds);
}

function daysFrom(value: Date, days: number): Date {
  return addMilliseconds(value, days * 24 * 60 * 60 * 1000);
}

function hoursFrom(value: Date, hours: number): Date {
  return addMilliseconds(value, hours * 60 * 60 * 1000);
}

function paddedQuota(index: number, digits = 6): string {
  return String(index).padStart(digits, '0');
}

async function upsertDocuments(
  collectionName: string,
  documents: AnyDocument[],
  session: ClientSession,
): Promise<void> {
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB no expuso una base conectada');
  const collection = db.collection<any>(collectionName);
  for (const document of documents) {
    const { _id, ...fields } = document;
    await collection.updateOne(
      { _id },
      { $set: fields, $setOnInsert: { _id } },
      { upsert: true, session },
    );
  }
}

async function assertLocalEmptyOrDemo(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('El sembrado demo está prohibido con NODE_ENV=production');
  }
  if (process.env.DEMO_SEED_CONFIRM !== DEMO_CONFIRMATION) {
    throw new Error(
      `Defina DEMO_SEED_CONFIRM=${DEMO_CONFIRMATION} para confirmar el sembrado local`,
    );
  }
  if (
    process.env.PAYMENTS_PROVIDER !== PaymentProviderName.Mock ||
    process.env.PAYMENTS_ALLOW_MOCK !== 'true'
  ) {
    throw new Error(
      'El sembrado requiere el proveedor de pagos mock habilitado',
    );
  }
  if (process.env.MEDIA_STORAGE_PROVIDER !== 'local') {
    throw new Error('El sembrado requiere almacenamiento de medios local');
  }
  if (process.env.SMTP_HOST !== 'mailpit') {
    throw new Error('El sembrado requiere el SMTP local de Mailpit');
  }
  const uri = process.env.MONGODB_URI?.trim();
  const hostname = uri ? new URL(uri).hostname : '';
  if (!['mongodb', 'localhost', '127.0.0.1'].includes(hostname)) {
    throw new Error('El sembrado solo acepta una instancia MongoDB local');
  }
  if (process.env.DEMO_SEED_ALLOW_NONEMPTY === 'true') return;
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB no expuso una base conectada');
  const checks = [
    {
      collection: 'users',
      filter: {
        $or: [
          { email: { $exists: false } },
          { email: { $not: new RegExp(`${DEMO_EMAIL_SUFFIX}$`) } },
        ],
      },
    },
    {
      collection: 'raffles',
      filter: { slug: { $not: new RegExp(`${DEMO_SLUG_SUFFIX}$`) } },
    },
    {
      collection: 'orders',
      filter: { publicId: { $not: new RegExp(`^${DEMO_ORDER_PREFIX}`) } },
    },
  ];
  const conflicts: string[] = [];
  for (const check of checks) {
    const count = await db
      .collection(check.collection)
      .countDocuments(check.filter);
    if (count > 0) conflicts.push(`${check.collection}=${count}`);
  }
  if (conflicts.length) {
    throw new Error(
      `La base contiene datos ajenos al demo (${conflicts.join(', ')}). No se modificó nada.`,
    );
  }
}

async function prepareDemoMedia(): Promise<{ size: number; checksum: string }> {
  const source = resolve(process.cwd(), 'src/assets/img/full_logo_color.png');
  const root = resolve(
    process.env.MEDIA_LOCAL_ROOT?.trim() ||
      resolve(process.cwd(), 'uploads/media'),
  );
  const storageKeys = [
    'demo/campaign-cover.png',
    'demo/free-media.png',
    'demo/deleted-media.png',
  ];
  const bytes = await readFile(source);
  for (const storageKey of storageKeys) {
    const destination = resolve(root, storageKey);
    await mkdir(dirname(destination), { recursive: true, mode: 0o750 });
    await copyFile(source, destination);
  }
  const sourceStat = await stat(source);
  return { size: sourceStat.size, checksum: sha256(bytes) };
}

function demoUsers(context: DemoContext): AnyDocument[] {
  const { now, passwordHash } = context;
  const base = {
    isActive: true,
    registrationPending: false,
    participations: [demoId(301), demoId(309), demoId(310), demoId(311)],
    balance: 0,
    emailVerified: true,
    passwordHash,
    failedLoginAttempts: 0,
    authVersion: 0,
    adminInvariantVersion: 0,
    profilePictureUrl: 'https://i.imgur.com/vMppUMs.png',
    createdAt: daysFrom(now, -120),
    updatedAt: now,
    __v: 0,
  };
  return [
    {
      _id: demoId(1),
      ...base,
      phone: '+5511999000001',
      nickname: 'admin.demo',
      name: 'Ana Administradora',
      firstName: 'Ana',
      lastName: 'Administradora',
      cpf: '52998224725',
      role: UserRole.ADMIN,
      email: `admin${DEMO_EMAIL_SUFFIX}`,
      address: 'Avenida Paulista, 1000 - São Paulo/SP',
    },
    {
      _id: demoId(2),
      ...base,
      phone: '+5511999000002',
      nickname: 'auditor.demo',
      name: 'Bruno Auditor',
      firstName: 'Bruno',
      lastName: 'Auditor',
      role: UserRole.ADMIN,
      email: `auditor${DEMO_EMAIL_SUFFIX}`,
      address: 'Rua da Consolação, 200 - São Paulo/SP',
    },
    {
      _id: demoId(3),
      ...base,
      phone: '+5511999000003',
      nickname: 'operador.demo',
      name: 'Carlos Operador',
      firstName: 'Carlos',
      lastName: 'Operador',
      cpf: '11144477735',
      role: UserRole.OPERATOR,
      email: `operador${DEMO_EMAIL_SUFFIX}`,
      address: 'Rua Augusta, 300 - São Paulo/SP',
    },
    {
      _id: demoId(4),
      ...base,
      phone: '+5511999000004',
      nickname: 'joao.demo',
      name: 'João Cliente',
      firstName: 'João',
      lastName: 'Cliente',
      cpf: '12345678909',
      role: UserRole.CUSTOMER,
      email: `joao${DEMO_EMAIL_SUFFIX}`,
      address: 'Rua das Flores, 123 - Campinas/SP',
      balance: 250,
    },
    {
      _id: demoId(5),
      ...base,
      phone: '+5511999000005',
      nickname: 'maria.demo',
      name: 'Maria Compradora',
      firstName: 'Maria',
      lastName: 'Compradora',
      role: UserRole.CUSTOMER,
      email: `maria${DEMO_EMAIL_SUFFIX}`,
      address: 'Avenida Brasil, 456 - Rio de Janeiro/RJ',
      balance: 80,
    },
    {
      _id: demoId(6),
      ...base,
      phone: '+5511999000006',
      nickname: 'inativo.demo',
      name: 'Pedro Inativo',
      role: UserRole.CUSTOMER,
      email: `inativo${DEMO_EMAIL_SUFFIX}`,
      isActive: false,
      emailVerified: true,
      authVersion: 2,
      participations: [],
    },
    {
      _id: demoId(7),
      ...base,
      phone: '+5511999000007',
      nickname: 'pendente.demo',
      name: 'Paula Cadastro Pendente',
      role: UserRole.CUSTOMER,
      email: `pendente${DEMO_EMAIL_SUFFIX}`,
      isActive: false,
      emailVerified: false,
      registrationPending: true,
      registrationPendingExpiresAt: hoursFrom(now, 24),
      registrationIdHash: sha256('demo-registration-id-unusable'),
      participations: [],
    },
  ];
}

function campaignBase(
  context: DemoContext,
  input: {
    sequence: number;
    name: string;
    slug: string;
    status: CampaignStatus;
    category: Types.ObjectId;
    totalTitles?: number;
    drawMethod?: DrawMethod;
    soldCount?: number;
    reservedCount?: number;
    featured?: boolean;
    sortOrder?: number;
    launchOffsetDays?: number;
    closeOffsetDays?: number;
    drawOffsetDays?: number;
    prizeTitle?: string;
    cashAlternative?: number;
    gameMechanic?: 'roulette' | 'scratch';
  },
): AnyDocument {
  const now = context.now;
  const totalTitles = input.totalTitles ?? 1_000;
  const soldCount = input.soldCount ?? 0;
  const reservedCount = input.reservedCount ?? 0;
  const drawMethod = input.drawMethod ?? DrawMethod.FederalLottery;
  const launchAt = daysFrom(now, input.launchOffsetDays ?? -30);
  const closesAt = daysFrom(now, input.closeOffsetDays ?? 30);
  const drawDate = daysFrom(now, input.drawOffsetDays ?? 35);
  const locked = input.status !== CampaignStatus.Draft;
  const complete = soldCount >= totalTitles;
  const id = demoId(input.sequence);
  return {
    _id: id,
    name: input.name,
    slug: input.slug,
    shortDescription:
      'Campanha fictícia completa para testar compra, pagamento, títulos e prêmios.',
    description:
      '<h2>Campanha demonstrativa</h2><p>Use os dados desta campanha somente no ambiente local.</p><ul><li>Checkout Pix mock</li><li>Prêmios instantâneos</li><li>Auditoria pública</li></ul>',
    regulationHtml: TERMS_HTML,
    termsVersion: 'demo-1',
    regulationHistory: [
      {
        version: 'demo-1',
        html: TERMS_HTML,
        sha256: TERMS_HASH,
        publishedAt: daysFrom(now, -35),
      },
    ],
    media: [
      {
        mediaId: demoId(201),
        type: MediaType.Image,
        alt: `Capa de ${input.name}`,
        sortOrder: 0,
        isCover: true,
      },
    ],
    category: input.category,
    size: totalTitles <= 10 ? 'small' : totalTitles <= 100 ? 'medium' : 'large',
    costLevel: 'low',
    status: input.status,
    statusLabel:
      input.status === CampaignStatus.Active ||
      input.status === CampaignStatus.Open
        ? 'Adquira já!'
        : 'Campanha demo',
    statusText: 'Ambiente de testes manuais',
    totalTitles,
    quotaDigits: Math.max(1, String(totalTitles - 1).length, 4),
    allocationCursor: soldCount + reservedCount,
    allocationMultiplier: 1,
    allocationOffset: 0,
    soldCount,
    reservedCount,
    maxParticipants: totalTitles,
    participants: [demoId(4), demoId(5)],
    winners: [],
    launchAt,
    closesAt,
    lifecycleExtensions:
      input.status === CampaignStatus.Expired
        ? [
            {
              previousClosesAt: daysFrom(now, -10),
              closesAt: daysFrom(now, -2),
              reason: 'Prorrogação demonstrativa para testar o histórico.',
              extendedAt: daysFrom(now, -12),
              extendedBy: demoId(1),
            },
          ]
        : [],
    drawDate,
    contractLockedAt: locked ? daysFrom(now, -30) : undefined,
    contractRevision: locked ? 1 : 0,
    salesClosedAt: complete ? daysFrom(now, -3) : undefined,
    currency: 'BRL',
    itemPrice: 25_000,
    ticketPrice: 1.5,
    itemCondition: 'new',
    prizeTitle: input.prizeTitle ?? input.name,
    cashAlternative: input.cashAlternative ?? 15_000,
    minimumOrderAmount: 3,
    maxTitlesPerOrder: Math.min(totalTitles, 200),
    quantitySuggestions: [2, 5, 10, 20, 50, 100].filter(
      (quantity) => quantity <= totalTitles,
    ),
    promotionTiers: [
      {
        quantity: 10,
        totalPrice: 12,
        label: 'Leve 10 com desconto',
        active: true,
      },
      { quantity: 20, totalPrice: 20, label: 'Oferta demo', active: true },
    ].filter((tier) => tier.quantity <= totalTitles),
    drawMethod,
    drawCommitment:
      drawMethod === DrawMethod.Cryptographic
        ? sha256(`commitment:${input.slug}`)
        : undefined,
    drawCommittedAt:
      drawMethod === DrawMethod.Cryptographic ? daysFrom(now, -20) : undefined,
    drawCommittedBy:
      drawMethod === DrawMethod.Cryptographic ? demoId(1) : undefined,
    federalLottery: {
      firstPrizeDigits: 3,
      secondPrizeDigits: 3,
      combination: 'concatenate',
      contest: '6001',
      extraction: 'Extração Federal Demo',
    },
    modules: {
      showProgress: true,
      showTopBuyers: true,
      showMinMaxQuota: true,
      showInstantPrizes: true,
      showParticipantsDownload: true,
      showTitleLookup: true,
      showSocialButtons: true,
      showCountdown: true,
    },
    instantGame: {
      enabled:
        input.status === CampaignStatus.Active ||
        input.status === CampaignStatus.Open,
      mechanic: input.gameMechanic ?? 'roulette',
      noPrizeWeight: 25,
      tiers: [
        { quantity: 2, attempts: 1 },
        { quantity: 10, attempts: 3 },
      ],
    },
    notice: {
      enabled: true,
      title: 'Dados de demonstração',
      description: 'Nenhum pagamento ou prêmio deste ambiente é real.',
      startsAt: daysFrom(now, -365),
      endsAt: daysFrom(now, 365),
    },
    doubleChance: {
      enabled: input.sequence === 301,
      title: 'Chance dupla demo',
      description: 'Período fictício de títulos em dobro.',
      startsAt: daysFrom(now, -1),
      endsAt: daysFrom(now, 2),
      multiplier: 2,
    },
    contacts: {
      instagram: 'https://instagram.com/sorteios.demo',
      telegram: 'https://t.me/sorteios_demo',
      whatsapp: '5511999000001',
    },
    seo: {
      title: `${input.name} | Sorteios Demo`,
      description: 'Campanha local de demonstração para testes manuais.',
      keywords: ['sorteio', 'demo', 'teste'],
    },
    analytics: { enabled: false },
    featured: input.featured ?? false,
    sortOrder: input.sortOrder ?? 0,
    createdAt: daysFrom(now, -40),
    updatedAt: now,
    __v: 0,
  };
}

function createCampaigns(context: DemoContext): AnyDocument[] {
  return [
    campaignBase(context, {
      sequence: 301,
      name: 'Titan 160 Brasileirinha ou R$ 15 mil',
      slug: 'titan-160-brasileirinha-demo',
      status: CampaignStatus.Active,
      category: demoId(101),
      featured: true,
      sortOrder: 1,
      prizeTitle: 'Honda Titan 160 Brasileirinha 0 km',
      cashAlternative: 15_000,
    }),
    campaignBase(context, {
      sequence: 302,
      name: 'Notebook Gamer — Rascunho',
      slug: 'notebook-gamer-rascunho-demo',
      status: CampaignStatus.Draft,
      category: demoId(103),
      drawMethod: DrawMethod.Cryptographic,
      sortOrder: 20,
    }),
    campaignBase(context, {
      sequence: 303,
      name: 'Viagem para Florianópolis — Programada',
      slug: 'viagem-florianopolis-programada-demo',
      status: CampaignStatus.Scheduled,
      category: demoId(104),
      launchOffsetDays: 7,
      closeOffsetDays: 45,
      drawOffsetDays: 50,
      sortOrder: 3,
    }),
    campaignBase(context, {
      sequence: 304,
      name: 'iPhone ou R$ 8 mil — Aberta',
      slug: 'iphone-ou-8-mil-aberta-demo',
      status: CampaignStatus.Open,
      category: demoId(103),
      gameMechanic: 'scratch',
      sortOrder: 2,
    }),
    campaignBase(context, {
      sequence: 305,
      name: 'Pix de R$ 5 mil — Vencida',
      slug: 'pix-5-mil-vencida-demo',
      status: CampaignStatus.Expired,
      category: demoId(102),
      closeOffsetDays: -2,
      drawOffsetDays: 5,
    }),
    campaignBase(context, {
      sequence: 306,
      name: 'Scooter Elétrica — Esgotada',
      slug: 'scooter-eletrica-esgotada-demo',
      status: CampaignStatus.SoldOut,
      category: demoId(101),
      totalTitles: 10,
      soldCount: 10,
      closeOffsetDays: -3,
      drawOffsetDays: 5,
    }),
    campaignBase(context, {
      sequence: 307,
      name: 'Console Gamer — Aguardando Sorteio Cripto',
      slug: 'console-aguardando-cripto-demo',
      status: CampaignStatus.AwaitingDraw,
      category: demoId(103),
      totalTitles: 6,
      soldCount: 6,
      drawMethod: DrawMethod.Cryptographic,
      closeOffsetDays: -4,
      drawOffsetDays: 1,
    }),
    campaignBase(context, {
      sequence: 308,
      name: 'Smart TV — Resultado Verificado',
      slug: 'smart-tv-resultado-verificado-demo',
      status: CampaignStatus.AwaitingDraw,
      category: demoId(103),
      totalTitles: 8,
      soldCount: 8,
      drawMethod: DrawMethod.ManualExternal,
      closeOffsetDays: -5,
      drawOffsetDays: -1,
    }),
    campaignBase(context, {
      sequence: 309,
      name: 'Moto Trail — Ganhador Pendente',
      slug: 'moto-trail-ganhador-pendente-demo',
      status: CampaignStatus.Drawn,
      category: demoId(101),
      totalTitles: 5,
      soldCount: 5,
      closeOffsetDays: -10,
      drawOffsetDays: -7,
    }),
    campaignBase(context, {
      sequence: 310,
      name: 'Pix de R$ 10 mil — Prêmio Reclamado',
      slug: 'pix-10-mil-reclamado-demo',
      status: CampaignStatus.Drawn,
      category: demoId(102),
      totalTitles: 5,
      soldCount: 5,
      closeOffsetDays: -20,
      drawOffsetDays: -18,
    }),
    campaignBase(context, {
      sequence: 311,
      name: 'Honda Pop — Prêmio Entregue',
      slug: 'honda-pop-entregue-demo',
      status: CampaignStatus.Drawn,
      category: demoId(101),
      totalTitles: 5,
      soldCount: 5,
      closeOffsetDays: -40,
      drawOffsetDays: -38,
    }),
    campaignBase(context, {
      sequence: 312,
      name: 'Campanha Histórica Encerrada',
      slug: 'campanha-historica-encerrada-demo',
      status: CampaignStatus.Closed,
      category: demoId(105),
      closeOffsetDays: -90,
      drawOffsetDays: -85,
    }),
    campaignBase(context, {
      sequence: 313,
      name: 'Campanha Cancelada',
      slug: 'campanha-cancelada-demo',
      status: CampaignStatus.Cancelled,
      category: demoId(105),
      closeOffsetDays: 20,
      drawOffsetDays: 25,
    }),
  ];
}

interface CommerceFixtures {
  orders: AnyDocument[];
  payments: AnyDocument[];
  quotas: AnyDocument[];
  paymentOutbox: AnyDocument[];
  refundOperations: AnyDocument[];
  campaignCounters: Map<string, { sold: number; reserved: number }>;
  orderByLabel: Map<string, AnyDocument>;
  quotaByLabel: Map<string, AnyDocument>;
}

function createCommerce(context: DemoContext): CommerceFixtures {
  const { now } = context;
  const orders: AnyDocument[] = [];
  const payments: AnyDocument[] = [];
  const quotas: AnyDocument[] = [];
  const paymentOutbox: AnyDocument[] = [];
  const refundOperations: AnyDocument[] = [];
  const campaignCounters = new Map<
    string,
    { sold: number; reserved: number }
  >();
  const orderByLabel = new Map<string, AnyDocument>();
  const quotaByLabel = new Map<string, AnyDocument>();
  let orderSequence = 0;
  let quotaSequence = 0;

  const buyerFor = (userId?: Types.ObjectId) =>
    userId?.equals(demoId(5))
      ? {
          name: 'Maria Compradora',
          phone: '+5511999000005',
          email: `maria${DEMO_EMAIL_SUFFIX}`,
          cpf: '39053344705',
        }
      : userId
        ? {
            name: 'João Cliente',
            phone: '+5511999000004',
            email: `joao${DEMO_EMAIL_SUFFIX}`,
            cpf: '12345678909',
          }
        : {
            name: 'Cliente Visitante',
            phone: '+5511988800000',
            email: `visitante${DEMO_EMAIL_SUFFIX}`,
            cpf: '39053344705',
          };

  const addOrder = (input: {
    label: string;
    campaign: Types.ObjectId;
    status: OrderStatus;
    paymentStatus: PaymentStatus;
    quantity: number;
    user?: Types.ObjectId;
    daysAgo: number;
    provider?: PaymentProviderName;
    bonus?: number;
    quotaStatus?: QuotaStatus;
    keepQuotas?: boolean;
    referral?: boolean;
  }) => {
    orderSequence += 1;
    const orderId = demoId(4_000 + orderSequence);
    const paymentId = demoId(5_000 + orderSequence);
    const publicId = `${DEMO_ORDER_PREFIX}${String(orderSequence).padStart(3, '0')}`;
    const orderToken = `demo-order-access-${String(orderSequence).padStart(3, '0')}`;
    const paymentToken = `demo-payment-access-${String(orderSequence).padStart(3, '0')}`;
    const createdAt = daysFrom(now, -input.daysAgo);
    const allocatedQuantity = input.quantity + (input.bonus ?? 0);
    const subtotal = Number((input.quantity * 1.5).toFixed(2));
    const discount =
      input.quantity >= 10 ? Number((subtotal * 0.1).toFixed(2)) : 0;
    const total = Number((subtotal - discount).toFixed(2));
    const amountCents = Math.round(total * 100);
    const terminalNoQuota = [
      OrderStatus.Expired,
      OrderStatus.Cancelled,
      OrderStatus.Rejected,
    ].includes(input.status);
    const keepQuotas = input.keepQuotas ?? !terminalNoQuota;
    const quotaIds: Types.ObjectId[] = [];
    const titleNumbers: string[] = [];
    for (let index = 0; index < allocatedQuantity; index += 1) {
      quotaSequence += 1;
      const quotaId = demoId(100_000 + quotaSequence);
      const number = paddedQuota(quotaSequence + 100);
      titleNumbers.push(number);
      if (!keepQuotas) continue;
      const status =
        input.quotaStatus ??
        ([OrderStatus.Reserved, OrderStatus.PendingPayment].includes(
          input.status,
        )
          ? QuotaStatus.Reserved
          : input.status === OrderStatus.Refunded
            ? QuotaStatus.Refunded
            : QuotaStatus.Paid);
      const quota: AnyDocument = {
        _id: quotaId,
        campaign: input.campaign,
        allocationIndex: quotaSequence - 1,
        number,
        status,
        order: orderId,
        ...(input.user ? { user: input.user } : {}),
        ...(status === QuotaStatus.Reserved
          ? { reservedUntil: hoursFrom(now, 4) }
          : {}),
        ...([QuotaStatus.Paid, QuotaStatus.Awarded].includes(status)
          ? { paidAt: hoursFrom(createdAt, 1) }
          : {}),
        unitPrice: 1.5,
        isBonus: index >= input.quantity,
        createdAt,
        updatedAt: now,
        __v: 0,
      };
      quotaIds.push(quotaId);
      quotas.push(quota);
      quotaByLabel.set(`${input.label}:${index}`, quota);
      const key = input.campaign.toString();
      const counters = campaignCounters.get(key) ?? { sold: 0, reserved: 0 };
      if ([QuotaStatus.Paid, QuotaStatus.Awarded].includes(status))
        counters.sold += 1;
      if (status === QuotaStatus.Reserved) counters.reserved += 1;
      campaignCounters.set(key, counters);
    }

    const paidLike = [
      PaymentStatus.Paid,
      PaymentStatus.RefundPending,
      PaymentStatus.PartiallyRefunded,
      PaymentStatus.Refunded,
      PaymentStatus.UnderReview,
      PaymentStatus.Disputed,
      PaymentStatus.Chargeback,
    ].includes(input.paymentStatus);
    const refundedCents =
      input.paymentStatus === PaymentStatus.Refunded ||
      input.paymentStatus === PaymentStatus.Chargeback
        ? amountCents
        : input.paymentStatus === PaymentStatus.PartiallyRefunded
          ? Math.max(1, Math.floor(amountCents / 2))
          : 0;
    const refundReservedAmountCents =
      input.paymentStatus === PaymentStatus.RefundPending ? amountCents : 0;
    const paidAt = paidLike ? hoursFrom(createdAt, 1) : undefined;
    const buyer = buyerFor(input.user);
    const order: AnyDocument = {
      _id: orderId,
      publicId,
      accessSecret: sha256(orderToken),
      accessSecretExpiresAt: daysFrom(now, 30),
      campaign: input.campaign,
      ...(input.user ? { user: input.user } : {}),
      buyer,
      selectedQuantity: input.quantity,
      bonusQuantity: input.bonus ?? 0,
      allocatedQuantity,
      unitPrice: 1.5,
      subtotal,
      discount,
      total,
      currency: 'BRL',
      ...(input.quantity >= 10
        ? {
            promotion: {
              quantity: input.quantity,
              totalPrice: total,
              label: 'Desconto demo de 10%',
            },
          }
        : {}),
      status: input.status,
      reservedAt: createdAt,
      expiresAt: [OrderStatus.Reserved, OrderStatus.PendingPayment].includes(
        input.status,
      )
        ? hoursFrom(now, 4)
        : hoursFrom(createdAt, 4),
      ...(paidAt ? { paidAt } : {}),
      ...(input.status === OrderStatus.Cancelled
        ? { cancelledAt: hoursFrom(createdAt, 2) }
        : {}),
      ...(input.status === OrderStatus.Refunded
        ? { refundedAt: daysFrom(createdAt, 2) }
        : {}),
      quotas: quotaIds,
      titleNumbers,
      payment: paymentId,
      termsVersion: 'demo-1',
      termsHash: TERMS_HASH,
      termsAcceptedAt: createdAt,
      idempotencyKey: `demo-checkout-${String(orderSequence).padStart(3, '0')}`,
      attribution: input.referral
        ? {
            referralCode: 'JOAO10',
            referralClickId: demoId(20_001).toString(),
            source: 'instagram',
            medium: 'social',
            campaign: 'titan-demo',
            content: 'story',
            landingPage: '/campanha/titan-160-brasileirinha-demo',
          }
        : { source: 'direct', landingPage: '/' },
      instantPrizes: [],
      prizeLifecycleVersion: 0,
      statusHistory: [
        { status: OrderStatus.Reserved, at: createdAt, actor: 'demo-seed' },
        ...(input.status !== OrderStatus.Reserved
          ? [
              {
                status: input.status,
                at: hoursFrom(createdAt, 1),
                reason: 'Estado de demonstração',
                actor: 'demo-seed',
              },
            ]
          : []),
      ],
      createdAt,
      updatedAt: now,
      __v: 0,
    };
    const provider = input.provider ?? PaymentProviderName.Mock;
    const receipts = paidLike
      ? [
          {
            endToEndId: `E2E-DEMO-${String(orderSequence).padStart(6, '0')}`,
            amountCents,
            paidAt,
          },
        ]
      : [];
    const payment: AnyDocument = {
      _id: paymentId,
      order: orderId,
      campaign: input.campaign,
      ...(input.user ? { user: input.user } : {}),
      status: input.paymentStatus,
      provider,
      externalId: `charge-demo-${String(orderSequence).padStart(4, '0')}`,
      txid: `TXIDDEMO${String(orderSequence).padStart(24, '0')}`,
      ...(receipts[0] ? { endToEndId: receipts[0].endToEndId } : {}),
      endToEndIds: receipts.map((receipt) => receipt.endToEndId),
      receipts,
      providerRefunds:
        refundedCents > 0
          ? [
              {
                providerRefundId: `refund-demo-${orderSequence}`,
                endToEndId:
                  receipts[0]?.endToEndId ?? `E2E-DEMO-${orderSequence}`,
                amountCents: refundedCents,
                status:
                  refundedCents === amountCents
                    ? PaymentStatus.Refunded
                    : PaymentStatus.PartiallyRefunded,
              },
            ]
          : [],
      qrCode: `loc-demo-${orderSequence}`,
      pixCopyPaste: `00020101021226820014BR.GOV.BCB.PIX-DEMO-${orderSequence}`,
      checkoutUrl: `https://sandbox.example.test/pay/${orderSequence}`,
      amount: total,
      amountCents,
      receivedAmountCents: paidLike ? amountCents : 0,
      refundedAmountCents: refundedCents,
      refundReservedAmountCents,
      currency: PaymentCurrency.BRL,
      idempotencyKey: `demo-payment-${String(orderSequence).padStart(3, '0')}`,
      publicSecretHash: sha256(paymentToken),
      expiresAt: [
        PaymentStatus.Created,
        PaymentStatus.Pending,
        PaymentStatus.Active,
      ].includes(input.paymentStatus)
        ? hoursFrom(now, 4)
        : hoursFrom(createdAt, 4),
      ...(paidAt ? { paidAt } : {}),
      ...(input.paymentStatus === PaymentStatus.Cancelled
        ? { cancelledAt: hoursFrom(createdAt, 2) }
        : {}),
      ...(input.paymentStatus === PaymentStatus.Refunded
        ? { refundedAt: daysFrom(createdAt, 2) }
        : {}),
      refundedAmount: refundedCents / 100,
      transitionSequence: 2,
      providerPayload: { environment: 'demo', synthetic: true },
      ...(input.paymentStatus === PaymentStatus.Failed
        ? { providerError: 'Falha simulada do provedor mock' }
        : {}),
      ...(input.paymentStatus === PaymentStatus.UnderReview
        ? { lifecycleHookError: 'Revisão manual simulada' }
        : {}),
      lifecycleHookProcessedAt: now,
      statusHistory: [
        {
          status: PaymentStatus.Created,
          source: PaymentEventSource.Application,
          occurredAt: createdAt,
        },
        {
          status: input.paymentStatus,
          source:
            provider === PaymentProviderName.Efi
              ? PaymentEventSource.Webhook
              : PaymentEventSource.Admin,
          reason: 'Transição de demonstração',
          metadata: { synthetic: true },
          occurredAt: hoursFrom(createdAt, 1),
        },
      ],
      webhookPayloads:
        provider === PaymentProviderName.Efi
          ? [
              {
                fingerprint: sha256(`webhook-demo-${orderSequence}`),
                eventId: `evt-demo-${orderSequence}`,
                provider,
                payload: { status: input.paymentStatus, synthetic: true },
                receivedAt: hoursFrom(createdAt, 1),
                processedAt: hoursFrom(createdAt, 1),
              },
            ]
          : [],
      refunds:
        refundedCents > 0 || refundReservedAmountCents > 0
          ? [
              {
                idempotencyKey: `demo-refund-${orderSequence}`,
                providerRefundId:
                  refundedCents > 0
                    ? `refund-demo-${orderSequence}`
                    : undefined,
                amount: (refundedCents || refundReservedAmountCents) / 100,
                status:
                  refundReservedAmountCents > 0
                    ? PaymentStatus.RefundPending
                    : refundedCents === amountCents
                      ? PaymentStatus.Refunded
                      : PaymentStatus.PartiallyRefunded,
                providerPayload: { synthetic: true },
                requestedAt: daysFrom(createdAt, 1),
                ...(refundedCents > 0
                  ? { completedAt: daysFrom(createdAt, 2) }
                  : {}),
              },
            ]
          : [],
      createdAt,
      updatedAt: now,
      __v: 0,
    };
    orders.push(order);
    payments.push(payment);
    orderByLabel.set(input.label, order);
    paymentOutbox.push({
      _id: demoId(30_000 + orderSequence),
      eventKey: `demo-payment-lifecycle-${orderSequence}`,
      payment: paymentId,
      sequence: 2,
      orderId: publicId,
      campaignId: input.campaign.toString(),
      ...(input.user ? { userId: input.user.toString() } : {}),
      provider,
      previousStatus: PaymentStatus.Created,
      status: input.paymentStatus,
      source: PaymentEventSource.Admin,
      amountCents,
      currency: PaymentCurrency.BRL,
      txid: payment.txid,
      ...(payment.endToEndId ? { endToEndId: payment.endToEndId } : {}),
      outboxStatus:
        input.paymentStatus === PaymentStatus.Failed
          ? PaymentOutboxStatus.DeadLetter
          : PaymentOutboxStatus.Succeeded,
      completedSteps:
        input.paymentStatus === PaymentStatus.Failed
          ? []
          : ['orders', 'prizes', 'referrals', 'notifications'],
      attempts: input.paymentStatus === PaymentStatus.Failed ? 12 : 1,
      nextAttemptAt: daysFrom(now, 365),
      completedAt:
        input.paymentStatus === PaymentStatus.Failed ? undefined : now,
      lastError:
        input.paymentStatus === PaymentStatus.Failed
          ? 'Dead letter de demonstração; não será reprocessada automaticamente.'
          : undefined,
      createdAt,
      updatedAt: now,
    });
    if (refundedCents > 0) {
      refundOperations.push({
        _id: demoId(31_000 + orderSequence),
        payment: paymentId,
        idempotencyKey: `demo-refund-operation-${orderSequence}`,
        requestedAmountCents: refundedCents,
        reservedAmountCents: 0,
        succeededAmountCents: refundedCents,
        status: RefundOperationStatus.Succeeded,
        allocations: [
          {
            endToEndId: receipts[0]?.endToEndId ?? `E2E-DEMO-${orderSequence}`,
            amountCents: refundedCents,
            providerRefundId: `refund-demo-${orderSequence}`,
            status: RefundOperationStatus.Succeeded,
            providerPayload: { synthetic: true },
          },
        ],
        reason: 'Reembolso demonstrativo',
        completedAt: daysFrom(createdAt, 2),
        createdAt: daysFrom(createdAt, 1),
        updatedAt: now,
      });
    }
    return { order, payment, orderToken, paymentToken };
  };

  const activeStates: Array<{
    label: string;
    order: OrderStatus;
    payment: PaymentStatus;
    quota?: QuotaStatus;
    keep?: boolean;
  }> = [
    {
      label: 'reserved',
      order: OrderStatus.Reserved,
      payment: PaymentStatus.Created,
    },
    {
      label: 'pending',
      order: OrderStatus.PendingPayment,
      payment: PaymentStatus.Pending,
    },
    {
      label: 'active-payment',
      order: OrderStatus.PendingPayment,
      payment: PaymentStatus.Active,
    },
    { label: 'paid', order: OrderStatus.Paid, payment: PaymentStatus.Paid },
    {
      label: 'expired',
      order: OrderStatus.Expired,
      payment: PaymentStatus.Expired,
      keep: false,
    },
    {
      label: 'cancelled',
      order: OrderStatus.Cancelled,
      payment: PaymentStatus.Cancelled,
      keep: false,
    },
    {
      label: 'rejected',
      order: OrderStatus.Rejected,
      payment: PaymentStatus.Rejected,
      keep: false,
    },
    {
      label: 'failed',
      order: OrderStatus.Rejected,
      payment: PaymentStatus.Failed,
      keep: false,
    },
    {
      label: 'refund-pending',
      order: OrderStatus.InReview,
      payment: PaymentStatus.RefundPending,
    },
    {
      label: 'partially-refunded',
      order: OrderStatus.InReview,
      payment: PaymentStatus.PartiallyRefunded,
    },
    {
      label: 'refunded',
      order: OrderStatus.Refunded,
      payment: PaymentStatus.Refunded,
      quota: QuotaStatus.Refunded,
    },
    {
      label: 'under-review',
      order: OrderStatus.InReview,
      payment: PaymentStatus.UnderReview,
    },
    {
      label: 'disputed',
      order: OrderStatus.Disputed,
      payment: PaymentStatus.Disputed,
    },
    {
      label: 'chargeback',
      order: OrderStatus.Disputed,
      payment: PaymentStatus.Chargeback,
      quota: QuotaStatus.Refunded,
    },
  ];
  activeStates.forEach((state, index) =>
    addOrder({
      label: state.label,
      campaign: demoId(301),
      status: state.order,
      paymentStatus: state.payment,
      quantity: index === 3 ? 10 : 2,
      bonus: index === 3 ? 2 : 0,
      user: index % 4 === 1 ? demoId(5) : demoId(4),
      daysAgo: index + 1,
      provider:
        index === 12 ? PaymentProviderName.Efi : PaymentProviderName.Mock,
      quotaStatus: state.quota,
      keepQuotas: state.keep,
      referral: index === 3 || index === 8,
    }),
  );

  const guest = addOrder({
    label: 'guest-paid',
    campaign: demoId(301),
    status: OrderStatus.Paid,
    paymentStatus: PaymentStatus.Paid,
    quantity: 3,
    daysAgo: 2,
    referral: true,
  });

  const specialCampaigns = [
    { label: 'sold-out', campaign: demoId(306), quantity: 10, daysAgo: 4 },
    {
      label: 'awaiting-crypto',
      campaign: demoId(307),
      quantity: 6,
      daysAgo: 6,
    },
    {
      label: 'awaiting-manual',
      campaign: demoId(308),
      quantity: 8,
      daysAgo: 8,
    },
    { label: 'main-pending', campaign: demoId(309), quantity: 5, daysAgo: 9 },
    { label: 'main-claimed', campaign: demoId(310), quantity: 5, daysAgo: 19 },
    {
      label: 'main-fulfilled',
      campaign: demoId(311),
      quantity: 5,
      daysAgo: 39,
    },
  ];
  specialCampaigns.forEach((entry) =>
    addOrder({
      ...entry,
      status: OrderStatus.Paid,
      paymentStatus: PaymentStatus.Paid,
      user: demoId(4),
    }),
  );

  refundOperations.push({
    _id: demoId(31_999),
    payment: payments.find((payment) => payment.status === PaymentStatus.Failed)
      ?._id,
    idempotencyKey: 'demo-refund-operation-failed',
    requestedAmountCents: 100,
    reservedAmountCents: 0,
    succeededAmountCents: 0,
    status: RefundOperationStatus.Failed,
    allocations: [],
    reason: 'Falha terminal demonstrativa',
    lastError: 'Pagamento sem recebimento suficiente.',
    completedAt: now,
    createdAt: daysFrom(now, -3),
    updatedAt: now,
  });

  orderByLabel.set('guest', guest.order);
  return {
    orders,
    payments,
    quotas,
    paymentOutbox,
    refundOperations,
    campaignCounters,
    orderByLabel,
    quotaByLabel,
  };
}

function applyCampaignRelationships(
  campaigns: AnyDocument[],
  commerce: CommerceFixtures,
): void {
  for (const campaign of campaigns) {
    const counters = commerce.campaignCounters.get(campaign._id.toString());
    if (counters && campaign._id.equals(demoId(301))) {
      campaign.soldCount = counters.sold;
      campaign.reservedCount = counters.reserved;
      campaign.allocationCursor = counters.sold + counters.reserved;
    }
  }
}

interface PrizeFixtures {
  prizes: AnyDocument[];
  attempts: AnyDocument[];
  awards: AnyDocument[];
}

function createInstantPrizes(
  context: DemoContext,
  commerce: CommerceFixtures,
): PrizeFixtures {
  const now = context.now;
  const campaign = demoId(301);
  const paidOrder = commerce.orderByLabel.get('paid');
  if (!paidOrder) throw new Error('No se encontró el pedido demo pagado');
  const prizes: AnyDocument[] = [
    {
      _id: demoId(601),
      campaign,
      title: 'Pix de R$ 100',
      description: 'Prêmio ativo de roleta para testes.',
      mechanic: PrizeMechanic.Roulette,
      cashValue: 100,
      mediaId: demoId(201),
      stock: 100,
      awardedCount: 1,
      weight: 15,
      status: InstantPrizeStatus.Active,
      sortOrder: 1,
    },
    {
      _id: demoId(602),
      campaign,
      title: 'Vale-compras de R$ 250',
      mechanic: PrizeMechanic.Scratch,
      cashValue: 250,
      stock: 10,
      awardedCount: 1,
      weight: 8,
      status: InstantPrizeStatus.Active,
      sortOrder: 2,
    },
    {
      _id: demoId(603),
      campaign,
      title: 'Capacete Premium',
      mechanic: PrizeMechanic.WinningTitle,
      quotaNumber: '000042',
      alternativeTitle: 'R$ 500 via Pix',
      cashValue: 500,
      stock: 1,
      awardedCount: 0,
      weight: 1,
      status: InstantPrizeStatus.Active,
      sortOrder: 3,
    },
    {
      _id: demoId(604),
      campaign,
      title: 'Prêmio Esgotado',
      mechanic: PrizeMechanic.Roulette,
      stock: 1,
      awardedCount: 1,
      weight: 5,
      status: InstantPrizeStatus.Exhausted,
      sortOrder: 4,
    },
    {
      _id: demoId(605),
      campaign,
      title: 'Pix Adjudicado',
      mechanic: PrizeMechanic.Roulette,
      cashValue: 50,
      stock: 1,
      awardedCount: 1,
      weight: 5,
      status: InstantPrizeStatus.Awarded,
      order: paidOrder._id,
      winner: demoId(4),
      winnerSnapshot: { name: 'João Cliente', phone: '+5511999000004' },
      awardedAt: daysFrom(now, -4),
      sortOrder: 5,
    },
    {
      _id: demoId(606),
      campaign,
      title: 'Smartwatch Reclamado',
      mechanic: PrizeMechanic.Scratch,
      stock: 1,
      awardedCount: 1,
      weight: 4,
      status: InstantPrizeStatus.Claimed,
      order: paidOrder._id,
      winner: demoId(4),
      winnerSnapshot: { name: 'João Cliente', phone: '+5511999000004' },
      awardedAt: daysFrom(now, -6),
      claimedAt: daysFrom(now, -5),
      sortOrder: 6,
    },
    {
      _id: demoId(607),
      campaign,
      title: 'Caixa de Som Entregue',
      mechanic: PrizeMechanic.Roulette,
      stock: 1,
      awardedCount: 1,
      weight: 3,
      status: InstantPrizeStatus.Fulfilled,
      order: paidOrder._id,
      winner: demoId(4),
      winnerSnapshot: { name: 'João Cliente', phone: '+5511999000004' },
      awardedAt: daysFrom(now, -12),
      claimedAt: daysFrom(now, -11),
      fulfilledAt: daysFrom(now, -10),
      sortOrder: 7,
    },
    {
      _id: demoId(608),
      campaign,
      title: 'Prêmio Cancelado',
      mechanic: PrizeMechanic.Roulette,
      stock: 1,
      awardedCount: 0,
      weight: 1,
      status: InstantPrizeStatus.Cancelled,
      sortOrder: 8,
    },
  ].map((row) => ({
    ...row,
    createdAt: daysFrom(now, -20),
    updatedAt: now,
    __v: 0,
  }));

  const attemptStates = [
    {
      status: PrizeAttemptStatus.Pending,
      outcome: undefined,
      prize: undefined,
    },
    {
      status: PrizeAttemptStatus.Played,
      outcome: PrizeAttemptOutcome.NoPrize,
      prize: undefined,
    },
    {
      status: PrizeAttemptStatus.Played,
      outcome: PrizeAttemptOutcome.Awarded,
      prize: demoId(605),
    },
    {
      status: PrizeAttemptStatus.Played,
      outcome: PrizeAttemptOutcome.InventoryExhausted,
      prize: demoId(604),
    },
    {
      status: PrizeAttemptStatus.Expired,
      outcome: undefined,
      prize: undefined,
    },
    {
      status: PrizeAttemptStatus.Played,
      outcome: PrizeAttemptOutcome.Awarded,
      prize: demoId(606),
    },
    {
      status: PrizeAttemptStatus.Played,
      outcome: PrizeAttemptOutcome.Awarded,
      prize: demoId(607),
    },
  ];
  const attempts = attemptStates.map((state, index): AnyDocument => ({
    _id: demoId(700 + index + 1),
    publicId: `demo-attempt-${String(index + 1).padStart(3, '0')}`,
    accessSecret: sha256(`demo-attempt-secret-${index + 1}`),
    accessSecretExpiresAt: daysFrom(now, 30),
    campaign,
    order: paidOrder._id,
    user: demoId(4),
    mechanic: index === 5 ? PrizeMechanic.Scratch : PrizeMechanic.Roulette,
    status: state.status,
    ...(state.prize ? { prize: state.prize, drawnPrize: state.prize } : {}),
    outcome: state.outcome,
    ordinal: index,
    ...(state.status === PrizeAttemptStatus.Played
      ? { playedAt: daysFrom(now, -(index + 1)) }
      : {}),
    entropyCommitment: sha256(`demo-commitment-${index + 1}`),
    configurationHash: sha256(`demo-configuration-${index + 1}`),
    configurationSnapshot: {
      version: 1,
      mechanic: index === 5 ? PrizeMechanic.Scratch : PrizeMechanic.Roulette,
      noPrizeWeight: 25,
      prizes: [
        {
          prizeId: demoId(601).toString(),
          weight: 15,
          stock: 100,
          sortOrder: 1,
        },
        { prizeId: demoId(605).toString(), weight: 5, stock: 1, sortOrder: 5 },
      ],
    },
    entropyReveal: `demo-entropy-reveal-${index + 1}`,
    createdAt: daysFrom(now, -(index + 8)),
    updatedAt: now,
    __v: 0,
  }));
  const awardSpecs = [
    { id: 801, prize: 605, attempt: 703, status: PrizeAwardStatus.Awarded },
    { id: 802, prize: 606, attempt: 706, status: PrizeAwardStatus.Claimed },
    { id: 803, prize: 607, attempt: 707, status: PrizeAwardStatus.Fulfilled },
    {
      id: 804,
      prize: 601,
      attempt: undefined,
      status: PrizeAwardStatus.Reversed,
    },
  ];
  const awards = awardSpecs.map((spec, index): AnyDocument => ({
    _id: demoId(spec.id),
    publicId: `demo-prize-award-${index + 1}`,
    campaign,
    prize: demoId(spec.prize),
    order: paidOrder._id,
    ...(spec.attempt ? { attempt: demoId(spec.attempt) } : {}),
    user: demoId(4),
    mechanic:
      spec.prize === 606 ? PrizeMechanic.Scratch : PrizeMechanic.Roulette,
    title: prizes.find((prize) => prize._id.equals(demoId(spec.prize)))?.title,
    description: 'Adjudicação fictícia para testar o fluxo de prêmio.',
    cashValue: spec.prize === 605 ? 50 : undefined,
    winnerSnapshot: { name: 'João Cliente', phone: '+5511999000004' },
    status: spec.status,
    awardedAt: daysFrom(now, -(index + 5)),
    ...([PrizeAwardStatus.Claimed, PrizeAwardStatus.Fulfilled].includes(
      spec.status,
    )
      ? { claimedAt: daysFrom(now, -(index + 4)) }
      : {}),
    ...(spec.status === PrizeAwardStatus.Fulfilled
      ? {
          fulfilledAt: daysFrom(now, -2),
          fulfilledBy: demoId(3),
          fulfillmentReference: 'ENTREGA-DEMO-001',
          fulfillmentNotes: 'Entregue em mãos no cenário demonstrativo.',
        }
      : {}),
    ...(spec.status === PrizeAwardStatus.Reversed
      ? { reversedAt: daysFrom(now, -1) }
      : {}),
    createdAt: daysFrom(now, -(index + 5)),
    updatedAt: now,
    __v: 0,
  }));
  attempts[2].award = demoId(801);
  attempts[5].award = demoId(802);
  attempts[6].award = demoId(803);
  paidOrder.instantPrizes = awards.map((award) => award._id);
  return { prizes, attempts, awards };
}

interface DrawFixtures {
  results: AnyDocument[];
  mainAwards: AnyDocument[];
}

function createDraws(
  context: DemoContext,
  commerce: CommerceFixtures,
  campaigns: AnyDocument[],
): DrawFixtures {
  const now = context.now;
  const specs = [
    {
      campaign: 308,
      order: 'awaiting-manual',
      result: 901,
      status: DrawResultStatus.Verified,
      method: DrawMethod.ManualExternal,
    },
    {
      campaign: 309,
      order: 'main-pending',
      result: 902,
      status: DrawResultStatus.Published,
      method: DrawMethod.FederalLottery,
      mainStatus: MainPrizeAwardStatus.Pending,
    },
    {
      campaign: 310,
      order: 'main-claimed',
      result: 903,
      status: DrawResultStatus.Published,
      method: DrawMethod.FederalLottery,
      mainStatus: MainPrizeAwardStatus.Claimed,
      choice: MainPrizeChoice.Physical,
    },
    {
      campaign: 311,
      order: 'main-fulfilled',
      result: 904,
      status: DrawResultStatus.Published,
      method: DrawMethod.FederalLottery,
      mainStatus: MainPrizeAwardStatus.Fulfilled,
      choice: MainPrizeChoice.Cash,
    },
  ];
  const results: AnyDocument[] = [];
  const mainAwards: AnyDocument[] = [];
  for (const [index, spec] of specs.entries()) {
    const order = commerce.orderByLabel.get(spec.order);
    const quota = commerce.quotaByLabel.get(`${spec.order}:1`);
    const campaign = campaigns.find((row) =>
      row._id.equals(demoId(spec.campaign)),
    );
    if (!order || !quota || !campaign) {
      throw new Error(`Faltan relaciones para el sorteo ${spec.campaign}`);
    }
    const published = spec.status === DrawResultStatus.Published;
    const result: AnyDocument = {
      _id: demoId(spec.result),
      campaign: campaign._id,
      method: spec.method,
      status: spec.status,
      contest: `60${index + 10}`,
      extraction: 'Extração Federal Demo',
      firstPrize: '12345',
      secondPrize: '67890',
      sourceUrl: 'https://servicebus3.caixa.gov.br/',
      sourcePublishedAt: daysFrom(now, -(index + 7)),
      sourceFetchedAt: daysFrom(now, -(index + 7)),
      sourceConfirmedAt: daysFrom(now, -(index + 7)),
      sourceBodySha256: sha256(`demo-source-${spec.result}`),
      sourceConfirmationBodySha256: sha256(`demo-confirmation-${spec.result}`),
      calculationRule:
        'Últimos dígitos do primeiro e segundo prêmios (demonstração).',
      evidenceHash: sha256(`demo-evidence-${spec.result}`),
      outcomes: [
        {
          position: 1,
          prizeTitle: campaign.prizeTitle,
          winningNumber: quota.number,
          quota: quota._id,
          order: order._id,
          user: demoId(4),
          winnerSnapshot: { name: 'João Cliente', phone: '+5511999000004' },
        },
      ],
      rawEvidence: { synthetic: true, source: 'demo-seed' },
      verifiedBy: demoId(1),
      verifiedAt: daysFrom(now, -(index + 6)),
      ...(published
        ? {
            publishedBy: demoId(2),
            publishedAt: daysFrom(now, -(index + 5)),
          }
        : {}),
      createdAt: daysFrom(now, -(index + 7)),
      updatedAt: now,
      __v: 0,
    };
    results.push(result);
    if (!spec.mainStatus) continue;
    quota.status = QuotaStatus.Awarded;
    campaign.mainWinner = demoId(4);
    campaign.winners = [demoId(4)];
    campaign.winningQuotaNumber = quota.number;
    campaign.resultPublishedAt = result.publishedAt;
    const claimed = [
      MainPrizeAwardStatus.Claimed,
      MainPrizeAwardStatus.Fulfilled,
    ].includes(spec.mainStatus);
    const fulfilled = spec.mainStatus === MainPrizeAwardStatus.Fulfilled;
    mainAwards.push({
      _id: demoId(920 + index),
      publicId: `demo-main-award-${index + 1}`,
      campaign: campaign._id,
      drawResult: result._id,
      quota: quota._id,
      order: order._id,
      orderPublicId: order.publicId,
      user: demoId(4),
      prizeTitle: campaign.prizeTitle,
      cashAlternative: campaign.cashAlternative,
      currency: 'BRL',
      winningNumber: quota.number,
      winnerSnapshot: {
        name: 'João Cliente',
        phone: '+5511999000004',
        email: `joao${DEMO_EMAIL_SUFFIX}`,
      },
      status: spec.mainStatus,
      ...(spec.choice ? { choice: spec.choice } : {}),
      ...(claimed
        ? {
            claimSource: MainPrizeClaimSource.Account,
            deliveryDetails:
              spec.choice === MainPrizeChoice.Physical
                ? {
                    recipientName: 'João Cliente',
                    phone: '+5511999000004',
                    address: 'Rua das Flores, 123 - Campinas/SP',
                    instructions: 'Ligar antes da entrega.',
                  }
                : undefined,
            claimedByUser: demoId(4),
            claimedAt: daysFrom(now, -(index + 3)),
          }
        : {}),
      ...(fulfilled
        ? {
            fulfilledAt: daysFrom(now, -2),
            fulfilledBy: demoId(3),
            fulfillmentReference: 'PIX-DEMO-PRINCIPAL-001',
            fulfillmentNotes:
              'Alternativa em dinheiro entregue no cenário demo.',
          }
        : {}),
      awardedAt: result.publishedAt,
      inboxNotificationQueuedAt: result.publishedAt,
      emailNotificationQueuedAt: result.publishedAt,
      notificationCompletedAt: result.publishedAt,
      notificationAttempts: 1,
      notificationNextAttemptAt: daysFrom(now, 365),
      createdAt: result.publishedAt,
      updatedAt: now,
      __v: 0,
    });
  }
  return { results, mainAwards };
}

function createReferrals(
  context: DemoContext,
  commerce: CommerceFixtures,
): {
  codes: AnyDocument[];
  clicks: AnyDocument[];
  commissions: AnyDocument[];
} {
  const now = context.now;
  const codes: AnyDocument[] = [
    {
      _id: demoId(20_000),
      code: 'JOAO10',
      beneficiaryUser: demoId(4),
      label: 'Código principal de João',
      status: ReferralCodeStatus.Active,
      commissionRateBps: 1_000,
      currency: 'BRL',
      campaignId: demoId(301).toString(),
      validFrom: daysFrom(now, -60),
      validUntil: daysFrom(now, 180),
      maxConversions: 100,
      clicksCount: 3,
      conversionsCount: 3,
      metadata: { channel: 'instagram', synthetic: true },
    },
    {
      _id: demoId(20_010),
      code: 'MARIA5',
      beneficiaryUser: demoId(5),
      label: 'Código pausado',
      status: ReferralCodeStatus.Paused,
      commissionRateBps: 500,
      currency: 'BRL',
      clicksCount: 1,
      conversionsCount: 0,
      metadata: { synthetic: true },
    },
    {
      _id: demoId(20_020),
      code: 'GLOBALDEMO',
      label: 'Código global desativado',
      status: ReferralCodeStatus.Disabled,
      commissionRateBps: 250,
      currency: 'BRL',
      clicksCount: 5,
      conversionsCount: 1,
      metadata: { synthetic: true },
    },
  ].map((row, index) => ({
    ...row,
    createdAt: daysFrom(now, -(30 + index)),
    updatedAt: now,
    __v: 0,
  }));
  const clicks = [0, 1, 2, 3].map((index): AnyDocument => {
    const converted = index < 3;
    const order = commerce.orders[index + 3];
    return {
      _id: demoId(20_001 + index),
      referralCode: index === 3 ? demoId(20_010) : demoId(20_000),
      code: index === 3 ? 'MARIA5' : 'JOAO10',
      eventId: `demo-referral-click-${index + 1}`,
      visitorId: `visitor-demo-${index + 1}`,
      user: index % 2 ? demoId(5) : demoId(4),
      campaignId: demoId(301).toString(),
      landingPath: '/campanha/titan-160-brasileirinha-demo',
      referrer: 'https://instagram.com/',
      utmSource: 'instagram',
      utmMedium: index === 0 ? 'story' : 'bio',
      utmCampaign: 'titan-demo',
      utmContent: `creative-${index + 1}`,
      ipHash: sha256(`demo-ip-${index + 1}`),
      userAgent: 'Demo Browser/1.0',
      ...(converted
        ? {
            attributedOrderId: order.publicId,
            convertedAt: daysFrom(now, -(index + 1)),
          }
        : {}),
      metadata: { synthetic: true },
      expiresAt: daysFrom(now, 180),
      createdAt: daysFrom(now, -(index + 4)),
      updatedAt: now,
      __v: 0,
    };
  });
  const commissionStatuses = [
    ReferralCommissionStatus.Pending,
    ReferralCommissionStatus.Approved,
    ReferralCommissionStatus.Paid,
    ReferralCommissionStatus.Rejected,
    ReferralCommissionStatus.Reversed,
  ];
  const commissions = commissionStatuses.map((status, index): AnyDocument => {
    const order = commerce.orders[index + 3];
    const amount = Number(order.total);
    const commissionAmount = Number((amount * 0.1).toFixed(2));
    return {
      _id: demoId(21_000 + index),
      referralCode: demoId(20_000),
      code: 'JOAO10',
      orderId: order.publicId,
      click: clicks[index % 3]._id,
      beneficiaryUser: demoId(4),
      buyerUser: demoId(5),
      orderAmount: amount,
      commissionBase: amount,
      commissionRateBps: 1_000,
      commissionAmount,
      currency: 'BRL',
      status,
      statusChangedAt: daysFrom(now, -(index + 1)),
      ...(status === ReferralCommissionStatus.Approved
        ? { approvedAt: daysFrom(now, -2) }
        : {}),
      ...(status === ReferralCommissionStatus.Paid
        ? { approvedAt: daysFrom(now, -4), paidAt: daysFrom(now, -2) }
        : {}),
      ...(status === ReferralCommissionStatus.Rejected
        ? {
            rejectedAt: daysFrom(now, -1),
            conversionReleasedAt: daysFrom(now, -1),
            statusReason: 'Pedido rejeitado no cenário demo.',
          }
        : {}),
      ...(status === ReferralCommissionStatus.Reversed
        ? {
            reversedAt: daysFrom(now, -1),
            conversionReleasedAt: daysFrom(now, -1),
            statusReason: 'Pagamento estornado no cenário demo.',
          }
        : {}),
      metadata: { synthetic: true },
      createdAt: daysFrom(now, -(index + 6)),
      updatedAt: now,
      __v: 0,
    };
  });
  return { codes, clicks, commissions };
}

function createNotifications(context: DemoContext): {
  notifications: AnyDocument[];
  preferences: AnyDocument[];
  pushSubscriptions: AnyDocument[];
} {
  const now = context.now;
  const types = Object.values(NotificationType);
  const delivery = [
    NotificationDeliveryStatus.Pending,
    NotificationDeliveryStatus.Processing,
    NotificationDeliveryStatus.Skipped,
    NotificationDeliveryStatus.Sent,
    NotificationDeliveryStatus.PartiallySent,
    NotificationDeliveryStatus.Failed,
    NotificationDeliveryStatus.Sent,
  ];
  const notifications = types.map((type, index): AnyDocument => ({
    _id: demoId(22_000 + index),
    user: demoId(4),
    title: [
      'Bem-vindo ao ambiente demo',
      'Campanha em reta final',
      'Pedido confirmado',
      'Pagamento recebido',
      'Você ganhou!',
      'Oferta especial de demonstração',
      'Atualização do sistema',
    ][index],
    body: 'Esta é uma notificação fictícia criada para testes manuais.',
    type,
    eventKey: `demo-notification-${type}`,
    data: {
      campaignId: demoId(301).toString(),
      orderPublicId: `${DEMO_ORDER_PREFIX}004`,
      synthetic: true,
    },
    imageUrl: `/api/v1/media/${demoId(201).toString()}`,
    actionUrl:
      type === NotificationType.Winner
        ? '/premios'
        : '/campanha/titan-160-brasileirinha-demo',
    ...(index % 2 === 0 ? { readAt: daysFrom(now, -(index + 1)) } : {}),
    deliveryStatus: delivery[index],
    pushRequested: false,
    scheduledAt: daysFrom(now, 365),
    deliveryAttempts:
      delivery[index] === NotificationDeliveryStatus.Failed ? 5 : 1,
    lastDeliveryAttemptAt: daysFrom(now, -(index + 1)),
    deliveryProvider: 'noop',
    deliveryCode:
      delivery[index] === NotificationDeliveryStatus.Sent
        ? NotificationDeliveryCode.Delivered
        : delivery[index] === NotificationDeliveryStatus.Failed
          ? NotificationDeliveryCode.DeliveryFailed
          : NotificationDeliveryCode.NoSubscriptions,
    deliveryAccepted:
      delivery[index] === NotificationDeliveryStatus.Sent ? 1 : 0,
    deliveryRejected:
      delivery[index] === NotificationDeliveryStatus.PartiallySent ? 1 : 0,
    deliveryInvalidSubscriptions: 0,
    ...(delivery[index] === NotificationDeliveryStatus.Sent
      ? { deliveredAt: daysFrom(now, -(index + 1)) }
      : {}),
    ...(delivery[index] === NotificationDeliveryStatus.Failed
      ? {
          lastDeliveryError:
            'Falha de demonstração; nenhum push real foi enviado.',
        }
      : {}),
    createdBy: demoId(1).toString(),
    expiresAt: daysFrom(now, 365),
    createdAt: daysFrom(now, -(index + 1)),
    updatedAt: now,
    __v: 0,
  }));
  return {
    notifications,
    preferences: [
      {
        _id: demoId(23_001),
        user: demoId(4),
        inAppEnabled: true,
        pushEnabled: false,
        transactionalEnabled: true,
        marketingEnabled: true,
        mutedTypes: [],
        timezoneOffsetMinutes: -180,
        createdAt: daysFrom(now, -30),
        updatedAt: now,
        __v: 0,
      },
      {
        _id: demoId(23_002),
        user: demoId(5),
        inAppEnabled: true,
        pushEnabled: false,
        transactionalEnabled: true,
        marketingEnabled: false,
        mutedTypes: [NotificationType.Promotion],
        quietHoursStart: '22:00',
        quietHoursEnd: '08:00',
        timezoneOffsetMinutes: -180,
        createdAt: daysFrom(now, -15),
        updatedAt: now,
        __v: 0,
      },
    ],
    pushSubscriptions: [
      {
        _id: demoId(23_100),
        user: demoId(4),
        provider: PushProviderKind.WebPush,
        address: 'https://push.invalid.example.test/demo-disabled',
        credentials: {},
        deviceId: 'demo-disabled-device',
        locale: 'pt-BR',
        timezone: 'America/Sao_Paulo',
        enabled: false,
        disabledAt: daysFrom(now, -1),
        disableReason: PushSubscriptionDisableReason.Invalid,
        lastSeenAt: daysFrom(now, -2),
        expiresAt: daysFrom(now, 365),
        metadata: { synthetic: true },
        createdAt: daysFrom(now, -10),
        updatedAt: now,
        __v: 0,
      },
    ],
  };
}

function createSettings(context: DemoContext): {
  versions: AnyDocument[];
  counters: AnyDocument[];
} {
  const now = context.now;
  const configuration = {
    brand: {
      siteName: 'Sorteios Demo',
      legalName: 'Sorteios Demo LTDA',
      tagline: 'Escolha seus números e teste todos os fluxos',
      logoUrl: `/api/v1/media/${demoId(201).toString()}`,
      faviconUrl: `/api/v1/media/${demoId(201).toString()}`,
    },
    contact: {
      supportEmail: `suporte${DEMO_EMAIL_SUFFIX}`,
      supportPhone: '+5511999000001',
      whatsapp: '5511999000001',
      address: 'Avenida Paulista, 1000 - São Paulo/SP',
    },
    social: {
      instagram: 'https://instagram.com/sorteios.demo',
      facebook: 'https://facebook.com/sorteios.demo',
      youtube: 'https://youtube.com/@sorteiosdemo',
      telegram: 'https://t.me/sorteios_demo',
      tiktok: 'https://tiktok.com/@sorteios.demo',
      x: 'https://x.com/sorteios_demo',
    },
    theme: {
      mode: ThemeMode.DARK,
      primaryColor: '#22C55E',
      secondaryColor: '#111827',
      accentColor: '#F59E0B',
      backgroundColor: '#030712',
    },
    legal: {
      privacyPolicyUrl: '/privacidade',
      termsUrl: '/termos',
      responsibleCompany: 'Sorteios Demo LTDA',
      cnpj: '12.345.678/0001-90',
      regulationText: 'Ambiente exclusivamente local com dados fictícios.',
    },
    featureFlags: {
      notifications: true,
      referrals: true,
      instantPrizes: true,
      rankings: true,
      auditLookup: true,
      socialCtas: true,
      pwaInstall: true,
      progressBar: true,
    },
  };
  return {
    versions: [
      {
        _id: demoId(24_001),
        version: 1,
        status: SettingsVersionStatus.ARCHIVED,
        ...configuration,
        createdBy: demoId(1).toString(),
        changeNote: 'Versão histórica de demonstração.',
        publishedBy: demoId(1).toString(),
        publishedAt: daysFrom(now, -60),
        createdAt: daysFrom(now, -70),
        updatedAt: daysFrom(now, -50),
      },
      {
        _id: demoId(24_002),
        version: 2,
        status: SettingsVersionStatus.PUBLISHED,
        ...configuration,
        createdBy: demoId(1).toString(),
        changeNote: 'Configuração pública completa para testes manuais.',
        publishedBy: demoId(2).toString(),
        publishedAt: daysFrom(now, -30),
        createdAt: daysFrom(now, -35),
        updatedAt: daysFrom(now, -30),
      },
      {
        _id: demoId(24_003),
        version: 3,
        status: SettingsVersionStatus.DRAFT,
        ...configuration,
        brand: {
          ...configuration.brand,
          tagline: 'Rascunho editável de demonstração',
        },
        createdBy: demoId(3).toString(),
        changeNote: 'Edite e publique esta versão para testar o módulo.',
        createdAt: daysFrom(now, -2),
        updatedAt: now,
      },
    ],
    counters: [{ _id: 'site-settings', nextVersion: 3, publishedVersion: 2 }],
  };
}

function createInternalFixtures(context: DemoContext): {
  bootstrap: AnyDocument[];
  refreshSessions: AnyDocument[];
  emailVerifications: AnyDocument[];
  emailOutbox: AnyDocument[];
  accessChallenges: AnyDocument[];
  auditLogs: AnyDocument[];
} {
  const now = context.now;
  const auditCategories = Object.values(AuditCategory);
  const auditLogs = Array.from({ length: 8 }, (_, index): AnyDocument => ({
    _id: demoId(25_000 + index),
    action: [
      'security.bootstrap.first_admin',
      'auth.login.success',
      'campaign.create',
      'payment.status.update',
      'draw.verify',
      'settings.version.publish',
      'media.read',
      'auth.login.failure',
    ][index],
    category: auditCategories[index % auditCategories.length],
    actorId:
      index === 7 ? demoId(6).toString() : demoId((index % 3) + 1).toString(),
    actorRole:
      index % 3 === 2
        ? UserRole.OPERATOR
        : index === 7
          ? UserRole.CUSTOMER
          : UserRole.ADMIN,
    ip: '127.0.0.1',
    userAgent: 'Demo Seed/1.0',
    resourceType: ['User', 'Session', 'Raffle', 'Payment'][index % 4],
    resourceId: `demo-resource-${index + 1}`,
    before: index > 1 ? { status: 'before' } : undefined,
    after: index > 1 ? { status: 'after', synthetic: true } : undefined,
    metadata: { synthetic: true, note: 'Evento de auditoria demonstrativo' },
    correlationId: `demo-correlation-${String(index + 1).padStart(3, '0')}`,
    outcome: index === 7 ? AuditOutcome.FAILURE : AuditOutcome.SUCCESS,
    ...(index === 7
      ? {
          errorCode: 'DEMO_LOGIN_REJECTED',
          errorMessage: 'Falha fictícia de login.',
        }
      : {}),
    expiresAt: daysFrom(now, 365),
    createdAt: daysFrom(now, -(index + 1)),
  }));
  return {
    bootstrap: [
      {
        _id: 'first-admin',
        operation: 'first-admin',
        userId: demoId(1),
        initializedAt: daysFrom(now, -120),
        createdAt: daysFrom(now, -120),
      },
    ],
    refreshSessions: [
      {
        _id: demoId(25_100),
        user: demoId(4),
        authVersion: 0,
        familyId: 'demo-revoked-session-family',
        tokenHash: sha256('demo-refresh-token-unusable'),
        expiresAt: daysFrom(now, 30),
        revokedAt: daysFrom(now, -1),
        revokeReason: 'Sesión ficticia revocada; no es utilizable.',
        createdAt: daysFrom(now, -5),
        updatedAt: daysFrom(now, -1),
        __v: 0,
      },
    ],
    emailVerifications: [
      {
        _id: demoId(25_200),
        email: `pendente${DEMO_EMAIL_SUFFIX}`,
        codeHash: sha256('demo-verification-code-unusable'),
        bindingHash: sha256('demo-registration-binding-unusable'),
        attempts: 1,
        purpose: EmailVerificationPurpose.Registration,
        createdAt: now,
        expiresAt: hoursFrom(now, 24),
        __v: 0,
      },
    ],
    emailOutbox: [
      {
        _id: demoId(25_300),
        eventKey: 'demo-main-award-email-sent',
        recipient: `joao${DEMO_EMAIL_SUFFIX}`,
        subject: 'Você ganhou um prêmio — demonstração',
        body: 'Mensagem fictícia já marcada como enviada.',
        status: TransactionalEmailStatus.Sent,
        attempts: 1,
        nextAttemptAt: daysFrom(now, 365),
        sentAt: daysFrom(now, -5),
        expiresAt: daysFrom(now, 30),
        createdAt: daysFrom(now, -5),
        updatedAt: daysFrom(now, -5),
        __v: 0,
      },
    ],
    accessChallenges: [
      {
        _id: demoId(25_400),
        challengeId: 'demo-expired-recovery-challenge',
        codeHash: sha256('demo-recovery-code-unusable'),
        identityHash: sha256('identity-not-linked-to-demo-users'),
        orderIds: [],
        truncated: false,
        campaignId: null,
        campaignIds: [],
        attempts: 5,
        createdAt: now,
        expiresAt: hoursFrom(now, 24),
      },
    ],
    auditLogs,
  };
}

function createLegacyFixtures(context: DemoContext): {
  products: AnyDocument[];
  transactions: AnyDocument[];
} {
  const now = context.now;
  const products = [
    [26_001, 'Capacete Premium', ProductCategory.Sports, 499.9],
    [26_002, 'Smartphone Demo', ProductCategory.Electronics, 2999],
    [26_003, 'Kit para Casa', ProductCategory.Home, 349.5],
    [26_004, 'Camiseta da Campanha', ProductCategory.ROPA, 79.9],
  ].map(([sequence, name, category, price], index): AnyDocument => ({
    _id: demoId(Number(sequence)),
    name,
    description: 'Produto legado fictício para cobertura da coleção.',
    price,
    category,
    images: [`/api/v1/media/${demoId(201).toString()}`],
    createdAt: daysFrom(now, -(index + 10)),
    updatedAt: now,
    __v: 0,
  }));
  const transactions = [
    TxStatus.Pending,
    TxStatus.Completed,
    TxStatus.Rejected,
  ].map((status, index): AnyDocument => ({
    _id: demoId(26_100 + index),
    user: demoId(4),
    paymentMethod: 'PIX DEMO',
    amountUsd: 10 + index * 5,
    rate: 5.25,
    fee: 2,
    netAmountCup: 51.45 + index * 25.72,
    description: 'Lançamento legado fictício para testes da coleção.',
    status,
    previousBalance: 100 + index * 50,
    resultingBalance: 151.45 + index * 75.72,
    confirmationCode: `LEGACY-DEMO-${index + 1}`,
    createdAt: daysFrom(now, -(index + 3)),
    updatedAt: now,
    __v: 0,
  }));
  return { products, transactions };
}

function createMediaFixtures(
  context: DemoContext,
  campaigns: AnyDocument[],
): { assets: AnyDocument[]; usage: AnyDocument[] } {
  const now = context.now;
  const references = campaigns.map(
    (campaign) => `campaign:${campaign._id.toString()}`,
  );
  const { size, checksum } = context.media;
  return {
    assets: [
      {
        _id: demoId(201),
        storageProvider: 'local',
        storageKey: 'demo/campaign-cover.png',
        originalName: 'campaign-cover-demo.png',
        mimeType: 'image/png',
        kind: MediaKind.Image,
        extension: 'png',
        size,
        checksumSha256: checksum,
        uploadedBy: demoId(1),
        references,
        status: MediaAssetStatus.Active,
        createdAt: daysFrom(now, -45),
        updatedAt: now,
        __v: 0,
      },
      {
        _id: demoId(202),
        storageProvider: 'local',
        storageKey: 'demo/free-media.png',
        originalName: 'free-media-demo.png',
        mimeType: 'image/png',
        kind: MediaKind.Image,
        extension: 'png',
        size,
        checksumSha256: checksum,
        uploadedBy: demoId(1),
        references: [],
        status: MediaAssetStatus.Active,
        createdAt: daysFrom(now, -20),
        updatedAt: now,
        __v: 0,
      },
      {
        _id: demoId(203),
        storageProvider: 'local',
        storageKey: 'demo/deleted-media.png',
        originalName: 'deleted-media-demo.png',
        mimeType: 'image/png',
        kind: MediaKind.Image,
        extension: 'png',
        size,
        checksumSha256: checksum,
        uploadedBy: demoId(1),
        references: [],
        status: MediaAssetStatus.Deleted,
        deletedAt: daysFrom(now, -40),
        deletedBy: demoId(1),
        createdAt: daysFrom(now, -60),
        updatedAt: daysFrom(now, -40),
        __v: 0,
      },
    ],
    usage: [
      {
        _id: demoId(27_001),
        scope: 'global',
        bytes: size * 3,
        objects: 3,
        createdAt: daysFrom(now, -60),
        updatedAt: now,
        __v: 0,
      },
      {
        _id: demoId(27_002),
        scope: `user:${demoId(1).toString()}`,
        bytes: size * 3,
        objects: 3,
        createdAt: daysFrom(now, -60),
        updatedAt: now,
        __v: 0,
      },
    ],
  };
}

async function seedDemo(): Promise<SeedResult> {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) throw new Error('MONGODB_URI es obligatoria');
  await mongoose.connect(uri, {
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 10_000,
  });
  try {
    await assertLocalEmptyOrDemo();
    const now = new Date();
    const context: DemoContext = {
      now,
      passwordHash: await bcrypt.hash(DEMO_PASSWORD, 12),
      media: await prepareDemoMedia(),
    };
    const users = demoUsers(context);
    const campaigns = createCampaigns(context);
    const commerce = createCommerce(context);
    applyCampaignRelationships(campaigns, commerce);
    const prizes = createInstantPrizes(context, commerce);
    const draws = createDraws(context, commerce, campaigns);
    const referrals = createReferrals(context, commerce);
    const notifications = createNotifications(context);
    const settings = createSettings(context);
    const internal = createInternalFixtures(context);
    const legacy = createLegacyFixtures(context);
    const media = createMediaFixtures(context, campaigns);
    const categories: AnyDocument[] = [
      [101, 'Motos', 'Motos, scooters e acessórios automotivos.'],
      [102, 'Dinheiro', 'Prêmios em Pix e alternativas em dinheiro.'],
      [103, 'Eletrônicos', 'Celulares, computadores, TVs e consoles.'],
      [104, 'Experiências', 'Viagens e experiências especiais.'],
      [105, 'Outros', 'Categoria livre para testar edição e exclusão.'],
    ].map(([sequence, name, description], index) => ({
      _id: demoId(Number(sequence)),
      name,
      description,
      createdAt: daysFrom(now, -(40 + index)),
      updatedAt: now,
      __v: 0,
    }));

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await upsertDocuments('users', users, session);
        await upsertDocuments('system_bootstrap', internal.bootstrap, session);
        await upsertDocuments('categories', categories, session);
        await upsertDocuments('products', legacy.products, session);
        await upsertDocuments('transactions', legacy.transactions, session);
        await upsertDocuments('media_assets', media.assets, session);
        await upsertDocuments('media_storage_usage', media.usage, session);
        await upsertDocuments('raffles', campaigns, session);
        await upsertDocuments('orders', commerce.orders, session);
        await upsertDocuments('payments', commerce.payments, session);
        await upsertDocuments('quotas', commerce.quotas, session);
        await upsertDocuments(
          'payment_lifecycle_outbox',
          commerce.paymentOutbox,
          session,
        );
        await upsertDocuments(
          'payment_refund_operations',
          commerce.refundOperations,
          session,
        );
        await upsertDocuments('instant_prizes', prizes.prizes, session);
        await upsertDocuments('prize_attempts', prizes.attempts, session);
        await upsertDocuments('prize_awards', prizes.awards, session);
        await upsertDocuments('draw_results', draws.results, session);
        await upsertDocuments('main_prize_awards', draws.mainAwards, session);
        await upsertDocuments('referral_codes', referrals.codes, session);
        await upsertDocuments('referral_clicks', referrals.clicks, session);
        await upsertDocuments(
          'referral_commissions',
          referrals.commissions,
          session,
        );
        await upsertDocuments(
          'notification_preferences',
          notifications.preferences,
          session,
        );
        await upsertDocuments(
          'notifications',
          notifications.notifications,
          session,
        );
        await upsertDocuments(
          'push_subscriptions',
          notifications.pushSubscriptions,
          session,
        );
        await upsertDocuments(
          'site_settings_versions',
          settings.versions,
          session,
        );
        await upsertDocuments('settings_counters', settings.counters, session);
        await upsertDocuments(
          'refresh_sessions',
          internal.refreshSessions,
          session,
        );
        await upsertDocuments(
          'emailverifications',
          internal.emailVerifications,
          session,
        );
        await upsertDocuments(
          'transactional_email_outbox',
          internal.emailOutbox,
          session,
        );
        await upsertDocuments(
          'order_access_challenges',
          internal.accessChallenges,
          session,
        );
        await upsertDocuments('audit_logs', internal.auditLogs, session);
      });
    } finally {
      await session.endSession();
    }

    const db = mongoose.connection.db;
    if (!db) throw new Error('MongoDB no expuso una base conectada');
    const collections = await Promise.all(
      (await db.listCollections({}, { nameOnly: true }).toArray())
        .map((entry) => entry.name)
        .sort()
        .map(async (name) => ({
          name,
          count: await db.collection(name).countDocuments(),
        })),
    );
    return {
      collections,
      credentials: [
        {
          role: UserRole.ADMIN,
          name: 'Ana Administradora',
          login: '+5511999000001',
          password: DEMO_PASSWORD,
        },
        {
          role: UserRole.ADMIN,
          name: 'Bruno Auditor',
          login: '+5511999000002',
          password: DEMO_PASSWORD,
        },
        {
          role: UserRole.OPERATOR,
          name: 'Carlos Operador',
          login: '+5511999000003',
          password: DEMO_PASSWORD,
        },
        {
          role: UserRole.CUSTOMER,
          name: 'João Cliente',
          login: '+5511999000004',
          password: DEMO_PASSWORD,
        },
        {
          role: UserRole.CUSTOMER,
          name: 'Maria Compradora',
          login: '+5511999000005',
          password: DEMO_PASSWORD,
        },
      ],
      publicCampaign: '/campanha/titan-160-brasileirinha-demo',
      guestOrder: {
        publicId: commerce.orderByLabel.get('guest')?.publicId,
        accessToken: 'demo-order-access-015',
      },
    };
  } finally {
    await mongoose.disconnect();
  }
}

void seedDemo()
  .then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`No se pudo sembrar la base demo: ${message}\n`);
    process.exitCode = 1;
  });
