import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Product, ProductDocument } from './schemas/product.schema';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
  ) {}

  async create(dto: CreateProductDto): Promise<ProductDocument> {
    this.logger.debug(`Creando producto: ${dto.name}`);
    try {
      const product = await this.productModel.create(dto);
      this.logger.log(`Producto creado: ${product._id}`);
      return product;
    } catch (error) {
      this.logger.error('Error al crear producto', error.stack);
      throw new InternalServerErrorException('Error al crear producto');
    }
  }

  async findAll(): Promise<ProductDocument[]> {
    this.logger.debug('Listando todos los productos');
    try {
      return await this.productModel.find().sort({ createdAt: -1 }).exec();
    } catch (error) {
      this.logger.error('Error al listar productos', error.stack);
      throw new InternalServerErrorException('Error al listar productos');
    }
  }

  async findOne(id: string): Promise<ProductDocument> {
    this.logger.debug(`Buscando producto ID=${id}`);
    if (!Types.ObjectId.isValid(id)) {
      this.logger.warn(`ID inválido al buscar producto: ${id}`);
      throw new BadRequestException('ID de producto inválido');
    }
    try {
      const product = await this.productModel.findById(id).exec();
      if (!product) {
        this.logger.warn(`Producto no encontrado: ${id}`);
        throw new NotFoundException('Producto no encontrado');
      }
      return product;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(`Error al buscar producto: ${id}`, error.stack);
      throw new InternalServerErrorException('Error al buscar producto');
    }
  }

  async update(id: string, dto: UpdateProductDto): Promise<ProductDocument> {
    this.logger.debug(`Actualizando producto ID=${id}`);
    if (!Types.ObjectId.isValid(id)) {
      this.logger.warn(`ID inválido al actualizar producto: ${id}`);
      throw new BadRequestException('ID de producto inválido');
    }
    try {
      const updated = await this.productModel
        .findByIdAndUpdate(id, dto, { new: true })
        .exec();
      if (!updated) {
        this.logger.warn(`Producto no encontrado al actualizar: ${id}`);
        throw new NotFoundException('Producto no encontrado');
      }
      this.logger.log(`Producto actualizado: ${id}`);
      return updated;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(`Error al actualizar producto: ${id}`, error.stack);
      throw new InternalServerErrorException('Error al actualizar producto');
    }
  }

  async remove(id: string): Promise<void> {
    this.logger.debug(`Eliminando producto ID=${id}`);
    if (!Types.ObjectId.isValid(id)) {
      this.logger.warn(`ID inválido al eliminar producto: ${id}`);
      throw new BadRequestException('ID de producto inválido');
    }
    try {
      const result = await this.productModel.findByIdAndDelete(id).exec();
      if (!result) {
        this.logger.warn(`Producto no encontrado al eliminar: ${id}`);
        throw new NotFoundException('Producto no encontrado');
      }
      this.logger.log(`Producto eliminado: ${id}`);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(`Error al eliminar producto: ${id}`, error.stack);
      throw new InternalServerErrorException('Error al eliminar producto');
    }
  }
}
