import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser>(
    error: unknown,
    user: TUser | false | null,
    _info: unknown,
    context: ExecutionContext,
  ): TUser | undefined {
    const authorization = context
      .switchToHttp()
      .getRequest<{ headers?: { authorization?: string } }>()
      .headers?.authorization;
    if (!authorization) return undefined;
    if (error || !user) {
      if (error instanceof Error) throw error;
      throw new UnauthorizedException('Token ausente, inválido o vencido');
    }
    return user;
  }
}
