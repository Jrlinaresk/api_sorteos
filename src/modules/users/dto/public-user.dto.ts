import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '../enums/user-role.enum';

export class PublicUserDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  phone: string;

  @ApiProperty()
  nickname: string;

  @ApiPropertyOptional()
  name?: string;

  @ApiPropertyOptional()
  cpf?: string;

  @ApiPropertyOptional()
  email?: string;

  @ApiProperty({ enum: UserRole })
  role: UserRole;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty()
  emailVerified: boolean;

  @ApiProperty()
  balance: number;

  @ApiPropertyOptional()
  address?: string;

  @ApiPropertyOptional()
  profilePictureUrl?: string;

  @ApiProperty({ type: [String] })
  participations: unknown[];

  @ApiPropertyOptional()
  createdAt?: Date;

  @ApiPropertyOptional()
  updatedAt?: Date;
}
