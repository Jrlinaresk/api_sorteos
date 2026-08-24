import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  MainPrizeAward,
  MainPrizeAwardDocument,
  MainPrizeAwardStatus,
} from '../main-awards/schemas/main-prize-award.schema';
import {
  Order,
  OrderDocument,
  OrderStatus,
} from '../orders/schemas/order.schema';
import { Payment, PaymentDocument } from '../payments/schemas/payment.schema';
import { PaymentStatus } from '../payments/payment.enums';
import {
  PrizeAward,
  PrizeAwardDocument,
  PrizeAwardStatus,
} from '../prizes/schemas/prize-award.schema';
import {
  CampaignStatus,
  Raffle,
  RaffleDocument,
} from '../riffles/schema/raffle.schema';
import { User, UserDocument } from '../users/schemas/user.schema';

interface CountRow {
  _id: string;
  count: number;
}

interface MoneyRow {
  _id: null;
  receivedCents: number;
  refundedCents: number;
  paymentCount: number;
}

@Injectable()
export class AdminDashboardService {
  constructor(
    @InjectModel(Raffle.name)
    private readonly campaigns: Model<RaffleDocument>,
    @InjectModel(Order.name)
    private readonly orders: Model<OrderDocument>,
    @InjectModel(Payment.name)
    private readonly payments: Model<PaymentDocument>,
    @InjectModel(User.name)
    private readonly users: Model<UserDocument>,
    @InjectModel(PrizeAward.name)
    private readonly instantAwards: Model<PrizeAwardDocument>,
    @InjectModel(MainPrizeAward.name)
    private readonly mainAwards: Model<MainPrizeAwardDocument>,
  ) {}

  async summary(days = 30) {
    const safeDays = Math.min(365, Math.max(1, Math.floor(days)));
    const rangeStart = new Date();
    rangeStart.setUTCHours(0, 0, 0, 0);
    rangeStart.setUTCDate(rangeStart.getUTCDate() - safeDays + 1);

    const [
      campaignRows,
      orderRows,
      paymentRows,
      instantRows,
      mainRows,
      userTotal,
      userActive,
      dailySales,
      topCampaigns,
      recentOrders,
    ] = await Promise.all([
      this.groupCounts(this.campaigns, '$status'),
      this.groupCounts(this.orders, '$status'),
      this.payments
        .aggregate<MoneyRow>([
          {
            $group: {
              _id: null,
              receivedCents: { $sum: '$receivedAmountCents' },
              refundedCents: { $sum: '$refundedAmountCents' },
              paymentCount: { $sum: 1 },
            },
          },
        ])
        .exec(),
      this.groupCounts(this.instantAwards, '$status'),
      this.groupCounts(this.mainAwards, '$status'),
      this.users.countDocuments().exec(),
      this.users.countDocuments({ isActive: true }).exec(),
      this.orders
        .aggregate<{
          date: string;
          orders: number;
          revenueCents: number;
          titles: number;
        }>([
          {
            $match: { status: OrderStatus.Paid, paidAt: { $gte: rangeStart } },
          },
          {
            $group: {
              _id: {
                $dateToString: {
                  format: '%Y-%m-%d',
                  date: '$paidAt',
                  timezone: 'America/Sao_Paulo',
                },
              },
              orders: { $sum: 1 },
              revenueCents: {
                $sum: { $round: [{ $multiply: ['$total', 100] }, 0] },
              },
              titles: { $sum: '$allocatedQuantity' },
            },
          },
          { $sort: { _id: 1 } },
          {
            $project: {
              _id: 0,
              date: '$_id',
              orders: 1,
              revenueCents: 1,
              titles: 1,
            },
          },
        ])
        .exec(),
      this.orders
        .aggregate<{
          campaignId: string;
          name: string;
          slug: string;
          orders: number;
          revenueCents: number;
          titles: number;
        }>([
          { $match: { status: OrderStatus.Paid } },
          {
            $group: {
              _id: '$campaign',
              orders: { $sum: 1 },
              revenueCents: {
                $sum: { $round: [{ $multiply: ['$total', 100] }, 0] },
              },
              titles: { $sum: '$allocatedQuantity' },
            },
          },
          { $sort: { revenueCents: -1, orders: -1 } },
          { $limit: 5 },
          {
            $lookup: {
              from: 'raffles',
              localField: '_id',
              foreignField: '_id',
              as: 'campaign',
            },
          },
          { $unwind: '$campaign' },
          {
            $project: {
              _id: 0,
              campaignId: { $toString: '$_id' },
              name: '$campaign.name',
              slug: '$campaign.slug',
              orders: 1,
              revenueCents: 1,
              titles: 1,
            },
          },
        ])
        .exec(),
      this.orders
        .find()
        .select(
          'publicId buyer status total currency allocatedQuantity createdAt paidAt campaign',
        )
        .populate('campaign', 'name slug')
        .sort({ createdAt: -1 })
        .limit(8)
        .lean()
        .exec(),
    ]);

    const campaignByStatus = this.toCountMap(campaignRows);
    const orderByStatus = this.toCountMap(orderRows);
    const instantByStatus = this.toCountMap(instantRows);
    const mainByStatus = this.toCountMap(mainRows);
    const money = paymentRows[0] ?? {
      receivedCents: 0,
      refundedCents: 0,
      paymentCount: 0,
    };

    return {
      generatedAt: new Date(),
      range: { days: safeDays, from: rangeStart },
      campaigns: {
        total: this.sumCounts(campaignRows),
        active: campaignByStatus[CampaignStatus.Active] ?? 0,
        scheduled: campaignByStatus[CampaignStatus.Scheduled] ?? 0,
        awaitingDraw: campaignByStatus[CampaignStatus.AwaitingDraw] ?? 0,
        byStatus: campaignByStatus,
      },
      orders: {
        total: this.sumCounts(orderRows),
        paid: orderByStatus[OrderStatus.Paid] ?? 0,
        pending:
          (orderByStatus[OrderStatus.Reserved] ?? 0) +
          (orderByStatus[OrderStatus.PendingPayment] ?? 0),
        attention:
          (orderByStatus[OrderStatus.InReview] ?? 0) +
          (orderByStatus[OrderStatus.Disputed] ?? 0),
        byStatus: orderByStatus,
      },
      finance: {
        receivedCents: money.receivedCents ?? 0,
        refundedCents: money.refundedCents ?? 0,
        netCents: (money.receivedCents ?? 0) - (money.refundedCents ?? 0),
        paymentCount: money.paymentCount ?? 0,
        paymentsUnderReview: await this.payments.countDocuments({
          status: {
            $in: [
              PaymentStatus.UnderReview,
              PaymentStatus.Disputed,
              PaymentStatus.Chargeback,
              PaymentStatus.RefundPending,
            ],
          },
        }),
      },
      users: { total: userTotal, active: userActive },
      prizes: {
        instantClaimed: instantByStatus[PrizeAwardStatus.Claimed] ?? 0,
        instantPending: instantByStatus[PrizeAwardStatus.Awarded] ?? 0,
        mainPending: mainByStatus[MainPrizeAwardStatus.Pending] ?? 0,
        mainClaimed: mainByStatus[MainPrizeAwardStatus.Claimed] ?? 0,
      },
      dailySales,
      topCampaigns,
      recentOrders: recentOrders.map((order: any) => ({
        id: order._id?.toString(),
        publicId: order.publicId,
        buyerName: order.buyer?.name,
        status: order.status,
        totalCents: Math.round(Number(order.total ?? 0) * 100),
        currency: order.currency,
        allocatedQuantity: order.allocatedQuantity,
        campaign: order.campaign
          ? {
              id: order.campaign._id?.toString(),
              name: order.campaign.name,
              slug: order.campaign.slug,
            }
          : null,
        createdAt: order.createdAt,
        paidAt: order.paidAt,
      })),
    };
  }

  private groupCounts(model: Model<any>, field: string): Promise<CountRow[]> {
    return model
      .aggregate<CountRow>([
        { $group: { _id: field, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ])
      .exec();
  }

  private toCountMap(rows: CountRow[]): Record<string, number> {
    return Object.fromEntries(rows.map((row) => [String(row._id), row.count]));
  }

  private sumCounts(rows: CountRow[]): number {
    return rows.reduce((sum, row) => sum + row.count, 0);
  }
}
