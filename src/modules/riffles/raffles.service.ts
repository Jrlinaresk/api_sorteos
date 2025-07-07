/* src/modules/raffles/raffles.service.ts */
import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CreateRaffleDto } from './dto/create-raffle.dto';
import { RaffleMessages } from './enums/raffle-messages.enum';
import { Raffle, RaffleDocument } from './schema/raffle.schema';
import { UpdateRaffleDto } from './enums/update-raffle.dto';
import { WinnersService } from '../winners/winners.service';

@Injectable()
export class RafflesService {
  constructor(
    @InjectModel(Raffle.name) private raffleModel: Model<RaffleDocument>,
    private readonly winnersService: WinnersService,
  ) {}

  async create(dto: CreateRaffleDto): Promise<RaffleDocument> {
    try {
      return await this.raffleModel.create(dto);
    } catch (err) {
      throw new InternalServerErrorException(err.message);
    }
  }

  async findAll(): Promise<RaffleDocument[]> {
    console.log('findAll');
    return this.raffleModel
      .find()
      .populate({ path: 'participants', select: 'phone nickname' })
      .populate({ path: 'winners', select: 'phone nickname' }) // ← aquí
      .exec();
  }

  async findOne(id: string): Promise<RaffleDocument> {
    if (!Types.ObjectId.isValid(id))
      throw new BadRequestException(RaffleMessages.INVALID_ID);

    const raffle = await this.raffleModel
      .findById(id)
      .populate({ path: 'participants', select: 'phone nickname' })
      .populate({ path: 'winners', select: 'phone nickname' })
      .exec();

    if (!raffle) throw new NotFoundException(RaffleMessages.RAFFLE_NOT_FOUND);

    return raffle;
  }

  async update(id: string, dto: UpdateRaffleDto): Promise<RaffleDocument> {
    if (!Types.ObjectId.isValid(id))
      throw new BadRequestException(RaffleMessages.INVALID_ID);
    const updated = await this.raffleModel
      .findByIdAndUpdate(id, dto, { new: true })
      .exec();
    if (!updated) throw new NotFoundException(RaffleMessages.RAFFLE_NOT_FOUND);
    return updated;
  }

  async remove(id: string): Promise<void> {
    if (!Types.ObjectId.isValid(id))
      throw new BadRequestException(RaffleMessages.INVALID_ID);
    const res = await this.raffleModel.findByIdAndDelete(id).exec();
    if (!res) throw new NotFoundException(RaffleMessages.RAFFLE_NOT_FOUND);
  }

  async addParticipant(
    raffleId: string,
    userId: string,
  ): Promise<RaffleDocument> {
    const raffle = await this.findOne(raffleId);
    const userObjectId = new Types.ObjectId(userId);

    // ❌ Evitar que se agregue si ya está
    const alreadyParticipating = raffle.participants.some(
      (id) => id.toString() === userId,
    );
    if (alreadyParticipating) return raffle;

    // ❌ Verificar que no se exceda el límite
    if (raffle.participants.length >= raffle.maxParticipants) {
      throw new ConflictException('La rifa está completa');
    }

    raffle.participants.push(userObjectId);
    return raffle.save();
  }

  async removeParticipant(
    raffleId: string,
    userId: string,
  ): Promise<RaffleDocument> {
    const raffle = await this.findOne(raffleId);
    raffle.participants = raffle.participants.filter(
      (id) => id.toString() !== userId,
    );
    return raffle.save();
  }
  /** Cierra manualmente una rifa y lanza el sorteo de ganadores */
  async closeRaffle(id: string): Promise<RaffleDocument> {
    // 1) Valida ID y que no haya sido ya sorteada
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException(RaffleMessages.INVALID_ID);
    }
    const raffle = await this.findOne(id);
    const hasWinners =
      Array.isArray(raffle.winners) && raffle.winners.length > 0;
    if (raffle.status === 'closed' && hasWinners) {
      throw new ConflictException('La rifa ya fue sorteada');
    }

    // 2) Delegamos TODO a drawWinners, que cierra, guarda, sortea y popula
    return this.winnersService.drawWinners(id);
  }
}
