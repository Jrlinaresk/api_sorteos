import { Controller, Get, Param, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { OrdersService } from './orders.service';

@ApiTags('Public participation')
@Controller('campaigns/:campaignId')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get('top-buyers')
  @ApiOperation({ summary: 'Ranking público con nombre y teléfono enmascarados' })
  topBuyers(@Param('campaignId') campaignId: string, @Query('limit') limit?: string) {
    return this.orders.topBuyers(campaignId, Number(limit || 10));
  }

  @Get('min-max-quota')
  @ApiOperation({ summary: 'Menor y mayor título pagado, con propietario enmascarado' })
  minMaxQuota(@Param('campaignId') campaignId: string) {
    return this.orders.minMaxQuota(campaignId);
  }

  @Get('participants')
  participants(
    @Param('campaignId') campaignId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.orders.listPublicParticipants(campaignId, Number(page || 1), Number(limit || 100));
  }

  @Get('participants.csv')
  async participantsCsv(
    @Param('campaignId') campaignId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="participantes-${campaignId}.csv"`);
    return new StreamableFile(await this.orders.participantsCsv(campaignId));
  }

  @Get('titles/:number')
  title(@Param('campaignId') campaignId: string, @Param('number') number: string) {
    return this.orders.lookupPublicTitle(campaignId, number);
  }
}
