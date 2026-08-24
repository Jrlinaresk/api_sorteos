import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PublicUserDto } from '../users/dto/public-user.dto';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import { RegisterPushSubscriptionDto } from './dto/register-push-subscription.dto';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('push/config')
  @ApiOperation({ summary: 'Obtener configuración pública de Web Push' })
  pushConfiguration() {
    return this.notificationsService.getPushPublicConfiguration();
  }

  @Get('me')
  @ApiOperation({ summary: 'Listar el inbox paginado de un usuario' })
  list(
    @CurrentUser() user: PublicUserDto,
    @Query() query: ListNotificationsQueryDto,
  ) {
    return this.notificationsService.listForUser(user.id, query);
  }

  @Get('me/unread-count')
  @ApiOperation({ summary: 'Contar notificaciones no leídas' })
  unreadCount(@CurrentUser() user: PublicUserDto) {
    return this.notificationsService.unreadCount(user.id);
  }

  @Patch(':notificationId/read')
  @ApiOperation({ summary: 'Marcar como leída verificando pertenencia' })
  markRead(
    @Param('notificationId') notificationId: string,
    @CurrentUser() user: PublicUserDto,
  ) {
    return this.notificationsService.markRead(notificationId, user.id);
  }

  @Patch('me/read-all')
  @ApiOperation({ summary: 'Marcar todo el inbox como leído' })
  markAllRead(@CurrentUser() user: PublicUserDto) {
    return this.notificationsService.markAllRead(user.id);
  }

  @Post('subscriptions')
  @ApiOperation({ summary: 'Registrar o renovar una suscripción push' })
  registerSubscription(
    @CurrentUser() user: PublicUserDto,
    @Body() dto: RegisterPushSubscriptionDto,
  ) {
    return this.notificationsService.registerSubscription(user.id, dto);
  }

  @Delete('subscriptions/:subscriptionId')
  @ApiOperation({ summary: 'Desactivar una suscripción push propia' })
  unregisterSubscription(
    @Param('subscriptionId') subscriptionId: string,
    @CurrentUser() user: PublicUserDto,
  ) {
    return this.notificationsService.unregisterSubscription(
      subscriptionId,
      user.id,
    );
  }

  @Get('me/preferences')
  @ApiOperation({ summary: 'Obtener preferencias de notificación' })
  getPreferences(@CurrentUser() user: PublicUserDto) {
    return this.notificationsService.getPreferences(user.id);
  }

  @Put('me/preferences')
  @ApiOperation({ summary: 'Actualizar preferencias de notificación' })
  updatePreferences(
    @CurrentUser() user: PublicUserDto,
    @Body() dto: UpdateNotificationPreferencesDto,
  ) {
    return this.notificationsService.updatePreferences(user.id, dto);
  }
}
