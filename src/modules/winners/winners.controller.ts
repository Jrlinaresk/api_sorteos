/* src/modules/winners/winners.controller.ts */
import { Controller, Post, Body, Get, Param, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { WinnersService } from './winners.service';
import { DrawWinnerDto } from './dto/draw-winner.dto';
import { WinnerMessages } from './enums/winner-messages.enum';
import { WinnerOperationSummaries } from './enums/winner-operation-summaries.enum';

@ApiTags('Winners')
@Controller('winners')
export class WinnersController {
  constructor(private readonly winnersService: WinnersService) {}

  @Post('draw')
  @ApiOperation({ summary: WinnerOperationSummaries.DRAW })
  @ApiResponse({
    status: HttpStatus.OK,
    description: WinnerMessages.DRAW_SUCCESS,
  })
  draw(@Body() dto: DrawWinnerDto) {
    return this.winnersService.drawWinners(dto.raffleId);
  }

  @Get(':raffleId')
  @ApiOperation({ summary: WinnerOperationSummaries.GET_WINNERS })
  @ApiResponse({
    status: HttpStatus.OK,
    description: WinnerMessages.DRAW_SUCCESS,
    type: [String],
  })
  get(@Param('raffleId') raffleId: string) {
    return this.winnersService.getWinners(raffleId);
  }
}
