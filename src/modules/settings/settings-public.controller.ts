import { Controller, Get, Header } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PublicSettingsView, SettingsService } from './settings.service';

@ApiTags('Public - Settings')
@Controller('settings')
export class SettingsPublicController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get('public')
  @Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  @ApiOperation({ summary: 'Configuración pública actualmente publicada' })
  @ApiOkResponse({ description: 'Marca, contacto, tema, legal y funciones' })
  getPublic(): Promise<PublicSettingsView> {
    return this.settingsService.getPublic();
  }
}
