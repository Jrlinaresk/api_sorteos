import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ListCampaignsDto } from './dto/list-campaigns.dto';
import { QuoteCampaignDto } from './dto/quote-campaign.dto';
import { RafflesService } from './raffles.service';

@ApiTags('Public campaigns')
@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly campaigns: RafflesService) {}

  @Get()
  @ApiOperation({ summary: 'Catálogo público paginado de campañas' })
  list(@Query() query: ListCampaignsDto) {
    return this.campaigns.findPublic(query);
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Detalle público completo por slug' })
  findBySlug(@Param('slug') slug: string) {
    return this.campaigns.findPublicBySlug(slug);
  }

  @Get(':slug/regulations/:version')
  @ApiOperation({
    summary: 'Consulta una versión histórica e inmutable del reglamento',
  })
  regulation(@Param('slug') slug: string, @Param('version') version: string) {
    return this.campaigns.findPublicRegulation(slug, version);
  }

  @Post(':slug/quote')
  @ApiOperation({
    summary: 'Calcula en servidor el precio y las cuotas de una selección',
    description:
      'La respuesta aplica el stock vigente y ORDER_MAX_ALLOCATED_TITLES sobre la asignación total, incluidas las cuotas bonus/doble oportunidad; checkout usa la misma regla.',
  })
  async quote(@Param('slug') slug: string, @Body() dto: QuoteCampaignDto) {
    const campaign = await this.campaigns.findPurchasableBySlug(slug);
    return this.campaigns.calculatePrice(campaign, dto.quantity);
  }
}
