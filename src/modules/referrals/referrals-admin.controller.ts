import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../users/enums/user-role.enum';
import { CreateReferralCodeDto } from './dto/create-referral-code.dto';
import {
  ListReferralClicksQueryDto,
  ListReferralCodesQueryDto,
  ListReferralCommissionsQueryDto,
} from './dto/list-referrals-query.dto';
import { UpdateCommissionStatusDto } from './dto/update-commission-status.dto';
import { UpdateReferralCodeDto } from './dto/update-referral-code.dto';
import {
  toAdminReferralCode,
  toAdminReferralCommission,
} from './referral.presenter';
import { ReferralsService } from './referrals.service';

/** Superficie separada para añadir JwtAuthGuard y RolesGuard de administración. */
@ApiTags('Admin Referrals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.OPERATOR, UserRole.ADMIN)
@Controller('admin/referrals')
export class ReferralsAdminController {
  constructor(private readonly referralsService: ReferralsService) {}

  @Post('codes')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Crear un código de referido' })
  async createCode(@Body() dto: CreateReferralCodeDto) {
    return toAdminReferralCode(await this.referralsService.createCode(dto));
  }

  @Get('codes')
  @ApiOperation({ summary: 'Listar códigos con filtros' })
  listCodes(@Query() query: ListReferralCodesQueryDto) {
    return this.referralsService.listCodes(query);
  }

  @Patch('codes/:codeId')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Editar, pausar o desactivar un código' })
  async updateCode(
    @Param('codeId') codeId: string,
    @Body() dto: UpdateReferralCodeDto,
  ) {
    return toAdminReferralCode(
      await this.referralsService.updateCode(codeId, dto),
    );
  }

  @Get('clicks')
  @ApiOperation({ summary: 'Listar clicks y datos UTM' })
  listClicks(@Query() query: ListReferralClicksQueryDto) {
    return this.referralsService.listClicks(query);
  }

  @Get('commissions')
  @ApiOperation({ summary: 'Listar atribuciones y comisiones' })
  listCommissions(@Query() query: ListReferralCommissionsQueryDto) {
    return this.referralsService.listCommissions(query);
  }

  @Patch('commissions/:commissionId/status')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Aprobar, pagar, rechazar o revertir una comisión' })
  async updateCommissionStatus(
    @Param('commissionId') commissionId: string,
    @Body() dto: UpdateCommissionStatusDto,
  ) {
    return toAdminReferralCommission(
      await this.referralsService.updateCommissionStatus(commissionId, dto),
    );
  }
}
