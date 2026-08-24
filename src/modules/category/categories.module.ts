/* src/modules/categories/categories.module.ts */
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { Category, CategorySchema } from './schemas/category.schema';
import { AuthModule } from '../auth/auth.module';
import { Raffle, RaffleSchema } from '../riffles/schema/raffle.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Category.name, schema: CategorySchema },
      { name: Raffle.name, schema: RaffleSchema },
    ]),
    AuthModule,
  ],
  controllers: [CategoriesController],
  providers: [CategoriesService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
