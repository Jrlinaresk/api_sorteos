/* src/modules/users/users.service.ts */
import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { User, UserDocument } from './schemas/user.schema';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserMessages } from './enums/user-messages.enum';
import { Raffle, RaffleDocument } from '../riffles/schema/raffle.schema';
import { TransactionsService } from '../transactions/transactions.service';
import { Model, Types } from 'mongoose';
import { CreateTransactionDto } from '../transactions/dto/create-transaction.dto';

const logger = new Logger('UsersService');

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Raffle.name) private raffleModel: Model<RaffleDocument>,
    private readonly txService: TransactionsService,
  ) {}

  async create(dto: CreateUserDto): Promise<UserDocument> {
    const exists = await this.userModel.findOne({ phone: dto.phone }).exec();
    if (exists) throw new ConflictException(UserMessages.PHONE_CONFLICT);
    return this.userModel.create(dto);
  }

  async findAll(): Promise<UserDocument[]> {
    return this.userModel.find().exec();
  }

  async findOne(id: string): Promise<UserDocument> {
    if (!Types.ObjectId.isValid(id))
      throw new BadRequestException(UserMessages.INVALID_ID);
    const user = await this.userModel.findById(id).exec();
    if (!user) throw new NotFoundException(UserMessages.USER_NOT_FOUND);
    return user;
  }

  async findByPhone(phone: string): Promise<UserDocument> {
    const user = await this.userModel.findOne({ phone }).exec();
    if (!user) throw new NotFoundException(UserMessages.USER_NOT_FOUND);
    return user;
  }

  async update(id: string, dto: UpdateUserDto): Promise<UserDocument> {
    if (dto.phone) {
      const conflict = await this.userModel
        .findOne({ phone: dto.phone, _id: { $ne: id } })
        .exec();
      if (conflict) throw new ConflictException(UserMessages.PHONE_CONFLICT);
    }
    const updated = await this.userModel
      .findByIdAndUpdate(id, dto, { new: true })
      .exec();
    if (!updated) throw new NotFoundException(UserMessages.USER_NOT_FOUND);
    return updated;
  }

  async remove(id: string): Promise<void> {
    if (!Types.ObjectId.isValid(id))
      throw new BadRequestException(UserMessages.INVALID_ID);
    const res = await this.userModel.findByIdAndDelete(id).exec();
    if (!res) throw new NotFoundException(UserMessages.USER_NOT_FOUND);
  }

  async getParticipations(userId: string): Promise<Types.ObjectId[]> {
    const user = await this.findOne(userId);
    return user.participations;
  }
  /**
   * Descuenta el ticketPrice del usuario y añade su participación,
   * registrando la transacción con todos los campos requeridos.
   */
  async addParticipation(
    userId: string,
    raffleId: string,
  ): Promise<UserDocument> {
    logger.log(`[ADD_PARTICIPATION] userId=${userId}, raffleId=${raffleId}`);

    // 1) Validar IDs
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException(`ID de usuario inválido: ${userId}`);
    }
    if (!Types.ObjectId.isValid(raffleId)) {
      throw new BadRequestException(`ID de rifa inválido: ${raffleId}`);
    }

    // 2) Cargar usuario y rifa
    const [dbUser, dbRaffle] = await Promise.all([
      this.userModel.findById(userId).exec(),
      this.raffleModel.findById(raffleId).exec(),
    ]);
    if (!dbUser) throw new NotFoundException('Usuario no encontrado');
    if (!dbRaffle) throw new NotFoundException('Rifa no encontrada');

    // 3) Validar saldo
    const price = dbRaffle.ticketPrice;
    if (dbUser.balance < price) {
      throw new ConflictException('Saldo insuficiente');
    }

    // 4) Descontar saldo y crear transacción PENDING
    const txDto: CreateTransactionDto = {
      userId,
      amountUsd: -price,
      description: `Pago ticket de rifa "${dbRaffle.name}"`,
      paymentMethod: 'Raffle Ticket',
      account: raffleId,
      rate: 1, // no aplica para tickets, usamos 1
      fee: 0, // sin fee adicional
      confirmationCode: '',
    };

    let tx;
    try {
      tx = await this.txService.create(txDto);
      logger.log(`[ADD_PARTICIPATION] Transacción creada: ${tx._id}`);
    } catch (err) {
      logger.error(
        `[ADD_PARTICIPATION] Error creando transacción: ${err.message}`,
      );
      throw new InternalServerErrorException(
        'Error al registrar pago de ticket',
      );
    }

    // 5) Registrar la participación en User y Raffle
    try {
      dbUser.participations.push(dbRaffle.id);
      await dbUser.save();

      dbRaffle.participants.push(dbUser.id);
      await dbRaffle.save();

      logger.log(`[ADD_PARTICIPATION] Participación registrada.`);
    } catch (err) {
      // 6) Si falla guardado, revertir saldo y transacción
      logger.error(
        `[ADD_PARTICIPATION] Falla guardando participación: ${err.message}`,
      );
      await this.txService
        .create({
          ...txDto,
          amountUsd: price, // devolución
          description: `Reversión pago ticket "${dbRaffle.name}"`,
        })
        .catch(() => {
          logger.error('[ADD_PARTICIPATION] Error al revertir transacción');
        });
      throw new InternalServerErrorException('Error al guardar participación');
    }

    // 7) Devolver usuario actualizado
    return this.userModel.findById(userId).exec() as Promise<UserDocument>;
  }

  async removeParticipation(
    userId: string,
    raffleId: string,
  ): Promise<UserDocument> {
    try {
      if (
        !Types.ObjectId.isValid(userId) ||
        !Types.ObjectId.isValid(raffleId)
      ) {
        throw new BadRequestException('ID de usuario o rifa no válido');
      }

      console.log('[REMOVE_PARTICIPATION] userId:', userId);
      console.log('[REMOVE_PARTICIPATION] raffleId:', raffleId);

      const user = await this.userModel.findById(userId);
      if (!user) throw new NotFoundException('Usuario no encontrado');

      const raffle = await this.raffleModel.findById(raffleId);
      if (!raffle) throw new NotFoundException('Rifa no encontrada');

      // Log antes
      console.log(
        '[REMOVE_PARTICIPATION] Participaciones antes:',
        user.participations,
      );
      console.log(
        '[REMOVE_PARTICIPATION] Participantes antes:',
        raffle.participants,
      );

      // Usar $pull para eliminar sin cargar documento completo
      await this.userModel.updateOne(
        { _id: userId },
        { $pull: { participations: new Types.ObjectId(raffleId) } },
      );

      await this.raffleModel.updateOne(
        { _id: raffleId },
        { $pull: { participants: new Types.ObjectId(userId) } },
      );

      const updatedUser = await this.userModel.findById(userId);
      if (!updatedUser) {
        throw new NotFoundException('Usuario no encontrado tras actualizar');
      }
      console.log(
        '[REMOVE_PARTICIPATION] Participaciones después:',
        updatedUser.participations,
      );
      return updatedUser;
    } catch (error) {
      console.error('[REMOVE_PARTICIPATION] Error:', error);
      throw error;
    }
  }
}
