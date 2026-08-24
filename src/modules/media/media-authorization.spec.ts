import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PublicUserDto } from '../users/dto/public-user.dto';
import { UserRole } from '../users/enums/user-role.enum';
import { MediaAdminController } from './media-admin.controller';
import { MediaPublicController } from './media-public.controller';
import { MediaService } from './media.service';

describe('media authorization', () => {
  it('protects admin endpoints and restricts deletion to admins', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, MediaAdminController)).toEqual([
      JwtAuthGuard,
      RolesGuard,
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, MediaAdminController)).toEqual([
      UserRole.OPERATOR,
      UserRole.ADMIN,
    ]);
    expect(
      Reflect.getMetadata(ROLES_KEY, MediaAdminController.prototype.remove),
    ).toEqual([UserRole.ADMIN]);
  });

  it('derives the uploader and deleter from CurrentUser', () => {
    const service = {
      createFromUpload: jest.fn(),
      softDelete: jest.fn(),
    } as unknown as MediaService;
    const controller = new MediaAdminController(service);
    const user = { id: 'jwt-user-id' } as PublicUserDto;
    const file = { path: '/tmp/opaque.upload' } as Express.Multer.File;

    controller.upload(file, user);
    controller.remove('media-id', user);

    expect(service.createFromUpload).toHaveBeenCalledWith(file, user.id);
    expect(service.softDelete).toHaveBeenCalledWith('media-id', user.id);
  });

  it('keeps the read controller public', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, MediaPublicController),
    ).toBeUndefined();
  });
});
