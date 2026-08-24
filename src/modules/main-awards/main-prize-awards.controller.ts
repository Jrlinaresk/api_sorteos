import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { PublicUserDto } from '../users/dto/public-user.dto';
import { ClaimMainPrizeDto } from './dto/claim-main-prize.dto';
import { MainPrizeAwardsService } from './main-prize-awards.service';

@ApiTags('Main prize awards')
@ApiBearerAuth()
@ApiHeader({
  name: 'X-Order-Token',
  required: false,
  description:
    'Requerido para el ganador invitado; Bearer basta para el dueño registrado',
})
@UseGuards(OptionalJwtAuthGuard)
@Controller('main-awards')
export class MainPrizeAwardsController {
  constructor(private readonly awards: MainPrizeAwardsService) {}

  @Get(':publicId')
  @ApiOperation({
    summary: 'Consultar el premio principal como su propietario',
  })
  find(
    @Param('publicId') publicId: string,
    @Headers('x-order-token') orderToken?: string,
    @CurrentUser() user?: PublicUserDto,
  ) {
    return this.awards.findOwned(publicId, orderToken, user?.id);
  }

  @Post(':publicId/claim')
  @ApiOperation({
    summary:
      'Reclamar el premio y elegir bien físico o alternativa en efectivo',
  })
  claim(
    @Param('publicId') publicId: string,
    @Body() dto: ClaimMainPrizeDto,
    @Headers('x-order-token') orderToken?: string,
    @CurrentUser() user?: PublicUserDto,
  ) {
    return this.awards.claimOwned(publicId, dto, orderToken, user?.id);
  }
}
