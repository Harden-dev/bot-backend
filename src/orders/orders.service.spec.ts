import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  INVALID_PERIOD_MESSAGE,
  MAX_ORDER_TOTAL,
  ORDER_TOTAL_EXCEEDED_MESSAGE,
  OrderTotalExceededError,
} from '../common/index.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/index.js';
import type { ListOrdersQueryDto } from './dto/list-orders.query.dto.js';
import {
  ORDER_NOT_EDITABLE_MESSAGE,
  ORDER_NOT_FOUND_MESSAGE,
  type CreateOrderInput,
  OrdersService,
} from './orders.service.js';

const CREATED_AT = new Date('2026-11-10T09:00:00.000Z');

const ORDER = {
  id: 7n,
  reference: 'CMD-20261110-003',
  vendorId: 2n,
  customerName: 'Aya',
  customerPhone: '0707070707',
  deliveryLocation: 'Cocody',
  notes: null,
  status: 'non_traitee' as const,
  totalAmount: 38_000,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
  vendor: { id: 2n, name: 'Boutique Awa' },
  items: [
    { id: 1n, orderId: 7n, label: 'Robe', quantity: 2, unitPrice: 15_000 },
  ],
  statusHistory: [
    {
      id: 1n,
      orderId: 7n,
      fromStatus: null,
      toStatus: 'non_traitee',
      changedByUserId: null,
      comment: null,
      changedAt: CREATED_AT,
    },
  ],
};

const INPUT: CreateOrderInput = {
  vendorId: 2n,
  customerName: 'Aya',
  customerPhone: '0707070707',
  deliveryLocation: 'Cocody',
  items: [
    { label: 'Robe', quantity: 2, unitPrice: 15_000 },
    { label: 'Sac', quantity: 1, unitPrice: 8_000 },
  ],
};

function prismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError('erreur', {
    code,
    clientVersion: 'test',
  });
}

function query(overrides: Partial<ListOrdersQueryDto> = {}) {
  return { page: 1, limit: 20, ...overrides } as ListOrdersQueryDto;
}

describe('OrdersService', () => {
  const order = {
    create: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    groupBy: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  };
  const tx = { order, $executeRaw: vi.fn(), $queryRaw: vi.fn() };
  // Connexion du service (hors transaction) : compteur du jour en autocommit.
  const prisma = {
    order,
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    $transaction: vi.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  let service: OrdersService;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(CREATED_AT);
    const moduleRef = await Test.createTestingModule({
      providers: [OrdersService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(OrdersService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('create', () => {
    const sql = (mock: ReturnType<typeof vi.fn>, call = 0) =>
      (mock.mock.calls[call][0] as string[]).join('?');

    beforeEach(() => {
      prisma.$queryRaw.mockResolvedValue([{ found: 1 }]);
      prisma.$executeRaw.mockResolvedValue(1);
      tx.$executeRaw.mockResolvedValue(1);
      tx.$queryRaw.mockResolvedValue([{ last_seq: 3 }]);
      order.create.mockResolvedValue(ORDER);
    });

    it('crée la commande, ses articles et l’historique initial avec la référence du jour', async () => {
      await expect(service.create(INPUT)).resolves.toBe(ORDER);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
      expect(sql(tx.$executeRaw)).toContain(
        'UPDATE daily_counters SET last_seq = last_seq + 1 WHERE day = ?',
      );
      expect(tx.$executeRaw.mock.calls[0][1]).toBe('2026-11-10');
      expect(sql(tx.$queryRaw)).toContain('FOR UPDATE');
      expect(order.create).toHaveBeenCalledWith({
        data: {
          reference: 'CMD-20261110-003',
          vendorId: 2n,
          customerName: 'Aya',
          customerPhone: '0707070707',
          deliveryLocation: 'Cocody',
          notes: null,
          totalAmount: 38_000,
          createdAt: CREATED_AT,
          items: {
            create: [
              { label: 'Robe', quantity: 2, unitPrice: 15_000 },
              { label: 'Sac', quantity: 1, unitPrice: 8_000 },
            ],
          },
          statusHistory: {
            create: {
              fromStatus: null,
              toStatus: 'non_traitee',
              changedByUserId: null,
              changedAt: CREATED_AT,
            },
          },
        },
      });
    });

    it('utilise la transaction de l’appelant sans en ouvrir une autre', async () => {
      tx.$queryRaw.mockResolvedValue([{ last_seq: 1000n }]);

      await service.create({ ...INPUT, notes: 'Fragile' }, tx as never);

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(order.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          reference: 'CMD-20261110-1000',
          notes: 'Fragile',
        }),
      });
    });

    it('crée la ligne du jour hors transaction si elle manque', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await service.create(INPUT);

      expect(sql(prisma.$executeRaw)).toContain(
        'INSERT IGNORE INTO daily_counters (day, last_seq) VALUES (?, 0)',
      );
      expect(prisma.$executeRaw.mock.calls[0][1]).toBe('2026-11-10');
      expect(prisma.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
        tx.$executeRaw.mock.invocationCallOrder[0],
      );
    });

    it('avec tx, n’utilise pas la connexion du service (ligne du jour préparée par l’appelant)', async () => {
      await service.create(INPUT, tx as never);

      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('prepareDailyCounter crée la ligne du jour si elle manque, rien sinon', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);
      await service.prepareDailyCounter(new Date('2026-11-11T23:59:59.999Z'));
      expect(prisma.$executeRaw).toHaveBeenCalledOnce();
      expect(prisma.$executeRaw.mock.calls[0][1]).toBe('2026-11-11');

      await service.prepareDailyCounter();
      expect(prisma.$executeRaw).toHaveBeenCalledOnce();
      expect(prisma.$queryRaw.mock.calls[1][1]).toBe('2026-11-10');
    });

    it('échoue si la ligne du compteur est absente dans la transaction', async () => {
      tx.$executeRaw.mockResolvedValue(0);

      await expect(service.create(INPUT, tx as never)).rejects.toThrow(
        'Compteur journalier absent pour 2026-11-10',
      );
      expect(order.create).not.toHaveBeenCalled();
    });

    it('relance sa propre transaction sur conflit P2034, 3 fois au plus', async () => {
      prisma.$transaction
        .mockRejectedValueOnce(prismaError('P2034'))
        .mockRejectedValueOnce(prismaError('P2034'));

      await expect(service.create(INPUT)).resolves.toBe(ORDER);
      expect(prisma.$transaction).toHaveBeenCalledTimes(3);

      prisma.$transaction.mockClear();
      prisma.$transaction
        .mockRejectedValueOnce(prismaError('P2034'))
        .mockRejectedValueOnce(prismaError('P2034'))
        .mockRejectedValueOnce(prismaError('P2034'));
      await expect(service.create(INPUT)).rejects.toMatchObject({
        code: 'P2034',
      });
      expect(prisma.$transaction).toHaveBeenCalledTimes(3);
    });

    it('ne relance pas sur une autre erreur', async () => {
      const error = prismaError('P2003');
      prisma.$transaction.mockRejectedValueOnce(error);

      await expect(service.create(INPUT)).rejects.toBe(error);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('ne relance pas la transaction de l’appelant', async () => {
      const error = prismaError('P2034');
      tx.$executeRaw.mockRejectedValueOnce(error);

      await expect(service.create(INPUT, tx as never)).rejects.toBe(error);
      expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('refuse un total au-delà du plafond sans toucher au compteur', async () => {
      const items = [
        { label: 'A', quantity: 1, unitPrice: MAX_ORDER_TOTAL },
        { label: 'B', quantity: 1, unitPrice: 1 },
      ];

      await expect(service.create({ ...INPUT, items })).rejects.toThrow(
        OrderTotalExceededError,
      );
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(tx.$executeRaw).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    beforeEach(() => {
      order.findMany.mockResolvedValue([ORDER]);
      order.count.mockResolvedValue(41);
    });

    it('renvoie { data, meta } trié par date décroissante, ids en number', async () => {
      const result = await service.findAll(query({ page: 3 }));

      expect(result.meta).toEqual({ page: 3, limit: 20, total: 41 });
      expect(result.data[0]).toMatchObject({
        id: 7,
        vendor: { id: 2, name: 'Boutique Awa' },
      });
      expect(order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: undefined, createdAt: undefined },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: 40,
          take: 20,
        }),
      );
    });

    it('cumule statut, vendeur et bornes de dates incluses (UTC)', async () => {
      await service.findAll(
        query({
          status: 'validee',
          vendorId: 2,
          from: '2026-11-01',
          to: '2026-11-10',
        }),
      );

      expect(order.count).toHaveBeenCalledWith({
        where: {
          status: 'validee',
          vendorId: 2n,
          createdAt: {
            gte: new Date('2026-11-01T00:00:00.000Z'),
            lte: new Date('2026-11-10T23:59:59.999Z'),
          },
        },
      });
    });

    it('accepte une seule borne de date', async () => {
      await service.findAll(query({ to: '2026-11-10' }));

      expect(order.count).toHaveBeenCalledWith({
        where: {
          status: undefined,
          createdAt: {
            gte: undefined,
            lte: new Date('2026-11-10T23:59:59.999Z'),
          },
        },
      });
    });

    it('cherche sur la référence et le nom pour un texte', async () => {
      await service.findAll(query({ search: 'Aya' }));

      expect(order.count).toHaveBeenCalledWith({
        where: {
          status: undefined,
          createdAt: undefined,
          OR: [
            { reference: { startsWith: 'Aya' } },
            { customerName: { contains: 'Aya' } },
          ],
        },
      });
    });

    it('cherche aussi sur les chiffres du téléphone pour une saisie numérique', async () => {
      await service.findAll(query({ search: '07 07.07' }));

      expect(order.count).toHaveBeenCalledWith({
        where: {
          status: undefined,
          createdAt: undefined,
          OR: [
            { reference: { startsWith: '07 07.07' } },
            { customerName: { contains: '07 07.07' } },
            { customerPhone: { contains: '070707' } },
          ],
        },
      });
    });

    it('échappe les jokers LIKE (%, _, \\)', async () => {
      await service.findAll(query({ search: String.raw`A_%\b` }));

      expect(order.count.mock.calls[0][0].where.OR).toEqual([
        { reference: { startsWith: String.raw`A\_\%\\b` } },
        { customerName: { contains: String.raw`A\_\%\\b` } },
      ]);
    });

    it('ramène un numéro complet aux 10 chiffres stockés', async () => {
      await service.findAll(query({ search: '+225 07 07 07 07 07' }));

      expect(order.count.mock.calls[0][0].where.OR).toContainEqual({
        customerPhone: { contains: '0707070707' },
      });
    });

    it('refuse from > to en 400 (PO-20)', async () => {
      await expect(
        service.findAll(query({ from: '2026-11-11', to: '2026-11-10' })),
      ).rejects.toThrow(new BadRequestException(INVALID_PERIOD_MESSAGE));
      expect(order.findMany).not.toHaveBeenCalled();
    });

    it('ignore une recherche vide', async () => {
      await service.findAll(query({ search: '' }));

      expect(order.count).toHaveBeenCalledWith({
        where: { status: undefined, createdAt: undefined },
      });
    });
  });

  it('compte les 6 statuts, 0 pour un statut sans commande', async () => {
    order.groupBy.mockResolvedValue([
      { status: 'non_traitee', _count: { _all: 4 } },
      { status: 'livree', _count: { _all: 2 } },
    ]);

    await expect(service.counts()).resolves.toEqual({
      non_traitee: 4,
      validee: 0,
      prete: 0,
      livree: 2,
      echec: 0,
      annulee: 0,
    });
  });

  it('renvoie les dernières commandes du vendeur, plus récente d’abord', async () => {
    const recent = [
      { reference: 'CMD-20261110-003', status: 'validee', totalAmount: 38_000 },
    ];
    order.findMany.mockResolvedValue(recent);

    await expect(service.findRecentByVendor(2n, 5)).resolves.toBe(recent);
    expect(order.findMany).toHaveBeenCalledWith({
      where: { vendorId: 2n },
      select: { reference: true, status: true, totalAmount: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 5,
    });
  });

  describe('findOne', () => {
    it('renvoie le détail : articles, vendeur, historique', async () => {
      order.findUnique.mockResolvedValue(ORDER);

      await expect(service.findOne(7n)).resolves.toMatchObject({
        id: 7,
        notes: null,
        items: [{ id: 1, label: 'Robe', quantity: 2, unitPrice: 15_000 }],
        history: [
          {
            id: 1,
            fromStatus: null,
            toStatus: 'non_traitee',
            changedByUserId: null,
          },
        ],
      });
    });

    it('répond 404 pour une commande inconnue', async () => {
      order.findUnique.mockResolvedValue(null);

      await expect(service.findOne(99n)).rejects.toThrow(
        new NotFoundException(ORDER_NOT_FOUND_MESSAGE),
      );
    });
  });

  describe('update', () => {
    beforeEach(() => {
      order.findUnique.mockResolvedValue(ORDER);
    });

    it('met à jour les champs fournis, remplace les articles et recalcule le total', async () => {
      tx.$queryRaw.mockResolvedValue([{ status: 'validee' }]);

      await service.update(7n, {
        customerPhone: '0505050505',
        notes: '',
        items: [{ label: 'Pagne', quantity: 3, unitPrice: 5_000 }],
      });

      expect(tx.$queryRaw.mock.calls[0][0].join('?')).toContain('FOR UPDATE');
      expect(order.update).toHaveBeenCalledWith({
        where: { id: 7n },
        data: {
          customerName: undefined,
          customerPhone: '0505050505',
          deliveryLocation: undefined,
          notes: null,
          totalAmount: 15_000,
          items: {
            deleteMany: {},
            create: [{ label: 'Pagne', quantity: 3, unitPrice: 5_000 }],
          },
        },
      });
    });

    it.each(['prete', 'livree', 'echec', 'annulee'])(
      'refuse la correction en %s (409, PO-14)',
      async (status) => {
        tx.$queryRaw.mockResolvedValue([{ status }]);

        await expect(service.update(7n, { notes: 'x' })).rejects.toThrow(
          new ConflictException(ORDER_NOT_EDITABLE_MESSAGE),
        );
        expect(order.update).not.toHaveBeenCalled();
      },
    );

    it('refuse un total au-delà du plafond en 400 (PO-01)', async () => {
      await expect(
        service.update(7n, {
          items: [
            { label: 'A', quantity: 1, unitPrice: MAX_ORDER_TOTAL },
            { label: 'B', quantity: 1, unitPrice: 1 },
          ],
        }),
      ).rejects.toThrow(new BadRequestException(ORDER_TOTAL_EXCEEDED_MESSAGE));
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('répond 404 pour une commande inconnue', async () => {
      tx.$queryRaw.mockResolvedValue([]);

      await expect(service.update(99n, {})).rejects.toThrow(
        new NotFoundException(ORDER_NOT_FOUND_MESSAGE),
      );
    });
  });

  describe('changeStatus', () => {
    beforeEach(() => {
      order.findUnique.mockResolvedValue(ORDER);
    });

    it('change le statut et écrit l’historique avec l’utilisateur', async () => {
      tx.$queryRaw.mockResolvedValue([{ status: 'non_traitee' }]);

      await service.changeStatus(7n, { status: 'validee', comment: 'OK' }, 1n);

      expect(order.update).toHaveBeenCalledWith({
        where: { id: 7n },
        data: {
          status: 'validee',
          statusHistory: {
            create: {
              fromStatus: 'non_traitee',
              toStatus: 'validee',
              changedByUserId: 1n,
              comment: 'OK',
              changedAt: CREATED_AT,
            },
          },
        },
      });
    });

    it('enregistre un commentaire absent ou vide à NULL', async () => {
      tx.$queryRaw.mockResolvedValue([{ status: 'prete' }]);

      await service.changeStatus(7n, { status: 'echec', comment: '' }, 1n);
      await service.changeStatus(7n, { status: 'echec' }, 1n);

      for (const [args] of order.update.mock.calls) {
        expect(args.data.statusHistory.create.comment).toBeNull();
      }
    });

    it('refuse une transition interdite en 409 sans écrire', async () => {
      tx.$queryRaw.mockResolvedValue([{ status: 'livree' }]);

      await expect(
        service.changeStatus(7n, { status: 'annulee' }, 1n),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(order.update).not.toHaveBeenCalled();
    });
  });
});
