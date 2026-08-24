/* src/modules/users/users.service.ts */
import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { User, UserDocument } from './schemas/user.schema';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserMessages } from './enums/user-messages.enum';
import { ClientSession, Model, Types } from 'mongoose';
import { UserRole } from './enums/user-role.enum';
import { PublicUserDto } from './dto/public-user.dto';
import { UpdateMyProfileDto } from './dto/update-my-profile.dto';
import { ListUsersDto } from './dto/list-users.dto';
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
const PENDING_REGISTRATION_LIFETIME_MILLISECONDS = 24 * 60 * 60 * 1000;

type InternalCreateUserDto = CreateUserDto & {
  isActive?: boolean;
  emailVerified?: boolean;
  registrationPending?: boolean;
  registrationPendingExpiresAt?: Date;
  registrationIdHash?: string;
};

interface NormalizedCreationIdentity {
  phone: string;
  phoneCandidates: string[];
  email?: string;
  cpf?: string;
  name?: string;
  nickname: string;
}

export interface PendingRegistrationResult {
  registrationId: string;
  user: UserDocument | null;
}

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) {}

  async create(
    dto: CreateUserDto,
    session?: ClientSession,
  ): Promise<UserDocument> {
    const identity = this.normalizeCreationIdentity(dto);

    // El coste de bcrypt ocurre también cuando hay un identificador duplicado.
    // Así el endpoint público de registro no tiene una diferencia de latencia
    // obvia entre una identidad nueva y otra ya registrada.
    const passwordHash = dto.password
      ? await bcrypt.hash(dto.password, PASSWORD_HASH_ROUNDS)
      : undefined;
    return this.createPrepared(dto, identity, passwordHash, session);
  }

  /**
   * Cada llamada crea un identificador opaco nuevo. Si la identidad coincide
   * con un alta pendiente, reemplaza sus credenciales y el intento anterior
   * deja de poder activarse. Una colisión activa conserva una respuesta opaca.
   */
  async createPendingRegistration(
    dto: CreateUserDto,
  ): Promise<PendingRegistrationResult> {
    const now = new Date();
    const identity = this.normalizeCreationIdentity(dto);
    const passwordHash = dto.password
      ? await bcrypt.hash(dto.password, PASSWORD_HASH_ROUNDS)
      : undefined;
    if (!passwordHash) {
      throw new BadRequestException(
        'La contraseña es obligatoria para el registro público',
      );
    }
    const registrationId = randomBytes(32).toString('base64url');
    const registrationIdHash = this.hashRegistrationId(registrationId);
    const registrationPendingExpiresAt = new Date(
      now.getTime() + PENDING_REGISTRATION_LIFETIME_MILLISECONDS,
    );
    const pendingPayload: InternalCreateUserDto & {
      isActive: false;
      emailVerified: false;
      registrationPending: true;
      registrationPendingExpiresAt: Date;
      role: UserRole.CUSTOMER;
    } = {
      ...dto,
      role: UserRole.CUSTOMER,
      isActive: false,
      emailVerified: false,
      registrationPending: true,
      registrationPendingExpiresAt,
      registrationIdHash,
    };

    try {
      const user = await this.createPrepared(
        pendingPayload,
        identity,
        passwordHash,
      );
      return { registrationId, user };
    } catch (error) {
      if (!(error instanceof ConflictException)) throw error;
    }

    const conflicts = await this.registrationIdentityConflicts(dto);
    const exactPending = conflicts.find(
      (candidate) =>
        candidate.registrationPending === true &&
        candidate.isActive === false &&
        candidate.phone === identity.phone &&
        candidate.email === identity.email &&
        candidate.cpf === identity.cpf,
    );
    if (exactPending) {
      const user = await this.replacePendingRegistration(
        exactPending,
        identity,
        passwordHash,
        registrationIdHash,
        registrationPendingExpiresAt,
      );
      return { registrationId, user };
    }

    // Un alta nunca activada no debe reservar teléfono/CPF/correo para
    // siempre. Solo se recupera automáticamente cuando todas las colisiones
    // pertenecen al mismo documento pendiente y ya vencido.
    if (conflicts.length === 1 && this.isExpiredPending(conflicts[0], now)) {
      const removed = await this.userModel
        .deleteOne({
          _id: conflicts[0]._id,
          role: UserRole.CUSTOMER,
          isActive: false,
          registrationPending: true,
          $or: [
            { registrationPendingExpiresAt: { $lte: now } },
            { registrationPendingExpiresAt: { $exists: false } },
          ],
        })
        .exec();
      if (removed.deletedCount === 1) {
        try {
          const user = await this.createPrepared(
            pendingPayload,
            identity,
            passwordHash,
          );
          return { registrationId, user };
        } catch (error) {
          if (!(error instanceof ConflictException)) throw error;
        }
      }
    }

    return { registrationId, user: null };
  }

  async findPendingRegistrationByEmail(
    rawEmail: string,
    registrationId: string,
  ): Promise<UserDocument | null> {
    const email = normalizeEmail(rawEmail);
    if (!email) return null;
    return this.userModel
      .findOne({
        email,
        role: UserRole.CUSTOMER,
        isActive: false,
        registrationPending: true,
        registrationPendingExpiresAt: { $gt: new Date() },
        registrationIdHash: this.hashRegistrationId(registrationId),
      })
      .exec();
  }

  async activatePendingRegistrationByEmail(
    rawEmail: string,
    registrationId: string,
    session?: ClientSession,
  ): Promise<UserDocument | null> {
    const email = normalizeEmail(rawEmail);
    if (!email) return null;
    const query = this.userModel.findOneAndUpdate(
      {
        email,
        role: UserRole.CUSTOMER,
        isActive: false,
        registrationPending: true,
        registrationPendingExpiresAt: { $gt: new Date() },
        registrationIdHash: this.hashRegistrationId(registrationId),
      },
      {
        $set: {
          isActive: true,
          emailVerified: true,
          registrationPending: false,
          failedLoginAttempts: 0,
        },
        $inc: { authVersion: 1 },
        $unset: {
          registrationPendingExpiresAt: 1,
          registrationIdHash: 1,
          lockedUntil: 1,
        },
      },
      { new: true },
    );
    if (session) query.session(session);
    return query.exec();
  }

  async findAll(query: ListUsersDto): Promise<{
    data: UserDocument[];
    meta: { page: number; limit: number; total: number; pages: number };
  }> {
    const page = query.page || 1;
    const limit = query.limit || 25;
    const [data, total] = await Promise.all([
      this.userModel
        .find()
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.userModel.countDocuments({}).exec(),
    ]);
    return {
      data,
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    };
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
    delete raw.registrationPending;
    delete raw.registrationPendingExpiresAt;
    delete raw.registrationIdHash;
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

  private normalizeCreationIdentity(
    dto: CreateUserDto,
  ): NormalizedCreationIdentity {
    const name = normalizeHumanName(dto.name);
    const nickname = normalizeHumanName(dto.nickname) ?? name;
    if (!nickname) {
      throw new BadRequestException('El nickname o el nombre son obligatorios');
    }
    return {
      phone: normalizePhone(dto.phone),
      phoneCandidates: phoneLookupCandidates(dto.phone),
      email: normalizeEmail(dto.email),
      cpf: normalizeCpf(dto.cpf),
      name,
      nickname,
    };
  }

  private async createPrepared(
    dto: InternalCreateUserDto,
    identity: NormalizedCreationIdentity,
    passwordHash: string | undefined,
    session?: ClientSession,
  ): Promise<UserDocument> {
    const duplicateFilters: Record<string, unknown>[] = [
      { phone: { $in: identity.phoneCandidates } },
    ];
    if (identity.email) duplicateFilters.push({ email: identity.email });
    if (identity.cpf) duplicateFilters.push({ cpf: identity.cpf });
    const duplicateQuery = this.userModel
      .findOne({ $or: duplicateFilters })
      .select('_id phone email cpf')
      .lean();
    if (session) duplicateQuery.session(session);
    const duplicate = await duplicateQuery.exec();

    if (duplicate) {
      this.throwDuplicateConflict(duplicate, {
        phone: identity.phone,
        phoneCandidates: identity.phoneCandidates,
        email: identity.email,
        cpf: identity.cpf,
      });
    }

    const payload = {
      ...dto,
      phone: identity.phone,
      email: identity.email,
      cpf: identity.cpf,
      name: identity.name,
      nickname: identity.nickname,
      password: undefined,
      passwordHash,
      role: dto.role ?? UserRole.CUSTOMER,
    };
    try {
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

  private async replacePendingRegistration(
    pending: UserDocument,
    identity: NormalizedCreationIdentity,
    passwordHash: string,
    registrationIdHash: string,
    registrationPendingExpiresAt: Date,
  ): Promise<UserDocument | null> {
    return this.userModel
      .findOneAndUpdate(
        {
          _id: pending._id,
          phone: identity.phone,
          email: identity.email,
          cpf: identity.cpf,
          role: UserRole.CUSTOMER,
          isActive: false,
          registrationPending: true,
        },
        {
          $set: {
            passwordHash,
            name: identity.name,
            nickname: identity.nickname,
            emailVerified: false,
            registrationIdHash,
            registrationPendingExpiresAt,
            failedLoginAttempts: 0,
          },
          $inc: { authVersion: 1 },
          $unset: { password: 1, lockedUntil: 1 },
        },
        { new: true, runValidators: true },
      )
      .exec();
  }

  private hashRegistrationId(registrationId: string): string {
    return createHash('sha256').update(registrationId).digest('hex');
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

  private async registrationIdentityConflicts(
    dto: CreateUserDto,
  ): Promise<UserDocument[]> {
    const filters: Record<string, unknown>[] = [
      { phone: { $in: phoneLookupCandidates(dto.phone) } },
    ];
    const email = normalizeEmail(dto.email);
    const cpf = normalizeCpf(dto.cpf);
    if (email) filters.push({ email });
    if (cpf) filters.push({ cpf });
    return this.userModel
      .find({ $or: filters })
      .select(
        '_id phone email cpf role isActive registrationPending registrationPendingExpiresAt',
      )
      .limit(4)
      .exec();
  }

  private isExpiredPending(user: UserDocument, now: Date): boolean {
    return (
      user.role === UserRole.CUSTOMER &&
      user.isActive === false &&
      user.registrationPending === true &&
      (!user.registrationPendingExpiresAt ||
        user.registrationPendingExpiresAt <= now)
    );
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
