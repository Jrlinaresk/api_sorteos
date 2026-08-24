import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DrawsService } from './draws.service';

@ApiTags('Public results')
@Controller('campaigns')
export class DrawsController {
  constructor(private readonly draws: DrawsService) {}

  @Get(':campaignIdOrSlug/result')
  @ApiOperation({ summary: 'Obtiene el resultado público y la evidencia verificable publicada' })
  result(@Param('campaignIdOrSlug') campaignIdOrSlug: string) {
    return this.draws.findPublicByCampaign(campaignIdOrSlug);
  }
}
