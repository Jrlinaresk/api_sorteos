/* src/modules/categories/dto/update-category.dto.ts */
import { PartialType } from '@nestjs/mapped-types';
import { CreateCategoryDto } from './create-category.dto';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateCategoryDto extends PartialType(CreateCategoryDto) {
  @ApiProperty({ description: 'Nuevo nombre de la categoría', required: false })
  name?: string;

  @ApiProperty({ description: 'Nueva descripción', required: false })
  description?: string;
}
