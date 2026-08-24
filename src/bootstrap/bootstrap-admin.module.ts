import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { validateEnvironment } from '../config/environment.validation';
import { mongoConnectionOptions } from '../config/mongo.config';
import { AuditService } from '../modules/audit/audit.service';
import {
  AuditLog,
  AuditLogSchema,
} from '../modules/audit/schemas/audit-log.schema';
import { User, UserSchema } from '../modules/users/schemas/user.schema';
import { UsersService } from '../modules/users/users.service';
import { FirstAdminBootstrapService } from './first-admin-bootstrap.service';
import {
  BootstrapState,
  BootstrapStateSchema,
} from './schemas/bootstrap-state.schema';

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: [`.env.${process.env.NODE_ENV || 'development'}`, '.env'],
      isGlobal: true,
      cache: true,
      validate: validateEnvironment,
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: mongoConnectionOptions,
    }),
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: AuditLog.name, schema: AuditLogSchema },
      { name: BootstrapState.name, schema: BootstrapStateSchema },
    ]),
  ],
  providers: [UsersService, AuditService, FirstAdminBootstrapService],
})
export class BootstrapAdminModule {}
