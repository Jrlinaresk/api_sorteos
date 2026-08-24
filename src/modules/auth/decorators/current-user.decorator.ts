import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { PublicUserDto } from '../../users/dto/public-user.dto';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): PublicUserDto => {
    const request = context.switchToHttp().getRequest<{
      user: PublicUserDto;
    }>();
    return request.user;
  },
);
