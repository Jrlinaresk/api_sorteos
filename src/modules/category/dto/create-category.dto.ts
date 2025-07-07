/* src/modules/categories/dto/create-category.dto.ts */
import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
  IsOptional,
} from 'class-validator';

export class CreateCategoryDto {
  @ApiProperty({ description: 'Nombre único de la categoría', example: 'Moda' })
  @IsNotEmpty()
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  name: string;

  @ApiProperty({
    description: 'Descripción de la categoría',
    example: 'Ropa y accesorios',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;
}
