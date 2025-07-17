import { ApiProperty } from '@nestjs/swagger';
import { ProductCategory } from '../enums/product-category.enum';

export class CreateProductDto {
  @ApiProperty({ description: 'Nombre del producto' })
  readonly name: string;

  @ApiProperty({ description: 'Descripción del producto' })
  readonly description: string;

  @ApiProperty({ description: 'Precio del producto', example: 19.99 })
  readonly price: number;

  @ApiProperty({
    description: 'Categoría del producto',
    enum: ProductCategory,
  })
  readonly category: ProductCategory;

  @ApiProperty({
    description: 'Lista de URLs de imágenes',
    type: [String],
    example: [
      'https://tuservidor.com/img1.png',
      'https://tuservidor.com/img2.png',
    ],
  })
  readonly images: string[];
}
