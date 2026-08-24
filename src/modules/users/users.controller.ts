/* src/modules/users/users.controller.ts */
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
  HttpCode,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserOperationSummaries } from './enums/user-operation-summaries.enum';
import { UserMessages } from './enums/user-messages.enum';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from './enums/user-role.enum';
import { PublicUserDto } from './dto/public-user.dto';
import { ListUsersDto } from './dto/list-users.dto';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiForbiddenResponse({ description: 'El rol no permite esta operación' })
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: UserOperationSummaries.CREATE })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: UserMessages.USER_CREATED,
    type: PublicUserDto,
  })
  async create(@Body() dto: CreateUserDto): Promise<PublicUserDto> {
    return this.usersService.toPublicUser(await this.usersService.create(dto));
  }

  @Get()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: UserOperationSummaries.FIND_ALL })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Página de usuarios; acceso exclusivo de ADMIN',
  })
  async findAll(@Query() query: ListUsersDto) {
    const result = await this.usersService.findAll(query);
    return {
      data: this.usersService.toPublicUsers(result.data),
      meta: result.meta,
    };
  }

  @Get('by-phone')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: UserOperationSummaries.FIND_BY_PHONE })
  @ApiResponse({
    status: HttpStatus.OK,
    description: UserMessages.USER_CREATED,
    type: PublicUserDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: UserMessages.USER_NOT_FOUND,
  })
  async findByPhone(@Query('phone') phone: string): Promise<PublicUserDto> {
    return this.usersService.toPublicUser(
      await this.usersService.findByPhone(phone),
    );
  }

  @Get(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: UserOperationSummaries.FIND_ONE })
  @ApiResponse({
    status: HttpStatus.OK,
    description: UserMessages.USER_CREATED,
    type: PublicUserDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: UserMessages.USER_NOT_FOUND,
  })
  async findOne(@Param('id') id: string): Promise<PublicUserDto> {
    return this.usersService.toPublicUser(await this.usersService.findOne(id));
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: UserOperationSummaries.UPDATE })
  @ApiResponse({
    status: HttpStatus.OK,
    description: UserMessages.USER_UPDATED,
    type: PublicUserDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: UserMessages.USER_NOT_FOUND,
  })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ): Promise<PublicUserDto> {
    return this.usersService.toPublicUser(
      await this.usersService.update(id, dto),
    );
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: UserOperationSummaries.DELETE })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: UserMessages.USER_DELETED,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: UserMessages.USER_NOT_FOUND,
  })
  remove(@Param('id') id: string): Promise<void> {
    return this.usersService.remove(id);
  }
}
