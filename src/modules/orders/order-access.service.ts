import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'crypto';
import { Connection, Model, Types } from 'mongoose';
import { EmailService } from '../email/email.service';
import { ConfirmOrderAccessDto } from './dto/confirm-order-access.dto';
import { RequestOrderAccessDto } from './dto/request-order-access.dto';
import {
  normalizeOrderEmail,
  normalizeOrderPhone,
} from './order-normalization';
import { OrdersService } from './orders.service';
import {
  OrderAccessChallenge,
  OrderAccessChallengeDocument,
} from './schemas/order-access-challenge.schema';
import { Order, OrderDocument } from './schemas/order.schema';

const CHALLENGE_LIFETIME_MS = 15 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
const DEFAULT_MAX_ORDERS = 20;
const ABSOLUTE_MAX_ORDERS = 50;

export interface RecoveryResponse {
  challengeId: string;
  expiresInSeconds: number;
  message: string;
}

@Injectable()
export class OrderAccessService {
  private readonly logger = new Logger(OrderAccessService.name);

  constructor(
    @InjectModel(OrderAccessChallenge.name)
    private readonly challengeModel: Model<OrderAccessChallengeDocument>,
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly email: EmailService,
    private readonly config: ConfigService,
    private readonly orders: OrdersService,
  ) {}

  async request(dto: RequestOrderAccessDto): Promise<RecoveryResponse> {
    const phone = normalizeOrderPhone(dto.phone);
    const email = normalizeOrderEmail(dto.email);
    this.assertNormalizedPhone(phone);
    const campaignId = this.normalizeCampaignId(dto.campaignId);
    const now = new Date();
    const identityHash = this.hashIdentity(phone, email, campaignId);
    const recent = await this.findRecentChallenge(identityHash, now);
    if (recent) {
      return this.publicChallengeResponse(recent.challengeId, recent.expiresAt);
    }

    const filter: Record<string, unknown> = {
      'buyer.phone': phone,
      'buyer.email': email,
      $or: [{ user: { $exists: false } }, { user: null }],
    };
    if (campaignId) {
      filter.campaign = new Types.ObjectId(campaignId);
    }

    const matches = await this.orderModel
      .find(filter)
      .select('_id')
      .sort({ createdAt: -1 })
      .limit(this.maxOrders() + 1)
      .lean()
      .exec();

    const challengeId = randomBytes(24).toString('base64url');
    const code = String(randomInt(100_000, 1_000_000));
    const truncated = matches.length > this.maxOrders();
    const orderIds = matches
      .slice(0, this.maxOrders())
      .map((order) => order._id);
    const expiresAt = new Date(now.getTime() + CHALLENGE_LIFETIME_MS);
    let challenge: OrderAccessChallengeDocument;
    try {
      const issued = await this.challengeModel
        .findOneAndUpdate(
          {
            identityHash,
            $or: [
              { createdAt: { $lte: this.cooldownCutoff(now) } },
              { expiresAt: { $lte: now } },
            ],
          },
          {
            $set: {
              identityHash,
              challengeId,
              codeHash: this.hashCode(challengeId, code),
              orderIds,
              truncated,
              attempts: 0,
              createdAt: now,
              expiresAt,
            },
          },
          { new: true, upsert: true, setDefaultsOnInsert: true },
        )
        .select('challengeId expiresAt')
        .exec();
      if (!issued) {
        throw new ServiceUnavailableException(
          'No se pudo iniciar la recuperación de pedidos',
        );
      }
      challenge = issued;
    } catch (error) {
      if (!this.isDuplicateKeyError(error)) throw error;
      const concurrent = await this.findRecentChallenge(identityHash, now);
      if (!concurrent) throw error;
      return this.publicChallengeResponse(
        concurrent.challengeId,
        concurrent.expiresAt,
      );
    }

    if (orderIds.length > 0) {
      // El SMTP se desacopla de la respuesta para que la latencia no revele si
      // la identidad coincide con algún pedido. La promesa siempre se captura.
      void this.deliverCode(email, code, challenge.challengeId);
    }

    return this.publicChallengeResponse(challengeId, expiresAt);
  }

  async confirm(dto: ConfirmOrderAccessDto) {
    const session = await this.connection.startSession();
    let invalid = false;
    let confirmationError: BadRequestException | undefined;
    let recovered: Array<Record<string, unknown>> = [];

    try {
      await session.withTransaction(async () => {
        invalid = false;
        confirmationError = undefined;
        recovered = [];
        const now = new Date();
        const challenge = await this.challengeModel
          .findOne({ challengeId: dto.challengeId })
          .select('+codeHash +orderIds +truncated')
          .session(session)
          .exec();

        if (
          !challenge ||
          challenge.expiresAt <= now ||
          challenge.attempts >= MAX_CODE_ATTEMPTS
        ) {
          if (challenge && challenge.expiresAt <= now) {
            await this.challengeModel.deleteOne(
              { _id: challenge._id },
              { session },
            );
          }
          invalid = true;
          return;
        }

        if (!this.codeMatches(challenge, dto.code)) {
          challenge.attempts = Math.min(
            MAX_CODE_ATTEMPTS,
            challenge.attempts + 1,
          );
          await challenge.save({ session });
          invalid = true;
          return;
        }

        if (challenge.truncated) {
          await this.challengeModel.deleteOne(
            { _id: challenge._id },
            { session },
          );
          confirmationError = this.campaignFilterRequired();
          return;
        }

        const orderIds = challenge.orderIds || [];
        if (orderIds.length === 0 || orderIds.length > this.maxOrders()) {
          invalid = true;
          return;
        }

        const orderDocuments = await this.orderModel
          .find({
            _id: { $in: orderIds },
            $or: [{ user: { $exists: false } }, { user: null }],
          })
          .select('+accessSecret')
          .select('-titleNumbers -quotas -instantPrizes -statusHistory')
          .populate('campaign', 'name slug status prizeTitle media imageUrl')
          .populate(
            'payment',
            'status provider txid amount currency qrCode qrCodeImage pixCopyPaste checkoutUrl expiresAt paidAt cancelledAt refundedAt refundedAmount createdAt updatedAt',
          )
          .sort({ createdAt: -1 })
          .session(session)
          .exec();

        if (orderDocuments.length !== orderIds.length) {
          invalid = true;
          return;
        }

        const deleted = await this.challengeModel.deleteOne(
          {
            _id: challenge._id,
            attempts: challenge.attempts,
            expiresAt: { $gt: now },
          },
          { session },
        );
        if (deleted.deletedCount !== 1) {
          invalid = true;
          return;
        }

        for (const order of orderDocuments) {
          const accessToken = randomBytes(32).toString('base64url');
          order.accessSecret = this.hashAccessToken(accessToken);
          await order.save({ session });
          recovered.push(
            this.orders.presentRecoveredOrder(order, accessToken) as Record<
              string,
              unknown
            >,
          );
        }
      });
    } finally {
      await session.endSession();
    }

    if (confirmationError) throw confirmationError;
    if (invalid) throw this.invalidChallenge();
    return {
      orders: recovered,
      meta: {
        count: recovered.length,
        hasMore: false,
        truncated: false,
      },
    };
  }

  private publicChallengeResponse(
    challengeId: string,
    expiresAt: Date,
  ): RecoveryResponse {
    return {
      challengeId,
      expiresInSeconds: Math.max(
        1,
        Math.ceil((expiresAt.getTime() - Date.now()) / 1000),
      ),
      message:
        'Si los datos coinciden, enviaremos un código al correo indicado.',
    };
  }

  private hashCode(challengeId: string, code: string): string {
    return createHmac('sha256', this.hmacSecret())
      .update(`${challengeId}:${code}`)
      .digest('hex');
  }

  private hashIdentity(
    phone: string,
    email: string,
    campaignId?: string,
  ): string {
    return createHmac('sha256', this.hmacSecret())
      .update(`${phone}:${email}:${campaignId || '*'}`)
      .digest('hex');
  }

  private async findRecentChallenge(identityHash: string, now: Date) {
    return this.challengeModel
      .findOne({
        identityHash,
        createdAt: { $gt: this.cooldownCutoff(now) },
        expiresAt: { $gt: now },
      })
      .select('challengeId expiresAt')
      .lean()
      .exec();
  }

  private cooldownCutoff(now: Date): Date {
    return new Date(now.getTime() - this.cooldownSeconds() * 1000);
  }

  private cooldownSeconds(): number {
    const configured = Number(
      this.config.get<string>('ORDER_ACCESS_REQUEST_COOLDOWN_SECONDS') || 60,
    );
    if (!Number.isInteger(configured)) return 60;
    return Math.min(3600, Math.max(30, configured));
  }

  private async deliverCode(
    email: string,
    code: string,
    challengeId: string,
  ): Promise<void> {
    try {
      await this.email.sendVerificationEmail(email, code);
    } catch {
      // No se registran el código ni datos personales.
      this.logger.warn(
        `No se pudo confirmar la entrega del código del challenge ${challengeId}`,
      );
    }
  }

  private isDuplicateKeyError(error: unknown): boolean {
    return Boolean(
      error &&
        typeof error === 'object' &&
        'code' in error &&
        (error as { code?: number }).code === 11000,
    );
  }

  private codeMatches(
    challenge: OrderAccessChallengeDocument,
    code: string,
  ): boolean {
    const expected = Buffer.from(challenge.codeHash || '', 'hex');
    const received = Buffer.from(
      this.hashCode(challenge.challengeId, code),
      'hex',
    );
    return (
      expected.length === received.length && timingSafeEqual(expected, received)
    );
  }

  private hashAccessToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private hmacSecret(): string {
    const dedicated = this.config
      .get<string>('ORDER_ACCESS_CODE_SECRET')
      ?.trim();
    const secret =
      dedicated ||
      (this.config.get<string>('NODE_ENV') === 'production'
        ? undefined
        : this.config.get<string>('CHECKOUT_ACCESS_SECRET_KEY')?.trim());
    if (!secret || secret.length < 32) {
      throw new ServiceUnavailableException(
        'Configure un secreto seguro para recuperar pedidos',
      );
    }
    return secret;
  }

  private maxOrders(): number {
    const configured = Number(
      this.config.get<string>('ORDER_ACCESS_MAX_ORDERS') || DEFAULT_MAX_ORDERS,
    );
    if (!Number.isInteger(configured)) return DEFAULT_MAX_ORDERS;
    return Math.min(ABSOLUTE_MAX_ORDERS, Math.max(1, configured));
  }

  private assertNormalizedPhone(phone: string): void {
    if (!/^\+?[1-9]\d{7,14}$/.test(phone)) {
      throw new BadRequestException('Teléfono inválido');
    }
  }

  private normalizeCampaignId(campaignId?: string): string | undefined {
    if (!campaignId) return undefined;
    if (!Types.ObjectId.isValid(campaignId)) {
      throw new BadRequestException('Campaña inválida');
    }
    return new Types.ObjectId(campaignId).toHexString();
  }

  private invalidChallenge(): BadRequestException {
    return new BadRequestException('Código inválido o expirado');
  }

  private campaignFilterRequired(): BadRequestException {
    return new BadRequestException({
      statusCode: 400,
      code: 'ORDER_ACCESS_CAMPAIGN_REQUIRED',
      message:
        'Hay más pedidos que el límite seguro. Solicite otro código indicando campaignId; si ya lo indicó, contacte con soporte.',
      meta: {
        hasMore: true,
        truncated: true,
        requiresCampaignId: true,
        maxOrders: this.maxOrders(),
      },
    });
  }
}
