import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, FilterQuery, Model, Types } from 'mongoose';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { Readable } from 'stream';
import { CreateOrderDto } from './dto/create-order.dto';
import { ListOrdersDto } from './dto/list-orders.dto';
import { ListMyTitlesDto } from './dto/list-my-titles.dto';
import { Order, OrderDocument, OrderStatus } from './schemas/order.schema';
import { Quota, QuotaDocument, QuotaStatus } from './schemas/quota.schema';
import {
  CampaignStatus,
  Raffle,
  RaffleDocument,
} from '../riffles/schema/raffle.schema';
import { RafflesService } from '../riffles/raffles.service';
import { sanitizeCampaignRichText } from '../riffles/utils/campaign-rich-text';
import { orderMaxAllocatedTitles } from './order-limits';
import {
  normalizeOrderEmail,
  normalizeOrderPhone,
} from './order-normalization';

interface ReservationResult {
  order: OrderDocument;
  accessToken: string;
}

const PUBLIC_PARTICIPATION_STATUSES = new Set<CampaignStatus>([
  CampaignStatus.Scheduled,
  CampaignStatus.Active,
  CampaignStatus.Open,
  CampaignStatus.Expired,
  CampaignStatus.SoldOut,
  CampaignStatus.AwaitingDraw,
  CampaignStatus.Drawn,
  CampaignStatus.Closed,
]);

@Injectable()
export class OrdersService {
  constructor(
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
    @InjectModel(Quota.name) private readonly quotaModel: Model<QuotaDocument>,
    @InjectModel(Raffle.name)
    private readonly campaignModel: Model<RaffleDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly campaigns: RafflesService,
  ) {}

  async createReservation(dto: CreateOrderDto, userId?: string) {
    this.assertValidCpf(dto.buyer.cpf);
    const normalized = this.normalizeCreateDto(dto);
    const ownerId =
      userId && Types.ObjectId.isValid(userId)
        ? new Types.ObjectId(userId)
        : undefined;
    const accessToken = this.createAccessToken(normalized);

    if (normalized.idempotencyKey) {
      const previous = await this.orderModel
        .findOne({
          'buyer.phone': normalized.buyer.phone,
          idempotencyKey: normalized.idempotencyKey,
        })
        .select('+accessSecret')
        .populate('campaign', 'slug')
        .exec();
      if (previous) {
        this.assertIdempotentReservation(previous, normalized);
        this.assertIdempotentOwner(previous, ownerId);
        this.assertReplayCredential(previous, accessToken);
        return this.toOwnerView(previous, accessToken, true);
      }
    }

    const session = await this.connection.startSession();
    let reservation: ReservationResult | undefined;
    try {
      await session.withTransaction(async () => {
        const campaign = await this.campaignModel
          .findOne({ slug: normalized.campaignSlug })
          .session(session)
          .exec();
        if (!campaign) throw new NotFoundException('Campaña no encontrada');
        this.assertPurchasable(campaign);
        if (normalized.termsVersion !== campaign.termsVersion) {
          throw new ConflictException(
            `Debe aceptar la versión ${campaign.termsVersion} del reglamento`,
          );
        }
        const acceptedRegulation = campaign.regulationHistory?.find(
          (entry) => entry.version === campaign.termsVersion,
        );
        const acceptedHtml = sanitizeCampaignRichText(
          acceptedRegulation?.html ?? campaign.regulationHtml ?? '',
        );
        const termsHash = createHash('sha256')
          .update(acceptedHtml, 'utf8')
          .digest('hex');

        const quote = this.campaigns.calculatePrice(
          campaign,
          normalized.quantity,
        );
        this.assertAllocationSize(quote.allocatedQuantity);
        const activeCount = campaign.soldCount + campaign.reservedCount;
        if (activeCount + quote.allocatedQuantity > campaign.totalTitles) {
          throw new ConflictException(
            'No quedan suficientes cuotas disponibles',
          );
        }

        const expiresAt = new Date(
          Date.now() + this.reservationMinutes() * 60_000,
        );
        const order = new this.orderModel({
          campaign: campaign._id,
          user: ownerId,
          buyer: normalized.buyer,
          selectedQuantity: quote.selectedQuantity,
          bonusQuantity: quote.bonusQuantity,
          allocatedQuantity: quote.allocatedQuantity,
          unitPrice: quote.unitPrice,
          subtotal: quote.subtotal,
          discount: quote.discount,
          total: quote.total,
          currency: quote.currency,
          promotion: quote.promotion,
          status: OrderStatus.Reserved,
          reservedAt: new Date(),
          expiresAt,
          termsVersion: campaign.termsVersion,
          termsHash,
          termsAcceptedAt: new Date(),
          idempotencyKey: normalized.idempotencyKey,
          attribution: normalized.attribution || {},
          accessSecret: this.hashSecret(accessToken),
          statusHistory: [
            {
              status: OrderStatus.Reserved,
              at: new Date(),
              reason: 'Cuotas reservadas',
            },
          ],
        });
        await order.save({ session });

        const reusable = await this.quotaModel
          .find({ campaign: campaign._id, status: QuotaStatus.Available })
          .sort({ updatedAt: 1 })
          .limit(quote.allocatedQuantity)
          .session(session)
          .exec();

        const quotaIds: Types.ObjectId[] = [];
        const titleNumbers: string[] = [];
        if (reusable.length > 0) {
          const reusableIds = reusable.map((quota) => quota._id);
          const updateResult = await this.quotaModel.updateMany(
            { _id: { $in: reusableIds }, status: QuotaStatus.Available },
            {
              $set: {
                status: QuotaStatus.Reserved,
                order: order._id,
                user: ownerId,
                reservedUntil: expiresAt,
                unitPrice: quote.unitPrice,
              },
            },
            { session },
          );
          if (updateResult.modifiedCount !== reusableIds.length) {
            throw new ConflictException(
              'Las cuotas cambiaron durante la reserva; reintente',
            );
          }
          quotaIds.push(...reusableIds);
          titleNumbers.push(...reusable.map((quota) => quota.number));
        }

        const newCount = quote.allocatedQuantity - quotaIds.length;
        if (campaign.allocationCursor + newCount > campaign.totalTitles) {
          throw new ConflictException(
            'No quedan suficientes cuotas disponibles',
          );
        }
        if (newCount > 0) {
          const docs = Array.from({ length: newCount }, (_, offset) => {
            const allocationIndex = campaign.allocationCursor + offset;
            const number = this.numberForIndex(campaign, allocationIndex);
            const absolutePosition = quotaIds.length + offset;
            return {
              campaign: campaign._id,
              allocationIndex,
              number,
              status: QuotaStatus.Reserved,
              order: order._id,
              user: ownerId,
              reservedUntil: expiresAt,
              unitPrice: quote.unitPrice,
              isBonus: absolutePosition >= quote.selectedQuantity,
            };
          });
          const created = await this.quotaModel.insertMany(docs, {
            session,
            ordered: true,
          });
          quotaIds.push(...created.map((quota) => quota._id));
          titleNumbers.push(...created.map((quota) => quota.number));
          campaign.allocationCursor += newCount;
        }

        if (reusable.length > 0) {
          for (let index = 0; index < reusable.length; index += 1) {
            const isBonus = index >= quote.selectedQuantity;
            if (reusable[index].isBonus !== isBonus) {
              await this.quotaModel.updateOne(
                { _id: reusable[index]._id },
                { $set: { isBonus } },
                { session },
              );
            }
          }
        }

        campaign.reservedCount += quote.allocatedQuantity;
        if (
          campaign.reservedCount + campaign.soldCount >=
          campaign.totalTitles
        ) {
          campaign.status = CampaignStatus.SoldOut;
        }
        await campaign.save({ session });

        order.quotas = quotaIds;
        order.titleNumbers = titleNumbers;
        await order.save({ session });
        reservation = { order, accessToken };
      });
    } catch (error) {
      if (normalized.idempotencyKey && this.isDuplicateKeyError(error)) {
        const replay = await this.orderModel
          .findOne({
            'buyer.phone': normalized.buyer.phone,
            idempotencyKey: normalized.idempotencyKey,
          })
          .select('+accessSecret')
          .populate('campaign', 'slug')
          .exec();
        if (replay) {
          this.assertIdempotentReservation(replay, normalized);
          this.assertIdempotentOwner(replay, ownerId);
          this.assertReplayCredential(replay, accessToken);
          return this.toOwnerView(replay, accessToken, true);
        }
      }
      throw error;
    } finally {
      await session.endSession();
    }
    if (!reservation)
      throw new ConflictException('No se pudo completar la reserva');
    return this.toOwnerView(reservation.order, reservation.accessToken, true);
  }

  async findByPublicId(
    publicId: string,
    accessToken?: string,
    userId?: string,
  ) {
    const order = await this.orderModel
      .findOne({ publicId })
      .select('+accessSecret')
      .populate('campaign', 'name slug status prizeTitle media imageUrl')
      .populate('quotas', 'number status isBonus instantPrize paidAt')
      .populate(
        'payment',
        'status provider txid amount currency qrCode qrCodeImage pixCopyPaste checkoutUrl expiresAt paidAt cancelledAt refundedAt refundedAmount createdAt updatedAt',
      )
      .exec();
    if (!order) throw new NotFoundException('Pedido no encontrado');
    this.assertOwner(order, accessToken, userId);
    return this.toOwnerView(order);
  }

  async listMine(userId: string, query: ListOrdersDto) {
    if (!Types.ObjectId.isValid(userId))
      throw new BadRequestException('Usuario inválido');
    const page = query.page || 1;
    const limit = query.limit || 20;
    const filter: FilterQuery<OrderDocument> = {
      user: new Types.ObjectId(userId),
    };
    if (query.status) filter.status = query.status;
    if (query.campaignId)
      filter.campaign = new Types.ObjectId(query.campaignId);
    const [rows, total] = await Promise.all([
      this.orderModel
        .find(filter)
        .select('-titleNumbers -quotas -instantPrizes -statusHistory')
        .populate('campaign', 'name slug status prizeTitle media imageUrl')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      this.orderModel.countDocuments(filter),
    ]);
    return {
      data: rows.map((row) => this.toOwnerView(row as any)),
      meta: { page, limit, total },
    };
  }

  async listAdmin(query: ListOrdersDto) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const filter: FilterQuery<OrderDocument> = {};
    if (query.status) filter.status = query.status;
    if (query.campaignId)
      filter.campaign = new Types.ObjectId(query.campaignId);
    const [data, total] = await Promise.all([
      this.orderModel
        .find(filter)
        .select('-titleNumbers -quotas -instantPrizes -statusHistory')
        .populate('campaign', 'name slug status')
        .populate('user', 'phone nickname firstName lastName email cpf')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      this.orderModel.countDocuments(filter),
    ]);
    return { data, meta: { page, limit, total } };
  }

  async cancel(
    publicId: string,
    reason: string | undefined,
    accessToken?: string,
    userId?: string,
  ) {
    const order = await this.orderModel
      .findOne({ publicId })
      .select('+accessSecret')
      .exec();
    if (!order) throw new NotFoundException('Pedido no encontrado');
    this.assertOwner(order, accessToken, userId);
    if (order.payment) {
      throw new ConflictException(
        'Use el endpoint de checkout para cancelar también el cobro Pix',
      );
    }
    if (
      ![OrderStatus.Reserved, OrderStatus.PendingPayment].includes(order.status)
    ) {
      throw new ConflictException('Este pedido ya no se puede cancelar');
    }
    await this.releaseReservation(
      order._id,
      OrderStatus.Cancelled,
      reason || 'Cancelado por cliente',
    );
    return this.findByPublicId(publicId, accessToken, userId);
  }

  async attachPayment(
    orderId: string | Types.ObjectId,
    paymentId: string | Types.ObjectId,
  ) {
    const order = await this.orderModel.findById(orderId).exec();
    if (!order) throw new NotFoundException('Pedido no encontrado');
    const normalizedPaymentId = new Types.ObjectId(paymentId.toString());
    if (order.payment) {
      if (order.payment.toString() === normalizedPaymentId.toString())
        return order;
      throw new ConflictException('El pedido ya tiene otro pago asociado');
    }
    if (
      ![OrderStatus.Reserved, OrderStatus.PendingPayment].includes(order.status)
    ) {
      throw new ConflictException('El pedido ya no admite pagos');
    }
    order.payment = normalizedPaymentId;
    order.status = OrderStatus.PendingPayment;
    order.statusHistory.push({
      status: OrderStatus.PendingPayment,
      at: new Date(),
      reason: 'Cobro creado',
    });
    return order.save();
  }

  async findOwnedForCheckout(
    publicId: string,
    accessToken?: string,
    userId?: string,
  ): Promise<OrderDocument> {
    const order = await this.orderModel
      .findOne({ publicId })
      .select('+accessSecret')
      .exec();
    if (!order) throw new NotFoundException('Pedido no encontrado');
    this.assertOwner(order, accessToken, userId);
    return order;
  }

  async cancelByIdSystem(
    orderId: string | Types.ObjectId,
    targetStatus: OrderStatus.Expired | OrderStatus.Cancelled,
    reason: string,
  ): Promise<void> {
    await this.releaseReservation(orderId, targetStatus, reason);
  }

  async markPaymentCancelled(
    paymentId: string | Types.ObjectId,
    targetStatus: OrderStatus.Expired | OrderStatus.Cancelled,
    reason: string,
  ): Promise<OrderDocument | null> {
    const order = await this.orderModel
      .findOne({ payment: new Types.ObjectId(paymentId.toString()) })
      .exec();
    if (!order) throw new NotFoundException('Pedido del pago no encontrado');
    if (order.status === targetStatus) return order;
    if (
      ![
        OrderStatus.Reserved,
        OrderStatus.PendingPayment,
        OrderStatus.InReview,
      ].includes(order.status)
    ) {
      return order;
    }
    await this.releaseReservation(order._id, targetStatus, reason);
    return this.orderModel.findById(order._id).exec();
  }

  async markPaidByPayment(
    paymentId: string | Types.ObjectId,
    paidAt = new Date(),
  ) {
    const session = await this.connection.startSession();
    let paidOrder: OrderDocument | undefined;
    try {
      await session.withTransaction(async () => {
        const order = await this.orderModel
          .findOne({ payment: new Types.ObjectId(paymentId.toString()) })
          .session(session)
          .exec();
        if (!order)
          throw new NotFoundException('Pedido del pago no encontrado');
        if (order.status === OrderStatus.Paid) {
          paidOrder = order;
          return;
        }
        if (
          ![
            OrderStatus.Reserved,
            OrderStatus.PendingPayment,
            OrderStatus.InReview,
          ].includes(order.status)
        ) {
          throw new ConflictException(
            `No se puede pagar un pedido ${order.status}`,
          );
        }
        if (order.status === OrderStatus.InReview) {
          const alreadyPaid = await this.quotaModel
            .countDocuments({
              order: order._id,
              status: { $in: [QuotaStatus.Paid, QuotaStatus.Awarded] },
            })
            .session(session);
          if (alreadyPaid === order.allocatedQuantity) {
            order.status = OrderStatus.Paid;
            order.paidAt = order.paidAt ?? paidAt;
            order.statusHistory.push({
              status: OrderStatus.Paid,
              at: paidAt,
              reason: 'Revisión de pago resuelta',
            });
            await order.save({ session });
            paidOrder = order;
            return;
          }
        }
        const updated = await this.quotaModel.updateMany(
          { order: order._id, status: QuotaStatus.Reserved },
          {
            $set: { status: QuotaStatus.Paid, paidAt },
            $unset: { reservedUntil: 1 },
          },
          { session },
        );
        if (updated.modifiedCount !== order.allocatedQuantity) {
          throw new ConflictException('La reserva de cuotas no está completa');
        }
        const campaign = await this.campaignModel
          .findById(order.campaign)
          .session(session)
          .exec();
        if (!campaign) throw new NotFoundException('Campaña no encontrada');
        campaign.reservedCount = Math.max(
          0,
          campaign.reservedCount - order.allocatedQuantity,
        );
        campaign.soldCount += order.allocatedQuantity;
        if (campaign.soldCount >= campaign.totalTitles) {
          campaign.status = CampaignStatus.SoldOut;
          campaign.salesClosedAt ??= paidAt;
        }
        await campaign.save({ session });

        order.status = OrderStatus.Paid;
        order.paidAt = paidAt;
        order.statusHistory.push({
          status: OrderStatus.Paid,
          at: paidAt,
          reason: 'Pago confirmado',
        });
        await order.save({ session });
        paidOrder = order;
      });
    } finally {
      await session.endSession();
    }
    return paidOrder;
  }

  async markPaymentReview(paymentId: string | Types.ObjectId, reason?: string) {
    return this.orderModel.findOneAndUpdate(
      {
        payment: new Types.ObjectId(paymentId.toString()),
        status: {
          $in: [
            OrderStatus.Reserved,
            OrderStatus.PendingPayment,
            OrderStatus.Paid,
          ],
        },
      },
      {
        $set: { status: OrderStatus.InReview },
        $push: {
          statusHistory: {
            status: OrderStatus.InReview,
            at: new Date(),
            reason,
          },
        },
      },
      { new: true },
    );
  }

  async markRefundedByPayment(
    paymentId: string | Types.ObjectId,
    reason?: string,
  ) {
    const session = await this.connection.startSession();
    let result: OrderDocument | null = null;
    try {
      await session.withTransaction(async () => {
        const order = await this.orderModel
          .findOne({ payment: new Types.ObjectId(paymentId.toString()) })
          .session(session)
          .exec();
        if (!order)
          throw new NotFoundException('Pedido del pago no encontrado');
        if (order.status === OrderStatus.Refunded) {
          result = order;
          return;
        }
        if (![OrderStatus.Paid, OrderStatus.InReview].includes(order.status)) {
          throw new ConflictException(
            'Solo se puede reembolsar un pedido pagado',
          );
        }
        if (!order.titleNumbers?.length) {
          const assigned = await this.quotaModel
            .find({ order: order._id })
            .select('number')
            .session(session)
            .lean();
          order.titleNumbers = assigned.map((quota) => quota.number);
        }
        await this.quotaModel.updateMany(
          {
            order: order._id,
            status: { $in: [QuotaStatus.Paid, QuotaStatus.Awarded] },
          },
          {
            $set: { status: QuotaStatus.Available, isBonus: false },
            $unset: {
              order: 1,
              user: 1,
              reservedUntil: 1,
              paidAt: 1,
              unitPrice: 1,
              instantPrize: 1,
            },
          },
          { session },
        );
        const campaign = await this.campaignModel
          .findById(order.campaign)
          .session(session)
          .exec();
        if (campaign) {
          campaign.soldCount = Math.max(
            0,
            campaign.soldCount - order.allocatedQuantity,
          );
          this.reopenAfterCapacityReleased(campaign);
          await campaign.save({ session });
        }
        order.status = OrderStatus.Refunded;
        order.refundedAt = new Date();
        order.statusHistory.push({
          status: OrderStatus.Refunded,
          at: new Date(),
          reason,
        });
        await order.save({ session });
        result = order;
      });
    } finally {
      await session.endSession();
    }
    return result;
  }

  async getMyTitles(userId: string, query: ListMyTitlesDto) {
    if (!Types.ObjectId.isValid(userId))
      throw new BadRequestException('Usuario inválido');
    const page = query.page || 1;
    const limit = query.limit || 100;
    const filter: FilterQuery<QuotaDocument> = {
      user: new Types.ObjectId(userId),
      status: { $in: [QuotaStatus.Paid, QuotaStatus.Awarded] },
    };
    if (query.campaignId) {
      if (!Types.ObjectId.isValid(query.campaignId)) {
        throw new BadRequestException('Campaña inválida');
      }
      filter.campaign = new Types.ObjectId(query.campaignId);
    }
    const [data, total] = await Promise.all([
      this.quotaModel
        .find(filter)
        .select('number status isBonus instantPrize paidAt campaign order')
        .populate(
          'campaign',
          'name slug status prizeTitle media imageUrl drawDate winningQuotaNumber',
        )
        .populate('instantPrize')
        .sort({ campaign: 1, number: 1, _id: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      this.quotaModel.countDocuments(filter).exec(),
    ]);
    return {
      data,
      meta: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async listPublicParticipants(campaignId: string, page = 1, limit = 100) {
    const campaign = await this.assertPublicModule(
      campaignId,
      'showParticipantsDownload',
    );
    const safePage = Math.max(1, Math.floor(page || 1));
    const safeLimit = Math.min(500, Math.max(1, Math.floor(limit || 100)));
    const filter = {
      campaign: campaign._id,
      status: { $in: [QuotaStatus.Paid, QuotaStatus.Awarded] },
    };
    const [rows, total] = await Promise.all([
      this.quotaModel
        .find(filter)
        .select('number status isBonus paidAt order')
        .populate('order', 'buyer')
        .sort({ number: 1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit)
        .lean(),
      this.quotaModel.countDocuments(filter),
    ]);
    return {
      data: rows.map((quota: any) => ({
        number: quota.number,
        status: quota.status,
        isBonus: quota.isBonus,
        paidAt: quota.paidAt,
        owner: quota.order?.buyer
          ? {
              name: this.maskName(quota.order.buyer.name),
              phone: this.maskPhone(quota.order.buyer.phone),
            }
          : null,
      })),
      meta: {
        page: safePage,
        limit: safeLimit,
        total,
        pages: Math.ceil(total / safeLimit),
      },
    };
  }

  async lookupPublicTitle(campaignId: string, number: string) {
    if (!Types.ObjectId.isValid(campaignId))
      throw new BadRequestException('Campaña inválida');
    if (!/^\d{1,12}$/.test(number))
      throw new BadRequestException('Título inválido');
    const campaign = await this.assertPublicModule(
      campaignId,
      'showTitleLookup',
    );
    const normalized = number.padStart(campaign.quotaDigits, '0');
    const quota: any = await this.quotaModel
      .findOne({
        campaign: campaign._id,
        number: normalized,
        status: { $in: [QuotaStatus.Paid, QuotaStatus.Awarded] },
      })
      .select('number status isBonus paidAt order')
      .populate('order', 'buyer')
      .lean();
    if (!quota) return { number: normalized, sold: false };
    return {
      number: quota.number,
      sold: true,
      status: quota.status,
      isBonus: quota.isBonus,
      owner: quota.order?.buyer
        ? {
            name: this.maskName(quota.order.buyer.name),
            phone: this.maskPhone(quota.order.buyer.phone),
          }
        : null,
    };
  }

  async participantsCsv(campaignId: string, admin = false): Promise<Readable> {
    if (!Types.ObjectId.isValid(campaignId))
      throw new BadRequestException('Campaña inválida');
    const campaign = admin
      ? await this.campaignModel.findById(campaignId).lean()
      : await this.assertPublicModule(campaignId, 'showParticipantsDownload');
    if (!campaign) throw new NotFoundException('Campaña no encontrada');
    const cursor = this.quotaModel
      .find({
        campaign: campaign._id,
        status: { $in: [QuotaStatus.Paid, QuotaStatus.Awarded] },
      })
      .select('number status isBonus paidAt order')
      .populate('order', 'publicId buyer')
      .sort({ number: 1 })
      .lean()
      .cursor();
    const maskName = (value?: string) => this.maskName(value);
    const maskPhone = (value?: string) => this.maskPhone(value);
    const csvCell = (value: string) => this.csvCell(value);
    async function* csv() {
      yield Buffer.from(
        `\uFEFF${admin ? 'titulo,status,bonus,pedido,nombre,telefono,email,cpf,pagado_en' : 'titulo,status,bonus,nombre,telefono,pagado_en'}\r\n`,
      );
      for await (const quota of cursor as any) {
        const buyer = quota.order?.buyer || {};
        const row = admin
          ? [
              quota.number,
              quota.status,
              quota.isBonus ? '1' : '0',
              quota.order?.publicId || '',
              buyer.name || '',
              buyer.phone || '',
              buyer.email || '',
              buyer.cpf || '',
              quota.paidAt?.toISOString?.() || '',
            ]
          : [
              quota.number,
              quota.status,
              quota.isBonus ? '1' : '0',
              maskName(buyer.name) || '',
              maskPhone(buyer.phone) || '',
              quota.paidAt?.toISOString?.() || '',
            ];
        yield Buffer.from(
          `${row.map((value) => csvCell(String(value))).join(',')}\r\n`,
        );
      }
    }
    return Readable.from(csv());
  }

  async topBuyers(campaignId: string, limit = 10) {
    await this.assertPublicModule(campaignId, 'showTopBuyers');
    const rows = await this.orderModel.aggregate([
      {
        $match: {
          campaign: new Types.ObjectId(campaignId),
          status: OrderStatus.Paid,
        },
      },
      {
        $group: {
          _id: { user: '$user', phone: '$buyer.phone', name: '$buyer.name' },
          quantity: { $sum: '$allocatedQuantity' },
          totalSpent: { $sum: '$total' },
        },
      },
      { $sort: { quantity: -1, totalSpent: -1 } },
      { $limit: Math.min(100, Math.max(1, limit)) },
    ]);
    return rows.map((row, index) => ({
      position: index + 1,
      name: this.maskName(row._id.name),
      phone: this.maskPhone(row._id.phone),
      quantity: row.quantity,
      totalSpent: row.totalSpent,
    }));
  }

  async minMaxQuota(campaignId: string) {
    await this.assertPublicModule(campaignId, 'showMinMaxQuota');
    const filter = {
      campaign: new Types.ObjectId(campaignId),
      status: { $in: [QuotaStatus.Paid, QuotaStatus.Awarded] },
    };
    const [minimum, maximum] = await Promise.all([
      this.quotaModel
        .findOne(filter)
        .sort({ number: 1 })
        .populate('user', 'nickname firstName phone')
        .populate('order', 'buyer')
        .lean(),
      this.quotaModel
        .findOne(filter)
        .sort({ number: -1 })
        .populate('user', 'nickname firstName phone')
        .populate('order', 'buyer')
        .lean(),
    ]);
    return {
      minimum: this.maskQuotaOwner(minimum),
      maximum: this.maskQuotaOwner(maximum),
    };
  }

  @Cron('*/30 * * * * *')
  async releaseExpiredReservations() {
    const expired = await this.orderModel
      .find({
        status: {
          $in: [OrderStatus.Reserved, OrderStatus.PendingPayment],
        },
        paidAt: { $exists: false },
        expiresAt: { $lte: new Date() },
      })
      .select('_id')
      .limit(100)
      .lean();
    for (const order of expired) {
      await this.releaseReservation(
        order._id,
        OrderStatus.Expired,
        'Reserva vencida',
      ).catch(() => undefined);
    }
    return expired.length;
  }

  private async releaseReservation(
    orderId: string | Types.ObjectId,
    targetStatus: OrderStatus.Expired | OrderStatus.Cancelled,
    reason: string,
  ) {
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        const order = await this.orderModel
          .findById(orderId)
          .session(session)
          .exec();
        if (
          !order ||
          order.paidAt ||
          ![
            OrderStatus.Reserved,
            OrderStatus.PendingPayment,
            OrderStatus.InReview,
          ].includes(order.status)
        )
          return;
        if (!order.titleNumbers?.length) {
          const assigned = await this.quotaModel
            .find({ order: order._id })
            .select('number')
            .session(session)
            .lean();
          order.titleNumbers = assigned.map((quota) => quota.number);
        }
        await this.quotaModel.updateMany(
          { order: order._id, status: QuotaStatus.Reserved },
          {
            $set: { status: QuotaStatus.Available, isBonus: false },
            $unset: { order: 1, user: 1, reservedUntil: 1, unitPrice: 1 },
          },
          { session },
        );
        const campaign = await this.campaignModel
          .findById(order.campaign)
          .session(session)
          .exec();
        if (campaign) {
          campaign.reservedCount = Math.max(
            0,
            campaign.reservedCount - order.allocatedQuantity,
          );
          this.reopenAfterCapacityReleased(campaign);
          await campaign.save({ session });
        }
        order.status = targetStatus;
        order.cancelledAt =
          targetStatus === OrderStatus.Cancelled ? new Date() : undefined;
        order.statusHistory.push({
          status: targetStatus,
          at: new Date(),
          reason,
        });
        await order.save({ session });
      });
    } finally {
      await session.endSession();
    }
  }

  private assertPurchasable(campaign: Raffle) {
    if (
      ![CampaignStatus.Active, CampaignStatus.Open].includes(campaign.status)
    ) {
      throw new ConflictException('La campaña no está disponible para comprar');
    }
    const now = new Date();
    if (campaign.launchAt && campaign.launchAt > now) {
      throw new ConflictException('La campaña todavía no ha comenzado');
    }
    if (campaign.closesAt && campaign.closesAt <= now) {
      throw new ConflictException('La campaña ha cerrado');
    }
    if (campaign.soldCount + campaign.reservedCount >= campaign.totalTitles) {
      throw new ConflictException('La campaña no tiene títulos disponibles');
    }
  }

  private numberForIndex(campaign: Raffle, index: number): string {
    const total = BigInt(campaign.totalTitles);
    const value =
      (BigInt(campaign.allocationMultiplier) * BigInt(index) +
        BigInt(campaign.allocationOffset)) %
      total;
    return value.toString().padStart(campaign.quotaDigits, '0');
  }

  private normalizeCreateDto(dto: CreateOrderDto): CreateOrderDto {
    return {
      ...dto,
      campaignSlug: dto.campaignSlug.trim().toLowerCase(),
      buyer: {
        name: dto.buyer.name.trim().replace(/\s+/g, ' '),
        phone: normalizeOrderPhone(dto.buyer.phone),
        email: normalizeOrderEmail(dto.buyer.email),
        cpf: dto.buyer.cpf.replace(/\D/g, ''),
      },
      idempotencyKey: dto.idempotencyKey?.trim(),
    };
  }

  private assertValidCpf(value: string) {
    const cpf = value.replace(/\D/g, '');
    if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) {
      throw new BadRequestException('CPF inválido');
    }
    const calculate = (length: number) => {
      let sum = 0;
      for (let index = 0; index < length; index += 1) {
        sum += Number(cpf[index]) * (length + 1 - index);
      }
      const digit = (sum * 10) % 11;
      return digit === 10 ? 0 : digit;
    };
    if (calculate(9) !== Number(cpf[9]) || calculate(10) !== Number(cpf[10])) {
      throw new BadRequestException('CPF inválido');
    }
  }

  private reservationMinutes(): number {
    const configured = Number(process.env.ORDER_RESERVATION_MINUTES || 15);
    return Number.isFinite(configured)
      ? Math.min(120, Math.max(5, configured))
      : 15;
  }

  private assertAllocationSize(allocatedQuantity: number): void {
    const hardLimit = orderMaxAllocatedTitles();
    if (
      !Number.isSafeInteger(allocatedQuantity) ||
      allocatedQuantity < 1 ||
      allocatedQuantity > hardLimit
    ) {
      throw new BadRequestException(
        `La compra no puede asignar más de ${hardLimit} títulos`,
      );
    }
  }

  /**
   * Un reembolso o liberación no puede dejar estados de cierre sorteables con
   * aforo incompleto. Solo reabre ventas si sus ventanas siguen vigentes.
   */
  private reopenAfterCapacityReleased(campaign: Raffle): void {
    if (
      ![CampaignStatus.SoldOut, CampaignStatus.AwaitingDraw].includes(
        campaign.status,
      ) ||
      campaign.soldCount + campaign.reservedCount >= campaign.totalTitles
    ) {
      return;
    }
    const now = new Date();
    const launchReached =
      !campaign.launchAt || new Date(campaign.launchAt) <= now;
    const closingFuture =
      !campaign.closesAt || new Date(campaign.closesAt) > now;
    const drawFuture = !campaign.drawDate || new Date(campaign.drawDate) > now;
    campaign.status = launchReached && closingFuture && drawFuture
      ? CampaignStatus.Active
      : CampaignStatus.Expired;
    campaign.salesClosedAt = undefined;
  }

  private createAccessToken(dto: CreateOrderDto): string {
    if (!dto.idempotencyKey) return randomBytes(24).toString('hex');
    let secret =
      process.env.CHECKOUT_ACCESS_SECRET_KEY ||
      process.env.PAYMENTS_PUBLIC_SECRET_KEY;
    if (!secret) {
      if (process.env.NODE_ENV === 'production') {
        throw new ServiceUnavailableException(
          'Configure CHECKOUT_ACCESS_SECRET_KEY para pedidos idempotentes',
        );
      }
      secret = 'development-only-checkout-secret-change-before-production';
    }
    return createHmac('sha256', secret)
      .update(`${dto.buyer.phone}:${dto.idempotencyKey}`)
      .digest('base64url');
  }

  private assertIdempotentReservation(
    order: OrderDocument,
    dto: CreateOrderDto,
  ): void {
    const campaign = order.campaign as unknown as {
      _id?: Types.ObjectId;
      slug?: string;
    };
    const campaignSlug = campaign?.slug;
    const same =
      campaignSlug === dto.campaignSlug &&
      order.selectedQuantity === dto.quantity &&
      order.buyer.phone === dto.buyer.phone &&
      order.buyer.email === dto.buyer.email &&
      order.buyer.cpf === dto.buyer.cpf &&
      order.termsVersion === dto.termsVersion;
    if (!same) {
      throw new ConflictException(
        'La clave idempotente ya se utilizó con otros datos de checkout',
      );
    }
  }

  private assertIdempotentOwner(
    order: OrderDocument,
    ownerId?: Types.ObjectId,
  ): void {
    const existingOwner = order.user?.toString();
    const requestedOwner = ownerId?.toString();
    if (existingOwner !== requestedOwner) {
      throw new ConflictException(
        'La clave idempotente ya pertenece a otro contexto de comprador',
      );
    }
  }

  private assertReplayCredential(
    order: OrderDocument,
    accessToken: string,
  ): void {
    const expected = Buffer.from(order.accessSecret || '', 'hex');
    const received = Buffer.from(this.hashSecret(accessToken), 'hex');
    if (
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    ) {
      throw new ConflictException({
        message:
          'El acceso de este pedido fue renovado; use recuperación de pedido o su cuenta',
        code: 'ORDER_ACCESS_ROTATED',
      });
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

  private hashSecret(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private assertOwner(
    order: OrderDocument,
    accessToken?: string,
    userId?: string,
  ) {
    if (userId && order.user?.toString() === userId) return;
    if (!accessToken)
      throw new ForbiddenException('Token de acceso al pedido requerido');
    const expected = Buffer.from(order.accessSecret || '', 'hex');
    const received = Buffer.from(this.hashSecret(accessToken), 'hex');
    if (
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    ) {
      throw new ForbiddenException('Token de acceso al pedido inválido');
    }
  }

  private toOwnerView(
    order: OrderDocument | Record<string, any>,
    accessToken?: string,
    includeInternalId = false,
  ) {
    const raw = (order as any).toObject
      ? (order as any).toObject()
      : { ...(order as any) };
    const internalId = raw._id?.toString?.() || raw._id;
    delete raw.accessSecret;
    delete raw.prizeLifecycleVersion;
    delete raw.__v;
    delete raw._id;
    if (
      [
        OrderStatus.Expired,
        OrderStatus.Cancelled,
        OrderStatus.Refunded,
      ].includes(raw.status) &&
      Array.isArray(raw.titleNumbers)
    ) {
      raw.quotas = raw.titleNumbers.map((number: string) => ({
        number,
        status: raw.status,
        historical: true,
      }));
    }
    return {
      ...raw,
      id: raw.publicId,
      internalId: includeInternalId ? internalId : undefined,
      accessToken,
      paymentRequired: [
        OrderStatus.Reserved,
        OrderStatus.PendingPayment,
      ].includes(raw.status),
    };
  }

  presentRecoveredOrder(
    order: OrderDocument | Record<string, any>,
    accessToken: string,
  ) {
    const view = this.toOwnerView(order, accessToken) as Record<string, any>;
    const titlesCount = Number(view.allocatedQuantity || 0);
    delete view.titleNumbers;
    delete view.quotas;
    delete view.instantPrizes;
    delete view.statusHistory;
    return { ...view, titlesCount };
  }

  private maskPhone(phone?: string): string | undefined {
    if (!phone || phone.length < 6) return phone;
    return `${phone.slice(0, 4)}${'*'.repeat(Math.max(4, phone.length - 6))}${phone.slice(-2)}`;
  }

  private maskName(name?: string): string | undefined {
    if (!name) return name;
    return name
      .split(/\s+/)
      .map((part, index) => (index === 0 ? part : `${part[0]}.`))
      .join(' ');
  }

  private maskQuotaOwner(quota: any) {
    if (!quota) return null;
    const user = quota.user || {};
    const buyer = quota.order?.buyer || {};
    return {
      number: quota.number,
      name: this.maskName(user.firstName || user.nickname || buyer.name),
      phone: this.maskPhone(user.phone || buyer.phone),
    };
  }

  private async assertPublicModule(
    campaignId: string,
    module:
      | 'showTopBuyers'
      | 'showMinMaxQuota'
      | 'showParticipantsDownload'
      | 'showTitleLookup',
  ) {
    if (!Types.ObjectId.isValid(campaignId))
      throw new BadRequestException('Campaña inválida');
    const campaign = await this.campaignModel.findById(campaignId).lean();
    if (!campaign || !PUBLIC_PARTICIPATION_STATUSES.has(campaign.status)) {
      throw new NotFoundException('Campaña no encontrada');
    }
    if (!campaign.modules?.[module]) {
      throw new NotFoundException(
        'Este módulo no está habilitado en la campaña',
      );
    }
    return campaign;
  }

  private csvCell(value: string) {
    const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  }
}
