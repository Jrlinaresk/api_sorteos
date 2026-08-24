import { BadRequestException, ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { RafflesService } from './raffles.service';
import {
  CampaignStatus,
  chooseCoprimeMultiplier,
  DrawMethod,
  Raffle,
  slugifyCampaign,
} from './schema/raffle.schema';

describe('RafflesService domain rules', () => {
  let raffleModel: jest.Mock & Record<string, jest.Mock>;
  let media: Record<string, jest.Mock>;
  let service: RafflesService;

  const validDto = () =>
    ({
      name: 'Titan Brasileirinha',
      totalTitles: 1_000,
      quotaDigits: 3,
      itemPrice: 15_000,
      ticketPrice: 0.2,
      maxTitlesPerOrder: 500,
      currency: 'brl',
      prizeTitle: 'Titan 160 ou R$ 15 mil',
      drawMethod: DrawMethod.ManualExternal,
      status: CampaignStatus.Draft,
      quantitySuggestions: [25, 50, 100],
      promotionTiers: [],
    }) as any;

  beforeEach(() => {
    raffleModel = jest.fn() as jest.Mock & Record<string, jest.Mock>;
    raffleModel.exists = jest.fn().mockResolvedValue(null);
    raffleModel.findById = jest.fn();
    media = {
      addReference: jest.fn().mockResolvedValue(undefined),
      removeReference: jest.fn().mockResolvedValue(undefined),
    };
    service = new RafflesService(raffleModel as any, media as any);
  });

  describe('campaign creation validation', () => {
    it.each([
      [
        'programación sin fecha',
        { status: CampaignStatus.Scheduled },
        'Una campaña programada necesita launchAt',
      ],
      [
        'publicación sin reglamento',
        { status: CampaignStatus.Active },
        'La campaña necesita un reglamento antes de publicarse',
      ],
      [
        'activación criptográfica sin commit previo',
        {
          status: CampaignStatus.Active,
          regulationHtml: '<p>Reglas</p>',
          drawMethod: DrawMethod.Cryptographic,
        },
        'Cree la campaña criptográfica en borrador',
      ],
      [
        'cierre anterior al lanzamiento',
        {
          launchAt: '2026-08-25T12:00:00.000Z',
          closesAt: '2026-08-25T11:59:59.000Z',
        },
        'closesAt debe ser posterior a launchAt',
      ],
      [
        'sugerencia que supera el máximo',
        { quantitySuggestions: [501] },
        'Una cantidad sugerida supera el límite de compra',
      ],
      [
        'promoción más cara que la compra normal',
        {
          promotionTiers: [{ quantity: 10, totalPrice: 2.01, active: true }],
        },
        'Una promoción no puede costar más que el precio normal',
      ],
      [
        'ventana temporal invertida',
        {
          notice: {
            enabled: true,
            startsAt: '2026-08-25T12:00:00.000Z',
            endsAt: '2026-08-25T11:00:00.000Z',
          },
        },
        'El fin de un contenido temporal debe ser posterior al inicio',
      ],
      [
        'juego instantáneo sin tramos',
        {
          instantGame: {
            enabled: true,
            mechanic: 'roulette',
            noPrizeWeight: 1,
            tiers: [],
          },
        },
        'El juego instantáneo necesita al menos un tramo',
      ],
    ])('rechaza %s', async (_label, overrides, message) => {
      await expect(
        service.create({ ...validDto(), ...overrides }),
      ).rejects.toMatchObject({
        message: expect.stringContaining(message),
      });
    });

    it('rechaza una regla Federal concatenada que no cabe en los títulos', async () => {
      await expect(
        service.create({
          ...validDto(),
          drawMethod: DrawMethod.FederalLottery,
          federalLottery: {
            firstPrizeDigits: 3,
            secondPrizeDigits: 3,
            combination: 'concatenate',
          },
        }),
      ).rejects.toThrow(
        'totalTitles/quotaDigits no cubre todos los resultados de la regla federal concatenada',
      );
    });

    it('rechaza slug vacío, duplicado y una capacidad decimal insuficiente', async () => {
      await expect(
        service.create({ ...validDto(), name: '---', slug: '---' }),
      ).rejects.toBeInstanceOf(BadRequestException);

      raffleModel.exists.mockResolvedValueOnce({ _id: new Types.ObjectId() });
      await expect(service.create(validDto())).rejects.toBeInstanceOf(
        ConflictException,
      );

      raffleModel.exists.mockResolvedValueOnce(null);
      await expect(
        service.create({ ...validDto(), totalTitles: 1_001, quotaDigits: 3 }),
      ).rejects.toThrow('quotaDigits no alcanza para totalTitles');
    });

    it('normaliza el slug y la moneda e inicializa contadores de venta', async () => {
      const saved: any[] = [];
      raffleModel.mockImplementation((payload: Record<string, unknown>) => {
        const document = {
          ...payload,
          _id: new Types.ObjectId(),
          save: jest.fn(),
        };
        document.save.mockImplementation(async () => {
          saved.push(document);
          return document;
        });
        return document;
      });

      const result = await service.create(validDto());

      expect(result).toEqual(
        expect.objectContaining({
          slug: 'titan-brasileirinha',
          currency: 'BRL',
          allocationCursor: 0,
          soldCount: 0,
          reservedCount: 0,
          maxParticipants: 1_000,
        }),
      );
      expect(saved).toHaveLength(1);
    });
  });

  describe('pricing', () => {
    const campaign = () =>
      ({
        ticketPrice: 0.1,
        currency: 'BRL',
        maxTitlesPerOrder: 500,
        minimumOrderAmount: 0,
        promotionTiers: [
          { quantity: 100, totalPrice: 7.99, label: 'Oferta', active: true },
          { quantity: 50, totalPrice: 4, label: 'Inactiva', active: false },
        ],
      }) as Raffle;

    it('calcula en centavos una promoción exacta y el bonus de doble oportunidad', () => {
      const at = new Date('2026-08-25T12:00:00.000Z');
      const input = campaign();
      input.doubleChance = {
        enabled: true,
        multiplier: 3,
        startsAt: new Date('2026-08-25T11:00:00.000Z'),
        endsAt: new Date('2026-08-25T13:00:00.000Z'),
      };

      expect(service.calculatePrice(input, 100, at)).toEqual({
        selectedQuantity: 100,
        bonusQuantity: 200,
        allocatedQuantity: 300,
        unitPrice: 0.1,
        subtotal: 10,
        discount: 2.01,
        total: 7.99,
        currency: 'BRL',
        promotion: { quantity: 100, totalPrice: 7.99, label: 'Oferta' },
        doubleChanceMultiplier: 3,
      });
    });

    it('no aplica promociones inactivas ni contenido fuera de su ventana', () => {
      const at = new Date('2026-08-25T14:00:00.000Z');
      const input = campaign();
      input.doubleChance = {
        enabled: true,
        multiplier: 2,
        endsAt: new Date('2026-08-25T13:00:00.000Z'),
      };

      expect(service.calculatePrice(input, 50, at)).toEqual(
        expect.objectContaining({
          subtotal: 5,
          total: 5,
          discount: 0,
          allocatedQuantity: 50,
          bonusQuantity: 0,
          promotion: undefined,
        }),
      );
    });

    it.each([0, -1, 1.5])(
      'rechaza cantidad no positiva/entera: %s',
      (quantity) => {
        expect(() => service.calculatePrice(campaign(), quantity)).toThrow(
          'La cantidad debe ser un entero positivo',
        );
      },
    );

    it('aplica máximo por pedido y mínimo monetario sobre el precio final', () => {
      expect(() => service.calculatePrice(campaign(), 501)).toThrow(
        'La compra no puede superar 500 cuotas',
      );
      const input = campaign();
      input.minimumOrderAmount = 8;
      expect(() => service.calculatePrice(input, 100)).toThrow(
        'La compra mínima es BRL 8.00',
      );
    });
  });

  it('genera slugs canónicos y multiplicadores coprimos', () => {
    expect(slugifyCampaign('  Titán 160 — Edição BR!  ')).toBe(
      'titan-160-edicao-br',
    );
    const multiplier = chooseCoprimeMultiplier(1_000);
    const gcd = (left: number, right: number): number =>
      right === 0 ? left : gcd(right, left % right);
    expect(multiplier).toBeGreaterThan(0);
    expect(multiplier).toBeLessThan(1_000);
    expect(gcd(multiplier, 1_000)).toBe(1);
  });
});
