import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { ApiProperty } from '@nestjs/swagger';
import { ProductCategory } from '../enums/product-category.enum';

export type ProductDocument = Product & Document;

@Schema({ timestamps: true })
export class Product {
  @ApiProperty({ description: 'Nombre del producto' })
  @Prop({ required: true, trim: true })
  name: string;

  @ApiProperty({ description: 'Descripción del producto' })
  @Prop({ required: true })
  description: string;

  @ApiProperty({ description: 'Precio del producto', example: 19.99 })
  @Prop({ required: true })
  price: number;

  @ApiProperty({
    description: 'Categoría del producto',
    enum: ProductCategory,
  })
  @Prop({ required: true, enum: ProductCategory })
  category: ProductCategory;

  @ApiProperty({
    description: 'URLs de las imágenes del producto',
    type: [String],
  })
  @Prop({ type: [String], default: [] })
  images: string[];
}

export const ProductSchema = SchemaFactory.createForClass(Product);
