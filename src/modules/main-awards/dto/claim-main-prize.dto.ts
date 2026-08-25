import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDefined,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { MainPrizeChoice } from '../schemas/main-prize-award.schema';

export class MainPrizeDeliveryDto {
  @ApiProperty({ example: 'Maria da Silva' })
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  @Matches(/\S/)
  recipientName: string;

  @ApiProperty({ example: '+55 11 99999-9999' })
  @IsString()
  @MaxLength(24)
  @Matches(/^(?=(?:\D*\d){8,15}\D*$)\+?[0-9() .-]+$/)
  phone: string;

  @ApiProperty({
    example: 'Rua das Flores, 123, apto 4, Centro, São Paulo - SP, 01000-000',
  })
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  @Matches(/\S/)
  address: string;

  @ApiPropertyOptional({ example: 'Entregar en portería de 9h a 18h.' })
  @IsOptional()
  @IsString()
  @MaxLength(1_000)
  @Matches(/\S/)
  instructions?: string;
}

export class ClaimMainPrizeDto {
  @ApiProperty({ enum: MainPrizeChoice })
  @IsEnum(MainPrizeChoice)
  choice: MainPrizeChoice;

  @ApiPropertyOptional({
    type: MainPrizeDeliveryDto,
    description:
      'Obligatorio y validado únicamente cuando choice es physical. No se publica en resultados ni listados administrativos.',
  })
  @ValidateIf(
    (dto: ClaimMainPrizeDto) => dto.choice === MainPrizeChoice.Physical,
  )
  @IsDefined()
  @ValidateNested()
  @Type(() => MainPrizeDeliveryDto)
  delivery?: MainPrizeDeliveryDto;
}
