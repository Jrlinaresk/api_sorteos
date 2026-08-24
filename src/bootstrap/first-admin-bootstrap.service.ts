import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { AuditService } from '../modules/audit/audit.service';
import { AuditCategory } from '../modules/audit/enums/audit-category.enum';
import { CreateUserDto } from '../modules/users/dto/create-user.dto';
import { UserRole } from '../modules/users/enums/user-role.enum';
import { User, UserDocument } from '../modules/users/schemas/user.schema';
import { UsersService } from '../modules/users/users.service';
import {
  BootstrapState,
  BootstrapStateDocument,
} from './schemas/bootstrap-state.schema';

const FIRST_ADMIN_MARKER = 'first-admin';

export interface FirstAdminBootstrapResult {
  created: boolean;
  userId: string;
}

@Injectable()
export class FirstAdminBootstrapService {
  constructor(
    private readonly config: ConfigService,
    private readonly usersService: UsersService,
    private readonly auditService: AuditService,
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(BootstrapState.name)
    private readonly bootstrapStateModel: Model<BootstrapStateDocument>,
  ) {}

  async run(): Promise<FirstAdminBootstrapResult> {
    const dto = await this.readAndValidateInput();
    const session = await this.connection.startSession();
    let result: FirstAdminBootstrapResult | undefined;

    try {
      await session.withTransaction(async () => {
        const marker = await this.bootstrapStateModel
          .findById(FIRST_ADMIN_MARKER)
          .session(session)
          .lean()
          .exec();
        if (marker) {
          const existing = await this.userModel
            .findOne({ _id: marker.userId, role: UserRole.ADMIN })
            .session(session)
            .select('_id')
            .lean()
            .exec();
          if (!existing) {
            throw new Error(
              'La inicialización del primer administrador ya fue consumida y su cuenta no está disponible',
            );
          }
          result = { created: false, userId: String(existing._id) };
          return;
        }

        const existingAdmin = await this.userModel
          .findOne({ role: UserRole.ADMIN })
          .session(session)
          .select('_id')
          .lean()
          .exec();
        if (existingAdmin) {
          await this.createMarker(existingAdmin._id, session);
          result = { created: false, userId: String(existingAdmin._id) };
          return;
        }

        const user = await this.usersService.create(dto, session);
        if (dto.email) {
          user.emailVerified = true;
          await user.save({ session });
        }
        await this.createMarker(user._id, session);
        result = { created: true, userId: String(user._id) };
      });
    } finally {
      await session.endSession();
    }

    if (!result) {
      throw new Error('MongoDB no confirmó la inicialización administrativa');
    }

    if (result.created) {
      await this.auditService.tryRecord({
        action: 'security.bootstrap.first_admin',
        category: AuditCategory.SECURITY,
        actorId: 'bootstrap-admin-cli',
        actorRole: UserRole.ADMIN,
        resourceType: User.name,
        resourceId: result.userId,
        after: { role: UserRole.ADMIN, isActive: true },
      });
    }
    return result;
  }

  private async createMarker(
    userId: Types.ObjectId,
    session: ClientSession,
  ): Promise<void> {
    await this.bootstrapStateModel.create(
      [
        {
          _id: FIRST_ADMIN_MARKER,
          operation: FIRST_ADMIN_MARKER,
          userId,
          initializedAt: new Date(),
        },
      ],
      { session },
    );
  }

  private async readAndValidateInput(): Promise<CreateUserDto> {
    const name = this.required('BOOTSTRAP_ADMIN_NAME');
    const dto = plainToInstance(CreateUserDto, {
      name,
      nickname: name,
      phone: this.required('BOOTSTRAP_ADMIN_PHONE'),
      password: this.required('BOOTSTRAP_ADMIN_PASSWORD', false),
      email: this.optional('BOOTSTRAP_ADMIN_EMAIL'),
      cpf: this.optional('BOOTSTRAP_ADMIN_CPF'),
      role: UserRole.ADMIN,
    });
    const errors = await validate(dto, {
      forbidUnknownValues: true,
      stopAtFirstError: false,
    });
    if (errors.length) {
      const fields = errors
        .map((error) => error.property)
        .sort()
        .join(', ');
      throw new Error(
        `Las variables del administrador inicial no son válidas: ${fields}`,
      );
    }
    return dto;
  }

  private required(name: string, trim = true): string {
    const raw = this.config.get<string>(name);
    const value = trim ? raw?.trim() : raw;
    if (!value) throw new Error(`${name} es obligatoria`);
    return value;
  }

  private optional(name: string): string | undefined {
    return this.config.get<string>(name)?.trim() || undefined;
  }
}
