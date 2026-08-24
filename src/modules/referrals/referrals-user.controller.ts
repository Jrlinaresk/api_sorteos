import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PublicUserDto } from '../users/dto/public-user.dto';
import { ListMyReferralCommissionsQueryDto } from './dto/list-referrals-query.dto';
import { ReferralsService } from './referrals.service';

/** La identidad del beneficiario siempre se deriva del JWT. */
@ApiTags('User Referrals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('referrals/me')
export class ReferralsUserController {
  constructor(private readonly referralsService: ReferralsService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Resumen de códigos e ingresos del afiliado' })
  summary(@CurrentUser() user: PublicUserDto) {
    return this.referralsService.userSummary(user.id);
  }

  @Get('commissions')
  @ApiOperation({ summary: 'Comisiones del afiliado autenticado' })
  commissions(
    @CurrentUser() user: PublicUserDto,
    @Query() query: ListMyReferralCommissionsQueryDto,
  ) {
    return this.referralsService.listUserCommissions(user.id, query);
  }
}
