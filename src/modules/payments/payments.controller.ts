import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { UpdatePaymentStatusDto } from './dto/update-payment-status.dto';
import { PaymentsWebhookGuard } from './guards/payments-webhook.guard';
import { PaymentProviderName, PaymentStatus } from './payment.enums';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/enums/user-role.enum';

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('admin')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.OPERATOR, UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Crear un pago (normalmente OrdersService llama PaymentsService directamente)',
  })
  async create(@Body() dto: CreatePaymentDto) {
    const result = await this.payments.create(dto);
    return {
      payment: this.payments.toAdminView(result.payment),
      accessSecret: result.accessSecret,
      idempotentReplay: result.idempotentReplay,
    };
  }

  @Get('admin')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.OPERATOR, UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiQuery({ name: 'status', enum: PaymentStatus, required: false })
  @ApiQuery({ name: 'page', type: Number, required: false })
  @ApiQuery({ name: 'limit', type: Number, required: false })
  async findAll(
    @Query('status') status?: PaymentStatus,
    @Query('page', new ParseIntPipe({ optional: true })) page?: number,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    const result = await this.payments.findAll(status, page, limit);
    return {
      ...result,
      data: result.data.map((payment) => this.payments.toAdminView(payment)),
    };
  }

  @Get('admin/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.OPERATOR, UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Consultar un pago con todos sus datos operativos' })
  async findAdmin(@Param('id') id: string) {
    return this.payments.toAdminView(await this.payments.findById(id));
  }

  @Post('admin/:id/reconcile')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.OPERATOR, UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Conciliar el estado contra el proveedor' })
  async reconcile(@Param('id') id: string) {
    return this.payments.toAdminView(await this.payments.reconcile(id));
  }

  @Post('admin/:id/retry-lifecycle')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.OPERATOR, UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Reintentar callbacks idempotentes hacia OrdersService',
  })
  async retryLifecycle(@Param('id') id: string) {
    return this.payments.toAdminView(
      await this.payments.retryLifecycleHooks(id),
    );
  }

  @Post('admin/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.OPERATOR, UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancelar una cobranza todavía pagable' })
  async cancel(@Param('id') id: string, @Body('reason') reason?: string) {
    return this.payments.toAdminView(await this.payments.cancel(id, reason));
  }

  @Post('admin/:id/refund')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Solicitar devolución Pix total o parcial' })
  async refund(@Param('id') id: string, @Body() dto: RefundPaymentDto) {
    return this.payments.toAdminView(await this.payments.refund(id, dto));
  }

  @Patch('admin/:id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Transición manual auditada del estado de pago' })
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdatePaymentStatusDto,
  ) {
    return this.payments.toAdminView(
      await this.payments.updateStatus(id, dto.status, dto.reason),
    );
  }

  @Post(['webhooks/:provider', 'webhooks/:provider/pix'])
  @HttpCode(HttpStatus.OK)
  @UseGuards(PaymentsWebhookGuard)
  @ApiParam({ name: 'provider', enum: PaymentProviderName })
  @ApiHeader({ name: 'x-efi-webhook-token', required: false })
  @ApiOperation({ summary: 'Recibir notificaciones idempotentes del PSP' })
  processWebhook(
    @Param('provider') provider: PaymentProviderName,
    @Body() payload: Record<string, unknown>,
  ) {
    return this.payments.processWebhook(provider, payload ?? {});
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Consulta pública segura para la pantalla de pago del comprador',
  })
  @ApiHeader({ name: 'X-Payment-Token', required: true })
  @ApiResponse({ status: HttpStatus.OK, description: 'Estado y datos Pix' })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Secreto inválido',
  })
  findPublic(
    @Param('id') id: string,
    @Headers('x-payment-token') accessSecret: string,
  ) {
    return this.payments.findPublic(id, accessSecret);
  }
}
