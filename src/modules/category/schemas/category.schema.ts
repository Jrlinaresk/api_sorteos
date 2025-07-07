/* src/modules/categories/schemas/category.schema.ts */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { ApiProperty } from '@nestjs/swagger';

@Schema({ timestamps: true })
export class Category extends Document {
  @ApiProperty({
    description: 'Nombre de la categoría',
    example: 'Electrónica',
  })
  @Prop({ required: true, unique: true })
  name: string;

  @ApiProperty({
    description: 'Descripción de la categoría',
    example: 'Dispositivos y gadgets electrónicos',
    nullable: true,
  })
  @Prop()
  description?: string;
}

export const CategorySchema = SchemaFactory.createForClass(Category);
