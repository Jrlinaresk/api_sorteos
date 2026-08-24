import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { SignOptions } from 'jsonwebtoken';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { EmailModule } from '../email/email.module';
import { MongooseModule } from '@nestjs/mongoose';
import { RefreshSession, RefreshSessionSchema } from './schemas/refresh-session.schema';
import { RefreshTokensService } from './refresh-tokens.service';
import { OptionalJwtAuthGuard } from './guards/optional-jwt-auth.guard';

@Module({
  imports: [
    ConfigModule,
    UsersModule,
    EmailModule,
    MongooseModule.forFeature([{ name: RefreshSession.name, schema: RefreshSessionSchema }]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService): JwtModuleOptions => {
        const secret = configService.get<string>('JWT_SECRET');
        if (!secret || secret.length < 32) {
          throw new Error('JWT_SECRET debe tener al menos 32 caracteres');
        }
        const expiresIn =
          configService.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '15m';
        return {
          secret,
          signOptions: {
            expiresIn: expiresIn as SignOptions['expiresIn'],
            issuer: configService.get<string>('JWT_ISSUER') ?? 'api-sorteos',
            audience:
              configService.get<string>('JWT_AUDIENCE') ?? 'sorteos-web',
          },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    RefreshTokensService,
    JwtStrategy,
    JwtAuthGuard,
    OptionalJwtAuthGuard,
    RolesGuard,
  ],
  exports: [
    AuthService,
    JwtModule,
    PassportModule,
    JwtAuthGuard,
    OptionalJwtAuthGuard,
    RolesGuard,
  ],
})
export class AuthModule {}
