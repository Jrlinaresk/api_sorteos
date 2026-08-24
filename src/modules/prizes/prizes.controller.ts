import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PublicUserDto } from '../users/dto/public-user.dto';
import { ClaimPrizeDto } from './dto/claim-prize.dto';
import { PrizesService } from './prizes.service';

@ApiTags('Public prizes')
@Controller()
export class PrizesController {
  constructor(private readonly prizes: PrizesService) {}

  @Get('campaigns/:campaignId/prizes')
  list(@Param('campaignId') campaignId: string) {
    return this.prizes.listPublic(campaignId);
  }

  @Get('prizes/attempts/order/:orderPublicId')
  @ApiHeader({ name: 'X-Order-Token', required: true })
  listAttempts(
    @Param('orderPublicId') orderPublicId: string,
    @Headers('x-order-token') orderToken: string,
  ) {
    return this.prizes.listAttemptsForOrder(orderPublicId, orderToken);
  }

  @Get('prize-awards/order/:orderPublicId')
  @ApiHeader({ name: 'X-Order-Token', required: true })
  listAwards(
    @Param('orderPublicId') orderPublicId: string,
    @Headers('x-order-token') orderToken: string,
  ) {
    return this.prizes.listAwardsForOrder(orderPublicId, orderToken);
  }

  @Post('prizes/attempts/:publicId/play')
  @ApiHeader({ name: 'X-Prize-Token', required: true })
  play(
    @Param('publicId') publicId: string,
    @Headers('x-prize-token') accessToken: string,
  ) {
    return this.prizes.playAttempt(publicId, accessToken);
  }

  @Post('prize-awards/:publicId/claim')
  @ApiHeader({ name: 'X-Order-Token', required: true })
  claimWithOrderToken(
    @Param('publicId') publicId: string,
    @Headers('x-order-token') orderToken: string,
    @Body() dto: ClaimPrizeDto,
  ) {
    return this.prizes.claimWithOrderToken(
      publicId,
      dto.orderPublicId,
      orderToken,
    );
  }

  @Get('me/prize-awards')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  listMine(@CurrentUser() user: PublicUserDto) {
    return this.prizes.listMine(user.id);
  }

  @Post('me/prize-awards/:publicId/claim')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  claim(
    @Param('publicId') publicId: string,
    @CurrentUser() user: PublicUserDto,
  ) {
    return this.prizes.claimAsUser(publicId, user.id);
  }
}
