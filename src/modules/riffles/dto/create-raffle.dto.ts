/* src/modules/raffles/dto/create-raffle.dto.ts */
import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsString,
  IsEnum,
  IsOptional,
  IsMongoId,
  IsUrl,
  IsDateString,
  IsInt,
  Min,
} from 'class-validator';

export class CreateRaffleDto {
  @ApiProperty({ description: 'Nombre de la rifa' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({ description: 'Descripción de la rifa', required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: 'URL de la imagen', required: false })
  @IsOptional()
  @IsUrl()
  imageUrl?: string;

  @ApiProperty({ description: 'ID de categoría asociada' })
  @IsNotEmpty()
  @IsMongoId()
  category: string;

  @ApiProperty({
    description: 'Tamaño de la rifa',
    enum: ['small', 'medium', 'large'],
  })
  @IsEnum(['small', 'medium', 'large'])
  size: string;

  @ApiProperty({
    description: 'Nivel de costo',
    enum: ['low', 'medium', 'high'],
  })
  @IsEnum(['low', 'medium', 'high'])
  costLevel: string;

  @ApiProperty({ description: 'Máximo de participantes' })
  @IsInt()
  @Min(1)
  maxParticipants: number;

  @ApiProperty({
    description: 'Fecha del sorteo',
    required: false,
    type: String,
    format: 'date-time',
  })
  @IsOptional()
  @IsDateString()
  drawDate?: string;
}
