/* src/modules/users/users.service.ts */
import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcryptjs';
import { User, UserDocument } from './schemas/user.schema';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserMessages } from './enums/user-messages.enum';
import { ClientSession, Model, Types } from 'mongoose';
import { UserRole } from './enums/user-role.enum';
import { PublicUserDto } from './dto/public-user.dto';
import { UpdateMyProfileDto } from './dto/update-my-profile.dto';
import {
  normalizeCpf,
  normalizeEmail,
  normalizeHumanName,
  normalizePhone,
  phoneLookupCandidates,
} from './utils/user-normalization';

const PASSWORD_HASH_ROUNDS = 12;
const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCK_MILLISECONDS = 15 * 60 * 1000;

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) {}

  async create(
    dto: CreateUserDto,
    session?: ClientSession,
  ): Promise<UserDocument> {
    const phone = normalizePhone(dto.phone);
    const email = normalizeEmail(dto.email);
    const cpf = normalizeCpf(dto.cpf);
    const name = normalizeHumanName(dto.name);
    const nickname = normalizeHumanName(dto.nickname) ?? name;

    if (!nickname) {
      throw new BadRequestException('El nickname o el nombre son obligatorios');
    }

    const phoneCandidates = phoneLookupCandidates(dto.phone);
    const duplicateFilters: Record<string, unknown>[] = [
      { phone: { $in: phoneCandidates } },
    ];
    if (email) duplicateFilters.push({ email });
    if (cpf) duplicateFilters.push({ cpf });
    const duplicateQuery = this.userModel
      .findOne({ $or: duplicateFilters })
      .select('_id phone email cpf')
      .lean();
    if (session) duplicateQuery.session(session);
    const duplicate = await duplicateQuery.exec();

    if (duplicate) {
      this.throwDuplicateConflict(duplicate, {
        phone,
        phoneCandidates,
        email,
        cpf,
      });
    }

    const passwordHash = dto.password
      ? await bcrypt.hash(dto.password, PASSWORD_HASH_ROUNDS)
      : undefined;

    try {
      const payload = {
        ...dto,
        phone,
        email,
        cpf,
        name,
        nickname,
        password: undefined,
        passwordHash,
        role: dto.role ?? UserRole.CUSTOMER,
      };
      if (session) {
        const [created] = await this.userModel.create([payload], { session });
        return created;
      }
      return await this.userModel.create(payload);
    } catch (error) {
      this.rethrowMongoDuplicate(error);
      throw error;
    }
  }

  async findAll(): Promise<UserDocument[]> {
    return this.userModel.find().exec();
  }

  async findOneOrNull(
    id: string,
    session?: ClientSession,
  ): Promise<UserDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const query = this.userModel.findById(id);
    if (session) query.session(session);
    return query.exec();
  }

  async findOne(id: string): Promise<UserDocument> {
    if (!Types.ObjectId.isValid(id))
      throw new BadRequestException(UserMessages.INVALID_ID);
    const user = await this.userModel.findById(id).exec();
    if (!user) throw new NotFoundException(UserMessages.USER_NOT_FOUND);
    return user;
  }

  async findByPhone(phone: string): Promise<UserDocument> {
    const user = await this.userModel
      .findOne({ phone: { $in: phoneLookupCandidates(phone) } })
      .exec();
    if (!user) throw new NotFoundException(UserMessages.USER_NOT_FOUND);
    return user;
  }

  async findByPhoneForAuthentication(
    phone: string,
  ): Promise<UserDocument | null> {
    return this.userModel
      .findOne({ phone: { $in: phoneLookupCandidates(phone) } })
      .select('+passwordHash +password +failedLoginAttempts +lockedUntil')
      .exec();
  }

  async recordFailedLogin(userId: string): Promise<void> {
    const lockedUntil = new Date(Date.now() + LOGIN_LOCK_MILLISECONDS);
    await this.userModel
      .updateOne({ _id: userId }, [
        {
          $set: {
            failedLoginAttempts: {
              $add: [{ $ifNull: ['$failedLoginAttempts', 0] }, 1],
            },
          },
        },
        {
          $set: {
            lockedUntil: {
              $cond: [
                { $gte: ['$failedLoginAttempts', MAX_FAILED_LOGIN_ATTEMPTS] },
                lockedUntil,
                '$lockedUntil',
              ],
            },
            failedLoginAttempts: {
              $cond: [
                { $gte: ['$failedLoginAttempts', MAX_FAILED_LOGIN_ATTEMPTS] },
                0,
                '$failedLoginAttempts',
              ],
            },
          },
        },
      ])
      .exec();
  }

  async clearFailedLogins(userId: string): Promise<void> {
    await this.userModel
      .updateOne(
        { _id: userId },
        {
          $set: { failedLoginAttempts: 0 },
          $unset: { lockedUntil: 1 },
        },
      )
      .exec();
  }

  async replaceLegacyPassword(
    userId: string,
    plainPassword: string,
  ): Promise<UserDocument> {
    return this.setPassword(userId, plainPassword);
  }

  async setPassword(
    userId: string,
    plainPassword: string,
    emailVerified = false,
  ): Promise<UserDocument> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException(UserMessages.INVALID_ID);
    }
    const passwordHash = await bcrypt.hash(plainPassword, PASSWORD_HASH_ROUNDS);
    const setValues: Record<string, unknown> = {
      passwordHash,
      failedLoginAttempts: 0,
    };
    if (emailVerified) setValues.emailVerified = true;

    const user = await this.userModel
      .findOneAndUpdate(
        { _id: userId },
        {
          $set: setValues,
          $inc: { authVersion: 1 },
          $unset: { password: 1, lockedUntil: 1 },
        },
        { new: true },
      )
      .exec();
    if (!user) throw new NotFoundException(UserMessages.USER_NOT_FOUND);
    return user;
  }

  toPublicUser(user: UserDocument): PublicUserDto {
    const raw = user.toObject({ transform: false }) as Record<string, any>;
    const id = String(raw._id);
    delete raw._id;
    delete raw.__v;
    delete raw.password;
    delete raw.passwordHash;
    delete raw.failedLoginAttempts;
    delete raw.lockedUntil;
    delete raw.authVersion;
    raw.role ??= UserRole.CUSTOMER;
    raw.isActive ??= true;
    raw.emailVerified ??= false;
    raw.participations ??= [];
    return { ...raw, id } as PublicUserDto;
  }

  toPublicUsers(users: UserDocument[]): PublicUserDto[] {
    return users.map((user) => this.toPublicUser(user));
  }

  async update(id: string, dto: UpdateUserDto): Promise<UserDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException(UserMessages.INVALID_ID);
    }

    const changes: Record<string, unknown> = { ...dto };
    if (dto.phone) {
      const phone = normalizePhone(dto.phone);
      const conflict = await this.userModel
        .findOne({
          phone: { $in: phoneLookupCandidates(dto.phone) },
          _id: { $ne: id },
        })
        .exec();
      if (conflict) throw new ConflictException(UserMessages.PHONE_CONFLICT);
      changes.phone = phone;
    }
    if (dto.email !== undefined) {
      const email = normalizeEmail(dto.email);
      if (email) {
        const conflict = await this.userModel
          .findOne({ email, _id: { $ne: id } })
          .exec();
        if (conflict) throw new ConflictException('El correo ya está en uso');
      }
      changes.email = email;
    }
    if (dto.cpf !== undefined) {
      const cpf = normalizeCpf(dto.cpf);
      if (cpf) {
        const conflict = await this.userModel
          .findOne({ cpf, _id: { $ne: id } })
          .exec();
        if (conflict) throw new ConflictException('El CPF ya está en uso');
      }
      changes.cpf = cpf;
    }
    if (dto.name !== undefined) {
      changes.name = normalizeHumanName(dto.name);
    }
    if (dto.nickname !== undefined) {
      changes.nickname = normalizeHumanName(dto.nickname);
    }
    if (dto.password) {
      changes.passwordHash = await bcrypt.hash(
        dto.password,
        PASSWORD_HASH_ROUNDS,
      );
      changes.password = undefined;
    }

    delete changes.password;
    try {
      const invalidatesSessions =
        dto.password !== undefined || dto.isActive !== undefined;
      const updateOperation = invalidatesSessions
        ? {
            $set: changes,
            $inc: { authVersion: 1 },
            ...(dto.password
              ? { $unset: { password: 1, lockedUntil: 1 } }
              : {}),
          }
        : { $set: changes };
      const updated = await this.userModel
        .findByIdAndUpdate(id, updateOperation, {
          new: true,
          runValidators: true,
        })
        .exec();
      if (!updated) throw new NotFoundException(UserMessages.USER_NOT_FOUND);
      return updated;
    } catch (error) {
      this.rethrowMongoDuplicate(error);
      throw error;
    }
  }

  async updateProfile(
    id: string,
    dto: UpdateMyProfileDto,
  ): Promise<UserDocument> {
    return this.update(id, dto);
  }

  async remove(id: string): Promise<void> {
    if (!Types.ObjectId.isValid(id))
      throw new BadRequestException(UserMessages.INVALID_ID);
    const user = await this.userModel
      .findByIdAndUpdate(
        id,
        {
          $set: { isActive: false, failedLoginAttempts: 0 },
          $inc: { authVersion: 1 },
          $unset: { lockedUntil: 1 },
        },
        { new: true },
      )
      .exec();
    if (!user) throw new NotFoundException(UserMessages.USER_NOT_FOUND);
  }

  private throwDuplicateConflict(
    duplicate: Record<string, unknown>,
    candidate: {
      phone: string;
      phoneCandidates: string[];
      email?: string;
      cpf?: string;
    },
  ): never {
    if (candidate.phoneCandidates.includes(String(duplicate.phone))) {
      throw new ConflictException(UserMessages.PHONE_CONFLICT);
    }
    if (candidate.email && duplicate.email === candidate.email) {
      throw new ConflictException('El correo ya está en uso');
    }
    if (candidate.cpf && duplicate.cpf === candidate.cpf) {
      throw new ConflictException('El CPF ya está en uso');
    }
    throw new ConflictException('Ya existe un usuario con estos datos');
  }

  private rethrowMongoDuplicate(error: unknown): void {
    const mongoError = error as {
      code?: number;
      keyPattern?: Record<string, number>;
    };
    if (mongoError?.code !== 11000) return;
    if (mongoError.keyPattern?.phone) {
      throw new ConflictException(UserMessages.PHONE_CONFLICT);
    }
    if (mongoError.keyPattern?.email) {
      throw new ConflictException('El correo ya está en uso');
    }
    if (mongoError.keyPattern?.cpf) {
      throw new ConflictException('El CPF ya está en uso');
    }
    throw new ConflictException('Ya existe un usuario con estos datos');
  }
}
