import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/index.js';
import { StatsService } from './stats.service.js';

const NOW = new Date('2026-11-13T10:00:00.000Z');
const PERIOD = { from: '2026-11-01', to: '2026-11-03' };
const RANGE = {
  gte: new Date('2026-11-01T00:00:00.000Z'),
  lte: new Date('2026-11-03T23:59:59.999Z'),
};

describe('StatsService', () => {
  const prisma = {
    order: { groupBy: vi.fn() },
    vendor: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
  };
  let service: StatsService;

  const sqlArgs = (call = 0) => prisma.$queryRaw.mock.calls[call].slice(1);

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const moduleRef = await Test.createTestingModule({
      providers: [StatsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(StatsService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('overview', () => {
    it('agrège statuts, montant hors annulee, taux et délai', async () => {
      prisma.order.groupBy.mockResolvedValue([
        {
          status: 'livree',
          _count: { _all: 8 },
          _sum: { totalAmount: 80_000 },
        },
        { status: 'echec', _count: { _all: 2 }, _sum: { totalAmount: 20_000 } },
        {
          status: 'annulee',
          _count: { _all: 1 },
          _sum: { totalAmount: 50_000 },
        },
      ]);
      prisma.$queryRaw.mockResolvedValue([{ average_us: 7_200_000_000 }]);

      await expect(service.overview(PERIOD)).resolves.toEqual({
        ...PERIOD,
        totalOrders: 11,
        totalAmount: 100_000,
        byStatus: {
          non_traitee: 0,
          validee: 0,
          prete: 0,
          livree: 8,
          echec: 2,
          annulee: 1,
        },
        deliveryRate: 80,
        failureRate: 20,
        averageValidationHours: 2,
      });
      expect(prisma.order.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({ where: { createdAt: RANGE } }),
      );
      expect(sqlArgs()).toEqual([
        'validee',
        '2026-11-01 00:00:00.000',
        '2026-11-03 23:59:59.999',
      ]);
    });

    it('renvoie des zéros et null sur une période vide', async () => {
      prisma.order.groupBy.mockResolvedValue([]);
      prisma.$queryRaw.mockResolvedValue([{ average_us: null }]);

      await expect(service.overview({})).resolves.toMatchObject({
        from: '2026-10-15',
        to: '2026-11-13',
        totalOrders: 0,
        totalAmount: 0,
        deliveryRate: null,
        failureRate: null,
        averageValidationHours: null,
      });
    });
  });

  describe('byVendor', () => {
    it('liste tous les vendeurs, y compris sans commande', async () => {
      prisma.vendor.findMany.mockResolvedValue([
        { id: 1n, name: 'Awa' },
        { id: 2n, name: 'Kofi' },
      ]);
      prisma.order.groupBy.mockResolvedValue([
        {
          vendorId: 1n,
          status: 'livree',
          _count: { _all: 2 },
          _sum: { totalAmount: 30_000 },
        },
        {
          vendorId: 1n,
          status: 'annulee',
          _count: { _all: 1 },
          _sum: { totalAmount: 9_000 },
        },
      ]);

      await expect(service.byVendor(PERIOD)).resolves.toEqual({
        ...PERIOD,
        data: [
          { vendorId: 1, vendorName: 'Awa', count: 3, amount: 30_000 },
          { vendorId: 2, vendorName: 'Kofi', count: 0, amount: 0 },
        ],
      });
    });
  });

  describe('byDay', () => {
    it('renvoie chaque jour de la période, à 0 sans commande', async () => {
      prisma.$queryRaw.mockResolvedValue([
        { day: '2026-11-01', status: 'livree', count: 2n, amount: 30_000n },
        { day: '2026-11-03', status: 'annulee', count: 1n, amount: 9_000n },
        { day: '2026-11-03', status: 'echec', count: 1n, amount: 5_000n },
      ]);

      await expect(service.byDay(PERIOD)).resolves.toEqual({
        ...PERIOD,
        data: [
          { day: '2026-11-01', count: 2, amount: 30_000 },
          { day: '2026-11-02', count: 0, amount: 0 },
          { day: '2026-11-03', count: 2, amount: 5_000 },
        ],
      });
      expect(sqlArgs()).toEqual([
        '2026-11-01 00:00:00.000',
        '2026-11-03 23:59:59.999',
      ]);
    });
  });
});
