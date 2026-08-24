import { BadRequestException, ConflictException } from '@nestjs/common';
import { createHash } from 'crypto';
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
  let caixaFederal: Record<string, jest.Mock>;
  let config: Record<string, jest.Mock>;
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
    raffleModel.findOneAndUpdate = jest.fn();
    raffleModel.findOne = jest.fn();
    raffleModel.find = jest.fn();
    raffleModel.updateMany = jest.fn().mockResolvedValue({ modifiedCount: 0 });
    media = {
      addReference: jest.fn().mockResolvedValue(undefined),
      removeReference: jest.fn().mockResolvedValue(undefined),
    };
    caixaFederal = {
      assertContestUpcoming: jest.fn().mockResolvedValue({}),
    };
    config = { get: jest.fn().mockReturnValue(undefined) };
    service = new RafflesService(
      raffleModel as any,
      media as any,
      caixaFederal as any,
      config as any,
    );
  });

  describe('campaign creation validation', () => {
    it.each([
      [
        'programación sin fecha',
        { status: CampaignStatus.Scheduled },
        'Una campaña programada necesita launchAt',
      ],
      [
        'estado inicial público',
        { status: CampaignStatus.Active },
        'solo puede crearse como borrador o programada',
      ],
      [
        'estado inicial finalizado',
        {
          status: CampaignStatus.Drawn,
        },
        'solo puede crearse como borrador o programada',
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

    it('permite preparar un borrador Federal sin concurso pero lo exige al abrir ventas', async () => {
      const saved: any[] = [];
      raffleModel.mockImplementation((payload: Record<string, unknown>) => {
        const value = {
          ...payload,
          _id: new Types.ObjectId(),
          save: jest.fn(),
        };
        value.save.mockImplementation(async () => {
          saved.push(value);
          return value;
        });
        return value;
      });

      await expect(
        service.create({
          ...validDto(),
          drawMethod: DrawMethod.FederalLottery,
          federalLottery: {
            firstPrizeDigits: 3,
            secondPrizeDigits: 3,
            combination: 'sum',
          },
        }),
      ).resolves.toEqual(
        expect.objectContaining({ status: CampaignStatus.Draft }),
      );
      expect(saved).toHaveLength(1);

      await expect(
        service.create({
          ...validDto(),
          status: CampaignStatus.Active,
          regulationHtml: '<p>Reglas</p>',
          drawMethod: DrawMethod.FederalLottery,
          federalLottery: {
            firstPrizeDigits: 3,
            secondPrizeDigits: 3,
            combination: 'sum',
          },
        }),
      ).rejects.toThrow('solo puede crearse como borrador o programada');
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

    it('sanitiza y canonicaliza el contenido público antes de persistir su hash legal', async () => {
      let persisted: Record<string, any> | undefined;
      raffleModel.mockImplementation((payload: Record<string, unknown>) => {
        persisted = {
          ...payload,
          _id: new Types.ObjectId(),
          save: jest.fn(),
        };
        persisted.save.mockResolvedValue(persisted);
        return persisted;
      });

      await service.create({
        ...validDto(),
        description:
          '<p onclick="steal()">Descripción</p><iframe src="https://evil.test"></iframe>',
        regulationHtml:
          '<p style="color:red">Reglas <strong>claras</strong></p><script>steal()</script>',
      });

      const safeRegulation = '<p>Reglas <strong>claras</strong></p>';
      expect(persisted).toEqual(
        expect.objectContaining({
          description: '<p>Descripción</p>',
          regulationHtml: safeRegulation,
          regulationHistory: [
            expect.objectContaining({
              version: '1',
              html: safeRegulation,
              sha256: createHash('sha256').update(safeRegulation).digest('hex'),
            }),
          ],
        }),
      );
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
        maxSelectableQuantity: 500,
        maxAllocatedTitles: 2_000,
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

    it('aplica en quote el límite operativo sobre cuotas pagadas y bonus', () => {
      const previous = process.env.ORDER_MAX_ALLOCATED_TITLES;
      process.env.ORDER_MAX_ALLOCATED_TITLES = '2000';
      try {
        const input = campaign();
        input.maxTitlesPerOrder = 1_000;
        input.doubleChance = { enabled: true, multiplier: 3 };

        expect(() => service.calculatePrice(input, 667)).toThrow(
          'más de 2000 títulos, incluidos los bonus',
        );
        expect(service.calculatePrice(input, 666)).toEqual(
          expect.objectContaining({
            allocatedQuantity: 1_998,
            maxSelectableQuantity: 666,
            maxAllocatedTitles: 2_000,
          }),
        );
      } finally {
        if (previous === undefined)
          delete process.env.ORDER_MAX_ALLOCATED_TITLES;
        else process.env.ORDER_MAX_ALLOCATED_TITLES = previous;
      }
    });

    it('no cotiza más títulos asignados que el stock que checkout puede reservar', () => {
      const input = campaign();
      input.totalTitles = 100;
      input.soldCount = 94;
      input.reservedCount = 2;
      input.doubleChance = { enabled: true, multiplier: 2 };

      expect(() => service.calculatePrice(input, 3)).toThrow(
        'No quedan suficientes cuotas disponibles',
      );
      expect(service.calculatePrice(input, 2)).toEqual(
        expect.objectContaining({
          allocatedQuantity: 4,
          maxSelectableQuantity: 2,
        }),
      );
    });
  });

  describe('protección de venta y regla de sorteo', () => {
    it('la búsqueda usada por quote solo admite campañas comprables', async () => {
      const campaign = { status: CampaignStatus.Active };
      const query = { exec: jest.fn().mockResolvedValue(campaign) };
      raffleModel.findOne.mockReturnValue(query);

      await expect(service.findPurchasableBySlug('Titan 160')).resolves.toBe(
        campaign,
      );
      expect(raffleModel.findOne).toHaveBeenCalledWith({
        slug: 'titan-160',
        status: { $in: [CampaignStatus.Active, CampaignStatus.Open] },
        $and: expect.any(Array),
      });

      query.exec.mockResolvedValueOnce(null);
      await expect(service.findPurchasableBySlug('borrador')).rejects.toThrow(
        'Campaña no disponible para compra',
      );
    });

    it.each([
      {
        label: 'aún no lanzada',
        launchAt: new Date(Date.now() + 60_000),
        closesAt: undefined,
        soldCount: 0,
        reservedCount: 0,
      },
      {
        label: 'cerrada por fecha',
        launchAt: undefined,
        closesAt: new Date(Date.now() - 60_000),
        soldCount: 0,
        reservedCount: 0,
      },
      {
        label: 'sin stock',
        launchAt: undefined,
        closesAt: undefined,
        soldCount: 90,
        reservedCount: 10,
      },
    ])('publica isPurchasable=false si está $label', (overrides) => {
      const view = (service as any).toPublicView(
        {
          _id: new Types.ObjectId(),
          status: CampaignStatus.Active,
          totalTitles: 100,
          media: [],
          regulationHistory: [],
          ...overrides,
        },
        true,
      );
      expect(view.isPurchasable).toBe(false);
    });

    it('publica sugerencias y promociones solo dentro del límite efectivo con bonus', () => {
      const previous = process.env.ORDER_MAX_ALLOCATED_TITLES;
      process.env.ORDER_MAX_ALLOCATED_TITLES = '2';
      try {
        const view = (service as any).toPublicView(
          {
            _id: new Types.ObjectId(),
            status: CampaignStatus.Active,
            totalTitles: 100,
            soldCount: 0,
            reservedCount: 0,
            maxTitlesPerOrder: 10,
            quantitySuggestions: [1, 2],
            promotionTiers: [
              { quantity: 1, totalPrice: 1, active: true },
              { quantity: 2, totalPrice: 2, active: true },
            ],
            doubleChance: { enabled: true, multiplier: 2 },
            media: [],
            regulationHistory: [],
          },
          true,
        );

        expect(view.maxTitlesPerOrder).toBe(1);
        expect(view.quantitySuggestions).toEqual([1]);
        expect(view.promotionTiers).toEqual([
          expect.objectContaining({ quantity: 1 }),
        ]);
        expect(view.purchaseLimits).toEqual({
          maxSelectedTitles: 1,
          maxAllocatedTitles: 2,
          allocationMultiplier: 2,
        });
      } finally {
        if (previous === undefined)
          delete process.env.ORDER_MAX_ALLOCATED_TITLES;
        else process.env.ORDER_MAX_ALLOCATED_TITLES = previous;
      }
    });

    it('no activa una campaña Federal sin concurso fijado', async () => {
      await expect(
        (service as any).assertActivationReady(
          {
            drawMethod: DrawMethod.FederalLottery,
            regulationHtml: '<p>Reglas</p>',
            regulationHistory: [],
            federalLottery: {
              firstPrizeDigits: 3,
              secondPrizeDigits: 3,
              combination: 'sum',
            },
          },
          new Date('2026-08-24T12:00:00.000Z'),
          CampaignStatus.Active,
        ),
      ).rejects.toThrow('fijar el concurso Federal');
    });

    it('exige cerrar y fijar antes de ventas el instante de baliza criptográfica', async () => {
      await expect(
        (service as any).assertActivationReady(
          {
            drawMethod: DrawMethod.Cryptographic,
            drawCommitment: 'a'.repeat(64),
            regulationHtml: '<p>Reglas</p>',
            regulationHistory: [],
            termsVersion: '1',
            totalTitles: 100,
            soldCount: 0,
            reservedCount: 0,
          },
          new Date('2026-08-24T12:00:00.000Z'),
          CampaignStatus.Active,
        ),
      ).rejects.toThrow('debe fijar closesAt y drawDate');
    });

    it('consulta CAIXA antes de programar y vuelve a fallar cerrado si no confirma', async () => {
      const at = new Date('2026-08-24T12:00:00.000Z');
      const campaign = {
        drawMethod: DrawMethod.FederalLottery,
        regulationHtml: '<p>Reglas</p>',
        regulationHistory: [],
        termsVersion: '1',
        launchAt: new Date('2026-08-25T12:00:00.000Z'),
        closesAt: new Date('2026-08-29T12:00:00.000Z'),
        drawDate: new Date('2026-08-30T20:00:00.000Z'),
        totalTitles: 1_000,
        soldCount: 0,
        reservedCount: 0,
        federalLottery: {
          contest: '6021',
          firstPrizeDigits: 1,
          secondPrizeDigits: 1,
          combination: 'sum',
        },
      } as any;

      await expect(
        (service as any).assertActivationReady(
          campaign,
          at,
          CampaignStatus.Scheduled,
        ),
      ).resolves.toBeUndefined();
      expect(caixaFederal.assertContestUpcoming).toHaveBeenCalledWith(
        '6021',
        campaign.drawDate,
        at,
      );

      caixaFederal.assertContestUpcoming.mockRejectedValueOnce(
        new Error('CAIXA indisponible'),
      );
      await expect(
        (service as any).assertActivationReady(
          campaign,
          at,
          CampaignStatus.Scheduled,
        ),
      ).rejects.toThrow('CAIXA indisponible');
    });

    it('el ciclo no convierte cierres parciales en AwaitingDraw', async () => {
      const at = new Date('2026-08-24T12:00:00.000Z');
      const findQuery: Record<string, jest.Mock> = {
        limit: jest.fn(),
        exec: jest.fn().mockResolvedValue([]),
      };
      findQuery.limit.mockReturnValue(findQuery);
      raffleModel.find.mockReturnValue(findQuery);
      await service.processLifecycle(at);

      expect(raffleModel.updateMany).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          $expr: { $eq: ['$soldCount', '$totalTitles'] },
          reservedCount: 0,
        }),
        [
          {
            $set: {
              status: CampaignStatus.SoldOut,
              salesClosedAt: { $ifNull: ['$salesClosedAt', at] },
            },
          },
        ],
      );
      expect(raffleModel.updateMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          status: { $in: [CampaignStatus.Active, CampaignStatus.Open] },
          closesAt: { $lte: at },
          $expr: { $lt: ['$soldCount', '$totalTitles'] },
        }),
        { $set: { status: CampaignStatus.Expired } },
      );
      expect(raffleModel.updateMany).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({
          status: CampaignStatus.SoldOut,
          $expr: { $eq: ['$soldCount', '$totalTitles'] },
          reservedCount: 0,
        }),
        { $set: { status: CampaignStatus.AwaitingDraw } },
      );
    });

    it('prorroga con CAS una campaña vencida parcial y conserva actor y motivo', async () => {
      const campaignId = new Types.ObjectId();
      const actorId = new Types.ObjectId();
      const previousClosesAt = new Date(Date.now() - 60_000);
      const closesAt = new Date(Date.now() + 60 * 60_000);
      const drawDate = new Date(Date.now() + 2 * 60 * 60_000);
      const campaign = {
        _id: campaignId,
        __v: 4,
        status: CampaignStatus.Expired,
        closesAt: previousClosesAt,
        drawDate,
        launchAt: new Date(Date.now() - 2 * 60 * 60_000),
        soldCount: 40,
        reservedCount: 0,
        totalTitles: 100,
        drawMethod: DrawMethod.ManualExternal,
        regulationHtml: '<p>Reglas</p>',
        regulationHistory: [
          {
            version: '1',
            html: '<p>Reglas</p>',
            sha256: createHash('sha256').update('<p>Reglas</p>').digest('hex'),
          },
        ],
        termsVersion: '1',
      } as any;
      raffleModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(campaign),
      });
      raffleModel.findOneAndUpdate.mockResolvedValue({
        ...campaign,
        status: CampaignStatus.Active,
      });

      await service.extendExpiredCampaign(
        campaignId.toString(),
        { closesAt: closesAt.toISOString(), reason: ' Demanda comprobada ' },
        actorId.toString(),
      );

      expect(raffleModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: campaignId,
          __v: 4,
          status: CampaignStatus.Expired,
          closesAt: previousClosesAt,
        }),
        expect.objectContaining({
          $set: { status: CampaignStatus.Active, closesAt },
          $unset: { salesClosedAt: 1 },
          $push: {
            lifecycleExtensions: expect.objectContaining({
              $each: [
                expect.objectContaining({
                  previousClosesAt,
                  closesAt,
                  reason: 'Demanda comprobada',
                  extendedBy: actorId,
                }),
              ],
              $slice: -50,
            }),
          },
          $inc: { contractRevision: 1, __v: 1 },
        }),
        { new: true, runValidators: true },
      );
    });

    it('congela todo el contrato económico, legal y aleatorio al salir de Draft', () => {
      const campaign = {
        status: CampaignStatus.Active,
        allocationCursor: 0,
        soldCount: 0,
        reservedCount: 0,
        drawMethod: DrawMethod.FederalLottery,
        federalLottery: {
          contest: '6020',
          firstPrizeDigits: 3,
          secondPrizeDigits: 3,
          combination: 'sum',
        },
      } as Raffle;

      expect(() =>
        (service as any).assertMutableUpdate(campaign, {
          federalLottery: {
            contest: '6021',
            firstPrizeDigits: 3,
            secondPrizeDigits: 3,
            combination: 'sum',
          },
        }),
      ).toThrow('contrato de campaña es inmutable');
      expect(() =>
        (service as any).assertMutableUpdate(campaign, {
          drawMethod: DrawMethod.ManualExternal,
        }),
      ).toThrow('contrato de campaña es inmutable');
      expect(() =>
        (service as any).assertMutableUpdate(campaign, {
          ticketPrice: 0.01,
        }),
      ).toThrow('ticketPrice');
      expect(() =>
        (service as any).assertMutableUpdate(campaign, {
          description: '<p>Contenido actualizado</p>',
        }),
      ).not.toThrow();
    });

    it('bloquea bypass de status, cierre parcial y cancelación con actividad', async () => {
      const campaign = {
        _id: new Types.ObjectId(),
        status: CampaignStatus.Active,
        allocationCursor: 10,
        soldCount: 9,
        reservedCount: 1,
        totalTitles: 100,
        save: jest.fn(),
      } as any;
      raffleModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(campaign),
      });

      expect(() =>
        (service as any).assertMutableUpdate(campaign, {
          status: CampaignStatus.Drawn,
        }),
      ).toThrow('endpoint de transición');
      await expect(
        service.changeStatus(
          campaign._id.toString(),
          CampaignStatus.AwaitingDraw,
        ),
      ).rejects.toThrow('100% de títulos pagados');
      await expect(
        service.changeStatus(campaign._id.toString(), CampaignStatus.Cancelled),
      ).rejects.toThrow('ventas o reservas activas');
    });

    it('impide marcar drawn sin publicar un resultado verificado', async () => {
      const campaign = {
        _id: new Types.ObjectId(),
        status: CampaignStatus.AwaitingDraw,
        allocationCursor: 100,
        soldCount: 100,
        reservedCount: 0,
        totalTitles: 100,
        save: jest.fn(),
      } as any;
      raffleModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(campaign),
      });

      await expect(
        service.changeStatus(campaign._id.toString(), CampaignStatus.Drawn),
      ).rejects.toThrow(
        'solo puede alcanzarse publicando un resultado verificado',
      );
      expect(campaign.save).not.toHaveBeenCalled();
    });

    it('bloquea el contrato con CAS atómico al abandonar Draft', async () => {
      const campaign = {
        _id: new Types.ObjectId(),
        __v: 7,
        status: CampaignStatus.Draft,
        allocationCursor: 0,
        soldCount: 0,
        reservedCount: 0,
        totalTitles: 100,
        drawMethod: DrawMethod.ManualExternal,
        description: '<p onclick="steal()">Descripción</p>',
        regulationHtml:
          '<p style="color:red">Reglas</p><script>steal()</script>',
        regulationHistory: [
          {
            version: '1',
            html: '<p style="color:red">Reglas</p><script>steal()</script>',
            sha256: 'legacy',
            publishedAt: new Date('2026-08-24T00:00:00.000Z'),
          },
        ],
        termsVersion: '1',
      } as any;
      raffleModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(campaign),
      });
      raffleModel.findOneAndUpdate.mockResolvedValue({
        ...campaign,
        status: CampaignStatus.Active,
      });

      await service.changeStatus(
        campaign._id.toString(),
        CampaignStatus.Active,
      );

      expect(raffleModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: campaign._id,
          __v: 7,
          status: CampaignStatus.Draft,
        }),
        expect.objectContaining({
          $set: expect.objectContaining({
            status: CampaignStatus.Active,
            description: '<p>Descripción</p>',
            regulationHtml: '<p>Reglas</p>',
            regulationHistory: [
              expect.objectContaining({
                version: '1',
                html: '<p>Reglas</p>',
                sha256: createHash('sha256')
                  .update('<p>Reglas</p>')
                  .digest('hex'),
              }),
            ],
          }),
          $inc: { contractRevision: 1 },
        }),
        { new: true, runValidators: true },
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
