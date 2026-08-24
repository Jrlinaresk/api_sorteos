import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DrawsService } from './draws.service';

@ApiTags('Public results')
@Controller('results')
export class ResultsController {
  constructor(private readonly draws: DrawsService) {}

  @Get()
  @ApiOperation({ summary: 'Archivo paginado de ganadores y resultados publicados' })
  list(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.draws.listPublic(Number(page || 1), Number(limit || 12));
  }
}
