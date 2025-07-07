// src/modules/transactions/transactions.service.ts
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Transaction, TransactionDocument } from './schemas/transaction.schema';
import { User, UserDocument } from '../users/schemas/user.schema';

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  constructor(
    @InjectModel(Transaction.name) private txModel: Model<TransactionDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {}

  async create(
    userId: string,
    amount: number,
    description: string,
  ): Promise<TransactionDocument> {
    this.logger.debug(`Iniciando create(): userId=${userId} amount=${amount}`);

    // 1) Validar ID
    if (!Types.ObjectId.isValid(userId)) {
      this.logger.warn(`ID inválido: ${userId}`);
      throw new BadRequestException('ID de usuario inválido');
    }

    let user: UserDocument | null;
    try {
      user = await this.userModel.findById(userId).exec();
      this.logger.debug(
        `Usuario cargado: ${user?._id} balance=${user?.balance}`,
      );
    } catch (err) {
      this.logger.error(`Error cargando usuario: ${err.message}`, err.stack);
      throw new InternalServerErrorException('Error al leer usuario');
    }
    if (!user) {
      this.logger.warn(`Usuario no encontrado: ${userId}`);
      throw new NotFoundException('Usuario no encontrado');
    }

    // 2) Calcular y validar nuevo balance
    const newBalance = user.balance + amount;
    if (newBalance < 0) {
      this.logger.warn(
        `Saldo insuficiente: balance=${user.balance} amount=${amount}`,
      );
      throw new BadRequestException('Saldo insuficiente');
    }

    // 3) Actualizar saldo
    try {
      user.balance = newBalance;
      await user.save();
      this.logger.debug(`Saldo actualizado: ${user._id} → ${user.balance}`);
    } catch (err) {
      this.logger.error(`Error al guardar saldo: ${err.message}`, err.stack);
      throw new InternalServerErrorException('Error al actualizar saldo');
    }

    // 4) Crear transacción
    let tx: TransactionDocument;
    try {
      tx = await this.txModel.create({
        user: user._id,
        amount,
        description,
        resultingBalance: newBalance,
      });
      this.logger.log(`Transacción creada: ${tx._id}`);
    } catch (err) {
      this.logger.error(`Error creando transacción: ${err.message}`, err.stack);
      // Intentamos revertir saldo en caso de fallo en creación de tx
      try {
        user.balance -= amount;
        await user.save();
        this.logger.debug(`Saldo revertido: ${user._id} → ${user.balance}`);
      } catch (reErr) {
        this.logger.error(
          `Error revirtiendo saldo: ${reErr.message}`,
          reErr.stack,
        );
      }
      throw new InternalServerErrorException('Error al crear transacción');
    }

    return tx;
  }

  async findByUser(userId: string): Promise<TransactionDocument[]> {
    this.logger.debug(`findByUser(): userId=${userId}`);
    if (!Types.ObjectId.isValid(userId)) {
      this.logger.warn(`ID inválido en findByUser: ${userId}`);
      throw new BadRequestException('ID de usuario inválido');
    }
    try {
      const txs = await this.txModel
        .find({ user: userId })
        .sort({ createdAt: -1 })
        .exec();
      this.logger.debug(`Transacciones encontradas: ${txs.length}`);
      return txs;
    } catch (err) {
      this.logger.error(
        `Error listando transacciones: ${err.message}`,
        err.stack,
      );
      throw new InternalServerErrorException('Error al listar transacciones');
    }
  }
}
