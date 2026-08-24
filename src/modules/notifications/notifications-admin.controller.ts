import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PublicUserDto } from '../users/dto/public-user.dto';
import { UserRole } from '../users/enums/user-role.enum';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { ListAdminNotificationsDto } from './dto/list-admin-notifications.dto';
import { toAdminNotification } from './notification.presenter';
import { NotificationsService } from './notifications.service';

/**
 * Superficie separada para aplicar JwtAuthGuard/RolesGuard sin afectar el inbox.
 */
@ApiTags('Admin Notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.OPERATOR, UserRole.ADMIN)
@Controller('admin/notifications')
export class NotificationsAdminController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'Lista notificaciones y su estado de entrega' })
  list(@Query() query: ListAdminNotificationsDto) {
    return this.notificationsService.listAdmin(query);
  }

  @Get(':notificationId')
  @ApiOperation({ summary: 'Consulta una notificación administrativa' })
  async detail(@Param('notificationId') notificationId: string) {
    return toAdminNotification(
      await this.notificationsService.getAdminById(notificationId),
    );
  }

  @Post()
  @ApiOperation({ summary: 'Crear una notificación de usuario' })
  async create(
    @Body() dto: CreateNotificationDto,
    @CurrentUser() user: PublicUserDto,
  ) {
    const notification = await this.notificationsService.create(dto, user.id);
    return toAdminNotification(notification);
  }

  @Post(':notificationId/deliver')
  @ApiOperation({ summary: 'Reintentar la entrega push' })
  async deliver(@Param('notificationId') notificationId: string) {
    const notification =
      await this.notificationsService.deliverPush(notificationId);
    return toAdminNotification(notification);
  }
}
