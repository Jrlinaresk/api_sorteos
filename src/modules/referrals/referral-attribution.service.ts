import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  calculateCommissionAmount,
  isReferralCodeUsable,
  normalizeReferralCode,
} from './referral-domain';
import {
  ReferralClick,
  ReferralClickDocument,
} from './schemas/referral-click.schema';
import {
  ReferralCode,
  ReferralCodeDocument,
  ReferralCodeStatus,
} from './schemas/referral-code.schema';
import {
  ReferralCommission,
  ReferralCommissionDocument,
  ReferralCommissionStatus,
} from './schemas/referral-commission.schema';

export interface AttributeReferralOrderInput {
  orderId: string;
  referralCode?: string;
  clickId?: string;
  buyerUserId?: string;
  campaignId?: string;
  orderAmount: number;
  commissionBase?: number;
  currency: string;
  metadata?: Record<string, unknown>;
}

/**
 * Helper interno para Orders. No se expone por HTTP para que un cliente no pueda
 * atribuir su propia orden ni crear comisiones.
 */
@Injectable()
export class ReferralAttributionService {
  constructor(
    @InjectModel(ReferralCode.name)
    private readonly codeModel: Model<ReferralCodeDocument>,
    @InjectModel(ReferralClick.name)
    private readonly clickModel: Model<ReferralClickDocument>,
    @InjectModel(ReferralCommission.name)
    private readonly commissionModel: Model<ReferralCommissionDocument>,
  ) {}

  async attributeOrder(
    input: AttributeReferralOrderInput,
  ): Promise<ReferralCommissionDocument | null> {
    const orderId = input.orderId.trim();
    if (!orderId) throw new BadRequestException('orderId es obligatorio');
    this.assertMoney(input.orderAmount, 'orderAmount');
    const commissionBase = input.commissionBase ?? input.orderAmount;
    this.assertMoney(commissionBase, 'commissionBase');
    if (commissionBase > input.orderAmount) {
      throw new BadRequestException(
        'commissionBase no puede superar orderAmount',
      );
    }

    const existing = await this.commissionModel.findOne({ orderId }).exec();
    if (existing) return existing;

    let click: ReferralClickDocument | null = null;
    if (input.clickId) {
      const clickId = this.toObjectId(input.clickId, 'click');
      click = await this.clickModel.findById(clickId).exec();
      if (!click)
        throw new NotFoundException('Click de referido no encontrado');
    }

    const codeValue = input.referralCode
      ? normalizeReferralCode(input.referralCode)
      : click?.code;
    if (!codeValue) return null;
    if (click && input.referralCode && click.code !== codeValue) {
      throw new ConflictException('El click no pertenece al código indicado');
    }

    const code = await this.codeModel.findOne({ code: codeValue }).exec();
    if (!code || !isReferralCodeUsable(code, new Date(), input.campaignId)) {
      throw new ConflictException('Código de referido no atribuible');
    }
    if (click && click.referralCode.toString() !== code.id) {
      throw new ConflictException('El click no pertenece al código indicado');
    }

    const buyerUser = input.buyerUserId
      ? this.toObjectId(input.buyerUserId, 'comprador')
      : undefined;
    if (
      buyerUser &&
      code.beneficiaryUser &&
      buyerUser.equals(code.beneficiaryUser)
    ) {
      throw new ConflictException('No se permite la autorreferencia');
    }

    const currency = input.currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new BadRequestException('Moneda inválida');
    }
    if (currency !== code.currency) {
      throw new ConflictException(
        `La orden está en ${currency} y el código liquida en ${code.currency}`,
      );
    }

    const claimedCode = await this.claimConversion(code, input.campaignId);
    if (!claimedCode) {
      throw new ConflictException('El código ya no admite conversiones');
    }

    const commissionAmount = calculateCommissionAmount(
      commissionBase,
      claimedCode.commissionRateBps,
    );

    try {
      const commission = await this.commissionModel.create({
        referralCode: claimedCode._id,
        code: claimedCode.code,
        orderId,
        click: click?._id,
        beneficiaryUser: claimedCode.beneficiaryUser,
        buyerUser,
        orderAmount: input.orderAmount,
        commissionBase,
        commissionRateBps: claimedCode.commissionRateBps,
        commissionAmount,
        currency,
        status: ReferralCommissionStatus.Pending,
        statusChangedAt: new Date(),
        metadata: input.metadata ?? {},
      });

      if (click) {
        await this.clickModel
          .updateOne(
            { _id: click._id },
            {
              $set: {
                attributedOrderId: orderId,
                convertedAt: new Date(),
              },
            },
          )
          .exec();
      }
      return commission;
    } catch (error) {
      await this.releaseConversion(claimedCode._id);
      if (this.isDuplicateKey(error)) {
        const duplicate = await this.commissionModel
          .findOne({ orderId })
          .exec();
        if (duplicate) return duplicate;
      }
      throw error;
    }
  }

  async approveOrder(orderId: string): Promise<ReferralCommissionDocument | null> {
    return this.commissionModel
      .findOneAndUpdate(
        { orderId, status: ReferralCommissionStatus.Pending },
        {
          $set: {
            status: ReferralCommissionStatus.Approved,
            statusChangedAt: new Date(),
            approvedAt: new Date(),
            statusReason: 'Pago confirmado',
          },
        },
        { new: true },
      )
      .exec();
  }

  async reverseOrder(orderId: string, reason: string): Promise<ReferralCommissionDocument | null> {
    const commission = await this.commissionModel.findOne({ orderId }).exec();
    if (!commission || commission.status === ReferralCommissionStatus.Reversed) return commission;
    if (commission.status === ReferralCommissionStatus.Paid) {
      throw new ConflictException('Una comisión ya pagada requiere reversión administrativa manual');
    }
    commission.status = ReferralCommissionStatus.Reversed;
    commission.statusChangedAt = new Date();
    commission.reversedAt = new Date();
    commission.statusReason = reason.slice(0, 500);
    await commission.save();
    await this.releaseConversion(commission.referralCode);
    return commission;
  }

  private async claimConversion(
    code: ReferralCodeDocument,
    campaignId?: string,
  ): Promise<ReferralCodeDocument | null> {
    const now = new Date();
    const clauses: Record<string, unknown>[] = [
      { _id: code._id },
      { status: ReferralCodeStatus.Active },
      {
        $or: [{ validFrom: { $exists: false } }, { validFrom: { $lte: now } }],
      },
      {
        $or: [{ validUntil: { $exists: false } }, { validUntil: { $gt: now } }],
      },
      {
        $or: [
          { maxConversions: { $exists: false } },
          { $expr: { $lt: ['$conversionsCount', '$maxConversions'] } },
        ],
      },
    ];
    if (code.campaignId) clauses.push({ campaignId });

    return this.codeModel
      .findOneAndUpdate(
        { $and: clauses },
        { $inc: { conversionsCount: 1 } },
        { new: true },
      )
      .exec();
  }

  private async releaseConversion(codeId: Types.ObjectId): Promise<void> {
    await this.codeModel
      .updateOne(
        { _id: codeId, conversionsCount: { $gt: 0 } },
        { $inc: { conversionsCount: -1 } },
      )
      .exec();
  }

  private assertMoney(value: number, field: string) {
    if (!Number.isFinite(value) || value < 0) {
      throw new BadRequestException(`${field} inválido`);
    }
  }

  private toObjectId(value: string, label: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(`ID de ${label} inválido`);
    }
    return new Types.ObjectId(value);
  }

  private isDuplicateKey(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: number }).code === 11000
    );
  }
}
