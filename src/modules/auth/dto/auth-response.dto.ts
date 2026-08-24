import { ApiProperty } from '@nestjs/swagger';
import { PublicUserDto } from '../../users/dto/public-user.dto';

export class AuthResponseDto {
  @ApiProperty()
  accessToken: string;

  @ApiProperty()
  refreshToken: string;

  @ApiProperty({ type: String, format: 'date-time' })
  refreshTokenExpiresAt: Date;

  @ApiProperty({ example: 'Bearer' })
  tokenType: 'Bearer';

  @ApiProperty({ example: '15m' })
  expiresIn: string;

  @ApiProperty({ type: PublicUserDto })
  user: PublicUserDto;
}
