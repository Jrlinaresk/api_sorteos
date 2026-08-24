import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PublicUserDto } from '../users/dto/public-user.dto';
import { UserRole } from '../users/enums/user-role.enum';
import { DrawsService } from './draws.service';
import { VerifyFederalDrawDto } from './dto/verify-federal-draw.dto';
import { VerifyManualDrawDto } from './dto/verify-manual-draw.dto';
import {
  CommitCryptographicDrawDto,
  VerifyCryptographicDrawDto,
} from './dto/cryptographic-draw.dto';

@ApiTags('Admin draws')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.OPERATOR, UserRole.ADMIN)
@Controller('admin/campaigns/:campaignId/draw')
export class AdminDrawsController {
  constructor(private readonly draws: DrawsService) {}

  @Post('cryptographic/commit')
  @ApiOperation({
    summary: 'Publica el compromiso criptográfico antes de abrir ventas',
  })
  commitCryptographic(
    @Param('campaignId') campaignId: string,
    @Body() dto: CommitCryptographicDrawDto,
    @CurrentUser() actor: PublicUserDto,
  ) {
    return this.draws.commitCryptographic(campaignId, dto, actor.id);
  }

  @Post('verify/federal-lottery')
  @ApiOperation({
    summary:
      'Concilia dos lecturas del resultado oficial de Lotería Federal CAIXA',
  })
  verifyFederal(
    @Param('campaignId') campaignId: string,
    @Body() dto: VerifyFederalDrawDto,
    @CurrentUser() actor: PublicUserDto,
  ) {
    return this.draws.verifyFederal(campaignId, dto, actor.id);
  }

  @Post('verify/manual-external')
  @ApiOperation({ summary: 'Registra un resultado externo con evidencia' })
  verifyManual(
    @Param('campaignId') campaignId: string,
    @Body() dto: VerifyManualDrawDto,
    @CurrentUser() actor: PublicUserDto,
  ) {
    return this.draws.verifyManual(campaignId, dto, actor.id);
  }

  @Post('verify/cryptographic')
  @ApiOperation({
    summary: 'Revela la semilla y combina una entropía externa auditable',
  })
  verifyCryptographic(
    @Param('campaignId') campaignId: string,
    @Body() dto: VerifyCryptographicDrawDto,
    @CurrentUser() actor: PublicUserDto,
  ) {
    return this.draws.verifyCryptographic(campaignId, dto, actor.id);
  }

  @Post('publish')
  @ApiOperation({
    summary: 'Publica de forma inmutable un resultado ya verificado',
  })
  publish(
    @Param('campaignId') campaignId: string,
    @CurrentUser() actor: PublicUserDto,
  ) {
    return this.draws.publish(campaignId, actor.id);
  }

  @Get()
  @ApiOperation({
    summary: 'Consulta el resultado y la evidencia íntegra para auditoría',
  })
  find(@Param('campaignId') campaignId: string) {
    return this.draws.findAdmin(campaignId);
  }
}
