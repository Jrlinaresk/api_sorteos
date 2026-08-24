import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PublicUserDto } from '../users/dto/public-user.dto';
import { UserRole } from '../users/enums/user-role.enum';
import { NotificationsAdminController } from './notifications-admin.controller';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

describe('Notifications authorization and ownership', () => {
  const user = { id: 'jwt-user-id' } as PublicUserDto;

  it('protects every inbox route with JWT', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, NotificationsController),
    ).toEqual([JwtAuthGuard]);
  });

  it('always scopes inbox operations to CurrentUser', () => {
    const service = {
      listForUser: jest.fn(),
      markRead: jest.fn(),
      registerSubscription: jest.fn(),
      unregisterSubscription: jest.fn(),
    } as unknown as NotificationsService;
    const controller = new NotificationsController(service);

    controller.list(user, {});
    controller.markRead('notification-id', user);
    controller.registerSubscription(user, {
      provider: 'web_push' as never,
      address: 'https://push.example/subscription',
    });
    controller.unregisterSubscription('subscription-id', user);

    expect(service.listForUser).toHaveBeenCalledWith(user.id, {});
    expect(service.markRead).toHaveBeenCalledWith('notification-id', user.id);
    expect(service.registerSubscription).toHaveBeenCalledWith(
      user.id,
      expect.any(Object),
    );
    expect(service.unregisterSubscription).toHaveBeenCalledWith(
      'subscription-id',
      user.id,
    );
  });

  it('protects admin routes and derives the audit actor from the JWT', async () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, NotificationsAdminController),
    ).toEqual([JwtAuthGuard, RolesGuard]);
    expect(
      Reflect.getMetadata(ROLES_KEY, NotificationsAdminController),
    ).toEqual([UserRole.OPERATOR, UserRole.ADMIN]);

    const now = new Date();
    const service = {
      create: jest.fn().mockResolvedValue({
        id: 'notification-id',
        user: { toString: () => 'target-user' },
        title: 'Título',
        body: 'Cuerpo',
        type: 'general',
        data: {},
        deliveryStatus: 'pending',
        deliveryAttempts: 0,
        createdAt: now,
        updatedAt: now,
      }),
    } as unknown as NotificationsService;
    const controller = new NotificationsAdminController(service);
    const dto = {
      userId: '507f1f77bcf86cd799439011',
      title: 'Título',
      body: 'Cuerpo',
    };

    await controller.create(dto, user);

    expect(service.create).toHaveBeenCalledWith(dto, user.id);
  });
});
