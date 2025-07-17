// src/modules/transactions/transactions.service.ts
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Transaction,
  TransactionDocument,
  TxStatus,
} from './schemas/transaction.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { CreateTransactionDto } from './dto/create-transaction.dto';

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  constructor(
    @InjectModel(Transaction.name) private txModel: Model<TransactionDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {}

  /**
   * Registra una solicitud de depósito (status = pending).
   */
  async create(dto: CreateTransactionDto): Promise<TransactionDocument> {
    const {
      userId,
      amountUsd,
      paymentMethod,
      account,
      rate,
      fee,
      description,
      confirmationCode,
    } = dto;
    this.logger.debug(
      `create() iniciada: userId=${userId}, amountUsd=${amountUsd}`,
    );

    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('ID de usuario inválido');
    }

    // 1) Cargar usuario para obtener balance previo
    const user = await this.userModel.findById(userId).exec();
    if (!user) throw new NotFoundException('Usuario no encontrado');
    const previousBalance = user.balance;

    // 2) Calcular netAmountCup
    const netAmountCup = amountUsd * rate * (1 - fee / 100);

    // 3) Grabar la transacción PENDING sin tocar user.balance
    try {
      const tx = await this.txModel.create({
        user: user._id,
        paymentMethod,
        confirmationCode,
        amountUsd,
        account,
        rate,
        fee,
        netAmountCup,
        amount: netAmountCup,
        previousBalance,
        resultingBalance: previousBalance, // por ahora igual al previo
        description,
        status: TxStatus.Pending,
      });
      this.logger.log(`Transacción PENDING creada: ${tx._id}`);
      return tx;
    } catch (err) {
      this.logger.error(`Error creando tx: ${err.message}`, err.stack);
      throw new InternalServerErrorException('Error al crear transacción');
    }
  }

  async findByUser(
    userId: string,
    status?: string,
  ): Promise<TransactionDocument[]> {
    // 1) validamos el ID
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('ID de usuario inválido');
    }

    // 2) armamos el filtro con ObjectId explícito
    const filter: any = {
      user: new Types.ObjectId(userId),
    };

    // 3) si nos pasaron status, lo normalizamos a minúsculas
    if (status) {
      const s = status.toLowerCase();
      if (!Object.values(TxStatus).includes(s as TxStatus)) {
        throw new BadRequestException(`Estado inválido: ${status}`);
      }
      filter.status = s;
    }

    // 4) ejecutamos la query
    this.logger.debug(`findByUser() filtro: ${JSON.stringify(filter)}`);
    return this.txModel.find(filter).sort({ createdAt: -1 }).exec();
  }

  async findAllByStatus(status: TxStatus): Promise<TransactionDocument[]> {
    return this.txModel.find({ status }).sort({ createdAt: -1 }).exec();
  }

  async updateStatus(
    txId: string,
    status: TxStatus,
  ): Promise<TransactionDocument> {
    if (!Types.ObjectId.isValid(txId)) {
      throw new BadRequestException('ID de transacción inválido');
    }
    const tx = await this.txModel.findById(txId).exec();
    if (!tx) throw new NotFoundException('Transacción no encontrada');

    const prevStatus = tx.status;
    tx.status = status;

    // Si pasa de Pending → Completed, actualizamos balance
    if (prevStatus === TxStatus.Pending && status === TxStatus.Completed) {
      const user = await this.userModel.findById(tx.user).exec();
      if (!user) throw new NotFoundException('Usuario no encontrado para tx');

      const newBalance = user.balance + tx.netAmountCup;
      // actualizamos y guardamos también en la tx el resultingBalance
      user.balance = newBalance;
      await user.save();
      tx.resultingBalance = newBalance;
      this.logger.debug(
        `Saldo de usuario ${tx.user} actualizado: ${newBalance}`,
      );
    }

    // Si cambias de Pending → Rejected, no tocas balance (queda igual)
    // O si re-procesas Completed → Rejected, podrías revertir aquí si lo deseas.

    return tx.save();
  }
}
