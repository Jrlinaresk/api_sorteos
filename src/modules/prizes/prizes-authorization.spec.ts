import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { PublicUserDto } from '../users/dto/public-user.dto';
import { UserRole } from '../users/enums/user-role.enum';
import { AdminPrizesController } from './admin-prizes.controller';
import { FulfillPrizeAwardDto } from './dto/fulfill-prize-award.dto';
import { PrizesService } from './prizes.service';

describe('AdminPrizesController authorization', () => {
  it('reserva la entrega exclusivamente para ADMIN', () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, AdminPrizesController.prototype.fulfill),
    ).toEqual([UserRole.ADMIN]);
  });

  it('deriva el actor de CurrentUser y reenvía el contrato al servicio', () => {
    const prizes = { fulfill: jest.fn() } as unknown as PrizesService;
    const controller = new AdminPrizesController(prizes);
    const dto: FulfillPrizeAwardDto = {
      reference: 'TRACKING-123',
      notes: 'Entregado personalmente',
    };
    const actor = { id: 'jwt-admin-id' } as PublicUserDto;

    controller.fulfill('award-public-id', dto, actor);

    expect(prizes.fulfill).toHaveBeenCalledWith(
      'award-public-id',
      dto,
      actor.id,
    );
  });
});
