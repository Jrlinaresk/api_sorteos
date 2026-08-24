import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { UsersService } from '../users/users.service';
import {
  normalizeCpf,
  normalizeEmail,
  normalizePhone,
} from '../users/utils/user-normalization';
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
  buyerPhone?: string;
  buyerEmail?: string;
  buyerCpf?: string;
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
    @Optional() private readonly users?: UsersService,
    @Optional()
    @InjectConnection()
    private readonly connection?: Connection,
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

    const currency = input.currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new BadRequestException('Moneda inválida');
    }
    if (!input.referralCode && !input.clickId) return null;
    if (!this.connection) {
      throw new ServiceUnavailableException(
        'La atribución de comisiones requiere transacciones',
      );
    }

    const session = await this.connection.startSession();
    let result: ReferralCommissionDocument | null | undefined;
    try {
      await session.withTransaction(async () => {
        result = undefined;
        const existing = await this.commissionModel
          .findOne({ orderId })
          .session(session)
          .exec();
        if (existing) {
          result = existing;
          return;
        }

        let click: ReferralClickDocument | null = null;
        if (input.clickId) {
          const clickId = this.toObjectId(input.clickId, 'click');
          click = await this.clickModel
            .findById(clickId)
            .session(session)
            .exec();
          if (!click) {
            throw new NotFoundException('Click de referido no encontrado');
          }
        }

        const codeValue = input.referralCode
          ? normalizeReferralCode(input.referralCode)
          : click?.code;
        if (!codeValue) {
          result = null;
          return;
        }
        if (click && input.referralCode && click.code !== codeValue) {
          throw new ConflictException(
            'El click no pertenece al código indicado',
          );
        }

        const code = await this.codeModel
          .findOne({ code: codeValue })
          .session(session)
          .exec();
        if (
          !code ||
          !isReferralCodeUsable(code, new Date(), input.campaignId)
        ) {
          throw new ConflictException('Código de referido no atribuible');
        }
        if (click && click.referralCode.toString() !== code.id) {
          throw new ConflictException(
            'El click no pertenece al código indicado',
          );
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
        await this.assertGuestIsNotBeneficiary(code, input, session);
        if (currency !== code.currency) {
          throw new ConflictException(
            `La orden está en ${currency} y el código liquida en ${code.currency}`,
          );
        }

        const claimedCode = await this.claimConversion(
          code,
          input.campaignId,
          session,
        );
        if (!claimedCode) {
          throw new ConflictException('El código ya no admite conversiones');
        }

        const commissionAmount = calculateCommissionAmount(
          commissionBase,
          claimedCode.commissionRateBps,
        );
        const [commission] = await this.commissionModel.create(
          [
            {
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
            },
          ],
          { session },
        );

        if (click) {
          const clickUpdate = await this.clickModel
            .updateOne(
              {
                _id: click._id,
                $or: [
                  { attributedOrderId: { $exists: false } },
                  { attributedOrderId: orderId },
                ],
              },
              {
                $set: {
                  attributedOrderId: orderId,
                  convertedAt: new Date(),
                },
              },
              { session },
            )
            .exec();
          if (!clickUpdate.matchedCount) {
            throw new ConflictException(
              'El click ya fue atribuido a otro pedido',
            );
          }
        }
        result = commission;
      });
    } catch (error) {
      if (this.isDuplicateKey(error)) {
        const duplicate = await this.commissionModel
          .findOne({ orderId })
          .exec();
        if (duplicate) return duplicate;
      }
      throw error;
    } finally {
      await session.endSession();
    }

    if (result === undefined) {
      throw new ConflictException('No se pudo atribuir la comisión');
    }
    return result;
  }

  async approveOrder(
    orderId: string,
  ): Promise<ReferralCommissionDocument | null> {
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

  async reverseOrder(
    orderId: string,
    reason: string,
  ): Promise<ReferralCommissionDocument | null> {
    if (!this.connection) {
      throw new ServiceUnavailableException(
        'La reversión de comisiones requiere transacciones',
      );
    }
    const session = await this.connection.startSession();
    let result: ReferralCommissionDocument | null | undefined;
    try {
      await session.withTransaction(async () => {
        result = undefined;
        const commission = await this.commissionModel
          .findOne({ orderId })
          .session(session)
          .exec();
        if (!commission) {
          result = null;
          return;
        }
        if (commission.status === ReferralCommissionStatus.Paid) {
          throw new ConflictException(
            'Una comisión ya pagada requiere reversión administrativa manual',
          );
        }
        if (commission.conversionReleasedAt) {
          result = commission;
          return;
        }

        const now = new Date();
        const alreadyRejected =
          commission.status === ReferralCommissionStatus.Rejected;
        const targetStatus = alreadyRejected
          ? ReferralCommissionStatus.Rejected
          : ReferralCommissionStatus.Reversed;
        const set: Record<string, unknown> = {
          status: targetStatus,
          statusChangedAt: now,
          statusReason: reason.slice(0, 500),
          conversionReleasedAt: now,
        };
        if (!alreadyRejected) set.reversedAt = now;
        const updated = await this.commissionModel
          .findOneAndUpdate(
            {
              _id: commission._id,
              status: commission.status,
              conversionReleasedAt: { $exists: false },
            },
            { $set: set },
            { new: true, session, runValidators: true },
          )
          .exec();
        if (!updated) {
          throw new ConflictException(
            'La comisión cambió mientras se revertía; reintente',
          );
        }
        await this.releaseConversion(updated.referralCode, session);
        result = updated;
      });
    } finally {
      await session.endSession();
    }
    if (result === undefined) {
      throw new ConflictException('No se pudo revertir la comisión');
    }
    return result;
  }

  private async claimConversion(
    code: ReferralCodeDocument,
    campaignId?: string,
    session?: ClientSession,
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
        { new: true, session },
      )
      .exec();
  }

  private async releaseConversion(
    codeId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<void> {
    await this.codeModel
      .updateOne(
        { _id: codeId, conversionsCount: { $gt: 0 } },
        { $inc: { conversionsCount: -1 } },
        session ? { session } : undefined,
      )
      .exec();
  }

  private assertMoney(value: number, field: string) {
    if (!Number.isFinite(value) || value < 0) {
      throw new BadRequestException(`${field} inválido`);
    }
  }

  private async assertGuestIsNotBeneficiary(
    code: ReferralCodeDocument,
    input: AttributeReferralOrderInput,
    session?: ClientSession,
  ): Promise<void> {
    if (!code.beneficiaryUser || !this.users) return;
    const beneficiary = await this.users.findOneOrNull(
      code.beneficiaryUser.toString(),
      session,
    );
    if (!beneficiary) return;

    const samePhone =
      Boolean(input.buyerPhone) &&
      normalizePhone(input.buyerPhone!) === normalizePhone(beneficiary.phone);
    const buyerEmail = normalizeEmail(input.buyerEmail);
    const sameEmail =
      Boolean(buyerEmail) && buyerEmail === normalizeEmail(beneficiary.email);
    const buyerCpf = normalizeCpf(input.buyerCpf);
    const sameCpf =
      Boolean(buyerCpf) && buyerCpf === normalizeCpf(beneficiary.cpf);
    if (samePhone || sameEmail || sameCpf) {
      throw new ConflictException('No se permite la autorreferencia');
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
