import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsersService } from '../../users/users.service';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { PublicUserDto } from '../../users/dto/public-user.dto';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly usersService: UsersService,
  ) {
    const secret = configService.get<string>('JWT_SECRET');
    if (!secret || secret.length < 32) {
      throw new Error('JWT_SECRET debe tener al menos 32 caracteres');
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
      issuer: configService.get<string>('JWT_ISSUER') ?? 'api-sorteos',
      audience: configService.get<string>('JWT_AUDIENCE') ?? 'sorteos-web',
    });
  }

  async validate(payload: JwtPayload): Promise<PublicUserDto> {
    const user = await this.usersService.findOneOrNull(payload.sub);
    if (
      !user ||
      user.isActive === false ||
      (user.authVersion ?? 0) !== (payload.ver ?? 0)
    ) {
      throw new UnauthorizedException('Sesión inválida');
    }
    return this.usersService.toPublicUser(user);
  }
}
