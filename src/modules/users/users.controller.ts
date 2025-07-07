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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from './schemas/user.schema';
import { UserOperationSummaries } from './enums/user-operation-summaries.enum';
import { UserMessages } from './enums/user-messages.enum';
import { Types } from 'mongoose';

@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @ApiOperation({ summary: UserOperationSummaries.CREATE })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: UserMessages.USER_CREATED,
    type: User,
  })
  create(@Body() dto: CreateUserDto): Promise<User> {
    return this.usersService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: UserOperationSummaries.FIND_ALL })
  @ApiResponse({
    status: HttpStatus.OK,
    description: UserMessages.USERS_LISTED,
    type: [User],
  })
  findAll(): Promise<User[]> {
    return this.usersService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: UserOperationSummaries.FIND_ONE })
  @ApiResponse({
    status: HttpStatus.OK,
    description: UserMessages.USER_CREATED,
    type: User,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: UserMessages.USER_NOT_FOUND,
  })
  findOne(@Param('id') id: string): Promise<User> {
    return this.usersService.findOne(id);
  }

  @Get('by-phone')
  @ApiOperation({ summary: UserOperationSummaries.FIND_BY_PHONE })
  @ApiResponse({
    status: HttpStatus.OK,
    description: UserMessages.USER_CREATED,
    type: User,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: UserMessages.USER_NOT_FOUND,
  })
  findByPhone(@Query('phone') phone: string): Promise<User> {
    return this.usersService.findByPhone(phone);
  }

  @Patch(':id')
  @ApiOperation({ summary: UserOperationSummaries.UPDATE })
  @ApiResponse({
    status: HttpStatus.OK,
    description: UserMessages.USER_UPDATED,
    type: User,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: UserMessages.USER_NOT_FOUND,
  })
  update(@Param('id') id: string, @Body() dto: UpdateUserDto): Promise<User> {
    return this.usersService.update(id, dto);
  }

  @Delete(':id')
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

  @Post(':id/participations')
  @ApiOperation({ summary: UserOperationSummaries.ADD_PARTICIPATION })
  @ApiResponse({
    status: HttpStatus.OK,
    description: UserMessages.PARTICIPATION_ADDED,
    type: User,
  })
  addParticipation(
    @Param('id') userId: string,
    @Body('raffleId') raffleId: string,
  ): Promise<User> {
    return this.usersService.addParticipation(userId, raffleId);
  }

  @Delete(':id/participations/:raffleId')
  @ApiOperation({ summary: UserOperationSummaries.REMOVE_PARTICIPATION })
  @ApiResponse({
    status: HttpStatus.OK,
    description: UserMessages.PARTICIPATION_REMOVED,
    type: User,
  })
  removeParticipation(
    @Param('id') userId: string,
    @Param('raffleId') raffleId: string,
  ): Promise<User> {
    return this.usersService.removeParticipation(userId, raffleId);
  }

  @Get(':id/participations')
  @ApiOperation({ summary: UserOperationSummaries.FIND_ONE })
  @ApiResponse({
    status: HttpStatus.OK,
    description: UserMessages.USERS_LISTED,
    type: [String],
  })
  getParticipations(@Param('id') userId: string): Promise<Types.ObjectId[]> {
    return this.usersService.getParticipations(userId);
  }
}
