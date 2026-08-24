import {
  Body,
  Controller,
  Get,
  Optional,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CaptureReferralClickDto } from './dto/capture-referral-click.dto';
import {
  hashReferralClientAddress,
  ReferralClickRateLimitGuard,
} from './referral-click-rate-limit.guard';
import { ReferralsService } from './referrals.service';

@ApiTags('Referrals')
@Controller('referrals')
export class ReferralsPublicController {
  constructor(
    private readonly referralsService: ReferralsService,
    @Optional() private readonly config?: ConfigService,
  ) {}

  @Get('resolve/:code')
  @ApiOperation({ summary: 'Validar un código sin exponer al beneficiario' })
  resolve(
    @Param('code') code: string,
    @Query('campaignId') campaignId?: string,
  ) {
    return this.referralsService.resolvePublic(code, campaignId);
  }

  @Post('clicks')
  @UseGuards(ReferralClickRateLimitGuard)
  @ApiOperation({ summary: 'Registrar un click/UTM de forma idempotente' })
  async captureClick(
    @Body() dto: CaptureReferralClickDto,
    @Req() request: Request,
  ) {
    const click = await this.referralsService.captureClick(dto, {
      ipHash: hashReferralClientAddress(
        request,
        this.config?.get<string>('REFERRAL_IP_HASH_SECRET'),
      ),
      userAgent: request.get('user-agent')?.slice(0, 1000),
    });
    return {
      clickId: click.id,
      code: click.code,
      recordedAt: click.createdAt,
    };
  }
}
