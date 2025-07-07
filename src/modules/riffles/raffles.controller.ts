/* src/modules/raffles/raffles.controller.ts */
import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { RafflesService } from './raffles.service';
import { CreateRaffleDto } from './dto/create-raffle.dto';
import { RaffleMessages } from './enums/raffle-messages.enum';
import { RaffleOperationSummaries } from './enums/raffle-operation-summaries.enum';
import { Raffle } from './schema/raffle.schema';
import { UpdateRaffleDto } from './enums/update-raffle.dto';

@ApiTags('Raffles')
@Controller('raffles')
export class RafflesController {
  constructor(private readonly rafflesService: RafflesService) {}

  @Post()
  @ApiOperation({ summary: RaffleOperationSummaries.CREATE })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: RaffleMessages.RAFFLE_CREATED,
    type: Raffle,
  })
  create(@Body() dto: CreateRaffleDto): Promise<Raffle> {
    return this.rafflesService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: RaffleOperationSummaries.FIND_ALL })
  @ApiResponse({
    status: HttpStatus.OK,
    description: RaffleMessages.RAFFLES_LISTED,
    type: [Raffle],
  })
  findAll(): Promise<Raffle[]> {
    return this.rafflesService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: RaffleOperationSummaries.FIND_ONE })
  @ApiResponse({
    status: HttpStatus.OK,
    description: RaffleMessages.RAFFLES_LISTED,
    type: Raffle,
  })
  findOne(@Param('id') id: string): Promise<Raffle> {
    return this.rafflesService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: RaffleOperationSummaries.UPDATE })
  @ApiResponse({
    status: HttpStatus.OK,
    description: RaffleMessages.RAFFLE_UPDATED,
    type: Raffle,
  })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateRaffleDto,
  ): Promise<Raffle> {
    return this.rafflesService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: RaffleOperationSummaries.DELETE })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: RaffleMessages.RAFFLE_DELETED,
  })
  remove(@Param('id') id: string): Promise<void> {
    return this.rafflesService.remove(id);
  }

  @Post(':id/participants')
  @ApiOperation({ summary: RaffleOperationSummaries.ADD_PARTICIPANT })
  @ApiResponse({
    status: HttpStatus.OK,
    description: RaffleMessages.PARTICIPATION_ADDED,
    type: Raffle,
  })
  addParticipant(
    @Param('id') raffleId: string,
    @Body('userId') userId: string,
  ): Promise<Raffle> {
    return this.rafflesService.addParticipant(raffleId, userId);
  }
}
