/* src/modules/categories/categories.controller.ts */
import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { Category } from './schemas/category.schema';
import { CategoryOperationSummaries } from './enums/category-operation-summaries.enum';
import { CategoryMessages } from './enums/category-messages.enum.ts';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/enums/user-role.enum';

@ApiTags('Categories')
@Controller('categories')
// @UseGuards(JwtAuthGuard, RolesGuard)
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.OPERATOR, UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: CategoryOperationSummaries.CREATE })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: CategoryMessages.CATEGORY_CREATED,
    type: Category,
  })
  async create(@Body() dto: CreateCategoryDto): Promise<Category> {
    return this.categoriesService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: CategoryOperationSummaries.FIND_ALL })
  @ApiResponse({
    status: HttpStatus.OK,
    description: CategoryMessages.CATEGORY_LISTED,
    type: [Category],
  })
  async findAll(): Promise<Category[]> {
    return this.categoriesService.findAll();
  }

  @Get('search')
  @ApiOperation({ summary: CategoryOperationSummaries.SEARCH })
  @ApiResponse({
    status: HttpStatus.OK,
    description: CategoryMessages.CATEGORY_LISTED,
    type: [Category],
  })
  async search(@Query('name') name: string): Promise<Category[]> {
    return this.categoriesService.searchByName(name);
  }

  @Get(':id')
  @ApiOperation({ summary: CategoryOperationSummaries.FIND_ONE })
  @ApiResponse({
    status: HttpStatus.OK,
    description: CategoryMessages.CATEGORY_LISTED,
    type: Category,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: CategoryMessages.CATEGORY_NOT_FOUND,
  })
  async findOne(@Param('id') id: string): Promise<Category> {
    return this.categoriesService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.OPERATOR, UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: CategoryOperationSummaries.UPDATE })
  @ApiResponse({
    status: HttpStatus.OK,
    description: CategoryMessages.CATEGORY_UPDATED,
    type: Category,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: CategoryMessages.CATEGORY_NOT_FOUND,
  })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
  ): Promise<Category> {
    return this.categoriesService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: CategoryOperationSummaries.DELETE })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: CategoryMessages.CATEGORY_DELETED,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: CategoryMessages.CATEGORY_NOT_FOUND,
  })
  async remove(@Param('id') id: string): Promise<void> {
    return this.categoriesService.remove(id);
  }
}
