/* src/modules/users/users.service.ts */
import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument } from './schemas/user.schema';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserMessages } from './enums/user-messages.enum';
import { Raffle, RaffleDocument } from '../riffles/schema/raffle.schema';

const logger = new Logger('UsersService');

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Raffle.name) private raffleModel: Model<RaffleDocument>, // ⬅️ ESTO ES LO QUE FALTABA
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
  async addParticipation(
    userId: string,
    raffleId: string,
  ): Promise<UserDocument> {
    logger.log(`[ADD_PARTICIPATION] userId: ${userId}, raffleId: ${raffleId}`);

    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException(`ID de usuario inválido: ${userId}`);
    }
    if (!Types.ObjectId.isValid(raffleId)) {
      throw new BadRequestException(`ID de rifa inválido: ${raffleId}`);
    }

    const userObjectId = new Types.ObjectId(userId);
    const raffleObjectId = new Types.ObjectId(raffleId);

    const user = await this.userModel.findById(userObjectId);
    if (!user) {
      throw new NotFoundException(`Usuario con ID ${userId} no encontrado`);
    }

    const raffle = await this.raffleModel.findById(raffleObjectId);
    if (!raffle) {
      throw new NotFoundException(`Rifa con ID ${raffleId} no encontrada`);
    }

    // Siempre agregamos participación, permitiendo duplicados
    user.participations.push(raffleObjectId);
    await user.save();
    logger.log(
      `[ADD_PARTICIPATION] Rifa añadida al usuario (total=${user.participations.length})`,
    );

    raffle.participants.push(userObjectId);
    await raffle.save();
    logger.log(
      `[ADD_PARTICIPATION] Usuario añadido a la rifa (total=${raffle.participants.length})`,
    );

    // Refrescar y devolver usuario actualizado
    const updatedUser = await this.userModel.findById(userId).exec();
    if (!updatedUser) {
      throw new NotFoundException(`Usuario no encontrado tras guardar`);
    }
    return updatedUser;
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
