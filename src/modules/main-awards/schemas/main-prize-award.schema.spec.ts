import { MainPrizeAwardSchema } from './main-prize-award.schema';

describe('MainPrizeAwardSchema delivery privacy', () => {
  it('excluye por defecto los datos logísticos sensibles', () => {
    expect(MainPrizeAwardSchema.path('deliveryDetails').options.select).toBe(
      false,
    );
  });
});
