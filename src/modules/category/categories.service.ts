/* src/modules/categories/categories.service.ts */
import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Category } from './schemas/category.schema';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CategoryMessages } from './enums/category-messages.enum.ts';

@Injectable()
export class CategoriesService {
  constructor(
    @InjectModel(Category.name) private categoryModel: Model<Category>,
  ) {}

  async create(dto: CreateCategoryDto): Promise<Category> {
    const exists = await this.categoryModel.findOne({ name: dto.name });
    if (exists) throw new ConflictException(CategoryMessages.NAME_CONFLICT);
    try {
      return await this.categoryModel.create(dto);
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        (error as { code?: number }).code === 11000
      ) {
        throw new ConflictException(CategoryMessages.NAME_CONFLICT);
      }
      throw error;
    }
  }

  async findAll(): Promise<Category[]> {
    return this.categoryModel.find().exec();
  }

  async findOne(id: string): Promise<Category> {
    if (!Types.ObjectId.isValid(id))
      throw new BadRequestException(CategoryMessages.INVALID_ID);
    const cat = await this.categoryModel.findById(id).exec();
    if (!cat) throw new NotFoundException(CategoryMessages.CATEGORY_NOT_FOUND);
    return cat;
  }

  async update(id: string, dto: UpdateCategoryDto): Promise<Category> {
    if (!Types.ObjectId.isValid(id))
      throw new BadRequestException(CategoryMessages.INVALID_ID);
    if (dto.name) {
      const exists = await this.categoryModel
        .findOne({ name: dto.name, _id: { $ne: id } })
        .exec();
      if (exists) throw new ConflictException(CategoryMessages.NAME_CONFLICT);
    }
    const updated = await this.categoryModel
      .findByIdAndUpdate(id, dto, { new: true })
      .exec();
    if (!updated)
      throw new NotFoundException(CategoryMessages.CATEGORY_NOT_FOUND);
    return updated;
  }

  async remove(id: string): Promise<void> {
    if (!Types.ObjectId.isValid(id))
      throw new BadRequestException(CategoryMessages.INVALID_ID);
    const res = await this.categoryModel.findByIdAndDelete(id).exec();
    if (!res) throw new NotFoundException(CategoryMessages.CATEGORY_NOT_FOUND);
  }

  async searchByName(name: string): Promise<Category[]> {
    const normalized = (name || '').trim().slice(0, 80);
    if (!normalized) return [];
    const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return this.categoryModel
      .find({ name: { $regex: escaped, $options: 'i' } })
      .limit(50)
      .exec();
  }
}
