/* src/modules/users/dto/update-user.dto.ts */
import { PartialType } from '@nestjs/mapped-types';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateUserDto } from './create-user.dto';

export class UpdateUserDto extends PartialType(CreateUserDto) {
  @ApiPropertyOptional({
    description: 'Activa o bloquea el acceso de la cuenta',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
